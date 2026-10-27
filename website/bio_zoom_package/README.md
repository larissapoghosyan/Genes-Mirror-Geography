# Europe-to-DNA SVG

Three files: `static_bio_zoom.svg`, `generator.py`, and this guide.
The SVG contains all artwork and interaction code. It requires no external assets, packages, or network requests. Copy only the SVG to use it in another project; keep the generator if you want to edit and rebuild it.

## Embed

```html
<iframe
  id="bio-zoom"
  src="bio_zoom_package/static_bio_zoom.svg"
  title="Explore Europe, the human body and DNA"
  style="display:block;width:100%;height:100vh;border:0"
></iframe>
```

Use an iframe or `<object type="image/svg+xml">` for interaction. An `<img>` shows a static image. Serve as `image/svg+xml`; allow its inline script in your content security policy.

Scroll or pinch to zoom; drag to pan the map. Click countries or landmarks to inspect them. `+` / `−` zoom, `0` resets, `PageUp` / `PageDown` change stages, and `1`–`9` select stages.

The route is Europe → Budapest, Hungary → tiny park → seated anatomy → heart → cells → nucleus → chromosome → DNA/SNP. Budapest and the park stay at the screen center from the opening Europe view through the seated figure, heart, cells and DNA. Across the latter part of the Hungary approach, the map rotates with finite perspective to the angle previously seen at 2.8× (center vertical compression 0.428), and holds that angle as the seated figure comes into view. Its center keeps the same horizontal scale; the far side narrows and the near side widens. The map stays vector sharp: its SVG country outlines and landmarks are projected directly, with no HTML layer or image resampling. Only visible outlines are updated while the tilt changes; settled frames reuse their paths. The anatomy reveal is the only timed fade. Hungary and the park share a daylight cream background; one radial mask feathers the park artwork into the map during the approach. The heart stays smooth at ordinary scale; zooming into its focal point reveals a broad irregular clump of cells. Their long spatial fade reaches about 80% farther toward the view corners. The supplied seated proportions and nested molecular artwork are preserved. The map-to-person journey is about 40% shorter than the earlier version. Full organelle detail appears as it becomes visible.

## Initial view

Append `?stage=0` through `?stage=8` to select a stage in the order above. `?mag=60000` opens the cell interior; `?intro=0.5` opens the anatomy reveal halfway through.

## App control

On the same origin, use the iframe's API after it loads:

```js
const zoom = document.getElementById('bio-zoom').contentWindow.bioZoom;
zoom.setStage(2, true);       // park, animated camera
zoom.setDepth(8, false);     // continuous camera depth
zoom.inspectCountry('FRA');
zoom.inspectLandmark('eiffel');
zoom.getState();
zoom.listCountries();        // codes, names, colors
zoom.listLandmarks();        // IDs, names, country codes
```

Across origins, send commands to the iframe:

```js
frame.contentWindow.postMessage({
  type: 'bio-zoom-command',
  action: 'stage', // stage, depth, country, landmark, state
  value: 2
}, new URL(frame.src).origin);
```

State messages use `type: 'bio-zoom-state'`. Check `event.source === frame.contentWindow` when receiving them. State includes `depth`, `maximum`, `stages`, `stageNames`, `magnification`, `bodyMagnification`, `opening`, `pan`, and `landmark`.

## Rebuild

```sh
python3 generator.py
```

Uses only Python's standard library and writes the SVG beside the generator. No source HTML, reference videos, previews, or other project files are required.

## Sources

Geography: [Europe GeoJSON](https://github.com/leakyMirror/map-of-europe). Landmark references: [EU atlas](https://europa.eu/europago/explore/pdf/flip-book/lets-explore-europe-en/NA0114598ENC_002.pdf), [UNESCO](https://whc.unesco.org/en/list/). The seated figure and park are embedded from the supplied proportional park studio. [Organelle reference](https://www.ncbi.nlm.nih.gov/books/NBK26907/). Landmark details and magnifications are illustrative; condensed chromosomes are an educational representation.
