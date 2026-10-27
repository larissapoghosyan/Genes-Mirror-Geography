"""Integrity checks for the expanded study, runnable without re-reading raw genotypes."""
import json
import hashlib
import contextlib
import io
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial.distance import pdist
import run_human_origins_pca as pipeline


def validate():
    root = pipeline.ROOT
    frame = pd.read_csv(root / "results/stats/human_origins_pca_results.csv")
    processed = pd.read_csv(root / "data/processed/europe_cleaned_cohort_metadata.csv")
    atlas = json.loads((root.parent / "website/data/genome_atlas.js").read_text().split("=", 1)[1].strip().rstrip(";"))
    reference = json.loads(Path(pipeline.__file__).with_name("cohort_reference.json").read_text())
    transform = json.loads((root / "results/stats/alignment_transform.json").read_text())
    manifest = json.loads((root / "results/stats/run_manifest.json").read_text())
    assert len(frame) == 996 and frame.sample_id.is_unique
    assert frame.restored_sample.sum() == 362
    assert frame.population.nunique() == 52
    assert set(frame.loc[frame.in_legacy_cohort, "sample_id"]) == set(reference["legacy_ids"])
    assert set(frame.loc[frame.is_pca_reference, "sample_id"]) == set(reference["reference_ids"])
    pd.testing.assert_frame_equal(frame, processed)
    samples = pd.DataFrame(atlas["samples"]).set_index("id").loc[frame.sample_id]
    assert len(samples) == atlas["meta"]["cohort_size"] == 996
    assert np.isfinite(frame[["PC1", "PC2", "rotLon", "rotLat"]]).all().all()
    np.testing.assert_allclose(samples[["rotLon", "rotLat"]], frame[["rotLon", "rotLat"]], atol=1e-12)
    # Shape is preserved by a similarity transform, including a possible reflection.
    np.testing.assert_allclose(pdist(frame[["RotEW", "RotNS"]]),
                               pdist(frame[["PC1", "PC2"]]) * transform["scale"], rtol=1e-8, atol=1e-10)
    cx, cy = transform["center"]
    factor = transform["longitude_factor"]
    angle = np.deg2rad(transform["target_angle"])
    dx, dy = (samples.x0 - cx) * factor, samples.y0 - cy
    reconstructed = np.column_stack([cx + (dx*np.cos(angle) - dy*np.sin(angle))/factor,
                                      cy + dx*np.sin(angle) + dy*np.cos(angle)])
    np.testing.assert_allclose(reconstructed, samples[["rotLon", "rotLat"]], atol=1e-10)
    # Identical markers prune on one chromosome, but must survive on different chromosomes.
    toy = np.array([[0,0],[0,0],[1,1],[1,1],[2,2],[2,2]], dtype=np.float32)
    for chromosomes, expected in [([1,1],1),([1,2],2)]:
        snps = pd.DataFrame({"chrom_int":chromosomes,"pos":[100,200]})
        with contextlib.redirect_stdout(io.StringIO()):
            kept, _ = pipeline.chunk_6_ld_pruning(toy, snps)
        assert kept.shape[1] == expected
    retained = pd.read_csv(root / "data/qc/retained_snps.csv")
    assert len(retained) == atlas["meta"]["snps_analyzed"] == 46213
    # Verify current code is the code recorded for this run (large raw hashes already recorded).
    source = Path(pipeline.__file__)
    source_key = str(source.relative_to(root.parent))
    assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest["inputs"][source_key]["sha256"]
    return {"all_samples_retained":996, "restored":362, "unchanged_reference":428,
            "regions":52,"retained_markers":len(retained), "CSV_matches_processed_and_atlas":"PASS",
            "single_scale_preserves_shape":"PASS", "website_rotation_endpoint":"PASS",
            "LD_respects_chromosome_boundaries":"PASS", "source_matches_run_manifest":"PASS"}


if __name__ == "__main__":
    print(json.dumps(validate(), indent=2))
