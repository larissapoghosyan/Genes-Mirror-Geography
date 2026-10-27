# Genes Mirror Geography

[View the interactive website](https://larissapoghosyan.github.io/Genes-Mirror-Geography/website/)

An interactive, scroll-driven account of a computational genetics study by Larisa Poghosyan. The project asks whether genetic variation among Europeans forms a recognizable geographic pattern when principal component analysis (PCA) receives no map, coastline, or country label.

The study analyzes **996 modern European individuals** from AADR v66 at **46,213 quality-controlled, LD-pruned SNPs**. PCA directions are learned from a fixed **428-person reference panel**; all 996 people are projected into that space. Geographic coordinates enter later, to orient the completed point cloud with one global similarity transform and to evaluate the result. This is an adaptation of Novembre et al. (2008), *Genes mirror geography within Europe*, using a different cohort and genotyping platform.

## Explore

- [Interactive story](website/index.html) — the biological zoom, genotype matrix, PCA, map reveal, and sensitivity controls.
- [Technical report](research/genes_mirror_geography_replication.html) and [research notebook](research/genes_mirror_geography_replication.ipynb) — methods, experiments, results, and limitations.
- [Maths and code walkthrough](research/genes_mirror_geography_math_code.html) and [teaching notebook](research/genes_mirror_geography_math_code.ipynb) — worked explanations of the computation.

To view the site locally, serve the project root:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/website/`.

## What the result means

The first two PCs explain about **0.96%** of reference-panel variance. After global geographic alignment, correlations with recorded or assigned locality coordinates are **0.861 east–west** and **0.881 north–south**.

Regional colors, country codes, and the separate Europe inset are annotations. They were not inputs to PCA. The aligned correlations describe this cohort; they are not held-out birthplace prediction scores. Uneven sampling, locality proxies, marker selection, and reference choice limit interpretation.

## Reproduce the analysis

The licensed AADR v66 Human Origins-compatible `.geno`, `.snp`, `.ind`, and `.anno` inputs must be supplied locally under `research/data/raw/`. They are excluded from Git, along with the paper PDF and private access correspondence. Historical 634-person tables used by the notebooks are in `research/data/historical_634/`.

Use a Python environment with `numpy`, `pandas`, `scipy`, `scikit-learn`, `matplotlib`, `plotly`, `jupyter`, `nbformat`, `nbconvert`, `beautifulsoup4`, `ipython`, and `matplotlib-inline`. Then run:

```bash
python3 research/pipeline/run_human_origins_pca.py
python3 research/pipeline/validate_human_expansion.py
python3 research/pipeline/execute_notebook_inprocess.py
python3 research/pipeline/execute_notebook_inprocess.py research/genes_mirror_geography_math_code.ipynb
python3 research/pipeline/export_notebook_versions.py
```

Both `.ipynb` files already contain saved tables and figures directly below their cells. The first setup cell only verifies inputs and creates scratch folders; later cells produce inline results and populate those folders. The notebook HTML files show the saved results without requiring the raw inputs. Canonical summary tables and figures are in `research/results/`. The [run manifest](research/results/stats/run_manifest.json) records source hashes, settings, and software versions.

## Website and release

The website is plain HTML, CSS, SVG, Canvas, and JavaScript. The scroll position drives a reversible biological zoom and scientific figure; the final point cloud does not draw a coastline. Its research panel opens the two notebook HTML versions alongside the story.

GitHub Pages serves `website/` and its linked `research/` files directly from the `main` branch. For a self-contained static release on another host, run:

```bash
python3 research/pipeline/build_submission.py
```

The output is `dist/`, which is ignored by Git. Deploy the **contents** of `dist/` as a static site; the builder checks local links and notebook anchors. The command does not publish anything.

Run the main interaction checks with:

```bash
node website/tests/story_integrity.cjs
REDUCED_MOTION=1 node website/tests/story_integrity.cjs
```

The current source is in `website/`, `research/`, and the selected scientific results. Local raw data and generated working output remain outside the public Git set through [.gitignore](.gitignore).
