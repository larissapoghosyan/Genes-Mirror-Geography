#!/usr/bin/env python3
"""
Fast Out-of-Sample Loss Function Comparison for Genetic-to-Globe Mapping
========================================================================
Compares 6 distinct loss functions for mapping DNA Principal Components onto the 3D Globe:
  1. Planar Degree L2 (MSE on flat Lon/Lat degrees — baseline flat-Earth loss)
  2. Spherical 3D Chord L2 (MSE on 3D unit vectors [X, Y, Z] — what we used first)
  3. Spherical Great-Circle L1 (Charbonnier / Smooth-L1 in true Great-Circle kilometers)
  4. Spherical Huber Loss (delta = 250 km — smooth locally, linear on isolate outliers)
  5. Cauchy / Lorentzian Outlier-Immune Loss (log(1 + (km / 280)^2) — ignores extreme isolates)
  6. Spherical Huber + Coastline-Spread Preservation (prevents inward shrinkage from coasts!)
"""

import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import pearsonr
import matplotlib.pyplot as plt

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
RAW = ROOT / "data" / "raw"
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


def run_fast_cv_mlp(X, lon, lat, loss_type="spherical_l2", n_folds=64, n_hidden=20, steps=220, lr=0.04, l2_reg=0.008):
    """
    Trains all folds simultaneously in cache-friendly 3D tensors (F=64, N=634, H=20)
    where fold f masks out its held-out test individuals completely during training.
    """
    N, D = X.shape
    R_earth = 6371.0
    Xn = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)

    if loss_type == "planar_l2":
        Y = np.column_stack([lon, lat])
        y_mean = Y.mean(axis=0)
        y_std = Y.std(axis=0) + 1e-8
        Yn = (Y - y_mean) / y_std
        d_out = 2
    else:
        Y_xyz = lonlat_to_xyz(lon, lat)
        y_mean = Y_xyz.mean(axis=0)
        y_std = Y_xyz.std(axis=0) + 1e-8
        Yn = (Y_xyz - y_mean) / y_std
        d_out = 3

    # Assign each individual i to fold (i % n_folds)
    fold_ids = np.arange(N) % n_folds
    M = np.zeros((n_folds, N), dtype=np.float64)
    for f in range(n_folds):
        tr = (fold_ids != f)
        M[f, tr] = 1.0 / tr.sum()
    M3 = M[:, :, None]

    rng = np.random.default_rng(42)
    W1 = np.broadcast_to(rng.normal(0.0, 1.0 / np.sqrt(D), size=(1, D, n_hidden)), (n_folds, D, n_hidden)).copy()
    b1 = np.zeros((n_folds, 1, n_hidden), dtype=np.float64)
    W2 = np.broadcast_to(rng.normal(0.0, 1.0 / np.sqrt(n_hidden), size=(1, n_hidden, d_out)), (n_folds, n_hidden, d_out)).copy()
    b2 = np.zeros((n_folds, 1, d_out), dtype=np.float64)

    params = [W1, b1, W2, b2]
    m_adam = [np.zeros_like(p) for p in params]
    v_adam = [np.zeros_like(p) for p in params]
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    target_std = Yn.std(axis=0)

    for t in range(1, steps + 1):
        Z1 = np.einsum("nd,fdh->fnh", Xn, W1) + b1
        H_act = np.tanh(Z1)
        Pred = np.einsum("fnh,fho->fno", H_act, W2) + b2
        Diff = Pred - Yn[None, :, :]

        if loss_type in ("planar_l2", "spherical_l2"):
            dPred = Diff * M3
        elif loss_type == "spherical_l1":
            Diff_xyz = Diff * y_std[None, None, :]
            dist_km = R_earth * np.sqrt(np.sum(Diff_xyz ** 2, axis=-1, keepdims=True) + (15.0 / R_earth) ** 2)
            dPred = (Diff * (y_std[None, None, :] ** 2) / (dist_km / R_earth + 1e-8)) * M3 * 8.0
        elif loss_type == "spherical_huber":
            Diff_xyz = Diff * y_std[None, None, :]
            dist_km = R_earth * np.sqrt(np.sum(Diff_xyz ** 2, axis=-1, keepdims=True) + 1e-10)
            delta_km = 250.0
            scale = np.where(dist_km <= delta_km, 1.0, delta_km / np.clip(dist_km, 1e-6, None))
            dPred = Diff * scale * M3 * 1.4
        elif loss_type == "spherical_cauchy":
            Diff_xyz = Diff * y_std[None, None, :]
            dist_km_sq = (R_earth ** 2) * np.sum(Diff_xyz ** 2, axis=-1, keepdims=True)
            sigma_sq = 260.0 ** 2
            weight = 1.0 / (1.0 + dist_km_sq / sigma_sq)
            dPred = Diff * weight * M3 * 2.4
        elif loss_type == "spherical_spread":
            Diff_xyz = Diff * y_std[None, None, :]
            dist_km = R_earth * np.sqrt(np.sum(Diff_xyz ** 2, axis=-1, keepdims=True) + 1e-10)
            delta_km = 260.0
            scale = np.where(dist_km <= delta_km, 1.0, delta_km / np.clip(dist_km, 1e-6, None))
            dPred_geo = Diff * scale * M3 * 1.3

            pred_mean = np.sum(Pred * M3, axis=1, keepdims=True)
            pred_centered = Pred - pred_mean
            pred_var = np.sum((pred_centered ** 2) * M3, axis=1, keepdims=True)
            pred_std = np.sqrt(pred_var + 1e-8)
            std_diff = pred_std - (target_std[None, None, :] * 1.02)
            dPred_spread = 0.55 * (std_diff / pred_std) * pred_centered * M3
            dPred = dPred_geo + dPred_spread

        dW2 = np.einsum("fnh,fno->fho", H_act, dPred) + l2_reg * W2
        db2 = np.sum(dPred, axis=1, keepdims=True)
        dH = np.einsum("fno,fho->fnh", dPred, W2)
        dZ1 = dH * (1.0 - H_act ** 2)
        dW1 = np.einsum("nd,fnh->fdh", Xn, dZ1) + l2_reg * W1
        db1 = np.sum(dZ1, axis=1, keepdims=True)

        grads = [dW1, db1, dW2, db2]
        for i, (p, g) in enumerate(zip(params, grads)):
            m_adam[i] = beta1 * m_adam[i] + (1.0 - beta1) * g
            v_adam[i] = beta2 * v_adam[i] + (1.0 - beta2) * (g ** 2)
            m_hat = m_adam[i] / (1.0 - beta1 ** t)
            v_hat = v_adam[i] / (1.0 - beta2 ** t)
            p -= lr * m_hat / (np.sqrt(v_hat) + eps)

    # Out-of-sample prediction for each individual i using their held-out fold (fold_ids[i])
    Pred_oos_n = np.zeros((N, d_out), dtype=np.float64)
    for i in range(N):
        f = fold_ids[i]
        z1 = Xn[i] @ W1[f] + b1[f, 0]
        h = np.tanh(z1)
        Pred_oos_n[i] = h @ W2[f] + b2[f, 0]

    Pred_oos = Pred_oos_n * y_std + y_mean
    if loss_type == "planar_l2":
        return Pred_oos[:, 0], Pred_oos[:, 1]
    else:
        return xyz_to_lonlat(Pred_oos)


def eval_metrics(name, plon, plat, lon, lat, pops):
    r_lon, _ = pearsonr(plon, lon)
    r_lat, _ = pearsonr(plat, lat)
    km = haversine_km(plon, plat, lon, lat)

    df = pd.DataFrame({"pop": pops, "plon": plon, "plat": plat, "lon": lon, "lat": lat})
    cent = df.groupby("pop")[["plon", "plat", "lon", "lat"]].mean()
    rc_lon, _ = pearsonr(cent["plon"], cent["lon"])
    rc_lat, _ = pearsonr(cent["plat"], cent["lat"])
    ckm = haversine_km(cent["plon"].values, cent["plat"].values, cent["lon"].values, cent["lat"].values)

    lon_spread_ratio = np.std(plon) / np.std(lon) * 100.0
    lat_spread_ratio = np.std(plat) / np.std(lat) * 100.0

    return {
        "loss_name": name,
        "ind_r_lon": float(r_lon),
        "ind_r_lat": float(r_lat),
        "cent_r_lon": float(rc_lon),
        "cent_r_lat": float(rc_lat),
        "mean_km": float(np.mean(km)),
        "median_km": float(np.median(km)),
        "cent_median_km": float(np.median(ckm)),
        "cent_mean_km": float(np.mean(ckm)),
        "lon_spread_pct": float(lon_spread_ratio),
        "lat_spread_pct": float(lat_spread_ratio),
    }


def main():
    print("=" * 80, flush=True)
    print("  COMPARING 6 LOSS FUNCTIONS FOR OUT-OF-SAMPLE PERCEPTRON ON THE 3D GLOBE", flush=True)
    print("=" * 80, flush=True)

    js_text = (ROOT / "data/historical_634/lab_5pc_data.js").read_text(encoding="utf-8")
    json_str = js_text.split("window.LAB_5PC_DATA = ", 1)[1].rstrip(";\n ")
    lab_data = json.loads(json_str)

    samples = lab_data["samples"]
    lon = np.array([s["lon"] for s in samples], dtype=float)
    lat = np.array([s["lat"] for s in samples], dtype=float)
    pops = np.array([s["pop"] for s in samples])
    X_unw5 = np.array([s["unw_pcs"] for s in samples], dtype=float)

    losses = [
        ("planar_l2", "1. Planar MSE (L2 on Flat Lon/Lat°)\n[What we used first: flat grid, squares outliers]"),
        ("spherical_l2", "2. Spherical 3D MSE (L2 on Unit Sphere XYZ)\n[Respects 3D globe, still squares isolate outliers]"),
        ("spherical_l1", "3. Spherical Great-Circle L1 (Geodesic km)\n[Minimizes true median km distance along Earth's curve]"),
        ("spherical_huber", "4. Spherical Huber Loss (δ = 250 km)\n[Smooth locally, refuses to let isolates warp mainland]"),
        ("spherical_cauchy", "5. Cauchy Outlier-Immune Loss (Log-Lorentzian)\n[Ignores extreme island/mountain drift completely]"),
        ("spherical_spread", "6. Spherical Huber + Coastline-Spread Loss\n[Prevents inward shrinkage so peninsulas reach the sea!]"),
    ]

    preds = {}
    rows = []
    for key, title in losses:
        t0 = time.time()
        plon, plat = run_fast_cv_mlp(X_unw5, lon, lat, loss_type=key, n_folds=64, n_hidden=20, steps=220)
        dt = time.time() - t0
        preds[key] = (plon, plat)
        m = eval_metrics(title.split("\n")[0], plon, plat, lon, lat, pops)
        rows.append(m)
        print(
            f"  {m['loss_name']:48s} ({dt:4.2f}s) | "
            f"Ind r: {m['ind_r_lon']:.3f}/{m['ind_r_lat']:.3f} | "
            f"Cent r: {m['cent_r_lon']:.3f}/{m['cent_r_lat']:.3f} | "
            f"Med: {m['median_km']:5.1f} km (Cent: {m['cent_median_km']:5.1f} km) | "
            f"Coast Reach: {m['lon_spread_pct']:.0f}%",
            flush=True,
        )

    pd.DataFrame(rows).to_csv(RESULTS_STATS / "loss_functions_comparison.csv", index=False)

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
    fig, axes = plt.subplots(2, 3, figsize=(20, 12.4), facecolor="#020617")

    for ax, (key, title), m in zip(axes.ravel(), losses, rows):
        draw_coastline(ax)
        plon, plat = preds[key]

        for i, s in enumerate(samples):
            ax.scatter(plon[i], plat[i], color=s["color"], alpha=0.55, s=16, edgecolors="none", zorder=3)

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
            f"{title}\n"
            f"Ind r: {m['ind_r_lon']:.3f} Lon · {m['ind_r_lat']:.3f} Lat  |  "
            f"Med Error: {m['median_km']:.0f} km (Centers: {m['cent_median_km']:.0f} km)  |  "
            f"Coast Reach: {m['lon_spread_pct']:.0f}%",
            fontsize=9.8,
            fontweight="bold",
            color="#f8fafc",
            pad=8,
        )
        ax.set_xlabel("Longitude (°E)", fontsize=8.5, color="#94a3b8")
        ax.set_ylabel("Latitude (°N)", fontsize=8.5, color="#94a3b8")

    plt.suptitle(
        "Which Loss Function Shapes the Best Genetic Map? (Out-of-Sample 1-Hidden-Layer Perceptron on 3D Globe)",
        fontsize=14.5,
        fontweight="bold",
        color="#ffffff",
        y=0.98,
    )
    plt.tight_layout(rect=[0, 0, 1, 0.955])
    out_plot = RESULTS_PLOTS / "loss_functions_comparison.png"
    plt.savefig(out_plot, dpi=220, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"\nSaved 6-loss visual comparison to {out_plot}", flush=True)

    # Keep the historical experiment bundle with its 634-person source data.
    export_samples = []
    for i, s in enumerate(samples):
        item = {
            "id": s["id"],
            "color": s["color"],
            "lon": round(float(lon[i]), 3),
            "lat": round(float(lat[i]), 3),
        }
        for key, _ in losses:
            item[f"{key}_lon"] = round(float(preds[key][0][i]), 3)
            item[f"{key}_lat"] = round(float(preds[key][1][i]), 3)
        export_samples.append(item)

    (ROOT / "data/historical_634/loss_demo_data.js").write_text(
        "window.LOSS_DEMO_DATA = " + json.dumps({"metrics": rows, "samples": export_samples}) + ";\n",
        encoding="utf-8",
    )
    print("Saved research/data/historical_634/loss_demo_data.js", flush=True)


if __name__ == "__main__":
    main()
