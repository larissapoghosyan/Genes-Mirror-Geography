#!/usr/bin/env python3
"""Human Origins / AADR v66 European PCA demonstration.

Restore every member of the previously selected clean pool; fit PCs on the
frozen historical reference panel and project all individuals. This is an
adaptation of the genes/geography idea, not an exact POPRES replication.
See the executed notebook for assumptions, exclusions, and limitations.
"""

import json
import time
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.stats import pearsonr
from sklearn.decomposition import PCA

# ── Base Directory Structure ──
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
QC_DIR = ROOT / "data" / "qc"
PLOTS = ROOT / "results" / "plots"
STATS = ROOT / "results" / "stats"
WEBSITE_DATA = ROOT.parent / "website" / "data"

for d in [PROCESSED, QC_DIR, PLOTS, STATS, WEBSITE_DATA]:
    d.mkdir(parents=True, exist_ok=True)

GENO_FILE = RAW / "v66.p1_compatibility_HO.aadr.patch.PUB.geno"
IND_FILE  = RAW / "v66.p1_compatibility_HO.aadr.patch.PUB.ind"
SNP_FILE  = RAW / "v66.p1_compatibility_HO.aadr.patch.PUB.snp"
ANNO_FILE = RAW / "v66.p1_compatibility_HO.aadr.PUB.anno"

# Legacy 26-population core .HO publications used to anchor the 100%-call-rate SNP set
CORE_HO_PUBLICATIONS = {
    "PattersonReichGenetics2012",
    "LazaridisKrauseNature2014",
    "LazaridisReichNature2016",
}

LEGACY_26_POPS = {
    "English", "Scottish", "Orcadian", "Icelandic", "Norwegian", "Finnish",
    "Estonian", "Lithuanian", "French", "Spanish", "Spanish_North", "Basque",
    "Italian_North", "Italian_South", "Sicilian", "Sardinian", "Czech",
    "Hungarian", "Croatian", "Albanian", "Romanian", "Bulgarian", "Greek",
    "Belarusian", "Ukrainian", "Russian",
}

# Historical exclusion intervals, in the supplied SNP manifest coordinate system.
# Retained for comparability; not asserted to reproduce the original paper masks.
HIGH_LD_REGIONS = [
    (1,  48e6, 52e6),     # Chr1 region
    (2,  86e6, 100.5e6),  # Historical Chr2 interval
    (2,  134.5e6, 138e6), # Historical Chr2 interval
    (6,  25e6, 33.5e6),   # Chr6 MHC/HLA
    (8,  8e6, 12e6),      # Chr8p23.1 inversion
    (11, 45e6, 57e6),     # Chr11 region
    (17, 40e6, 43e6),     # Chr17q21.31 inversion
]

# Isolate / Peripheral Drift Cohorts Capped in Reference Eigenvector Fit
ISOLATE_COHORTS = {
    "Sardinian", "Basque", "Spanish_North", "Maltese", "Russian_North", "French_South"
}

# Macro-Region & Color Assignment for All 52 Regional European Cohorts
def get_region_and_color(pop):
    if pop in {"Icelandic", "Norwegian", "Finnish", "Estonian", "Lithuanian"}:
        return "Northern & Nordic", "#20C997"
    if pop in {"English_Cornwall", "English_Kent", "Scottish", "Orcadian"} or pop.startswith("French"):
        return "Western & Atlantic", "#4DABF7"
    if pop == "Basque" or pop.startswith("Spanish"):
        return "Iberia & Basque", "#FF8787"
    if pop in {"Sardinian", "Sicilian", "Maltese"} or pop.startswith("Italian"):
        return "Mediterranean", "#FF922B"
    if pop in {"Albanian", "Greek", "Bulgarian", "Romanian", "Croatian", "Serbian", "Bosnian", "Montenegrin", "Moldavian"}:
        return "Balkans & Southeast", "#51CF66"
    return "Central & Eastern", "#845EF7"


def assign_regional_cohort(row, loc_col):
    """Map raw AADR v66 population + locality into 52 geographically resolved European cohorts."""
    p = str(row["pop"])
    loc = str(row[loc_col])
    if p in ("GBR", "English"):
        if "Orkney" in loc:
            return "Orcadian"
        if "Cornwall" in loc:
            return "English_Cornwall"
        return "English_Kent"
    if p in ("FIN", "Finnish"):
        return "Finnish"
    if p == "French":
        if "Moselle" in loc or "Yonne" in loc:
            return "French_East"
        if "Nord" in loc or "Pas-de-Calais" in loc or "Seine-Maritime" in loc:
            return "French_North"
        if "Ille-et-Vilaine" in loc or "Loire-Atlantique" in loc:
            return "French_West"
        if "Lourdes" in loc:
            return "French_South"
        return "French"
    if p == "TSI":
        return "Italian_Tuscany"
    if p in ("Italian_North", "Italian_North-1"):
        if row["lat"] < 44.0:
            return "Italian_Tuscany"
        return "Italian_North"
    if p in ("Spanish", "Spanish-1", "IBS", "IBS-1"):
        if "Eivissa" in loc:
            return "Spanish_Ibiza"
        if "Balear" in loc:
            return "Spanish_Baleares"
        if any(k in loc for k in ["Catal", "Barcelon", "Girona", "Lleida", "Tarragona", "Pened", "Pirineu", "Ebre"]):
            return "Spanish_Catalonia"
        if any(k in loc for k in ["València", "Alacant", "Castelló"]):
            return "Spanish_Valencia"
        if "Galicia" in loc:
            return "Spanish_Galicia"
        if "Cantabria" in loc:
            return "Spanish_Cantabria"
        if "Andalucia" in loc:
            return "Spanish_Andalucia"
        if "Extremadura" in loc:
            return "Spanish_Extremadura"
        if "Aragon" in loc:
            return "Spanish_Aragon"
        if "Murcia" in loc:
            return "Spanish_Murcia"
        if "Pais Vasco" in loc:
            return "Spanish_North"
        return "Spanish_Castilla"
    if p == "Russian":
        if "Vologda" in loc:
            return "Russian_North"
        if "Pskov" in loc:
            return "Russian_West"
        if any(k in loc for k in ["Belgorod", "Pristensky", "Livnensky", "Roslavl", "Borovsky"]):
            return "Russian_SouthWest"
        return "Russian_Central"
    if p in ("Ukrainian", "Ukrainian_North"):
        if "Lviv" in loc or "Rovenskaya" in loc or "Zhitomir" in loc:
            return "Ukrainian_West"
        return "Ukrainian_East"
    if p in ("Cypriot-1", "Cypriot-2"):
        return "Cypriot"
    if p in ("Greek_1", "Greek_1-1"):
        return "Greek"
    if p in ("Serbian_Serb", "North_Macedonian_Serb"):
        return "Serbian"
    if p == "Montenegrin_Serb":
        return "Montenegrin"
    if p == "Bosnian_Serb":
        return "Bosnian"
    if p == "Croatian_Serb":
        return "Croatian"
    return p


def chunk_1_verify_environment():
    """Chunk 1: Environment & File Verification"""
    print("=" * 70)
    print("  [CHUNK 1] Verifying Environment & File System...")
    print("=" * 70)
    assert GENO_FILE.exists(), f"Missing GENO file: {GENO_FILE}"
    assert IND_FILE.exists(), f"Missing IND file: {IND_FILE}"
    assert SNP_FILE.exists(), f"Missing SNP file: {SNP_FILE}"
    assert ANNO_FILE.exists(), f"Missing ANNO file: {ANNO_FILE}"
    print(f"  • GENO File Size : {GENO_FILE.stat().st_size / 1e9:.2f} GB")
    print("  Environment check passed.\n")


def chunk_2_cohort_selection():
    """Chunk 2: Expanded European Cohort Selection, Coordinate Audit & Platform Deduplication"""
    print("=" * 70)
    print("  [CHUNK 2] Selecting & Cleaning Expanded AADR v66 European Cohort...")
    print("=" * 70)
    anno = pd.read_csv(ANNO_FILE, sep="\t", low_memory=False)
    ind = pd.read_csv(IND_FILE, sep=r"\s+", header=None, names=["gid", "sex", "pop"])
    ind["sample_idx"] = np.arange(len(ind))

    gid_col = anno.columns[0]
    iid_col = anno.columns[2]
    pub_col = anno.columns[6]
    date_col = anno.columns[10]
    loc_col = anno.columns[15]
    country_col = anno.columns[16]
    lat_col = anno.columns[17]
    lon_col = anno.columns[18]
    snp_col = anno.columns[29]

    df = ind.merge(anno, left_on="gid", right_on=gid_col, how="left")
    df["date_mean"] = pd.to_numeric(df[date_col], errors="coerce")
    df["lat"] = pd.to_numeric(df[lat_col], errors="coerce")
    df["lon"] = pd.to_numeric(df[lon_col], errors="coerce")
    df["snps_ho"] = pd.to_numeric(df[snp_col], errors="coerce").fillna(0)
    df["suffix"] = [x.split(".")[-1] if "." in x else "none" for x in df["gid"]]

    # Flag legacy 409 core .HO samples to anchor the 100%-call-rate SNP manifest
    df["is_core_ho"] = (
        (df["suffix"] == "HO")
        & df["pop"].isin(LEGACY_26_POPS)
        & df[pub_col].isin(CORE_HO_PUBLICATIONS)
    )

    eur_countries = [
        "United Kingdom", "Iceland", "Norway", "Sweden", "Finland", "Estonia", "Latvia", "Lithuania",
        "Denmark", "Netherlands", "Belgium", "France", "Spain", "Portugal", "Ireland", "Germany",
        "Switzerland", "Austria", "Italy", "Czechia", "Czech Republic", "Poland", "Slovakia", "Hungary",
        "Slovenia", "Croatia", "Bosnia and Herzegovina", "Bosnia-Herzegovina", "Serbia", "Montenegro",
        "Albania", "North Macedonia", "Macedonia", "Greece", "Bulgaria", "Romania", "Moldova",
        "Ukraine", "Belarus", "Russia", "Malta", "Cyprus",
    ]
    modern = df[(df["date_mean"] == 0) & (df[country_col].str.strip().isin(eur_countries))].copy()

    # Retained historical population/platform scope. Not all Europeans are represented.
    exclude_tokens = [
        "QCremove", "-o", "Discovery", "CEU", "CanaryIslands", "Jew_Ashkenazi",
        "Kalmyk", "Nogai", "Tatar", "Bashkir", "Chuvash", "Udmurt", "Besermyan",
        "Mari", "Komi", "Khanty", "Saami", "WGA", "Mordovian", "Archangelsk",
    ]
    modern = modern[~modern["pop"].apply(lambda p: any(ex in str(p) for ex in exclude_tokens))].copy()
    modern = modern[modern["suffix"].isin(["HO", "DG"])].copy()
    modern = modern[~((modern[country_col].str.strip() == "Russia") & ((modern["lon"] > 42.0) | (modern["lat"] < 49.0) | modern["lon"].isna()))]

    # Historical locality proxies; these are not individual birthplaces or verified GPS fixes.
    modern["coordinate_source"] = "AADR annotation"
    loc_coords = {
        "Unknown, Finland": (60.2, 24.9),
        "Cornwall and Devon (England)": (50.5, -4.2),
        "Baleares": (39.5, 3.0),
        "Castilla y Leon": (41.4, -4.5),
        "Cataluna": (41.8, 1.5),
        "Unknown, Spain": (40.4, -3.7),
        "Unknown, Norway": (60.4, 5.4),
    }
    for loc_name, (lt, ln) in loc_coords.items():
        m = (modern["lat"].isna() | modern["lon"].isna()) & (modern[loc_col] == loc_name)
        modern.loc[m, "lat"] = lt
        modern.loc[m, "lon"] = ln
        modern.loc[m, "coordinate_source"] = "Assigned locality proxy"

    modern.loc[modern["pop"] == "TSI", "lat"] = 43.8
    modern.loc[modern["pop"] == "TSI", "lon"] = 11.2
    modern.loc[modern["pop"] == "TSI", "coordinate_source"] = "Assigned Tuscany proxy"

    # Exclude HGDP re-sequencings (already present in Patterson2012 .HO) and deduplicate by Individual ID (.HO preferred over .DG)
    modern = modern[~modern[pub_col].isin(["Byrska-BishopZodyCell2022", "BergströmTyler-SmithScience2020"])].copy()
    suf_priority = {"HO": 0, "DG": 1}
    modern["suf_rank"] = modern["suffix"].map(lambda s: suf_priority.get(s, 9))
    dedup = (
        modern.sort_values(["suf_rank", "snps_ho"], ascending=[True, False])
        .drop_duplicates(subset=[iid_col], keep="first")
        .sort_values("sample_idx")
        .reset_index(drop=True)
    )

    dedup["population"] = dedup.apply(assign_regional_cohort, loc_col=loc_col, axis=1)

    # Exclude non-continental peripheral outliers (Cypriot, Ibiza island isolate, Karelian/Veps, Gagauz, Crete)
    # and retain a historical six-ID exclusion list. Relatedness is not re-estimated here.
    peripheral_excl = {"Cypriot", "Spanish_Ibiza", "Karelian", "Veps", "Gagauz", "Greek_Crete"}
    cryptic_relatives = {"ITS2.HO", "ITS5.HO", "PuG20.HO", "KAR-183.HO", "HG00120.DG", "HG00240.DG"}
    clean_pool = dedup[
        (~dedup["population"].isin(peripheral_excl))
        & (~dedup["gid"].isin(cryptic_relatives))
    ].copy().reset_index(drop=True)

    # All clean-pool individuals are retained. Freeze old membership only for
    # audit/comparison and the original PCA reference, never to cap output.
    membership = json.loads((Path(__file__).parent / "cohort_reference.json").read_text())
    extract_df = clean_pool.copy().reset_index(drop=True)
    extract_df["in_legacy_cohort"] = extract_df["gid"].isin(membership["legacy_ids"])
    extract_df["is_pca_reference"] = extract_df["gid"].isin(membership["reference_ids"])
    extract_df["restored_sample"] = ~extract_df["in_legacy_cohort"]
    # Compatibility field for archived experimental scripts; NOT the output mask.
    extract_df["in_balanced_cohort"] = extract_df["in_legacy_cohort"]
    assert set(membership["legacy_ids"]).issubset(set(extract_df["gid"]))
    assert set(membership["reference_ids"]).issubset(set(extract_df["gid"]))
    assert extract_df["gid"].is_unique
    assert np.isfinite(extract_df[["lat", "lon"]].to_numpy()).all()
    extract_df["sample_id"] = extract_df["gid"]
    extract_df["latitude"] = extract_df["lat"]
    extract_df["longitude"] = extract_df["lon"]
    extract_df["locality"] = extract_df[loc_col].fillna("")
    extract_df["country"] = extract_df[country_col].str.strip()
    extract_df["publication"] = extract_df[pub_col].fillna("")

    counts = extract_df.groupby("population").agg(
        total=("sample_id", "size"), legacy=("in_legacy_cohort", "sum"),
        restored=("restored_sample", "sum"), reference=("is_pca_reference", "sum"))
    counts.to_csv(QC_DIR / "cohort_counts.csv")
    print(f"  • Retained: {len(extract_df):,} individuals / {len(counts)} regional groups")
    print(f"  • Restored: {extract_df.restored_sample.sum()}; reference: {extract_df.is_pca_reference.sum()}")
    return extract_df


def chunk_3_snp_manifest_and_inversion_qc():
    """Chunk 3: Parse SNP Dictionary & Exclude Inversions/High-LD Regions"""
    print("=" * 70)
    print("  [CHUNK 3] Parsing SNP Manifest & Stripping Inversions/High-LD...")
    print("=" * 70)
    snp_records = []
    with open(SNP_FILE, "r") as f:
        for idx, line in enumerate(f):
            parts = line.strip().split()
            if len(parts) >= 6:
                snp_records.append({
                    "snp_idx": idx,
                    "snpid": parts[0],
                    "chrom": parts[1],
                    "pos": int(parts[3])
                })

    snp_df = pd.DataFrame(snp_records)
    snp_df["chrom_int"] = pd.to_numeric(snp_df["chrom"], errors="coerce")

    def in_high_ld(c, p):
        return any(c == chrom and start <= p <= end for chrom, start, end in HIGH_LD_REGIONS)

    autosomal_mask = (snp_df["chrom_int"] >= 1) & (snp_df["chrom_int"] <= 22)
    high_ld_mask = [in_high_ld(c, p) for c, p in zip(snp_df["chrom_int"], snp_df["pos"])]
    snp_qc1 = snp_df[autosomal_mask & (~np.array(high_ld_mask))].copy().reset_index(drop=True)

    print(f"  • Total SNPs on array               : {len(snp_df):,}")
    print(f"  • SNPs in historical intervals      : {sum(high_ld_mask):,} (removed)")
    print(f"  • Retained Autosomal SNPs    : {len(snp_qc1):,}")
    print("  SNP manifest QC complete.\n")
    return snp_df, snp_qc1


def chunk_4_binary_genotype_extraction(eur_df, snp_df, snp_qc1):
    """Chunk 4: Vectorized 2-Bit Extraction from Sample-Major Binary GENO"""
    print("=" * 70)
    print("  [CHUNK 4] Fast Vectorized Binary Genotype Extraction...")
    print("=" * 70)
    t0 = time.time()
    n_total_snps = len(snp_df)
    bytes_per_sample = (n_total_snps + 3) // 4
    HEADER_OFFSET = 48

    target_indices = eur_df["sample_idx"].values
    kept_snp_indices = snp_qc1["snp_idx"].values

    lookup = np.zeros((256, 4), dtype=np.float32)
    for b in range(256):
        for k in range(4):
            val = (b >> (2 * k)) & 3
            lookup[b, k] = np.nan if val == 3 else float(val)

    G_all = np.empty((len(eur_df), len(kept_snp_indices)), dtype=np.float32)

    with open(GENO_FILE, "rb") as f:
        header = f.read(HEADER_OFFSET).rstrip(b"\0").decode("ascii").split()
        assert header[0] == "TGENO", "Expected sample-major TGENO"
        n_ind, n_snp = map(int, header[1:3])
        assert n_snp == n_total_snps
        assert n_ind == sum(1 for _ in open(IND_FILE))
        assert GENO_FILE.stat().st_size == HEADER_OFFSET + n_ind * bytes_per_sample
        for i, s_idx in enumerate(target_indices):
            f.seek(HEADER_OFFSET + s_idx * bytes_per_sample)
            raw_bytes = f.read(bytes_per_sample)
            byte_arr = np.frombuffer(raw_bytes, dtype=np.uint8)
            unpacked = lookup[byte_arr].reshape(-1)[:n_total_snps]
            G_all[i, :] = unpacked[kept_snp_indices]

    print(f"  • Extracted Genotype Matrix : {G_all.shape} in {time.time()-t0:.2f}s")
    print("  Binary extraction complete.\n")
    eur_df["autosomal_call_rate"] = np.isfinite(G_all).mean(axis=1)
    assert (eur_df["autosomal_call_rate"] >= 0.95).all(), "Review low-call-rate samples before proceeding"
    return G_all


def chunk_5_quality_control(G_all, snp_qc1, eur_df=None):
    """Chunk 5: 100% Call Rate on Core .HO Panel & MAF >= 5%"""
    print("=" * 70)
    print("  [CHUNK 5] Quality Control: Core 100% Call Rate & MAF >= 5%...")
    print("=" * 70)
    if eur_df is not None and "is_core_ho" in eur_df.columns:
        core_mask = eur_df["is_core_ho"].values
    else:
        core_mask = np.ones(G_all.shape[0], dtype=bool)

    zero_missing_mask = np.isnan(G_all[core_mask]).sum(axis=0) == 0
    G_clean = G_all[:, zero_missing_mask]
    snp_qc2 = snp_qc1[zero_missing_mask].reset_index(drop=True)

    alt_freq = np.nanmean(G_clean[core_mask], axis=0) / 2.0
    maf = np.minimum(alt_freq, 1.0 - alt_freq)
    maf_mask = maf >= 0.05

    G_maf = G_clean[:, maf_mask]
    snp_final_qc = snp_qc2[maf_mask].reset_index(drop=True)

    print(f"  • SNPs with 100% Core Call Rate        : {G_clean.shape[1]:,}")
    print(f"  • SNPs passing MAF (>=5%)              : {G_maf.shape[1]:,}")
    print("  Quality control complete.\n")
    return G_maf, snp_final_qc


def chunk_6_ld_pruning(G_maf, snp_final_qc, eur_df=None):
    """Chunk 6: Vectorized Sliding-Window Linkage Disequilibrium (LD) Pruning (r² < 0.20)"""
    print("=" * 70)
    print("  [CHUNK 6] Sliding-Window Linkage Disequilibrium (LD) Pruning...")
    print("=" * 70)
    t_ld0 = time.time()
    if eur_df is not None and "is_core_ho" in eur_df.columns:
        G_ld_base = G_maf[eur_df["is_core_ho"].values]
    else:
        G_ld_base = G_maf

    n_snps = G_ld_base.shape[1]
    keep = np.ones(n_snps, dtype=bool)
    G_std = (G_ld_base - np.nanmean(G_ld_base, axis=0)) / (np.nanstd(G_ld_base, axis=0) + 1e-7)
    G_std = np.nan_to_num(G_std, nan=0.0)
    N = G_ld_base.shape[0]
    window = 50
    step = 5
    r2_threshold = 0.20

    # Never correlate SNPs across chromosome boundaries. Input is sorted below.
    order = snp_final_qc.sort_values(["chrom_int", "pos"]).index.to_numpy()
    assert np.array_equal(order, np.arange(n_snps)), "SNP manifest must be chromosome/position sorted"
    for _, chrom_group in snp_final_qc.groupby("chrom_int", sort=False):
        chrom_indices = chrom_group.index.to_numpy()
        start = int(chrom_indices[0])
        chrom_end = int(chrom_indices[-1]) + 1
        while start < chrom_end:
            end = min(start + window, chrom_end)
            sub_indices = np.where(keep[start:end])[0] + start
            if len(sub_indices) > 1:
                sub_G = G_std[:, sub_indices]
                corr2 = ((sub_G.T @ sub_G) / N) ** 2
                for i in range(len(sub_indices)):
                    if not keep[sub_indices[i]]:
                        continue
                    for j in range(i + 1, len(sub_indices)):
                        if corr2[i, j] > r2_threshold:
                            keep[sub_indices[j]] = False
            start += step

    G_pruned = G_maf[:, keep]
    snp_pruned = snp_final_qc[keep].reset_index(drop=True)
    print(f"  • Pruned SNPs in {time.time()-t_ld0:.2f}s")
    print(f"  • LD-pruned SNPs Retained : {G_pruned.shape[1]:,} (removed {(~keep).sum():,} collinear SNPs)")
    print("  LD pruning complete.\n")
    return G_pruned, snp_pruned


def chunk_7_pca(G_pruned, eur_df):
    """Chunk 7: HWE-normalized sklearn PCA on frozen reference; projection of every sample"""
    print("=" * 70)
    print("  [CHUNK 7] Fitting reference PCA and projecting the full cohort...")
    print("=" * 70)
    ref_idx = np.flatnonzero(eur_df["is_pca_reference"].to_numpy())
    assert len(ref_idx) > 10

    # Patterson Hardy-Weinberg Standardization: Z = (G - 2p) / sqrt(2p(1-p))
    # Any rare missing call is set to Z = 0.0 (mean allele frequency, per EIGENSOFT/SmartPCA)
    G_ref = G_pruned[ref_idx]
    p_j = np.nanmean(G_ref, axis=0) / 2.0
    denom = np.sqrt(2.0 * p_j * (1.0 - p_j))
    denom[denom < 1e-6] = 1.0

    X_ref = np.nan_to_num((G_ref - 2.0 * p_j) / denom, nan=0.0)
    X_all = np.nan_to_num((G_pruned - 2.0 * p_j) / denom, nan=0.0)

    pca = PCA(n_components=10, random_state=42)
    pca.fit(X_ref)
    pcs = pca.transform(X_all)
    var_exp = pca.explained_variance_ratio_ * 100

    results_df = eur_df.copy()
    pd.DataFrame({"pc": np.arange(1, 11), "reference_variance_pct": var_exp}).to_csv(
        STATS / "pca_explained_variance.csv", index=False)
    for i in range(10):
        results_df[f"PC{i+1}"] = pcs[:, i].astype(np.float64)

    print(f"  • Final Clean Cohort Size         : {len(results_df):,} individuals across {results_df['population'].nunique()} cohorts")
    print(f"  • Variance Explained (Top 10 PCs) : {var_exp.sum():.2f}%")
    for i, v in enumerate(var_exp):
        bar = "█" * int(v * 25)
        print(f"    - PC{i+1:<2}: {v:5.2f}%  {bar}")
    print("  PCA complete.\n")
    return results_df, G_pruned, var_exp


def chunk_8_procrustes_superposition(results_df):
    """Fit one similarity transform to all 52 legacy regional centroids.

    Geography is used ONLY at this alignment stage, never as an input to PCA.
    A local equirectangular plane uses x = lon*cos(mean latitude), y = lat.
    Reflection (arbitrary PC sign), rotation, ONE scale, and translation are
    permitted; independent axis rescaling and per-point adjustments are not.
    The 362 restored samples do not contribute to the alignment fit.
    """
    calibration = results_df.loc[results_df.in_legacy_cohort]
    cent = calibration.groupby("population")[["PC1", "PC2", "longitude", "latitude"]].mean()
    A = cent[["PC1", "PC2"]].to_numpy(dtype=float)
    reference_latitude = float(cent.latitude.mean())
    lon_factor = float(np.cos(np.deg2rad(reference_latitude)))
    B = cent[["longitude", "latitude"]].to_numpy() * [lon_factor, 1]
    am, bm = A.mean(axis=0), B.mean(axis=0)
    ac, bc = A - am, B - bm
    U, singular, Vt = np.linalg.svd(ac.T @ bc)
    rotation = U @ Vt
    scale = float(singular.sum() / np.square(ac).sum())
    fitted = ac @ rotation * scale + bm
    disparity = float(np.square(fitted - B).sum() / np.square(bc).sum())
    all_pc = results_df[["PC1", "PC2"]].to_numpy()
    aligned = (all_pc - am) @ rotation * scale + bm
    # Factor the possible sign reflection out of the animation's proper rotation.
    reflection = np.diag([1., float(np.linalg.det(rotation))])
    proper_rotation = reflection @ rotation
    angle = float(np.rad2deg(np.arctan2(proper_rotation[0, 1], proper_rotation[0, 0])))
    initial = (all_pc - am) @ reflection * scale + bm
    results_df = results_df.copy()
    results_df[["RotEW", "RotNS"]] = aligned
    results_df[["rotLon", "rotLat"]] = aligned / [lon_factor, 1]
    results_df[["x0", "y0"]] = initial / [lon_factor, 1]
    results_df.attrs["alignment"] = {
        "calibration": "Equal-weight centroids of all 52 historical regional groups",
        "calibration_n": len(calibration), "reference_latitude": reference_latitude,
        "longitude_factor": lon_factor, "pc_center": am.tolist(),
        "center": (bm / [lon_factor, 1]).tolist(), "rotation": rotation.tolist(),
        "scale": scale, "reflection": reflection.tolist(), "target_angle": angle,
        "disparity": disparity,
    }
    print(f"Alignment: {len(cent)} legacy centroids; angle {angle:.3f}°; scale {scale:.5f}; disparity {disparity:.5f}")
    return results_df, disparity


def descriptive_metrics(frame):
    """Descriptive correlations; no independent-test p-values after alignment fitting."""
    cent = frame.groupby("population")[["RotEW", "RotNS", "longitude", "latitude"]].mean()
    return {
        "cohort_size": len(frame), "populations": frame.population.nunique(),
        "r_EastWest_Longitude": float(pearsonr(frame.RotEW, frame.longitude).statistic),
        "r_NorthSouth_Latitude": float(pearsonr(frame.RotNS, frame.latitude).statistic),
        "r_centroid_EastWest": float(pearsonr(cent.RotEW, cent.longitude).statistic),
        "r_centroid_NorthSouth": float(pearsonr(cent.RotNS, cent.latitude).statistic),
    }


def chunk_9_validation_and_visualization(results_df, disparity, G_pruned, var_exp):
    """Export all individuals, provenance, descriptive statistics, and honest atlas geometry."""
    alignment = results_df.attrs["alignment"]
    export_cols = [
        "sample_idx", "sample_id", "sex", "population", "locality", "country",
        "publication", "suffix", "latitude", "longitude", "coordinate_source",
        "in_legacy_cohort", "restored_sample", "is_core_ho", "is_pca_reference",
        "autosomal_call_rate", *[f"PC{k}" for k in range(1, 11)],
        "RotEW", "RotNS", "rotLon", "rotLat", "x0", "y0",
    ]
    for path in [STATS / "human_origins_pca_results.csv", PROCESSED / "europe_cleaned_cohort_metadata.csv"]:
        results_df[export_cols].to_csv(path, index=False)
    summaries = []
    for name, subset in [("all", results_df), ("legacy", results_df[results_df.in_legacy_cohort]),
                         ("restored", results_df[results_df.restored_sample])]:
        summaries.append({"subset": name, **descriptive_metrics(subset)})
    pd.DataFrame(summaries).to_csv(STATS / "cohort_comparison_metrics.csv", index=False)
    metrics = summaries[0].copy()
    metrics.update(snps_analyzed=G_pruned.shape[1], reference_size=int(results_df.is_pca_reference.sum()),
                   restored_samples=int(results_df.restored_sample.sum()),
                   procrustes_disparity=disparity,
                   procrustes_similarity=float(np.sqrt(max(0, 1 - disparity))))
    pd.DataFrame([metrics]).to_csv(STATS / "statistical_validation_metrics.csv", index=False)
    (STATS / "alignment_transform.json").write_text(json.dumps(alignment, indent=2) + "\n")

    atlas_path = WEBSITE_DATA / "genome_atlas.js"
    coastline = []
    if atlas_path.exists():
        old = json.loads(atlas_path.read_text().split("=", 1)[1].strip().rstrip(";"))
        coastline = old.get("coastline", [])
    valid_cols = np.flatnonzero(np.isfinite(G_pruned).all(axis=0) &
                              (np.nanmean(G_pruned, axis=0) >= .7) & (np.nanmean(G_pruned, axis=0) <= 1.3))
    assert len(valid_cols) >= 32, "Need 32 distinct observed markers for the genotype illustration"
    chosen = valid_cols[np.linspace(0, len(valid_cols)-1, 32, dtype=int)]
    samples = []
    for i, row in enumerate(results_df.itertuples()):
        region, color = get_region_and_color(row.population)
        samples.append(dict(id=row.sample_id, pop=row.population, country=row.country, sex=row.sex, region=region, color=color,
                            lon=float(row.longitude), lat=float(row.latitude), pc1=float(row.PC1), pc2=float(row.PC2),
                            x0=float(row.x0), y0=float(row.y0), rotLon=float(row.rotLon), rotLat=float(row.rotLat),
                            restored=bool(row.restored_sample), reference=bool(row.is_pca_reference),
                            coordinate_source=row.coordinate_source, allele=int(G_pruned[i, chosen[i % 32]])))
    centroids = []
    for pop, grp in results_df.groupby("population"):
        region, color = get_region_and_color(pop)
        item = dict(pop=pop, region=region, color=color, count=len(grp),
                    country=str(grp.country.iloc[0]) if grp.country.nunique() == 1 else "Multiple countries")
        for dest, src in [("lon", "longitude"), ("lat", "latitude"), ("x0", "x0"), ("y0", "y0"), ("rotLon", "rotLon"), ("rotLat", "rotLat")]:
            item[dest] = float(grp[src].mean())
        centroids.append(item)
    meta = dict(cohort_size=len(results_df), populations=int(results_df.population.nunique()),
                countries=int(results_df.country.nunique()),
                snps_analyzed=G_pruned.shape[1], reference_size=int(results_df.is_pca_reference.sum()),
                restored_samples=int(results_df.restored_sample.sum()),
                r_ew=metrics["r_EastWest_Longitude"], r_ns=metrics["r_NorthSouth_Latitude"],
                rc_ew=metrics["r_centroid_EastWest"], rc_ns=metrics["r_centroid_NorthSouth"],
                similarity=metrics["procrustes_similarity"], **alignment)
    meta["scree"] = [dict(pc=f"PC{k+1}", var=float(v), role="Variance in the frozen PCA reference panel") for k,v in enumerate(var_exp)]
    # Spread the illustrative rows through the fixed cohort order, independent of PCA positions.
    excerpt_rows = np.linspace(0, len(results_df)-1, min(12, len(results_df)), dtype=int)
    genotype_excerpt = dict(marker_indices=chosen.tolist(), cohort_row_indices=excerpt_rows.tolist(),
        selection="Evenly spaced rows in cohort order; illustrative excerpt, not a representative sample", samples=[
        dict(id=str(results_df.iloc[i].sample_id), calls=G_pruned[i, chosen].astype(int).tolist())
        for i in excerpt_rows])
    atlas_path.write_text("window.GENOME_ATLAS = " + json.dumps(dict(meta=meta, samples=samples, centroids=centroids,
        genotype_excerpt=genotype_excerpt, coastline=coastline), allow_nan=False) + ";\n")
    print(pd.DataFrame(summaries).to_string(index=False))
    return metrics


def generate_figures(results_df, metrics):
    """Points only, equal planar aspect: no coastline, no jitter, no density fill."""
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    import plotly.graph_objects as go
    colors = [get_region_and_color(p)[1] for p in results_df.population]
    background, foreground = "#080f1e", "#e5edf7"
    fig, ax = plt.subplots(figsize=(12, 9), facecolor=background)
    ax.set_facecolor(background)
    ax.scatter(results_df.RotEW, results_df.RotNS, c=colors, s=12, alpha=.75, linewidths=0)
    ax.set_aspect("equal", adjustable="box")
    ax.margins(.08)
    ax.axis("off")
    fig.suptitle("Europe, through human genetic variation", color=foreground, fontsize=23, y=.95)
    ax.set_title(f'{len(results_df):,} individuals · {results_df.population.nunique()} regional groups · {metrics["snps_analyzed"]:,} LD-pruned markers', color="#aebed2", fontsize=12, pad=15)
    regions = dict(get_region_and_color(p) for p in results_df.population)
    handles = [Line2D([], [], marker="o", linestyle="", color=c, label=r, markersize=6) for r,c in regions.items()]
    fig.legend(handles=handles, loc="lower center", ncol=3, frameon=False, labelcolor=foreground, bbox_to_anchor=(.5,.06), fontsize=10)
    fig.text(.5,.035,"DNA-derived PCs; geography calibrates orientation and one common scale. No coastlines drawn.",ha="center",color="#aebed2",fontsize=10)
    fig.text(.5,.015,"Sampling is uneven; dots show genetic structure, not a reconstructed shoreline or individual birthplace.",ha="center",color="#aebed2",fontsize=9)
    fig.subplots_adjust(top=.85,bottom=.16,left=.04,right=.96)
    path = PLOTS / "human_expanded_points_only.png"
    fig.savefig(path, dpi=220, facecolor=background)
    plt.close(fig)

    fig, axes = plt.subplots(1,3,figsize=(16,6))
    panels = [(results_df.PC1,results_df.PC2,"A · Raw PC1 / PC2"),
              (results_df.RotEW,results_df.RotNS,"B · One similarity transform"),
              (results_df.longitude * results_df.attrs["alignment"]["longitude_factor"],results_df.latitude,"C · Recorded locality coordinates")]
    for ax,(x,y,title) in zip(axes,panels):
        ax.scatter(x,y,c=colors,s=8,alpha=.65,linewidths=0)
        ax.set_aspect("equal",adjustable="box");ax.set_title(title);ax.set_xticks([]);ax.set_yticks([])
    xbounds = (min(axes[1].get_xlim()[0], axes[2].get_xlim()[0]), max(axes[1].get_xlim()[1], axes[2].get_xlim()[1]))
    ybounds = (min(axes[1].get_ylim()[0], axes[2].get_ylim()[0]), max(axes[1].get_ylim()[1], axes[2].get_ylim()[1]))
    for ax in axes[1:]: ax.set_xlim(xbounds); ax.set_ylim(ybounds)
    fig.suptitle(f"{len(results_df):,} humans · full projected cohort · no continent outlines",fontsize=17)
    fig.text(.5,.03,f'Descriptive individual r: longitude {metrics["r_EastWest_Longitude"]:.3f}; latitude {metrics["r_NorthSouth_Latitude"]:.3f}. Geography is used for alignment, not for fitting PCA.',ha="center",fontsize=10)
    fig.subplots_adjust(bottom=.13,top=.86,wspace=.16)
    fig.savefig(PLOTS/"pca_rotation_progression_3panel.png",dpi=200)
    plt.close(fig)

    interactive = go.Figure()
    # The outline uses the SAME local projection as the aligned points. Keep
    # axis ranges fixed so showing it never changes the point-cloud view.
    factor = results_df.attrs["alignment"]["longitude_factor"]
    map_x, map_y = [], []
    geography = json.loads((RAW / "europe.geojson").read_text())
    for feature in geography["features"]:
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            for ring in polygon:
                for lon, lat, *_ in ring:
                    if -28 <= lon <= 46 and 33 <= lat <= 72:
                        map_x.append(lon * factor)
                        map_y.append(lat)
                    else:
                        map_x.append(None)
                        map_y.append(None)
                map_x.append(None)
                map_y.append(None)
    interactive.add_trace(go.Scatter(x=map_x, y=map_y, mode="lines", name="Europe outline",
        line=dict(color="rgba(129,163,174,0.65)", width=1),
        hoverinfo="skip", showlegend=False, visible=False))
    for pop, group in results_df.groupby("population"):
        interactive.add_trace(go.Scatter(x=group.RotEW,y=group.RotNS,mode="markers",name=pop,
            marker=dict(size=6,color=get_region_and_color(pop)[1],opacity=.7),
            customdata=group[["sample_id","restored_sample"]].to_numpy(),
            hovertemplate="%{customdata[0]}<br>Restored: %{customdata[1]}<extra>%{fullData.name}</extra>"))
    xpad = (results_df.RotEW.max() - results_df.RotEW.min()) * .08
    ypad = (results_df.RotNS.max() - results_df.RotNS.min()) * .08
    interactive.update_layout(title=f"Human genetic variation · {len(results_df)} individuals",template="plotly_dark",height=850,
        margin=dict(t=110),
        updatemenus=[dict(type="buttons", direction="right", x=0, y=1.10, active=-1,
            buttons=[dict(label="Europe outline", method="restyle",
                args=[{"visible": True}, [0]], args2=[{"visible": False}, [0]])])],
        xaxis=dict(range=[float(results_df.RotEW.min()-xpad), float(results_df.RotEW.max()+xpad)]),
        xaxis_title="Genetic east–west (common planar scale)",yaxis_title="Genetic north–south (common planar scale)",
        yaxis=dict(scaleanchor="x",scaleratio=1,
            range=[float(results_df.RotNS.min()-ypad), float(results_df.RotNS.max()+ypad)]))
    interactive.write_html(PLOTS/"genes_mirror_geography_human_origins.html",include_plotlyjs=True)
    return path


def write_run_manifest(eur_df, snp_pruned, metrics):
    import hashlib
    import platform
    import importlib.metadata
    def digest(path):
        h = hashlib.sha256()
        with open(path,"rb") as stream:
            for block in iter(lambda: stream.read(8*1024*1024),b""): h.update(block)
        return h.hexdigest()
    snp_pruned.to_csv(QC_DIR / "retained_snps.csv",index=False)
    files = [GENO_FILE,IND_FILE,SNP_FILE,ANNO_FILE,Path(__file__),Path(__file__).with_name("cohort_reference.json")]
    manifest = dict(metrics=metrics, python=platform.python_version(),
                    packages={p:importlib.metadata.version(p) for p in ["numpy","pandas","scipy","scikit-learn","matplotlib"]},
                    inputs={str(p.relative_to(ROOT.parent)):dict(bytes=p.stat().st_size,sha256=digest(p)) for p in files},
                    seed=42,ld=dict(window_snps=50,step_snps=5,r2_threshold=.2,chromosome_local=True),
                    sample_call_rate_min=float(eur_df.autosomal_call_rate.min()),
                    coordinate_sources=eur_df.coordinate_source.value_counts().to_dict(),
                    caveat="Historical cohort exclusions and reference weights retained, not independently validated; this is not an unbiased sample of Europe or an exact POPRES replication.")
    (STATS/"run_manifest.json").write_text(json.dumps(manifest,indent=2,allow_nan=False)+"\n")


def main():
    chunk_1_verify_environment()
    eur_df = chunk_2_cohort_selection()
    snp_df, snp_qc1 = chunk_3_snp_manifest_and_inversion_qc()
    G_all = chunk_4_binary_genotype_extraction(eur_df, snp_df, snp_qc1)
    G_maf, snp_final_qc = chunk_5_quality_control(G_all, snp_qc1, eur_df)
    del G_all
    G_pruned, snp_pruned = chunk_6_ld_pruning(G_maf, snp_final_qc, eur_df)
    del G_maf
    results_df, G_pruned, var_exp = chunk_7_pca(G_pruned, eur_df)
    results_df, disparity = chunk_8_procrustes_superposition(results_df)
    metrics = chunk_9_validation_and_visualization(results_df, disparity, G_pruned, var_exp)
    generate_figures(results_df, metrics)
    write_run_manifest(eur_df, snp_pruned, metrics)
    print("Complete: full cohort, figures, provenance, and website atlas exported.")


if __name__ == "__main__":
    main()
