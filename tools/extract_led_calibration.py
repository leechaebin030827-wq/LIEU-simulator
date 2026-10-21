#!/usr/bin/env python3
"""Recover physical LED geometry from the source GLB. Requires trimesh and numpy.

All recovered coordinates are GLB world-space meters. The resulting numbering
is *virtual*, NOT a claim about real controller wiring order.
"""
import json
from pathlib import Path
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'assets/LIEU_Senario.glb'
OUT = ROOT / 'config/LIEU_LED_Calibration.json'
scene = trimesh.load(str(MODEL), force='scene', process=False)


def mesh_and_matrix(node_name):
    world, geom_name = scene.graph[node_name]
    return scene.geometry[geom_name], world


def rarr(v):
    return [round(float(k), 8) for k in v]


ring_mesh, ring_tf = mesh_and_matrix('네오픽셀 24개')
ring_leds = []
for part in ring_mesh.split(only_watertight=False):
    center = part.bounds.mean(axis=0)
    # 24 six-face chip caps on the radial r=2.94 (original CAD local units) ring
    if not (len(part.faces) == 6 and abs(center[1] + 2.323) < 0.01
            and abs(np.linalg.norm(center[[0, 2]]) - 2.94) < .02):
        continue
    xyz = trimesh.transform_points([center], ring_tf)[0]
    theta = np.degrees(np.arctan2(xyz[2], xyz[0])) % 360
    ring_leds.append({'angleDegWorldXtoZ': round(float(theta), 6),
                      'worldPositionMeters': rarr(xyz),
                      'outwardNormalWorld': [0, -1, 0]})
ring_leds.sort(key=lambda p: p['angleDegWorldXtoZ'])
assert len(ring_leds) == 24
for i, led in enumerate(ring_leds):
    led['virtualIndex'] = i
    assert abs(led['angleDegWorldXtoZ'] - 15 * i) < .01, (i, led)


def extract_eye(name, side_name, node_index):
    mesh, tf = mesh_and_matrix(name)
    pixels = []
    for part in mesh.split(only_watertight=False):
        center = part.bounds.mean(axis=0)
        # Each source Eye PCB has exactly 64 pixel caps with 124 triangles.
        if len(part.faces) != 124:
            continue
        col_source = float(center[1])
        row_source = float(center[0])
        row = int(round((row_source + 1.4) / 0.4))
        col = int(round((1.4 - col_source) / 0.4))
        assert 0 <= row < 8 and 0 <= col < 8, (name,row,col,center)
        xyz = trimesh.transform_points([center], tf)[0]
        pixels.append({'row': row, 'col': col,
                       'matrixIndex': row * 8 + col,
                       'worldPositionMeters': rarr(xyz),
                       'cadLocalGridCoordinate': [round(row_source, 3), round(col_source, 3)]})
    pixels.sort(key=lambda p: p['matrixIndex'])
    assert len(pixels) == 64 and len({p['matrixIndex'] for p in pixels}) == 64
    return {'name': side_name, 'meshNodeIndex': node_index,
            'matrixResolution': [8, 8],
            'physicalI2cAddress': None, 'orientationConfirmedOnPhysicalBuild': False,
            'pixels': pixels}

left = extract_eye('Body2', 'screenLeft_positiveZ_whenViewedFromPlusX', 13)
right = extract_eye('Body2.007', 'screenRight_negativeZ_whenViewedFromPlusX', 8)
result = {
  'schema': 'LIEU_LED_Calibration/1.0',
  'units': 'meters; glTF world coordinates at imported rest pose',
  'sourceFile': 'LIEU_Senario.glb',
  'modelGeometryConfirmed': {
    'neopixelChipCount': 24,
    'neopixelCentersRadiusMeters': .0294,
    'neopixelPitchDeg': 15,
    'eyeMatrixCount': 2,
    'eyePixelsPerMatrix': 64,
    'neopixelSourceMeshNodeIndex': 133,
    'eyeSourcesMeshNodeIndices': [13, 8],
  },
  'important': [
    'RGBW physical chipset and byte ordering NOT established by CAD geometry.',
    'Virtual pixel0 is at +X world and pixels increase towards +Z (seen from +Y). Actual physical DIN orientation/order is unknown.',
    'The 8x8 physical row/column mapping is inferred from modeled chip surfaces, NOT confirmed I2C register ordering.',
    'LED chip centers are inside existing shade/guide meshes; final glow should be computed as visible diffusion or shader emissive, not always draw raw spheres at these centers.',
    'Screen left/right assumes the observer looks from world +X toward -X with world +Y as up; check UI mirror mapping.',
  ],
  'ring24': {'sourceMeshNodeIndex': 133, 'chipType': 'unknown_RGBW_or_RGB',
             'physicalIndex0AtVirtualIndex': None, 'physicalOrderClockwiseViewedFromBelow': None,
             'physicalColorByteOrder': None, 'pixels': ring_leds},
  'eyes': [left, right]
}
OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False),encoding='utf-8')
print('Wrote',OUT,OUT.stat().st_size)
