#!/usr/bin/env python3
"""Validate and export the executed research and teaching notebooks to readable HTML."""
from pathlib import Path
import json
import re
from urllib.parse import quote

import nbformat
from nbconvert import HTMLExporter
from bs4 import BeautifulSoup

root = Path(__file__).resolve().parents[2]
research = root / "research"
versions = [
    ("genes_mirror_geography_replication", "Technical Report", "notebook", False),
    ("genes_mirror_geography_math_code", "Maths & Code Walkthrough", "teaching_notebook", True),
]
reports = []
for stem, label, work, teaching in versions:
    path = research / (stem + ".ipynb")
    notebook = nbformat.read(path, 4)
    nbformat.validate(notebook)
    code_cells = [c for c in notebook.cells if c.cell_type == "code"]
    # Jupyter changes execution counts when a reader reruns an individual cell.
    # Require executed cells, but do not mistake ordinary reruns for missing work.
    assert all(isinstance(c.execution_count, int) and c.execution_count > 0 for c in code_cells)
    errors = [o for c in code_cells for o in c.outputs if o.output_type == "error"]
    assert not errors
    assert all(c.outputs for c in code_cells)
    missing = []
    for cell in notebook.cells:
        if cell.cell_type == "code":
            cell.metadata["jupyter"] = {"source_hidden": not teaching}
        else:
            assert not re.search(r"sample.recovery|restore the|omitted people|362 (?:people|samples)", cell.source, re.I)
            for link in re.findall(r"\]\(([^)]+)\)", cell.source):
                if "://" not in link and not link.startswith("#"):
                    if not (research/link.split("#", 1)[0]).exists():
                        missing.append(link)
    assert not missing, missing
    saved_checks = "\n".join(
        str(output.data.get("text/plain", ""))
        for cell in code_cells for output in cell.outputs
        if output.output_type == "display_data"
    )
    for label in ("Current scores and alignment agree with final data",
                  "App and canonical outputs unchanged",
                  "Common scale preserves planar shape",
                  "Archived reports unchanged"):
        assert re.search(rf"^{re.escape(label)}\s+PASS$", saved_checks, re.MULTILINE), label
    assert re.search(r"^Current individuals\s+996$", saved_checks, re.MULTILINE)
    assert re.search(r"^Retained markers\s+46213$", saved_checks, re.MULTILINE)
    nbformat.write(notebook, path)
    body, _ = HTMLExporter().from_notebook_node(notebook)
    soup = BeautifulSoup(body, "html.parser")
    soup.title.string = (notebook.metadata.title if not teaching else
                         "Maths & Code Walkthrough — Human Genetic Variation")
    if not teaching:
        # Keep the atlas's established deep link stable when the report title changes.
        heading = soup.find("h1")
        heading["id"] = "Geographic-structure-in-European-genetic-variation"
        heading.find("a", class_="anchor-link")["href"] = "#" + heading["id"]

    style = soup.new_tag("style")
    style.string = """
body { background: #f5f8f7; color: #173139; }
main { max-width: 1180px; margin: 24px auto; background: white; padding: 28px 34px; border: 1px solid #dbe5e2; border-radius: 12px; }
.jp-RenderedHTMLCommon { font-size: 15px; line-height: 1.68; }
.jp-RenderedHTMLCommon h1, .jp-RenderedHTMLCommon h2, .jp-RenderedHTMLCommon h3 { color: #183e47; scroll-margin-top: calc(var(--notebook-nav-offset, 120px) + 22px); }
.jp-RenderedHTMLCommon h2 { border-top: 1px solid #dce7e3; padding-top: 22px; margin-top: 26px; }
.notebook-nav { position: sticky; top: 0; z-index: 30; max-height: 45svh; overflow: auto; padding: 12px 20px; background: #eff6f3; border: 1px solid #c6d9d1; border-radius: 8px; margin-bottom: 26px; font-size: 14px; line-height: 1.7; }
.notebook-nav p { margin: 0 0 6px; }
.notebook-nav ul { columns: 2; padding-left: 22px; }
.notebook-nav a { color: #19686c; }
.notebook-nav .atlas-return { display: inline-flex; align-items: center; min-height: 44px; padding: 6px 12px; box-sizing: border-box; background: #19686c; color: white; border-radius: 5px; text-decoration: none; }
.notebook-nav .atlas-return:hover { background: #104f53; }
.notebook-nav a:focus-visible, .comparison-scroll:focus-visible { outline: 3px solid #b77c24; outline-offset: 3px; }
.comparison-scroll { overflow-x: auto; margin: 16px 0; }
.comparison-scroll table { min-width: 600px; width: 100%; text-align: left; border-collapse: collapse; }
.comparison-scroll th, .comparison-scroll td { padding: 12px; border-bottom: 1px solid #dbe5e2; vertical-align: top; white-space: normal; text-align: left; }
.comparison-scroll thead { background: #eff6f3; }
.comparison-scroll tbody th { width: 23%; font-weight: 600; }
details.analysis-code { margin: 8px 0 15px; border-left: 3px solid #b9ceca; padding: 6px 0 6px 12px; }
details.analysis-code > summary { cursor: pointer; color: #32616a; font: 13px system-ui, sans-serif; margin-bottom: 8px; }
.jp-OutputArea-output img { max-width: 100%; height: auto; }
@media (max-width: 760px) { main { margin: 0; padding: 16px 10px; border: 0; } .notebook-nav ul { columns: 1; } }
@media print { body, main { background: white; } main { border: 0; margin: 0; padding: 0; } .notebook-nav { display: none; } details.analysis-code:not([open]) { display: none; } }
"""
    soup.head.append(style)
    for wrapper in soup.select(".jp-CodeCell .jp-Cell-inputWrapper"):
        details = soup.new_tag("details", attrs={"class": "analysis-code"})
        if teaching:
            details["open"] = ""
        summary = soup.new_tag("summary")
        summary.string = "Analysis code"
        wrapper.wrap(details)
        details.insert(0, summary)

    nav = soup.new_tag("nav", attrs={"class": "notebook-nav", "aria-label": "Notebook navigation"})
    p = soup.new_tag("p")
    strong = soup.new_tag("strong")
    back = soup.new_tag("a", href="../website/index.html", target="_top", attrs={"class": "atlas-return"})
    back.string = "← Return to Interactive Atlas"
    strong.append(back)
    p.append(strong)
    p.append(" · Companion versions: ")
    for i, (other, other_label, *_rest) in enumerate(versions):
        if i:
            p.append(" · ")
        link = soup.new_tag("a", href=other+".html")
        link.string = other_label
        p.append(link)
    nav.append(p)
    contents = soup.new_tag("details")
    summary = soup.new_tag("summary")
    summary.string = "Contents"
    contents.append(summary)
    ul = soup.new_tag("ul")
    for heading in soup.select("h2[id]"):
        title = heading.get_text(" ", strip=True).replace("¶", "").strip()
        if re.match(r"\d+\.", title):
            li = soup.new_tag("li")
            link = soup.new_tag("a", href="#"+heading["id"])
            link.string = title
            li.append(link)
            ul.append(li)
    contents.append(ul)
    nav.append(contents)
    main = soup.find("main") or soup.body
    main.insert(0, nav)
    for heading in soup.select("h3[id]"):
        if heading.get_text().startswith("At-a-glance comparison"):
            table = heading.find_next("table")
            wrapper = soup.new_tag("div", attrs={"class": "comparison-scroll", "role": "region",
                "aria-labelledby": heading["id"], "tabindex": "0"})
            table.wrap(wrapper)
            for th in table.select("thead th"):
                th["scope"] = "col"
            for tr in table.select("tbody tr"):
                th = tr.find("td")
                th.name = "th"
                th["scope"] = "row"
    ids = {tag["id"] for tag in soup.select("[id]")}
    for link in soup.find_all("a", href=True):
        if link["href"] in [v[0]+".ipynb" for v in versions]:
            link["href"] = link["href"].replace(".ipynb", ".html")
        if link["href"].startswith("#") and link["href"][1:] in ids:
            link["href"] = "#" + quote(link["href"][1:], safe="")
    script = soup.new_tag("script")
    script.string = """(() => {
const nav = document.querySelector('.notebook-nav');
const measure = () => document.documentElement.style.setProperty('--notebook-nav-offset', nav.getBoundingClientRect().height + 'px');
measure();
if (window.ResizeObserver) new ResizeObserver(measure).observe(nav);
else window.addEventListener('resize', measure);
nav.addEventListener('toggle', measure, true);
})();"""
    soup.body.append(script)
    html = str(soup)
    html_path = path.with_suffix(".html")
    html_path.write_text(html)
    assert len(soup.select("details.analysis-code")) == len(code_cells)
    saved_figures = sum("image/png" in output.data for cell in code_cells
                        for output in cell.outputs if output.output_type == "display_data")
    assert saved_figures > 0
    assert len(soup.select("img[src^='data:image/png;base64,']")) == saved_figures
    stderr = [o.text for c in code_cells for o in c.outputs
              if o.output_type == "stream" and o.name == "stderr" and o.text.strip()]
    report = {"version": label, "cells": len(notebook.cells), "executed_code_cells": len(code_cells),
              "execution_seconds": notebook.metadata.execution_seconds,
              "embedded_png_figures": len(soup.select("img[src^='data:image/png;base64,']")),
              "errors": len(errors), "stderr_messages": stderr,
              "local_links": "PASS", "canonical_agreement": "PASS",
              "html_bytes": html_path.stat().st_size}
    reports.append(report)
print(json.dumps(reports, indent=2))
