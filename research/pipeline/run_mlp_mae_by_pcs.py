#!/usr/bin/env python3
"""
1-Hidden-Layer Perceptron (Spherical MAE) Across Top 2, 5, 10, 15, 25, and 50 PCs
=================================================================================
Uses the cached Top 50 PCs (`europe_634_top50_pcs.npz`) to evaluate a 1-Hidden-Layer
Perceptron trained with Spherical Great-Circle MAE (L1 Geodesic Loss on the 3D Globe)
as we increase the number of input Principal Components:
  - Top 2 PCs
  - Top 5 PCs
  - Top 10 PCs
  - Top 15 PCs
  - Top 25 PCs
  - Top 50 PCs
"""

import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import pearsonr
import matplotlib.pyplot as plt

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
RESULTS_PLOTS = ROOT / "results" / "plots"
RESULTS_STATS = ROOT / "results" / "stats"


def lonlat_to_xyz(lon_deg, lat_deg):
    lam = np.radians(lon_deg)
    phi = np.radians(lat_deg)
    return np.column_stack([
        np.cos(phi) * np.cos(lam),
        np.cos(phi) * np.sin(lam),
        np.sin(phi),
    ])


def xyz_to_lonlat(xyz):
    norms = np.linalg.norm(xyz, axis=-1, keepdims=True)
    u = xyz / np.clip(norms, 1e-12, None)
    lon_deg = np.degrees(np.arctan2(u[..., 1], u[..., 0]))
    lat_deg = np.degrees(np.arcsin(np.clip(u[..., 2], -1.0, 1.0)))
    return lon_deg, lat_deg


def haversine_km(lon1, lat1, lon2, lat2):
    R = 6371.0
    phi1, phi2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlam = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2.0) ** 2 + np.cos(phi1) * np.cos(phi2) * np.sin(dlam / 2.0) ** 2
    return 2.0 * R * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def fit_mlp_spherical_mae(X_tr, lon_tr, lat_tr, X_eval, n_hidden=28, l2_reg=2e-3, maxiter=220):
    """
    1-Hidden-Layer Perceptron with Spherical Great-Circle MAE Loss (L1 Geodesic in km).
    """
    N, D = X_tr.shape
    x_mean = X_tr.mean(axis=0)
    x_std = X_tr.std(axis=0) + 1e-8
    Xn = (X_tr - x_mean) / x_std
    Xeval_n = (X_eval - x_mean) / x_std

    Y_xyz = lonlat_to_xyz(lon_tr, lat_tr)
    y_mean = Y_xyz.mean(axis=0)
    y_std = Y_xyz.std(axis=0) + 1e-8
    Yn = (Y_xyz - y_mean) / y_std

    rng = np.random.default_rng(42)
    W1_0 = rng.normal(0.0, 1.0 / np.sqrt(D), size=(D, n_hidden))
    b1_0 = np.zeros(n_hidden)
    W2_0 = rng.normal(0.0, 1.0 / np.sqrt(n_hidden), size=(n_hidden, 3))
    b2_0 = np.zeros(3)
    theta0 = np.concatenate([W1_0.ravel(), b1_0, W2_0.ravel(), b2_0])

    idx1 = D * n_hidden
    idx2 = idx1 + n_hidden
    idx3 = idx2 + n_hidden * 3
    eps = 8.0 / 6371.0

    def loss_and_grad(theta):
        W1 = theta[:idx1].reshape(D, n_hidden)
        b1 = theta[idx1:idx2]
        W2 = theta[idx2:idx3].reshape(n_hidden, 3)
        b2 = theta[idx3:]

        Z1 = Xn @ W1 + b1
        H = np.tanh(Z1)
        Pred_n = H @ W2 + b2
        Diff_xyz = (Pred_n - Yn) * y_std
        dist = np.sqrt(np.sum(Diff_xyz ** 2, axis=1, keepdims=True) + eps ** 2)

        loss = np.mean(dist) + 0.5 * l2_reg * (np.sum(W1 ** 2) + np.sum(W2 ** 2))
        dPred_n = (Diff_xyz * y_std / dist) / N
        dW2 = H.T @ dPred_n + l2_reg * W2
        db2 = np.sum(dPred_n, axis=0)
        dH = dPred_n @ W2.T
        dZ1 = dH * (1.0 - H ** 2)
        dW1 = Xn.T @ dZ1 + l2_reg * W1
        db1 = np.sum(dZ1, axis=0)
        return loss, np.concatenate([dW1.ravel(), db1, dW2.ravel(), db2])

    res = minimize(loss_and_grad, theta0, method="L-BFGS-B", jac=True, options={"maxiter": maxiter})
    theta = res.x
    W1 = theta[:idx1].reshape(D, n_hidden)
    b1 = theta[idx1:idx2]
    W2 = theta[idx2:idx3].reshape(n_hidden, 3)
    b2 = theta[idx3:]
    Pred_xyz = (np.tanh(Xeval_n @ W1 + b1) @ W2 + b2) * y_std + y_mean
    return xyz_to_lonlat(Pred_xyz)


def run_kfold_mlp_mae(X, lon, lat, n_folds=10, n_hidden=24, l2_reg=8e-3):
    N = len(lon)
    fold_ids = np.arange(N) % n_folds
    plon = np.zeros(N)
    plat = np.zeros(N)
    for f in range(n_folds):
        te = (fold_ids == f)
        tr = ~te
        plon[te], plat[te] = fit_mlp_spherical_mae(
            X[tr], lon[tr], lat[tr], X[te], n_hidden=n_hidden, l2_reg=l2_reg, maxiter=140
        )
    return plon, plat


def eval_metrics(k, mode, plon, plat, lon, lat, pops):
    r_lon, _ = pearsonr(plon, lon)
    r_lat, _ = pearsonr(plat, lat)
    km = haversine_km(plon, plat, lon, lat)

    df = pd.DataFrame({"pop": pops, "plon": plon, "plat": plat, "lon": lon, "lat": lat})
    cent = df.groupby("pop")[["plon", "plat", "lon", "lat"]].mean()
    rc_lon, _ = pearsonr(cent["plon"], cent["lon"])
    rc_lat, _ = pearsonr(cent["plat"], cent["lat"])
    ckm = haversine_km(cent["plon"].values, cent["plat"].values, cent["lon"].values, cent["lat"].values)

    return {
        "k_pcs": k,
        "mode": mode,
        "ind_r_lon": float(r_lon),
        "ind_r_lat": float(r_lat),
        "cent_r_lon": float(rc_lon),
        "cent_r_lat": float(rc_lat),
        "mae_km": float(np.mean(km)),
        "median_km": float(np.median(km)),
        "cent_mae_km": float(np.mean(ckm)),
        "cent_median_km": float(np.median(ckm)),
    }


def main():
    t0 = time.time()
    cache = np.load(PROCESSED / "europe_634_top50_pcs.npz", allow_pickle=True)
    pcs_unw = cache["pcs_unw"]

    js_text = (ROOT / "data/historical_634/lab_5pc_data.js").read_text(encoding="utf-8")
    lab_data = json.loads(js_text.split("window.LAB_5PC_DATA = ", 1)[1].rstrip(";\n "))
    samples = lab_data["samples"]
    lon = np.array([s["lon"] for s in samples], dtype=float)
    lat = np.array([s["lat"] for s in samples], dtype=float)
    pops = np.array([s["pop"] for s in samples])

    ks = [2, 5, 10, 15, 25, 50]
    direct_preds = {}
    cv_preds = {}
    rows = []

    for k in ks:
        Xk = pcs_unw[:, :k]
        # 1. Direct Supervised Spherical MAE fit
        d_lon, d_lat = fit_mlp_spherical_mae(Xk, lon, lat, Xk, n_hidden=28, l2_reg=2.5e-3, maxiter=200)
        direct_preds[k] = (d_lon, d_lat)
        m_dir = eval_metrics(k, "Direct_Supervised_MAE", d_lon, d_lat, lon, lat, pops)
        rows.append(m_dir)

        # 2. Out-of-Sample Cross-Validated Spherical MAE fit
        reg_cv = 3e-3 if k <= 5 else (6e-3 if k <= 15 else 1.2e-2)
        c_lon, c_lat = run_kfold_mlp_mae(Xk, lon, lat, n_folds=10, n_hidden=24, l2_reg=reg_cv)
        cv_preds[k] = (c_lon, c_lat)
        m_cv = eval_metrics(k, "Out_of_Sample_CV_MAE", c_lon, c_lat, lon, lat, pops)
        rows.append(m_cv)

        print(
            f"Top {k:2d} PCs | "
            f"[Direct] Ind r: {m_dir['ind_r_lon']:.3f}/{m_dir['ind_r_lat']:.3f}, MAE: {m_dir['mae_km']:5.1f} km, Med: {m_dir['median_km']:5.1f} km (Cent Med: {m_dir['cent_median_km']:4.1f} km) || "
            f"[Out-of-Sample] Ind r: {m_cv['ind_r_lon']:.3f}/{m_cv['ind_r_lat']:.3f}, Cent r: {m_cv['cent_r_lon']:.3f}/{m_cv['cent_r_lat']:.3f}, MAE: {m_cv['mae_km']:5.1f} km, Med: {m_cv['median_km']:5.1f} km (Cent Med: {m_cv['cent_median_km']:4.1f} km)",
            flush=True,
        )

    pd.DataFrame(rows).to_csv(RESULTS_STATS / "mlp_mae_by_pcs.csv", index=False)

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
                        facecolor="#111c2d",
                        edgecolor="#38bdf8",
                        alpha=0.42,
                        linewidth=0.55,
                        zorder=1,
                    )
        ax.set_facecolor("#050a14")
        ax.set_xlim(-14, 43)
        ax.set_ylim(34.5, 65.5)
        ax.set_aspect(1.0 / 0.6428)
        ax.grid(True, linestyle="--", alpha=0.16, color="#64748b", zorder=2)
        ax.tick_params(colors="#94a3b8", labelsize=8)
        for spine in ax.spines.values():
            spine.set_edgecolor("#334155")

    plt.style.use("dark_background")

    # Plot 1: Direct Supervised 1-Hidden-Layer MLP (Spherical MAE) for Top 2, 5, 10, 15, 25, 50 PCs
    fig, axes = plt.subplots(2, 3, figsize=(20, 12.4), facecolor="#020617")
    for ax, k in zip(axes.ravel(), ks):
        draw_coastline(ax)
        plon, plat = direct_preds[k]
        m_dir = [r for r in rows if r["k_pcs"] == k and r["mode"] == "Direct_Supervised_MAE"][0]
        m_cv = [r for r in rows if r["k_pcs"] == k and r["mode"] == "Out_of_Sample_CV_MAE"][0]

        for i, s in enumerate(samples):
            ax.scatter(plon[i], plat[i], color=s["color"], alpha=0.58, s=16, edgecolors="none", zorder=3)

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
            ax.plot([c_plon, c_lon], [c_plat, c_lat], color=col, linestyle=":", linewidth=0.95, alpha=0.68, zorder=4)
            ax.scatter(c_plon, c_plat, color=col, s=48, edgecolors="#000000", linewidths=0.95, zorder=5)

        ax.set_title(
            f"Top {k} PCs — 1-Hidden-Layer MLP (Spherical MAE)\n"
            f"Supervised Fit: r = {m_dir['ind_r_lon']:.3f} Lon · {m_dir['ind_r_lat']:.3f} Lat | MAE: {m_dir['mae_km']:.0f} km (Med: {m_dir['median_km']:.0f} km)\n"
            f"Out-of-Sample CV: Centroid r = {m_cv['cent_r_lon']:.3f}/{m_cv['cent_r_lat']:.3f} | Cent Med: {m_cv['cent_median_km']:.0f} km",
            fontsize=9.5,
            fontweight="bold",
            color="#f8fafc",
            pad=8,
        )
        ax.set_xlabel("Longitude (°E)", fontsize=8.5, color="#94a3b8")
        ax.set_ylabel("Latitude (°N)", fontsize=8.5, color="#94a3b8")

    plt.suptitle(
        "1-Hidden-Layer Perceptron (Spherical MAE): Progression from Top 2 -> 5 -> 10 -> 15 -> 25 -> 50 PCs",
        fontsize=14.5,
        fontweight="bold",
        color="#ffffff",
        y=0.98,
    )
    plt.tight_layout(rect=[0, 0, 1, 0.955])
    out_plot = RESULTS_PLOTS / "mlp_mae_progression_2_to_50.png"
    plt.savefig(out_plot, dpi=220, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"Completed in {time.time() - t0:.2f}s -> {out_plot}", flush=True)


if __name__ == "__main__":
    main()
