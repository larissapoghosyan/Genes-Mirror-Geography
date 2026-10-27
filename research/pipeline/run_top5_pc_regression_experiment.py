#!/usr/bin/env python3
"""
Standalone Experimental Pipeline: Top-5 PC Supervised Multiple Linear Regression
================================================================================
Investigates exactly which Principal Components (PC1 through PC5+) carry
continental geographic information (Longitude and Latitude) in the deduplicated
Human Origins (.HO) European dataset (N = 407, 46,222 zero-missingness SNPs).

Kept strictly separate from the canonical unsupervised 2-PC Procrustes pipeline
(`run_human_origins_pca.py`).
"""

import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import pearsonr
from sklearn.decomposition import PCA
import matplotlib.pyplot as plt
import seaborn as sns

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import run_human_origins_pca as base_pipe

ROOT = SCRIPT_DIR.parent
RAW = ROOT / "data" / "raw"
RESULTS_PLOTS = ROOT / "results" / "plots"
RESULTS_STATS = ROOT / "results" / "stats"
WEBSITE_DATA = ROOT.parent / "website" / "data"


def fit_ols_and_metrics(pcs_matrix, lon, lat, pops, k_max=10):
    """Fit cumulative OLS regression for k=1..k_max PCs and compute per-PC attribution."""
    N = len(lon)
    # Standardize PCs and targets for standardized beta weights
    pcs_std = (pcs_matrix - pcs_matrix.mean(axis=0)) / (pcs_matrix.std(axis=0) + 1e-12)
    lon_std = (lon - lon.mean()) / lon.std()
    lat_std = (lat - lat.mean()) / lat.std()

    # Since PCs are mutually orthogonal in unweighted PCA, standardized beta_k == r(PC_k, target)
    w_lon_std = np.linalg.lstsq(pcs_std[:, :5], lon_std, rcond=None)[0]
    w_lat_std = np.linalg.lstsq(pcs_std[:, :5], lat_std, rcond=None)[0]

    # Raw OLS coefficients for k=5 (intercept + 5 PCs) so JS can reconstruct any subset of PC1..PC5!
    # Because centered PCs have mean 0, we center PCs so toggling any subset k in {1..5} is exact:
    # hat_y = mean(y) + sum_{k in active} beta_k * (PC_k - mean(PC_k))
    pcs_centered = pcs_matrix[:, :5] - pcs_matrix[:, :5].mean(axis=0)
    beta_lon_raw = np.linalg.lstsq(pcs_centered, lon - lon.mean(), rcond=None)[0]
    beta_lat_raw = np.linalg.lstsq(pcs_centered, lat - lat.mean(), rcond=None)[0]

    cumul_records = []
    prev_r2_lon = 0.0
    prev_r2_lat = 0.0

    for k in range(1, k_max + 1):
        X_k = np.column_stack([np.ones(N), pcs_matrix[:, :k]])
        b_lon = np.linalg.lstsq(X_k, lon, rcond=None)[0]
        b_lat = np.linalg.lstsq(X_k, lat, rcond=None)[0]
        pred_lon = X_k @ b_lon
        pred_lat = X_k @ b_lat

        r_lon, p_lon = pearsonr(pred_lon, lon)
        r_lat, p_lat = pearsonr(pred_lat, lat)
        r2_lon = (r_lon ** 2) * 100.0
        r2_lat = (r_lat ** 2) * 100.0

        df_tmp = pd.DataFrame({"pop": pops, "plon": pred_lon, "plat": pred_lat, "lon": lon, "lat": lat})
        cent = df_tmp.groupby("pop")[["plon", "plat", "lon", "lat"]].mean()
        rc_lon, _ = pearsonr(cent["plon"], cent["lon"])
        rc_lat, _ = pearsonr(cent["plat"], cent["lat"])

        # Single-PC direct correlation
        r_single_lon, p_single_lon = pearsonr(pcs_matrix[:, k - 1], lon)
        r_single_lat, p_single_lat = pearsonr(pcs_matrix[:, k - 1], lat)

        # Population poles for PC_k
        s_poles = pd.Series(pcs_matrix[:, k - 1], index=pops).groupby(level=0).mean().sort_values()
        neg_pole = f"{s_poles.index[0]} ({s_poles.iloc[0]:.1f})"
        pos_pole = f"{s_poles.index[-1]} ({s_poles.iloc[-1]:.1f})"

        cumul_records.append({
            "pc_index": k,
            "pc_name": f"PC{k}",
            "single_r_lon": float(r_single_lon),
            "single_p_lon": float(p_single_lon),
            "single_r_lat": float(r_single_lat),
            "single_p_lat": float(p_single_lat),
            "delta_r2_lon_pct": float(r2_lon - prev_r2_lon),
            "delta_r2_lat_pct": float(r2_lat - prev_r2_lat),
            "cumul_r_lon": float(r_lon),
            "cumul_r2_lon_pct": float(r2_lon),
            "cumul_r_lat": float(r_lat),
            "cumul_r2_lat_pct": float(r2_lat),
            "centroid_r_lon": float(rc_lon),
            "centroid_r_lat": float(rc_lat),
            "neg_pole": neg_pole,
            "pos_pole": pos_pole,
            "beta_std_lon": float(w_lon_std[k - 1]) if k <= 5 else 0.0,
            "beta_std_lat": float(w_lat_std[k - 1]) if k <= 5 else 0.0,
            "beta_raw_lon": float(beta_lon_raw[k - 1]) if k <= 5 else 0.0,
            "beta_raw_lat": float(beta_lat_raw[k - 1]) if k <= 5 else 0.0,
        })
        prev_r2_lon = r2_lon
        prev_r2_lat = r2_lat

    return pd.DataFrame(cumul_records), pcs_centered, beta_lon_raw, beta_lat_raw


def main():
    print("=" * 72)
    print("  [EXPERIMENT] Top-5 PC Multiple Linear Regression & Attribution")
    print("=" * 72)

    eur_df = base_pipe.chunk_2_cohort_selection()
    snp_df, snp_qc1 = base_pipe.chunk_3_snp_manifest_and_inversion_qc()
    G_all = base_pipe.chunk_4_binary_genotype_extraction(eur_df, snp_df, snp_qc1)
    G_maf, snp_final_qc = base_pipe.chunk_5_quality_control(G_all, snp_qc1, eur_df)
    G_pruned, snp_pruned = base_pipe.chunk_6_ld_pruning(G_maf, snp_final_qc, eur_df)

    # Filter to the balanced 634-individual cohort across 52 European regional populations
    keep_mask = eur_df["in_balanced_cohort"].values
    eur_clean = eur_df[keep_mask].reset_index(drop=True)
    G_clean = G_pruned[keep_mask]

    # Mode A: Standard Unweighted In-Sample PCA on all 634 European individuals
    p_all = np.nanmean(G_clean, axis=0) / 2.0
    denom_all = np.sqrt(np.clip(2.0 * p_all * (1.0 - p_all), 1e-6, None))
    X_unw = np.nan_to_num((G_clean - 2.0 * p_all) / denom_all, nan=0.0)
    pca_unw = PCA(n_components=10, random_state=42)
    pcs_unw = pca_unw.fit_transform(X_unw)
    var_unw = pca_unw.explained_variance_ratio_ * 100.0

    # Mode B: Sample-Balanced PCA (loaded from canonical results CSV)
    bal_df = pd.read_csv(RESULTS_STATS / "human_origins_pca_results.csv")
    pcs_bal = bal_df[[f"PC{i}" for i in range(1, 11)]].values

    lon = eur_clean["longitude"].values
    lat = eur_clean["latitude"].values
    pops = eur_clean["population"].values

    unw_stats, pcs_unw_c, b_lon_unw, b_lat_unw = fit_ols_and_metrics(pcs_unw, lon, lat, pops, k_max=10)
    unw_stats["var_explained_pct"] = var_unw
    unw_stats["mode"] = f"Unweighted_All{len(eur_clean)}"

    bal_stats, pcs_bal_c, b_lon_bal, b_lat_bal = fit_ols_and_metrics(pcs_bal, lon, lat, pops, k_max=10)
    bal_stats["var_explained_pct"] = var_unw
    bal_stats["mode"] = "Balanced_Reference"

    combined_stats = pd.concat([unw_stats, bal_stats], ignore_index=True)
    combined_stats.to_csv(RESULTS_STATS / "top5_pc_regression_summary.csv", index=False)

    print(f"\n--- MODE A: STANDARD UNWEIGHTED PCA (ALL {len(eur_clean)} INDIVIDUALS) ---")
    for _, row in unw_stats.iloc[:5].iterrows():
        print(
            f"  {row['pc_name']} ({row['var_explained_pct']:.2f}% var) | "
            f"ΔR²(Lon)=+{row['delta_r2_lon_pct']:5.1f}%, ΔR²(Lat)=+{row['delta_r2_lat_pct']:5.1f}% | "
            f"Cumul r(Lon)={row['cumul_r_lon']:.4f}, r(Lat)={row['cumul_r_lat']:.4f} "
            f"(Centroid r={row['centroid_r_lon']:.4f}/{row['centroid_r_lat']:.4f}) | "
            f"Poles: {row['neg_pole']} <-> {row['pos_pole']}"
        )

    print("\n--- MODE B: SAMPLE-BALANCED PCA (NOVEMBRE 2-PC BASIS) ---")
    for _, row in bal_stats.iloc[:5].iterrows():
        print(
            f"  {row['pc_name']} ({row['var_explained_pct']:.2f}% var) | "
            f"ΔR²(Lon)=+{row['delta_r2_lon_pct']:5.1f}%, ΔR²(Lat)=+{row['delta_r2_lat_pct']:5.1f}% | "
            f"Cumul r(Lon)={row['cumul_r_lon']:.4f}, r(Lat)={row['cumul_r_lat']:.4f} "
            f"(Centroid r={row['centroid_r_lon']:.4f}/{row['centroid_r_lat']:.4f})"
        )

    # Save 3-panel high-resolution diagnostic figure
    fig, axes = plt.subplots(1, 3, figsize=(19, 6.2))

    # Panel 1: Cumulative R² curve across PC1..PC6 (Unweighted vs Balanced)
    ax0 = axes[0]
    ks = np.arange(1, 7)
    ax0.plot(ks, unw_stats["cumul_r2_lon_pct"].iloc[:6], "o-", color="#2563eb", lw=2.4, label="Unweighted PCA: Longitude R²")
    ax0.plot(ks, unw_stats["cumul_r2_lat_pct"].iloc[:6], "s-", color="#0d9488", lw=2.4, label="Unweighted PCA: Latitude R²")
    ax0.plot(ks, bal_stats["cumul_r2_lon_pct"].iloc[:6], "o--", color="#93c5fd", lw=1.8, label="Balanced PCA: Longitude R²")
    ax0.plot(ks, bal_stats["cumul_r2_lat_pct"].iloc[:6], "s--", color="#5eead4", lw=1.8, label="Balanced PCA: Latitude R²")
    ax0.axvline(4, color="#ef4444", linestyle=":", lw=1.5, label="Geographic Signal Cutoff (PC4)")
    ax0.set_xticks(ks)
    ax0.set_xticklabels([f"Top {k}\n(PC1–{k})" for k in ks])
    ax0.set_ylabel("Geographic Variance Explained R² (%)", fontweight="bold")
    ax0.set_title("A. Which PCs Carry Geographic Signal?\n(Cumulative OLS R² across Top Components)", fontweight="bold")
    ax0.set_ylim(10, 90)
    ax0.grid(True, linestyle="--", alpha=0.35)
    ax0.legend(fontsize=8.5, loc="lower right")

    # Load Europe GeoJSON for Panels 2 & 3
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
                    ax.fill([pt[0] for pt in ring], [pt[1] for pt in ring],
                            facecolor="#f1f5f9", edgecolor="#cbd5e1", linewidth=0.6, zorder=1)
        ax.set_xlim(-22, 46)
        ax.set_ylim(34, 67)
        ax.set_aspect(1.0 / 0.6428)
        ax.grid(True, linestyle="--", alpha=0.3, zorder=2)

    unique_pops = sorted(eur_clean["population"].unique())
    palette = dict(zip(unique_pops, sns.color_palette("husl", len(unique_pops))))

    # Panel 2: Unweighted Top 2 PCs OLS (showing why Sardinian/Basque pull PC1/PC2)
    ax1 = axes[1]
    draw_coastline(ax1)
    pred_lon_2 = lon.mean() + pcs_unw_c[:, :2] @ b_lon_unw[:2]
    pred_lat_2 = lat.mean() + pcs_unw_c[:, :2] @ b_lat_unw[:2]
    for pop in unique_pops:
        m = eur_clean["population"] == pop
        ax1.scatter(pred_lon_2[m], pred_lat_2[m], color=palette[pop], alpha=0.55, s=22, zorder=3)
        ax1.text(pred_lon_2[m].mean(), pred_lat_2[m].mean(), pop.replace("_", " "), fontsize=7.5, fontweight="bold",
                 ha="center", va="center", zorder=4,
                 bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.85, edgecolor=palette[pop], lw=1.1))
    r2_lon_2 = unw_stats.loc[1, "cumul_r_lon"]
    r2_lat_2 = unw_stats.loc[1, "cumul_r_lat"]
    ax1.set_title(f"B. Raw Unweighted Top 2 PCs (PC1 + PC2 Only)\n"
                  f"r(Lon) = {r2_lon_2:.3f}, r(Lat) = {r2_lat_2:.3f} (Basque & Sardinia distort PC2)", fontweight="bold")
    ax1.set_xlabel("Predicted Longitude (°E)", fontweight="bold")
    ax1.set_ylabel("Predicted Latitude (°N)", fontweight="bold")

    # Panel 3: Unweighted Top 5 PCs OLS (PC1 + PC2 + PC3 + PC4 + PC5)
    ax2 = axes[2]
    draw_coastline(ax2)
    pred_lon_5 = lon.mean() + pcs_unw_c[:, :5] @ b_lon_unw[:5]
    pred_lat_5 = lat.mean() + pcs_unw_c[:, :5] @ b_lat_unw[:5]
    for pop in unique_pops:
        m = eur_clean["population"] == pop
        ax2.scatter(pred_lon_5[m], pred_lat_5[m], color=palette[pop], alpha=0.55, s=22, zorder=3)
        ax2.text(pred_lon_5[m].mean(), pred_lat_5[m].mean(), pop.replace("_", " "), fontsize=7.5, fontweight="bold",
                 ha="center", va="center", zorder=4,
                 bbox=dict(boxstyle="round,pad=0.2", facecolor="white", alpha=0.85, edgecolor=palette[pop], lw=1.1))
    r5_lon = unw_stats.loc[4, "cumul_r_lon"]
    r5_lat = unw_stats.loc[4, "cumul_r_lat"]
    rc5_lon = unw_stats.loc[4, "centroid_r_lon"]
    rc5_lat = unw_stats.loc[4, "centroid_r_lat"]
    ax2.set_title(f"C. Supervised 5-PC Linear Regression (PC1–PC5)\n"
                  f"Ind r = {r5_lon:.3f} / {r5_lat:.3f} | Centroid r = {rc5_lon:.3f} / {rc5_lat:.3f}", fontweight="bold")
    ax2.set_xlabel("Predicted Longitude (°E)", fontweight="bold")
    ax2.set_ylabel("Predicted Latitude (°N)", fontweight="bold")

    plt.tight_layout()
    out_fig = RESULTS_PLOTS / "top5_pc_regression_experiment.png"
    plt.savefig(out_fig, dpi=300)
    plt.close()
    print(f"\nSaved 3-panel regression figure to {out_fig}")

    # Export the historical 634-person data bundle for the research notebooks.
    # Include both Unweighted PC1..PC5 and Balanced PC1..PC5 centered coordinates and regression weights
    # so the user can toggle any combination of PC1, PC2, PC3, PC4, PC5 in real time!
    atlas_js_text = (WEBSITE_DATA / "genome_atlas.js").read_text()
    atlas_obj = json.loads(atlas_js_text.replace("window.GENOME_ATLAS = ", "").rstrip(";\n"))
    pop_meta = {c["pop"]: {"color": c["color"], "region": c["region"]} for c in atlas_obj["centroids"]}
    sample_proc = {s["id"]: (s["rotLon"], s["rotLat"]) for s in atlas_obj["samples"]}

    samples_out = []
    for i in range(len(eur_clean)):
        sid = str(eur_clean.loc[i, "sample_id"])
        pop = str(eur_clean.loc[i, "population"])
        plon, plat = sample_proc.get(sid, (float(lon[i]), float(lat[i])))
        samples_out.append({
            "id": sid,
            "pop": pop,
            "sex": str(eur_clean.loc[i, "sex"]),
            "region": pop_meta[pop]["region"],
            "color": pop_meta[pop]["color"],
            "lon": float(lon[i]),
            "lat": float(lat[i]),
            # Centered PC1..PC5 for Unweighted PCA
            "unw_pcs": [round(float(pcs_unw_c[i, k]), 4) for k in range(5)],
            # Centered PC1..PC5 for Balanced PCA
            "bal_pcs": [round(float(pcs_bal_c[i, k]), 4) for k in range(5)],
            # 2-PC rigid Procrustes coordinates for reference
            "proc_lon": round(float(plon), 3),
            "proc_lat": round(float(plat), 3),
        })

    lab_bundle = {
        "mean_lon": round(float(lon.mean()), 4),
        "mean_lat": round(float(lat.mean()), 4),
        "unweighted": {
            "beta_lon": [round(float(x), 6) for x in b_lon_unw],
            "beta_lat": [round(float(x), 6) for x in b_lat_unw],
            "components": unw_stats.iloc[:6].to_dict(orient="records"),
        },
        "balanced": {
            "beta_lon": [round(float(x), 6) for x in b_lon_bal],
            "beta_lat": [round(float(x), 6) for x in b_lat_bal],
            "components": bal_stats.iloc[:6].to_dict(orient="records"),
        },
        "samples": samples_out,
        "map_polygons": atlas_obj.get("map_polygons", atlas_obj.get("polygons", [])),
    }

    lab_js_path = ROOT / "data/historical_634/lab_5pc_data.js"
    lab_js_path.write_text("window.LAB_5PC_DATA = " + json.dumps(lab_bundle) + ";\n")
    print(f"Saved interactive 5-PC regression bundle to {lab_js_path}")


if __name__ == "__main__":
    main()
