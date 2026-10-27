#!/usr/bin/env python3
"""Package the atlas and linked research as a self-contained static site.

Source layout: /website/index.html beside /research/. Published layout:
/index.html beside /research/. Rewrite both directions of this relationship;
retain relative URLs so project-subpath hosting works. Raw genotypes are excluded.
"""
from argparse import ArgumentParser
from collections import deque
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import shutil
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "website"
RESEARCH = ROOT / "research"


class Links(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.urls, self.ids = [], set()
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "id":
                self.ids.add(value)
            if key in {"href", "src", "data-notebook-src"} and value:
                self.urls.append(value)


def local_links(path):
    for url in Links(path.read_text()).urls:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue
        target = (path.parent / unquote(parsed.path)).resolve()
        if not target.is_file():
            raise ValueError(f"Broken local link in {path.name}: {url}")
        if not target.is_relative_to(SITE) and not target.is_relative_to(RESEARCH):
            raise ValueError(f"Link outside website/research: {url}")
        if target.is_relative_to(RESEARCH / "data" / "raw"):
            raise ValueError("Raw genotype inputs must not be bundled")
        yield target


def published_path(source, output):
    if source.is_relative_to(SITE):
        return output / source.relative_to(SITE)
    return output / "research" / source.relative_to(RESEARCH)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    output = args.output.resolve()
    if SITE.is_relative_to(output) or RESEARCH.is_relative_to(output) or output.is_relative_to(SITE) or output.is_relative_to(RESEARCH):
        raise ValueError("Build output must be separate from the source trees")
    sources = {SITE / "index.html"}
    for folder in ["css", "js", "data", "vendor"]:
        sources.update(p for p in (SITE / folder).rglob("*")
                       if p.is_file() and not any(part.startswith(".") or part == "__pycache__" for part in p.relative_to(SITE).parts))
    for stem in ["genes_mirror_geography_replication", "genes_mirror_geography_math_code"]:
        sources.update(RESEARCH / (stem + ext) for ext in [".html", ".ipynb"])
    # The notebook's historical prediction section reads this small, public bundle.
    sources.add(RESEARCH / "data/historical_634/lab_5pc_data.js")
    sources.update(p for p in (RESEARCH / "pipeline").iterdir() if p.suffix in {".py", ".json"})
    queue, visited = deque(p for p in sources if p.suffix == ".html"), set()
    while queue:
        path = queue.popleft()
        if path in visited:
            continue
        visited.add(path)
        for target in local_links(path):
            sources.add(target)
            if target.suffix == ".html" and target not in visited:
                queue.append(target)
    output.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for source in sorted(sources):
        target = published_path(source, output)
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix == ".html":
            text = source.read_text()
            if source == SITE / "index.html":
                text = text.replace("../research/", "research/")
            if source.parent == RESEARCH:
                text = text.replace('href="../website/index.html"', 'href="../index.html"')
            target.write_text(text)
        else:
            shutil.copy2(source, target)
        hashes[str(target.relative_to(output))] = sha256(target.read_bytes()).hexdigest()
    # Verify actual deployed URLs and internal fragments, including the return links.
    checked = 0
    pages = [published_path(source, output) for source in sources if source.suffix == ".html"]
    ids = {page: Links(page.read_text()).ids for page in pages}
    for page in pages:
        for url in Links(page.read_text()).urls:
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc:
                continue
            target = (page.parent / unquote(parsed.path)).resolve() if parsed.path else page
            assert target.is_relative_to(output), f"URL escapes deployment root: {url}"
            assert target.is_file(), f"Missing deployed asset: {url}"
            if parsed.fragment and target.suffix == ".html":
                assert unquote(parsed.fragment) in ids[target], f"Broken deployed fragment: {url}"
            checked += 1
    manifest = {"layout": "index.html + research/", "files": hashes, "checked_local_urls": checked,
                "raw_genotypes_bundled": False}
    (output / "submission_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"PASS: {len(hashes)} files; {checked} local URLs/fragments; atlas returns and notebook assets resolve under {output}")


if __name__ == "__main__":
    main()
