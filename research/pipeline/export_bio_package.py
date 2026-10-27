#!/usr/bin/env python3
"""Extract the supplied SVG artwork for the atlas's shared scroll camera.

Keep this adapter outside the replaceable package folder. Import geometry and
definitions only; the atlas owns document styles and scrolling.
"""
import hashlib
import ast
import json
import math
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'website/bio_zoom_package/static_bio_zoom.svg'
OUTPUT = ROOT / 'website/data/bio_package.js'


def convert(element):
    tag = element.tag.split('}')[-1]
    attrs = {}
    for key, value in element.attrib.items():
        key = key.split('}')[-1]
        if key in {'tabindex', 'role', 'aria-label', 'data-go-stage'} or key.startswith('on'):
            continue
        if key == 'id':
            value = 'pkg-' + value
        elif key == 'href' and value.startswith('#'):
            value = '#pkg-' + value[1:]
        attrs[key] = re.sub(r'url\(#([^)]*)\)', r'url(#pkg-\1)', value)
    if tag == 'text':
        attrs.update(fill='#292622', stroke='#fcfaf7', **{'stroke-opacity': '.55',
                     'stroke-width': '.45', 'paint-order': 'stroke fill'})
    if 'lbl' in attrs.get('class', '').split():
        attrs['font-weight'] = '600'
    if attrs.get('fill') == '#0b1432':
        attrs['fill'] = '#fff6e5'
    bones = {'#c9ddf4': '#8395a4', '#e8f2ff': '#b3c1cb', '#cfe2f7': '#9aafbf',
             '#dcebfa': '#a3b5c2', '#f1f7ff': '#b3c1cb', '#bcd6f5': '#6d8da3'}
    for key in ('fill', 'stroke'):
        if key in attrs:
            attrs[key] = bones.get(attrs[key], attrs[key])
    return [tag, attrs, (element.text or '').strip(), [convert(child) for child in element]]


def opaque_circle(layer):
    """Read an opaque, untransformed backdrop for safe ancestor culling."""
    for child in layer:
        attrs = child.attrib
        if (child.tag.endswith('}circle') and attrs.get('fill', 'black') != 'none'
                and not attrs.get('transform') and float(attrs.get('opacity', 1)) == 1
                and float(attrs.get('fill-opacity', 1)) == 1):
            return [float(attrs.get('cx', 0)), float(attrs.get('cy', 0)), float(attrs['r'])]
    return None


def main():
    source = SOURCE.read_text()
    tree = ET.fromstring(source)
    if tree.find(".//*[@id='L-Europe']") is not None:
        export_route(source, tree)
        return
    levels = json.loads(re.search(r'var LEVELS = (\[.*?\]);', source, re.S).group(1))
    children = list(tree)
    defs = next(child for child in children if child.tag.endswith('}defs'))
    layers = [next(child for child in children if child.attrib.get('id') == level['id']) for level in levels]
    center = re.search(r'var CX = ([\d.]+), CY = ([\d.]+);', source)
    payload = {'source': str(SOURCE.relative_to(ROOT / 'website')),
               'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
               'focus': [float(center[1]), float(center[2])] if center else None,
               'levels': levels, 'occluders': [opaque_circle(layer) for layer in layers],
               'defs': convert(defs), 'layers': [convert(layer) for layer in layers]}
    OUTPUT.write_text('/* Generated from the user-supplied Bio Zoom Package. */\nwindow.BIO_ZOOM_PACKAGE = ' +
                      json.dumps(payload, separators=(',', ':')) + ';\n')
    print(f'Exported {len(layers)} SVG layers; source SHA-256 {payload["sha256"][:16]}')


def export_route(source, tree):
    """Import the new nested Europe-to-DNA scene without executing its script."""
    script = next(child.text for child in tree if child.tag.endswith('}script'))
    def value(name):
        match = re.search(r'\b' + re.escape(name) + r'\s*=\s*', script)
        if name == 'names':
            return ast.literal_eval(re.match(r'\[[^\]]*\]', script[match.end():]).group())
        return json.JSONDecoder().raw_decode(script[match.end():])[0]
    route = {name: value(name) for name in ['levels', 'bounds', 'cells', 'geo', 'landmarks',
             'mapView', 'hungaryView', 'mapPerspective', 'mapOffset',
             'mapTitlePosition', 'parkView', 'bodyView', 'parkBackgroundBounds',
             'personScale', 'names']}
    route['countryLabelCodes'] = value('countryLabels')
    route['countryLabelPositions'] = value('labelPositions')
    route['finalMapPitch'] = float(re.search(r'Math\.acos\((\d+(?:\.\d+)?)\)', script).group(1))
    # The supplied map geometry is still Lambert-projected about the original
    # geographic origin, then shifted so Budapest and the biology focus are (0,0).
    route['projection'] = {'center': [12, 52], 'radius': 1000, 'anchor': [12.4, 43],
                           'focus': [19.046, 47.507]}
    def project(lon, lat):
        p0, p, d = math.radians(52), math.radians(lat), math.radians(lon-12)
        k = math.sqrt(2/(1+math.sin(p0)*math.sin(p)+math.cos(p0)*math.cos(p)*math.cos(d)))
        return 1000*k*math.cos(p)*math.sin(d), -1000*k*(math.cos(p0)*math.sin(p)-math.sin(p0)*math.cos(p)*math.cos(d))
    origin = project(12.4, 43)
    budapest = project(19.046, 47.507)
    assert math.hypot(budapest[0]-origin[0]-route['mapOffset'][0],
                      budapest[1]-origin[1]-route['mapOffset'][1]) < .001, 'Budapest map origin changed'
    for name, lon, lat in [('pisa', 10.3964, 43.723), ('rome', 12.492, 41.89),
                           ('eiffel', 2.294, 48.858)]:
        point = project(lon, lat)
        landmark = next(item for item in route['landmarks'] if item['id'] == name)
        assert math.hypot(point[0]-budapest[0]-landmark['x'], point[1]-budapest[1]-landmark['y']) < .001, 'SVG projection metadata changed'
    payload = {'kind': 'europe-to-dna', 'source': str(SOURCE.relative_to(ROOT / 'website')),
               'sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(), 'route': route,
               'defs': convert(next(child for child in tree if child.tag.endswith('}defs'))),
               'camera': convert(tree.find(".//*[@id='camera']"))}
    OUTPUT.write_text('/* Generated from the user-supplied Europe-to-DNA ZIP. */\nwindow.BIO_ZOOM_PACKAGE = ' +
                      json.dumps(payload, separators=(',', ':')) + ';\n')
    print(f'Exported Europe-to-DNA route; source SHA-256 {payload["sha256"][:16]}')


if __name__ == '__main__':
    main()
