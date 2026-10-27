#!/usr/bin/env python3
"""
Standalone Experiment: 1-Hidden-Layer Perceptron (MLP) with Leave-One-Out (LOOCV)
=================================================================================
Tests a 1-hidden-layer neural network (perceptron with tanh hidden layer) trained via
strict Leave-One-Out Cross-Validation (634 folds, one per individual) to map genetic
Principal Components (2D vs 5D) onto the 3D Globe:
  1. Linear LOO Baseline (Planar Lon/Lat & 3D Unit Sphere)
  2. 1-Hidden-Layer Perceptron LOO (Planar Lon/Lat)
  3. 1-Hidden-Layer Spherical Perceptron LOO (3D Globe Unit Vectors [X, Y, Z] -> Lon/Lat)

Evaluates both Leave-One-Individual-Out (634 folds) and Leave-One-Population-Out (52 folds)
using Great-Circle Haversine distance (km) on the spherical Earth as well as Lon/Lat r.
"""

import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import pearsonr
import matplotlib.pyplot as plt
import seaborn as sns

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
RAW = ROOT / "data" / "raw"
RESULTS_PLOTS = ROOT / "results" / "plots"
RESULTS_STATS = ROOT / "results" / "stats"


def lonlat_to_xyz(lon_deg, lat_deg):
    """Convert spherical (lon, lat) in degrees to 3D unit-sphere coordinates (x, y, z)."""
    lam = np.radians(lon_deg)
    phi = np.radians(lat_deg)
    x = np.cos(phi) * np.cos(lam)
    y = np.cos(phi) * np.sin(lam)
    z = np.sin(phi)
    return np.column_stack([x, y, z])


def xyz_to_lonlat(xyz):
    """Project 3D vectors onto the unit sphere and convert back to (lon_deg, lat_deg)."""
    norms = np.linalg.norm(xyz, axis=-1, keepdims=True)
    u = xyz / np.clip(norms, 1e-12, None)
    lon_deg = np.degrees(np.arctan2(u[..., 1], u[..., 0]))
    lat_deg = np.degrees(np.arcsin(np.clip(u[..., 2], -1.0, 1.0)))
    return lon_deg, lat_deg


def haversine_km(lon1, lat1, lon2, lat2):
    """Great-circle distance in kilometers on the spherical Earth (R = 6371.0 km)."""
    R = 6371.0
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlam = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlam / 2.0) ** 2
    return 2.0 * R * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def fit_predict_mlp_1hidden(X_train, Y_train, X_test, n_hidden=20, alpha=1e-2, seed=42):
    """
    Train a 1-hidden-layer perceptron:
        H = tanh(X @ W1 + b1)
        Y_hat = H @ W2 + b2 + X @ W_skip
    Wait: let's test a pure 1-hidden-layer perceptron:
        H = tanh(X @ W1 + b1)
        Y_hat = H @ W2 + b2
    using analytical gradients + L-BFGS-B for fast, exact convergence on each LOO fold.
    """
    n_samples, d_in = X_train.shape
    d_out = Y_train.shape[1]

    # Standardize inputs and targets using ONLY X_train, Y_train (zero leakage)
    x_mean = X_train.mean(axis=0)
    x_std = X_train.std(axis=0) + 1e-8
    y_mean = Y_train.mean(axis=0)
    y_std = Y_train.std(axis=0) + 1e-8

    Xn = (X_train - x_mean) / x_std
    Yn = (Y_train - y_mean) / y_std
    Xtest_n = (X_test - x_mean) / x_std

    rng = np.random.default_rng(seed)
    W1_init = rng.normal(0.0, 1.0 / np.sqrt(d_in), size=(d_in, n_hidden))
    b1_init = np.zeros(n_hidden)
    W2_init = rng.normal(0.0, 1.0 / np.sqrt(n_hidden), size=(n_hidden, d_out))
    b2_init = np.zeros(d_out)

    theta0 = np.concatenate([W1_init.ravel(), b1_init, W2_init.ravel(), b2_init])
    idx1 = d_in * n_hidden
    idx2 = idx1 + n_hidden
    idx3 = idx2 + n_hidden * d_out

    def loss_and_grad(theta):
        W1 = theta[:idx1].reshape(d_in, n_hidden)
        b1 = theta[idx1:idx2]
        W2 = theta[idx2:idx3].reshape(n_hidden, d_out)
        b2 = theta[idx3:]

        Z1 = Xn @ W1 + b1
        H = np.tanh(Z1)
        Pred = H @ W2 + b2
        Diff = Pred - Yn

        # MSE + L2 weight decay on W1, W2
        mse = 0.5 * np.mean(np.sum(Diff ** 2, axis=1))
        reg = 0.5 * alpha * (np.sum(W1 ** 2) + np.sum(W2 ** 2))
        loss = mse + reg

        dPred = Diff / n_samples
        dW2 = H.T @ dPred + alpha * W2
        db2 = np.sum(dPred, axis=0)
        dH = dPred @ W2.T
        dZ1 = dH * (1.0 - H ** 2)
        dW1 = Xn.T @ dZ1 + alpha * W1
        db1 = np.sum(dZ1, axis=0)

        grad = np.concatenate([dW1.ravel(), db1, dW2.ravel(), db2])
        return loss, grad

    res = minimize(
        loss_and_grad,
        theta0,
        method="L-BFGS-B",
        jac=True,
        options={"maxiter": 120, "ftol": 1e-7}
    )
    theta_opt = res.x
    W1 = theta_opt[:idx1].reshape(d_in, n_hidden)
    b1 = theta_opt[idx1:idx2]
    W2 = theta_opt[idx2:idx3].reshape(n_hidden, d_out)
    b2 = theta_opt[idx3:]

    H_test = np.tanh(Xtest_n @ W1 + b1)
    Ytest_n = H_test @ W2 + b2
    return Ytest_n * y_std + y_mean


def run_loocv_suite(X, lon, lat, pops, n_hidden=20, alpha=0.05):
    """
    Runs strict 634-fold Leave-One-Individual-Out (LOOCV) and 52-fold Leave-One-Population-Out (LOPO)
    for:
      1. Linear OLS (Planar Lon/Lat)
      2. Linear Spherical OLS (3D Globe X, Y, Z -> Lon/Lat)
      3. 1-Hidden-Layer Perceptron (Planar Lon/Lat)
      4. 1-Hidden-Layer Spherical Perceptron (3D Globe X, Y, Z -> Lon/Lat)
    """
    N = len(lon)
    Y_deg = np.column_stack([lon, lat])
    Y_xyz = lonlat_to_xyz(lon, lat)

    pred_lin_deg = np.zeros((N, 2))
    pred_lin_xyz = np.zeros((N, 3))
    pred_mlp_deg = np.zeros((N, 2))
    pred_mlp_xyz = np.zeros((N, 3))

    t0 = time.time()
    for i in range(N):
        mask = np.ones(N, dtype=bool)
        mask[i] = False
        X_tr, X_te = X[mask], X[i:i+1]

        # 1. Linear Planar LOO
        X_tr_1 = np.column_stack([np.ones(N - 1), X_tr])
        X_te_1 = np.column_stack([np.ones(1), X_te])
        B_deg = np.linalg.lstsq(X_tr_1, Y_deg[mask], rcond=None)[0]
        pred_lin_deg[i] = (X_te_1 @ B_deg)[0]

        # 2. Linear Spherical 3D LOO
        B_xyz = np.linalg.lstsq(X_tr_1, Y_xyz[mask], rcond=None)[0]
        pred_lin_xyz[i] = (X_te_1 @ B_xyz)[0]

        # 3. 1-Hidden-Layer Perceptron Planar LOO
        pred_mlp_deg[i] = fit_predict_mlp_1hidden(
            X_tr, Y_deg[mask], X_te, n_hidden=n_hidden, alpha=alpha, seed=42
        )[0]

        # 4. 1-Hidden-Layer Perceptron Spherical 3D Globe LOO
        pred_mlp_xyz[i] = fit_predict_mlp_1hidden(
            X_tr, Y_xyz[mask], X_te, n_hidden=n_hidden, alpha=alpha, seed=42
        )[0]

    elapsed = time.time() - t0
    lin_sph_lon, lin_sph_lat = xyz_to_lonlat(pred_lin_xyz)
    mlp_sph_lon, mlp_sph_lat = xyz_to_lonlat(pred_mlp_xyz)

    # Also run Leave-One-Population-Out (52 folds) for 1-Hidden-Layer Spherical Perceptron
    # to test how it generalizes to completely unseen regional populations!
    pred_lopo_mlp_xyz = np.zeros((N, 3))
    pred_lopo_lin_xyz = np.zeros((N, 3))
    for pop in np.unique(pops):
        te_mask = (pops == pop)
        tr_mask = ~te_mask
        X_tr, X_te = X[tr_mask], X[te_mask]
        X_tr_1 = np.column_stack([np.ones(tr_mask.sum()), X_tr])
        X_te_1 = np.column_stack([np.ones(te_mask.sum()), X_te])
        B_xyz = np.linalg.lstsq(X_tr_1, Y_xyz[tr_mask], rcond=None)[0]
        pred_lopo_lin_xyz[te_mask] = X_te_1 @ B_xyz
        pred_lopo_mlp_xyz[te_mask] = fit_predict_mlp_1hidden(
            X_tr, Y_xyz[tr_mask], X_te, n_hidden=n_hidden, alpha=alpha, seed=42
        )
    lopo_lin_lon, lopo_lin_lat = xyz_to_lonlat(pred_lopo_lin_xyz)
    lopo_mlp_lon, lopo_mlp_lat = xyz_to_lonlat(pred_lopo_mlp_xyz)

    results = {
        "lin_planar": (pred_lin_deg[:, 0], pred_lin_deg[:, 1]),
        "lin_spherical": (lin_sph_lon, lin_sph_lat),
        "mlp_planar": (pred_mlp_deg[:, 0], pred_mlp_deg[:, 1]),
        "mlp_spherical": (mlp_sph_lon, mlp_sph_lat),
        "lopo_lin_spherical": (lopo_lin_lon, lopo_lin_lat),
        "lopo_mlp_spherical": (lopo_mlp_lon, lopo_mlp_lat),
        "elapsed_sec": elapsed,
    }
    return results


def summarize_predictions(name, pred_lon, pred_lat, true_lon, true_lat, pops):
    r_lon, _ = pearsonr(pred_lon, true_lon)
    r_lat, _ = pearsonr(pred_lat, true_lat)
    km_err = haversine_km(pred_lon, pred_lat, true_lon, true_lat)

    df = pd.DataFrame({
        "pop": pops,
        "plon": pred_lon,
        "plat": pred_lat,
        "lon": true_lon,
        "lat": true_lat
    })
    cent = df.groupby("pop")[["plon", "plat", "lon", "lat"]].mean()
    rc_lon, _ = pearsonr(cent["plon"], cent["lon"])
    rc_lat, _ = pearsonr(cent["plat"], cent["lat"])
    cent_km = haversine_km(cent["plon"].values, cent["plat"].values, cent["lon"].values, cent["lat"].values)

    return {
        "model": name,
        "ind_r_lon": float(r_lon),
        "ind_r_lat": float(r_lat),
        "ind_r2_lon_pct": float(r_lon ** 2 * 100),
        "ind_r2_lat_pct": float(r_lat ** 2 * 100),
        "mean_km_err": float(np.mean(km_err)),
        "median_km_err": float(np.median(km_err)),
        "centroid_r_lon": float(rc_lon),
        "centroid_r_lat": float(rc_lat),
        "centroid_mean_km_err": float(np.mean(cent_km)),
        "centroid_median_km_err": float(np.median(cent_km)),
    }


def main():
    print("=" * 78)
    print("  1-HIDDEN-LAYER PERCEPTRON (MLP) LEAVE-ONE-OUT GLOBE EXPERIMENT (N = 634)")
    print("=" * 78)

    # Load the 634 European individuals and their PCs from lab_5pc_data.js
    js_text = (ROOT / "data/historical_634/lab_5pc_data.js").read_text(encoding="utf-8")
    json_str = js_text.split("window.LAB_5PC_DATA = ", 1)[1].rstrip(";\n ")
    lab_data = json.loads(json_str)

    samples = lab_data["samples"]
    lon = np.array([s["lon"] for s in samples], dtype=float)
    lat = np.array([s["lat"] for s in samples], dtype=float)
    pops = np.array([s["pop"] for s in samples])
    X_unw = np.array([s["unw_pcs"] for s in samples], dtype=float)
    X_bal = np.array([s["bal_pcs"] for s in samples], dtype=float)

    summary_rows = []
    all_preds = {}

    for basis_name, X_full in [("Unweighted_PCA", X_unw), ("Balanced_PCA", X_bal)]:
        for k in [2, 5]:
            tag = f"{basis_name}_Top{k}PCs"
            print(f"\n>>> Running 634-fold LOOCV + 52-fold LOPO for {tag} ...")
            res = run_loocv_suite(X_full[:, :k], lon, lat, pops, n_hidden=20, alpha=0.05)
            print(f"    Completed in {res['elapsed_sec']:.2f}s")
            all_preds[tag] = res

            for m_key, m_label in [
                ("lin_planar", f"{tag} | Linear LOO (Planar Lon/Lat)"),
                ("lin_spherical", f"{tag} | Linear LOO (3D Sphere XYZ)"),
                ("mlp_planar", f"{tag} | 1-Hidden-Layer MLP LOO (Planar Lon/Lat)"),
                ("mlp_spherical", f"{tag} | 1-Hidden-Layer MLP LOO (3D Sphere XYZ)"),
                ("lopo_lin_spherical", f"{tag} | Linear LOPO-52 (Unseen Pop 3D XYZ)"),
                ("lopo_mlp_spherical", f"{tag} | 1-Hidden-Layer MLP LOPO-52 (Unseen Pop 3D XYZ)"),
            ]:
                plon, plat = res[m_key]
                row = summarize_predictions(m_label, plon, plat, lon, lat, pops)
                summary_rows.append(row)
                print(
                    f"  {m_label:58s} | "
                    f"Ind r: {row['ind_r_lon']:.3f} Lon, {row['ind_r_lat']:.3f} Lat | "
                    f"Cent r: {row['centroid_r_lon']:.3f} Lon, {row['centroid_r_lat']:.3f} Lat | "
                    f"Med Err: {row['median_km_err']:5.0f} km (Cent: {row['centroid_median_km_err']:4.0f} km)"
                )

    df_sum = pd.DataFrame(summary_rows)
    out_csv = RESULTS_STATS / "mlp_loo_globe_experiment.csv"
    df_sum.to_csv(out_csv, index=False)
    print(f"\nSaved detailed LOO metrics table to {out_csv}")

    # Generate visual comparison figure (2x3 panels)
    with open(RAW / "europe.geojson", "r") as f:
        geojson_data = json.load(f)

    def draw_coastline(ax):
        for feature in geojson_data.get("features", []):
            geom = feature.get("geometry", {})
            g_type = geom.get("type")
            coords = geom.get("coordinates", [])
            polys = [coords] if g_type == "Polygon" else (coords if g_type == "MultiPolygon" else [])
            for poly in polys:
                for ring in poly:
                    ax.fill(
                        [pt[0] for pt in ring],
                        [pt[1] for pt in ring],
                        facecolor="#162234",
                        edgecolor="#3b82f6",
                        alpha=0.55,
                        linewidth=0.55,
                        zorder=1,
                    )
        ax.set_facecolor("#060d18")
        ax.set_xlim(-22, 46)
        ax.set_ylim(34, 66)
        ax.set_aspect(1.0 / 0.6428)
        ax.grid(True, linestyle="--", alpha=0.18, color="#64748b", zorder=2)
        ax.tick_params(colors="#94a3b8", labelsize=8)
        for spine in ax.spines.values():
            spine.set_edgecolor("#334155")

    plt.style.use("dark_background")
    fig, axes = plt.subplots(2, 3, figsize=(20, 12.2), facecolor="#020617")

    panels = [
        ("Unweighted_PCA_Top2PCs", "lin_planar", "A. Linear LOO — Top 2 PCs (Unweighted)\nBasque/Sardinia Warp Compress Britain & Russia"),
        ("Unweighted_PCA_Top2PCs", "mlp_spherical", "B. 1-Hidden-Layer MLP LOO — Top 2 PCs (3D Globe)\nNon-Linear Curve Unfolds Coastlines from 2 PCs Alone!"),
        ("Balanced_PCA_Top2PCs", "mlp_spherical", "C. 1-Hidden-Layer MLP LOO — Top 2 PCs (Balanced)\n3D Spherical MLP on Balanced 2D Kinship"),
        ("Unweighted_PCA_Top5PCs", "lin_planar", "D. Linear LOO — Top 5 PCs (Planar Lon/Lat)\nFlat-Plane Linear Combination of 5 Dimensions"),
        ("Unweighted_PCA_Top5PCs", "mlp_planar", "E. 1-Hidden-Layer MLP LOO — Top 5 PCs (Planar)\nNon-Linear Perceptron on Flat Degrees"),
        ("Unweighted_PCA_Top5PCs", "mlp_spherical", "F. 1-Hidden-Layer MLP LOO — Top 5 PCs (3D Globe XYZ)\nSpherical Perceptron on the Curved Earth Surface"),
    ]

    for ax, (tag, key, title) in zip(axes.ravel(), panels):
        draw_coastline(ax)
        plon, plat = all_preds[tag][key]
        row = summarize_predictions(title, plon, plat, lon, lat, pops)

        # Plot individuals
        for s_idx, s in enumerate(samples):
            ax.scatter(plon[s_idx], plat[s_idx], color=s["color"], alpha=0.55, s=16, edgecolors="none", zorder=3)

        # Plot 52 regional centroids + drift vectors to true physical centroids
        df_tmp = pd.DataFrame({
            "pop": pops,
            "color": [s["color"] for s in samples],
            "plon": plon,
            "plat": plat,
            "lon": lon,
            "lat": lat,
        })
        for pop, grp in df_tmp.groupby("pop"):
            c_plon, c_plat = grp["plon"].mean(), grp["plat"].mean()
            c_lon, c_lat = grp["lon"].mean(), grp["lat"].mean()
            col = grp["color"].iloc[0]
            ax.plot([c_plon, c_lon], [c_plat, c_lat], color=col, linestyle=":", linewidth=0.9, alpha=0.65, zorder=4)
            ax.scatter(c_plon, c_plat, color=col, s=46, edgecolors="#000000", linewidths=0.9, zorder=5)

        ax.set_title(
            f"{title}\n"
            f"Ind r: {row['ind_r_lon']:.3f} Lon · {row['ind_r_lat']:.3f} Lat | "
            f"Cent r: {row['centroid_r_lon']:.3f} Lon · {row['centroid_r_lat']:.3f} Lat | "
            f"Median Error: {row['median_km_err']:.0f} km",
            fontsize=10.2,
            fontweight="bold",
            color="#f8fafc",
            pad=8,
        )
        ax.set_xlabel("Longitude (°E)", fontsize=8.5, color="#94a3b8")
        ax.set_ylabel("Latitude (°N)", fontsize=8.5, color="#94a3b8")

    plt.suptitle(
        "Leave-One-Out (634 Folds): Linear Projection vs. 1-Hidden-Layer Spherical Perceptron on the 3D Globe",
        fontsize=14.5,
        fontweight="bold",
        color="#ffffff",
        y=0.98,
    )
    plt.tight_layout(rect=[0, 0, 1, 0.955])
    out_plot = RESULTS_PLOTS / "mlp_loo_globe_experiment.png"
    plt.savefig(out_plot, dpi=220, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"Saved 6-panel visual comparison plot to {out_plot}")

    # Export standalone JS bundle for optional interactive 3D Globe inspection (does not touch main project files)
    export_samples = []
    for i, s in enumerate(samples):
        export_samples.append({
            "id": s["id"],
            "color": s["color"],
            "lon": round(float(lon[i]), 3),
            "lat": round(float(lat[i]), 3),
            "lin2_lon": round(float(all_preds["Unweighted_PCA_Top2PCs"]["lin_planar"][0][i]), 3),
            "lin2_lat": round(float(all_preds["Unweighted_PCA_Top2PCs"]["lin_planar"][1][i]), 3),
            "mlp2_sph_lon": round(float(all_preds["Unweighted_PCA_Top2PCs"]["mlp_spherical"][0][i]), 3),
            "mlp2_sph_lat": round(float(all_preds["Unweighted_PCA_Top2PCs"]["mlp_spherical"][1][i]), 3),
            "bal_mlp2_sph_lon": round(float(all_preds["Balanced_PCA_Top2PCs"]["mlp_spherical"][0][i]), 3),
            "bal_mlp2_sph_lat": round(float(all_preds["Balanced_PCA_Top2PCs"]["mlp_spherical"][1][i]), 3),
            "lin5_lon": round(float(all_preds["Unweighted_PCA_Top5PCs"]["lin_planar"][0][i]), 3),
            "lin5_lat": round(float(all_preds["Unweighted_PCA_Top5PCs"]["lin_planar"][1][i]), 3),
            "mlp5_plan_lon": round(float(all_preds["Unweighted_PCA_Top5PCs"]["mlp_planar"][0][i]), 3),
            "mlp5_plan_lat": round(float(all_preds["Unweighted_PCA_Top5PCs"]["mlp_planar"][1][i]), 3),
            "mlp5_sph_lon": round(float(all_preds["Unweighted_PCA_Top5PCs"]["mlp_spherical"][0][i]), 3),
            "mlp5_sph_lat": round(float(all_preds["Unweighted_PCA_Top5PCs"]["mlp_spherical"][1][i]), 3),
            "lopo5_sph_lon": round(float(all_preds["Unweighted_PCA_Top5PCs"]["lopo_mlp_spherical"][0][i]), 3),
            "lopo5_sph_lat": round(float(all_preds["Unweighted_PCA_Top5PCs"]["lopo_mlp_spherical"][1][i]), 3),
        })

    out_js = ROOT / "data/historical_634/mlp_loo_experiment_data.js"
    out_js.write_text(
        "window.MLP_LOO_EXPERIMENT = " + json.dumps({"metrics": summary_rows, "samples": export_samples}) + ";\n",
        encoding="utf-8",
    )
    print(f"Saved standalone interactive bundle to {out_js}")


if __name__ == "__main__":
    main()
