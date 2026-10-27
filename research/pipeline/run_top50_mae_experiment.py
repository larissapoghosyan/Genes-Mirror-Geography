#!/usr/bin/env python3
"""
Supervised MAE (Mean Absolute Error) Mapping from Top 50 PCs to Ground Truth
============================================================================
Extracts the Top 50 Principal Components (PC1..PC50) on the 634 European individuals
(caching top50_pcs.npz for instant reuse) and maps them to Ground Truth geography
using Supervised MAE (Great-Circle L1 / Planar L1):
  1. Top 2 PCs  -> Ground Truth (Supervised MAE)
  2. Top 5 PCs  -> Ground Truth (Supervised MAE)
  3. Top 10 PCs -> Ground Truth (Supervised MAE)
  4. Top 25 PCs -> Ground Truth (Supervised MAE)
  5. Top 50 PCs -> Ground Truth (Linear Supervised MAE - LOO & Full)
  6. Top 50 PCs -> Ground Truth (1-Hidden-Layer Perceptron Supervised MAE - LOO & Full)
"""

import json
import sys
import time
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import pearsonr
from sklearn.decomposition import PCA
import matplotlib.pyplot as plt

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import run_human_origins_pca as base_pipe

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


def get_or_compute_top50_pcs():
    cache_file = PROCESSED / "europe_634_top50_pcs.npz"
    if cache_file.exists():
        print(f"Loading cached Top 50 PCs from {cache_file} ...", flush=True)
        data = np.load(cache_file, allow_pickle=True)
        return data["pcs_unw"], data["pcs_bal"], data["var_unw"]

    print("Extracting genotypes & computing Top 50 PCs (one-time cache) ...", flush=True)
    eur_df = base_pipe.chunk_2_cohort_selection()
    snp_df, snp_qc1 = base_pipe.chunk_3_snp_manifest_and_inversion_qc()
    G_all = base_pipe.chunk_4_binary_genotype_extraction(eur_df, snp_df, snp_qc1)
    G_maf, snp_final_qc = base_pipe.chunk_5_quality_control(G_all, snp_qc1, eur_df)
    G_pruned, _ = base_pipe.chunk_6_ld_pruning(G_maf, snp_final_qc, eur_df)

    keep_mask = eur_df["in_balanced_cohort"].values
    eur_clean = eur_df[keep_mask].reset_index(drop=True)
    G_clean = G_pruned[keep_mask]

    # Unweighted Top 50 PCA
    p_all = np.nanmean(G_clean, axis=0) / 2.0
    denom_all = np.sqrt(np.clip(2.0 * p_all * (1.0 - p_all), 1e-6, None))
    X_unw = np.nan_to_num((G_clean - 2.0 * p_all) / denom_all, nan=0.0)
    pca_unw = PCA(n_components=50, random_state=42)
    pcs_unw = pca_unw.fit_transform(X_unw)
    var_unw = pca_unw.explained_variance_ratio_ * 100.0

    # Sample-Balanced Top 50 PCA
    rng = np.random.default_rng(42)
    ref_idx = []
    for _, grp in eur_clean.groupby("population"):
        idxs = grp.index.values
        ref_idx.extend(rng.choice(idxs, size=min(len(idxs), 6), replace=False))
    ref_idx = sorted(ref_idx)
    G_ref = G_clean[ref_idx]
    p_ref = np.nanmean(G_ref, axis=0) / 2.0
    denom_ref = np.sqrt(np.clip(2.0 * p_ref * (1.0 - p_ref), 1e-6, None))
    X_ref = np.nan_to_num((G_ref - 2.0 * p_ref) / denom_ref, nan=0.0)
    X_all_bal = np.nan_to_num((G_clean - 2.0 * p_ref) / denom_ref, nan=0.0)
    pca_bal = PCA(n_components=50, random_state=42)
    pca_bal.fit(X_ref)
    pcs_bal = pca_bal.transform(X_all_bal)

    np.savez_compressed(cache_file, pcs_unw=pcs_unw, pcs_bal=pcs_bal, var_unw=var_unw)
    return pcs_unw, pcs_bal, var_unw


def fit_linear_spherical_mae(X_tr, Y_xyz_tr, X_te, l2_reg=1e-3):
    """
    Supervised Linear Mapping trained with Spherical Great-Circle MAE (L1 Geodesic Loss in km):
        min_W  (1/N) * sum_i || X_i W - Y_xyz_i ||_km + l2_reg * ||W||^2
    """
    N, D = X_tr.shape
    X_tr1 = np.column_stack([np.ones(N), X_tr])
    X_te1 = np.column_stack([np.ones(len(X_te)), X_te])

    # Initialize with ridge regression
    I_reg = np.eye(D + 1) * l2_reg * N
    I_reg[0, 0] = 0.0
    W0 = np.linalg.solve(X_tr1.T @ X_tr1 + I_reg, X_tr1.T @ Y_xyz_tr)

    eps_chord = 10.0 / 6371.0  # 10 km smoothing for exact differentiability at 0

    def loss_and_grad(w_flat):
        W = w_flat.reshape(D + 1, 3)
        Pred = X_tr1 @ W
        Diff = Pred - Y_xyz_tr
        dist = np.sqrt(np.sum(Diff ** 2, axis=1, keepdims=True) + eps_chord ** 2)
        mae_loss = np.mean(dist) + 0.5 * l2_reg * np.sum(W[1:] ** 2)
        dPred = (Diff / dist) / N
        grad = X_tr1.T @ dPred
        grad[1:] += l2_reg * W[1:]
        return mae_loss, grad.ravel()

    res = minimize(loss_and_grad, W0.ravel(), method="L-BFGS-B", jac=True, options={"maxiter": 150})
    W_opt = res.x.reshape(D + 1, 3)
    return X_te1 @ W_opt


def run_cv_linear_mae(X, lon, lat, n_folds=64, l2_reg=2e-3):
    """Out-of-sample cross-validated Linear Spherical MAE."""
    N = len(lon)
    Xn = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)
    Y_xyz = lonlat_to_xyz(lon, lat)
    fold_ids = np.arange(N) % n_folds
    Pred_xyz = np.zeros((N, 3))
    for f in range(n_folds):
        te = (fold_ids == f)
        tr = ~te
        Pred_xyz[te] = fit_linear_spherical_mae(Xn[tr], Y_xyz[tr], Xn[te], l2_reg=l2_reg)
    return xyz_to_lonlat(Pred_xyz)


def fit_mlp_spherical_mae_full(X, lon, lat, n_hidden=32, l2_reg=1e-3):
    """Supervised 1-Hidden-Layer Perceptron trained with Spherical MAE (Great-Circle L1) on Top 50 PCs."""
    N, D = X.shape
    Xn = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)
    Y_xyz = lonlat_to_xyz(lon, lat)
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

    res = minimize(loss_and_grad, theta0, method="L-BFGS-B", jac=True, options={"maxiter": 220})
    theta = res.x
    W1 = theta[:idx1].reshape(D, n_hidden)
    b1 = theta[idx1:idx2]
    W2 = theta[idx2:idx3].reshape(n_hidden, 3)
    b2 = theta[idx3:]
    Pred_xyz = (np.tanh(Xn @ W1 + b1) @ W2 + b2) * y_std + y_mean
    return xyz_to_lonlat(Pred_xyz)


def run_cv_mlp_spherical_mae(X, lon, lat, n_folds=64, n_hidden=28, steps=240, lr=0.035, l2_reg=0.012):
    """Out-of-sample cross-validated 1-Hidden-Layer Perceptron with Spherical Great-Circle MAE."""
    N, D = X.shape
    R_earth = 6371.0
    Xn = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-8)
    Y_xyz = lonlat_to_xyz(lon, lat)
    y_mean = Y_xyz.mean(axis=0)
    y_std = Y_xyz.std(axis=0) + 1e-8
    Yn = (Y_xyz - y_mean) / y_std

    fold_ids = np.arange(N) % n_folds
    M = np.zeros((n_folds, N), dtype=np.float64)
    for f in range(n_folds):
        tr = (fold_ids != f)
        M[f, tr] = 1.0 / tr.sum()
    M3 = M[:, :, None]

    rng = np.random.default_rng(42)
    W1 = np.broadcast_to(rng.normal(0.0, 1.0 / np.sqrt(D), size=(1, D, n_hidden)), (n_folds, D, n_hidden)).copy()
    b1 = np.zeros((n_folds, 1, n_hidden), dtype=np.float64)
    W2 = np.broadcast_to(rng.normal(0.0, 1.0 / np.sqrt(n_hidden), size=(1, n_hidden, 3)), (n_folds, n_hidden, 3)).copy()
    b2 = np.zeros((n_folds, 1, 3), dtype=np.float64)

    params = [W1, b1, W2, b2]
    m_adam = [np.zeros_like(p) for p in params]
    v_adam = [np.zeros_like(p) for p in params]
    beta1, beta2, eps = 0.9, 0.999, 1e-8

    for t in range(1, steps + 1):
        Z1 = np.einsum("nd,fdh->fnh", Xn, W1) + b1
        H_act = np.tanh(Z1)
        Pred = np.einsum("fnh,fho->fno", H_act, W2) + b2
        Diff = Pred - Yn[None, :, :]

        Diff_xyz = Diff * y_std[None, None, :]
        dist_km = R_earth * np.sqrt(np.sum(Diff_xyz ** 2, axis=-1, keepdims=True) + (15.0 / R_earth) ** 2)
        dPred = (Diff * (y_std[None, None, :] ** 2) / (dist_km / R_earth + 1e-8)) * M3 * 8.0

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

    Pred_oos_n = np.zeros((N, 3), dtype=np.float64)
    for i in range(N):
        f = fold_ids[i]
        Pred_oos_n[i] = np.tanh(Xn[i] @ W1[f] + b1[f, 0]) @ W2[f] + b2[f, 0]

    return xyz_to_lonlat(Pred_oos_n * y_std + y_mean)


def eval_metrics(name, plon, plat, lon, lat, pops):
    r_lon, _ = pearsonr(plon, lon)
    r_lat, _ = pearsonr(plat, lat)
    km = haversine_km(plon, plat, lon, lat)

    df = pd.DataFrame({"pop": pops, "plon": plon, "plat": plat, "lon": lon, "lat": lat})
    cent = df.groupby("pop")[["plon", "plat", "lon", "lat"]].mean()
    rc_lon, _ = pearsonr(cent["plon"], cent["lon"])
    rc_lat, _ = pearsonr(cent["plat"], cent["lat"])
    ckm = haversine_km(cent["plon"].values, cent["plat"].values, cent["lon"].values, cent["lat"].values)

    return {
        "model": name,
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
    print("=" * 82, flush=True)
    print("  SUPERVISED MAE MAPPING: TOP 50 PCs -> GROUND TRUTH GEOGRAPHY (N = 634)", flush=True)
    print("=" * 82, flush=True)

    pcs_unw, pcs_bal, var_unw = get_or_compute_top50_pcs()
    js_text = (ROOT / "data/historical_634/lab_5pc_data.js").read_text(encoding="utf-8")
    lab_data = json.loads(js_text.split("window.LAB_5PC_DATA = ", 1)[1].rstrip(";\n "))
    samples = lab_data["samples"]

    lon = np.array([s["lon"] for s in samples], dtype=float)
    lat = np.array([s["lat"] for s in samples], dtype=float)
    pops = np.array([s["pop"] for s in samples])
    Y_xyz = lonlat_to_xyz(lon, lat)

    configs = []

    # 1. Top 2 PCs -> Ground Truth (Linear Spherical MAE, Out-of-Sample)
    p2_lon, p2_lat = run_cv_linear_mae(pcs_unw[:, :2], lon, lat)
    configs.append(("1. Top 2 PCs — Linear MAE (Out-of-Sample)", p2_lon, p2_lat))

    # 2. Top 5 PCs -> Ground Truth (Linear Spherical MAE, Out-of-Sample)
    p5_lon, p5_lat = run_cv_linear_mae(pcs_unw[:, :5], lon, lat)
    configs.append(("2. Top 5 PCs — Linear MAE (Out-of-Sample)", p5_lon, p5_lat))

    # 3. Top 15 PCs -> Ground Truth (Linear Spherical MAE, Out-of-Sample)
    p15_lon, p15_lat = run_cv_linear_mae(pcs_unw[:, :15], lon, lat)
    configs.append(("3. Top 15 PCs — Linear MAE (Out-of-Sample)", p15_lon, p15_lat))

    # 4. Top 50 PCs -> Ground Truth (Linear Spherical MAE, Out-of-Sample CV)
    p50_lin_cv_lon, p50_lin_cv_lat = run_cv_linear_mae(pcs_unw[:, :50], lon, lat, l2_reg=5e-3)
    configs.append(("4. Top 50 PCs — Linear MAE (Out-of-Sample CV)", p50_lin_cv_lon, p50_lin_cv_lat))

    # 5. Top 50 PCs -> Ground Truth (Linear Spherical MAE, Direct Supervised Fit)
    Xn50 = (pcs_unw[:, :50] - pcs_unw[:, :50].mean(axis=0)) / (pcs_unw[:, :50].std(axis=0) + 1e-8)
    p50_lin_full_lon, p50_lin_full_lat = xyz_to_lonlat(fit_linear_spherical_mae(Xn50, Y_xyz, Xn50, l2_reg=1e-4))
    configs.append(("5. Top 50 PCs — Linear MAE (Direct Supervised Fit)", p50_lin_full_lon, p50_lin_full_lat))

    # 6. Top 50 PCs -> Ground Truth (1-Hidden-Layer Perceptron Spherical MAE: CV & Direct)
    p50_mlp_cv_lon, p50_mlp_cv_lat = run_cv_mlp_spherical_mae(pcs_unw[:, :50], lon, lat, l2_reg=0.025)
    p50_mlp_full_lon, p50_mlp_full_lat = fit_mlp_spherical_mae_full(pcs_unw[:, :50], lon, lat, n_hidden=32, l2_reg=2e-3)
    configs.append(("6. Top 50 PCs — 1-Hidden-Layer MLP MAE (Direct Supervised)", p50_mlp_full_lon, p50_mlp_full_lat))

    rows = []
    for title, plon, plat in configs:
        m = eval_metrics(title, plon, plat, lon, lat, pops)
        rows.append(m)
        print(
            f"  {m['model']:52s} | "
            f"Ind r: {m['ind_r_lon']:.3f}/{m['ind_r_lat']:.3f} | "
            f"Cent r: {m['cent_r_lon']:.3f}/{m['cent_r_lat']:.3f} | "
            f"MAE: {m['mae_km']:5.1f} km | Med: {m['median_km']:5.1f} km (Cent Med: {m['cent_median_km']:5.1f} km)",
            flush=True,
        )

    # Also log 50-PC MLP Out-of-Sample CV
    m_mlp_cv = eval_metrics("Top 50 PCs — 1-Hidden-Layer MLP MAE (Out-of-Sample CV)", p50_mlp_cv_lon, p50_mlp_cv_lat, lon, lat, pops)
    rows.append(m_mlp_cv)
    print(
        f"  {m_mlp_cv['model']:52s} | "
        f"Ind r: {m_mlp_cv['ind_r_lon']:.3f}/{m_mlp_cv['ind_r_lat']:.3f} | "
        f"Cent r: {m_mlp_cv['cent_r_lon']:.3f}/{m_mlp_cv['cent_r_lat']:.3f} | "
        f"MAE: {m_mlp_cv['mae_km']:5.1f} km | Med: {m_mlp_cv['median_km']:5.1f} km (Cent Med: {m_mlp_cv['cent_median_km']:5.1f} km)",
        flush=True,
    )

    pd.DataFrame(rows).to_csv(RESULTS_STATS / "top50_mae_experiment.csv", index=False)

    # Render high-res 2x3 visual comparison PNG
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

    for ax, (title, plon, plat), m in zip(axes.ravel(), configs, rows[:6]):
        draw_coastline(ax)
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
            f"{title}\n"
            f"Ind r: {m['ind_r_lon']:.3f} Lon · {m['ind_r_lat']:.3f} Lat  |  "
            f"Cent r: {m['cent_r_lon']:.3f} Lon · {m['cent_r_lat']:.3f} Lat\n"
            f"MAE: {m['mae_km']:.0f} km  ·  Median Error: {m['median_km']:.0f} km (52 Centers Med: {m['cent_median_km']:.0f} km)",
            fontsize=9.6,
            fontweight="bold",
            color="#f8fafc",
            pad=8,
        )
        ax.set_xlabel("Longitude (°E)", fontsize=8.5, color="#94a3b8")
        ax.set_ylabel("Latitude (°N)", fontsize=8.5, color="#94a3b8")

    plt.suptitle(
        "Supervised Spherical MAE Mapping: From Top 2 -> Top 50 Principal Components to Ground Truth",
        fontsize=14.5,
        fontweight="bold",
        color="#ffffff",
        y=0.98,
    )
    plt.tight_layout(rect=[0, 0, 1, 0.955])
    out_plot = RESULTS_PLOTS / "top50_mae_experiment.png"
    plt.savefig(out_plot, dpi=220, facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"\nSaved Top-50 PC Supervised MAE plot to {out_plot}", flush=True)


if __name__ == "__main__":
    main()
