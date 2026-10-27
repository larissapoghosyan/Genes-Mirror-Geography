#!/usr/bin/env python3
"""Verify a middle displayed A/G heterozygous call against the raw genotype."""
from pathlib import Path
import csv
import json

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research"
atlas = json.loads((ROOT / "website/data/genome_atlas.js").read_text().split("=", 1)[1].strip().rstrip(";"))
excerpt = atlas["genotype_excerpt"]
sample = excerpt["samples"][0]
with (RESEARCH / "data/qc/retained_snps.csv").open() as stream:
    retained = list(csv.DictReader(stream))
    displayed = [retained[index] for index in excerpt["marker_indices"][:24]]
    column = 12  # Column 13 of 24: a real A/G call near the excerpt's middle.
    marker = displayed[column]
with (RESEARCH / "results/stats/human_origins_pca_results.csv").open() as stream:
    cohort = list(csv.DictReader(stream))
    individual = next(row for row in cohort if row["sample_id"] == sample["id"])
raw = RESEARCH / "data/raw"
with (raw / "v66.p1_compatibility_HO.aadr.patch.PUB.snp").open() as stream:
    snp = next(line.split() for i, line in enumerate(stream) if i == int(marker["snp_idx"]))
assert snp[0] == marker["snpid"]
with (raw / "v66.p1_compatibility_HO.aadr.patch.PUB.geno").open("rb") as stream:
    header = stream.read(48).rstrip(b"\0").decode("ascii").split()
    assert header[0] == "TGENO"
    stride = (int(header[2]) + 3) // 4
    index = int(marker["snp_idx"])
    stream.seek(48 + int(individual["sample_idx"]) * stride + index // 4)
    call = (stream.read(1)[0] >> (2 * (index % 4))) & 3
    matrix = []
    for person in cohort:
        stream.seek(48 + int(person["sample_idx"]) * stride)
        block = stream.read(stride)
        calls = [(block[int(row["snp_idx"])//4] >> (2*(int(row["snp_idx"])%4))) & 3 for row in displayed]
        assert all(value in {0,1,2} for value in calls)
        matrix.append(dict(id=person["sample_id"], calls=calls))
assert call == sample["calls"][column] == 1
reference, alternate = snp[4:6]
assert {reference, alternate} == {"A", "G"}
payload = dict(sample=sample["id"], marker=snp[0], chromosome=int(snp[1]), position=int(snp[3]),
               countedAllele=reference, otherAllele=alternate, dosage=call,
               genotype=alternate * (2-call) + reference * call,
               row=0, column=column, retainedMarkerIndex=excerpt["marker_indices"][column],
               source="Raw TGENO byte, SNP manifest, retained-marker index and atlas excerpt agree",
               formatReference="https://github.com/DReichLab/EIG/blob/master/CONVERTF/README",
               phased=False)
(ROOT / "website/data/bio_marker.js").write_text("window.BIO_MARKER = " + json.dumps(payload, indent=2) + ";\n")
assert [row["id"] for row in matrix] == [row["id"] for row in atlas["samples"]]
for i, row in zip(excerpt["cohort_row_indices"], excerpt["samples"]):
    assert matrix[i]["id"] == row["id"] and matrix[i]["calls"] == row["calls"][:24]
matrix_payload = dict(markers=[row["snpid"] for row in displayed], samples=matrix,
                      source="Decoded raw calls for all 996 people, at the atlas excerpt's first 24 retained SNPs")
(ROOT / "website/data/bio_matrix.js").write_text("window.BIO_MATRIX = " + json.dumps(matrix_payload, separators=(",", ":")) + ";\n")
print(f"Verified {payload['sample']} / {payload['marker']}: {payload['genotype']} = {call}; row 1, column {column+1}")
print(f"Verified complete matrix window: {len(matrix)} rows × {len(displayed)} SNPs; all existing excerpt calls agree")
