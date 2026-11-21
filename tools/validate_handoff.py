#!/usr/bin/env python3
"""Portable, dependency-free integrity checks for LIEU Codex handoff.

Run from any directory: python tools/validate_handoff.py
It checks the GLB JSON header, manifest mappings, LED coordinates, source images,
example sequences, preview limits, and that hardware is disabled/uncalibrated.
It does NOT guarantee electromechanical safety or optical accuracy.
"""
from __future__ import annotations
import json
import math
import struct
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
ERRORS=[]
CHECKS=[]

def check(statement, condition, detail=''):
    CHECKS.append((statement, bool(condition), detail))
    if not condition: ERRORS.append(f'{statement}: {detail}')

def data(rel):
    return json.loads((ROOT / rel).read_text(encoding='utf-8'))

def verify():
    src=ROOT/'assets/LIEU_Senario.glb'
    check('GLB source file exists', src.exists(), str(src))
    if not src.exists(): return
    with src.open('rb') as f:
        magic, version, length=struct.unpack('<4sII', f.read(12))
        chunk_length, chunk_type=struct.unpack('<I4s', f.read(8))
        gltf=json.loads(f.read(chunk_length))
    check('GLB valid binary v2 header',magic==b'glTF' and version==2 and chunk_type==b'JSON')
    check('GLB header declared size matches file size',length==src.stat().st_size,
          f'{length} vs {src.stat().st_size}')
    manifest=data('config/LIEU_GLB_Node_Manifest.json')
    expected=manifest['statistics']
    # This manifest describes the original robot. The current export appends
    # the exhibition stand at node 144; it does not renumber the robot.
    core=gltf['nodes'][:expected['totalNodeCount']]
    counts={'totalNodeCount':len(core),
            'meshInstanceCount':sum('mesh' in n for n in core),
            'uniqueMeshCount':len({n['mesh'] for n in core if 'mesh' in n}),
            'animationCount':len(gltf.get('animations',[])),
            'skinCount':len(gltf.get('skins',[]))}
    for label,actual in counts.items():
        check('Robot subassembly manifest count: '+label,expected[label]==actual, f'{actual} actual vs {expected[label]} listed')
    check('Original robot expected component counts',counts['totalNodeCount']==144 and
          counts['meshInstanceCount']==61 and counts['uniqueMeshCount']==38)
    check('Static Rail node 143 is root mesh', 'mesh' in gltf['nodes'][143] and
          143 in gltf['scenes'][0]['nodes'])
    check('No embedded animation', len(gltf.get('animations',[]))==0)
    check('Manifest node coverage 144', sorted(n['nodeIndex'] for n in manifest['nodes'])==list(range(144)))
    check('Manifest mesh coverage 61',
          sorted(m['nodeIndex'] for m in manifest['meshInstances'])==
          sorted(i for i,n in enumerate(core) if 'mesh' in n))
    check('Robot node identities preserved in exhibition export',
          all(gltf['nodes'][n['nodeIndex']].get('name') == n['name'] and
              gltf['nodes'][n['nodeIndex']].get('mesh') == n.get('meshIndex')
              for n in manifest['nodes']))
    extra=gltf['nodes'][len(core):]
    check('Exhibition extension counts', len(gltf['nodes']) == 1093 and
          sum('mesh' in n for n in extra) == 310 and len(gltf['meshes']) == 72,
          f"{len(gltf['nodes'])} nodes; {sum('mesh' in n for n in extra)} fixed extension meshes")
    check('Exhibition extension does not reparent robot nodes',
          all(c >= len(core) for n in extra for c in n.get('children', [])))
    check('Public GLB matches source', (ROOT/'public/assets/LIEU_Senario.glb').read_bytes() == src.read_bytes())
    cfg=data('config/LIEU_Simulator_Config.json')
    modelids=set(i for i,n in enumerate(core) if 'mesh' in n)
    static=set(cfg['staticMeshes']['railNodeIndices'])
    carriage=set(cfg['allCarriageMeshes'])
    check('Every mesh exactly one base movement owner',
          static.isdisjoint(carriage) and static|carriage==modelids)
    yaw=set(cfg['previewKinematics']['yawCandidateMeshNodeIndices'])
    tilt=set(cfg['previewKinematics']['tiltCandidateMeshNodeIndices'])
    check('Candidate yaw subset carriage',yaw<=carriage)
    check('Candidate tilt subset yaw',tilt<=yaw)
    for name,p in cfg['actuators'].items():
        check(f'{name} previewOnlyRange well ordered',p['previewOnlyRange'][0]<p['previewOnlyRange'][1])
        check(f'{name} physical bounds unknown or ordered documented record',
              (p['physical']['minimum'] is None and p['physical']['maximum'] is None) or
              (isinstance(p['physical']['minimum'], (int,float)) and
               isinstance(p['physical']['maximum'], (int,float)) and
               p['physical']['minimum'] < p['physical']['maximum'] and bool(p['physical'].get('controller'))))
    check('Hardware mode disabled',cfg['hardwareMode']['enabled'] is False)
    leds=data('config/LIEU_LED_Calibration.json')
    ring=leds['ring24']['pixels']
    check('24 separate neopixel coordinates',len(ring)==24 and
          [p['virtualIndex'] for p in ring]==list(range(24)))
    rad=[math.hypot(p['worldPositionMeters'][0],p['worldPositionMeters'][2]) for p in ring]
    check('Neopixel radius 29.4mm',len(rad)==24 and all(abs(r-.0294)<0.0001 for r in rad))
    angs=[p['angleDegWorldXtoZ'] for p in ring]
    check('Neopixels spaced 15 degrees virtually',all(abs((a - i*15)%360)<.01 or
          abs((a-i*15)%360-360)<.01 for i,a in enumerate(angs)))
    eyes=leds['eyes']
    check('2x64 eye pixel coordinates',len(eyes)==2 and all(len(e['pixels'])==64 for e in eyes))
    for i,e in enumerate(eyes):
        check(f'Eye {i} unique positions & matrixIndices',len({tuple(p['worldPositionMeters']) for p in e['pixels']})==64
              and sorted(p['matrixIndex'] for p in e['pixels'])==list(range(64)))
    check('RGBW physical order remains unverified',
          leds['ring24']['physicalIndex0AtVirtualIndex'] is None and
          leds['ring24']['physicalColorByteOrder'] is None)
    ev=data('config/LIEU_Physical_Evidence.json')
    check('Photo evidence filenames exist',all((ROOT/'config'/path).is_file() for path in ev['sources'].values()))
    check('Eyes I2C addresses unknown and independent control flagged',
          ev['eyes']['photoLeftBoard']['address'] is None and
          ev['eyes']['photoRightBoard']['address'] is None and
          ev['eyes']['independentHardwareControlRequiresDistinctAddresses'])
    check('Gear teeth count unknown',ev['yawGear']['pinionToothCount'] is None
          and ev['yawGear']['ringToothCount'] is None)
    for sequence_path in sorted((ROOT/'examples').glob('[0-9][0-9]_*.lieu.json')):
        name=sequence_path.name.removesuffix('.lieu.json')
        seq=data(f'examples/{name}.lieu.json')
        check(f'{name} schema / duration / preview flag',seq['schema']=='lieu.sequence/v1' and
              seq['durationSec']>0 and isinstance(seq.get('demoPreviewOnly'), bool))
        check(f'{name} public copy matches source', (ROOT/'public/examples'/sequence_path.name).read_bytes() == sequence_path.read_bytes())
        tracks=seq['tracks']; duration=seq['durationSec']
        for axis in ('railX','yawY','tiltZ'):
            keys=tracks['motion'][axis]['keys']
            lo,hi=cfg['actuators'][axis]['previewOnlyRange']
            check(f'{name} {axis} keys valid',
                  all(0<=k['tSec']<=duration and lo<=k['value']<=hi for k in keys) and
                  all(a['tSec']<b['tSec'] for a,b in zip(keys,keys[1:])))
        keys=tracks['ring24']['baseFrames']['keys']
        check(f'{name} RGBW frames 24x4 ints 0..255',all(len(k['value'])==24 and
              all(len(pixel)==4 and all(isinstance(v,int) and 0<=v<=255 for v in pixel)
                  for pixel in k['value']) for k in keys))
        for side in ('left','right'):
            check(f'{name} {side} eye frames 8 row bytes',all(len(k['value'])==8 and
                  all(isinstance(r,int) and 0<=r<=255 for r in k['value'])
                  for k in tracks['eyes'][side]['keys']))
        for lane in ('projector','audio'):
            for clip in (tracks['projector']['clips'] if lane=='projector' else tracks['audio']):
                asset=ROOT/'examples'/clip['assetId']
                check(f'{name} {lane} clip valid & asset exists',
                      0 <= clip['fromSec'] < clip['toSec'] <= duration and asset.is_file(),str(asset))
        check(f'{name} events inside sequence',all(0<=c['tSec']<=duration for c in tracks['events']))
    check('Codex instruction exists', (ROOT/'CODEX_START_HERE.md').is_file())
    check('Sequence type contract exists', (ROOT/'spec/sequence-types.ts').is_file())
    check('Calibration input template exists', (ROOT/'spec/HARDWARE_CALIBRATION_TEMPLATE.json').is_file())

if __name__=='__main__':
    verify()
    for label,passed,detail in CHECKS:
        print(('PASS' if passed else 'FAIL')+'  '+label+(f' | {detail}' if detail else ''))
    print(f'\nResult: {len(CHECKS)-len(ERRORS)}/{len(CHECKS)} passed')
    if ERRORS:
        print('\nFAILURES:')
        for error in ERRORS: print(' -',error)
        raise SystemExit(1)
