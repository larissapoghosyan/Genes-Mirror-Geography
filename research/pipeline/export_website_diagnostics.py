#!/usr/bin/env python3
"""Export real QC, normalization and reference-sensitivity data for the website."""
from pathlib import Path
import hashlib
import json
import tempfile

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
import run_human_origins_pca as pipeline


def main():
    project = Path(__file__).resolve().parents[2]
    atlas_path = project / "website/data/genome_atlas.js"
    original = atlas_path.read_bytes()
    atlas = json.loads(original.decode().split("=", 1)[1].strip().rstrip(";"))
    canonical = pd.read_csv(project / "research/results/stats/human_origins_pca_results.csv")
    with tempfile.TemporaryDirectory(prefix="genetic-website-") as temporary:
        for attribute in ["PROCESSED", "QC_DIR", "STATS", "PLOTS", "WEBSITE_DATA"]:
            folder = Path(temporary) / attribute.lower()
            folder.mkdir()
            setattr(pipeline, attribute, folder)
        cohort = pipeline.chunk_2_cohort_selection()
        manifest, eligible = pipeline.chunk_3_snp_manifest_and_inversion_qc()
        genotypes = pipeline.chunk_4_binary_genotype_extraction(cohort, manifest, eligible)
        complete = int(np.isfinite(genotypes[cohort.is_core_ho.to_numpy()]).all(axis=0).sum())
        filtered, snps = pipeline.chunk_5_quality_control(genotypes, eligible, cohort)
        del genotypes
        pruned, retained = pipeline.chunk_6_ld_pruning(filtered, snps, cohort)
        del filtered
        assert pruned.shape == (996, 46213)
        assert cohort.sample_id.tolist() == canonical.sample_id.tolist()

        excerpt = atlas["genotype_excerpt"]
        rows, columns = excerpt["cohort_row_indices"], excerpt["marker_indices"]
        np.testing.assert_array_equal(pruned[np.ix_(rows, columns)],
                                      np.array([s["calls"] for s in excerpt["samples"]]))
        p_ref = np.nanmean(pruned[cohort.is_pca_reference.to_numpy()], axis=0)/2
        denominator = np.sqrt(2*p_ref*(1-p_ref))
        denominator[denominator < 1e-6] = 1
        normalized = np.nan_to_num((pruned[np.ix_(rows, columns)]-2*p_ref[columns])/denominator[columns])

        p_all = np.nanmean(pruned, axis=0)/2
        denom_all = np.sqrt(2*p_all*(1-p_all))
        denom_all[denom_all < 1e-6] = 1
        standardized = np.nan_to_num((pruned-2*p_all)/denom_all, nan=0.0)
        model = PCA(n_components=10, random_state=42)
        scores = model.fit_transform(standardized)
        equal = cohort.copy()
        equal[[f"PC{i}" for i in range(1, 11)]] = scores
        equal, _ = pipeline.chunk_8_procrustes_superposition(equal)
        equal_metrics = pipeline.descriptive_metrics(equal)
        saved = pd.read_csv(project / "research/results/stats/reference_sensitivity_metrics.csv").iloc[1]
        for key in ["r_EastWest_Longitude", "r_NorthSouth_Latitude"]:
            np.testing.assert_allclose(equal_metrics[key], saved[key], atol=1e-7)

        italy = canonical[canonical.country.eq("Italy")]
        payload = {
            "source": "AADR v66 Human Origins-compatible; computed from the current retained genotypes",
            "canonical_atlas_sha256": hashlib.sha256(original).hexdigest(),
            "qc": [
                {"label": "Array markers", "count": len(manifest)},
                {"label": "Autosomes & interval filters", "count": len(eligible)},
                {"label": "Complete core-panel calls", "count": complete},
                {"label": "Minor allele frequency ≥ 5%", "count": len(snps)},
                {"label": "After LD pruning", "count": len(retained)}
            ],
            "normalization": {
                "sampleId": excerpt["samples"][0]["id"],
                "markerIds": retained.snpid.iloc[columns].tolist(),
                "calls": excerpt["samples"][0]["calls"],
                "frequencies": p_ref[columns].astype(float).tolist(),
                "values": normalized[0].astype(float).tolist()
            },
            "equalWeight": {
                "alignment": equal.attrs["alignment"],
                "metrics": equal_metrics,
                "samples": [{"id": row.sample_id, "lon": row.rotLon, "lat": row.rotLat}
                            for row in equal.itertuples()],
                "centroids": [{"pop": pop, "lon": group.rotLon.mean(), "lat": group.rotLat.mean()}
                              for pop, group in equal.groupby("population")]
            },
            "coordinateSources": canonical.coordinate_source.value_counts().to_dict(),
            "countryCounts": canonical.country.value_counts().to_dict(),
            "italy": {"count": len(italy),
                      "longitudeDifference": float((italy.rotLon-italy.longitude).mean()),
                      "latitudeDifference": float((italy.rotLat-italy.latitude).mean())}
        }
    assert atlas_path.read_bytes() == original
    output = project / "website/data/study_diagnostics.js"
    output.write_text("window.STUDY_DIAGNOSTICS = " + json.dumps(payload, separators=(",", ":"), allow_nan=False) + ";\n")
    print(f"Exported {output.stat().st_size:,} bytes; canonical atlas unchanged.")


if __name__ == "__main__":
    main()
