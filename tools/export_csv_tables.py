#!/usr/bin/env python3
"""Create handoff CSVs for mechanical and LED mapping review. No extra pip dependencies."""
import json,csv
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'tables';out.mkdir(exist_ok=True)
manifest=json.loads((root/'config/LIEU_GLB_Node_Manifest.json').read_text('utf-8'))
leds=json.loads((root/'config/LIEU_LED_Calibration.json').read_text('utf-8'))

def write(name,fields,rows):
    path=out/name
    with path.open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
    print(path, len(rows),'rows')

nodes=[]
for n in manifest['nodes']:
    nodes.append({k:n.get(k) for k in ('nodeIndex','name','parentNodeIndex','meshIndex',
                                      'semanticComponentRootIndex','semanticCategory')})
write('glb_nodes_144.csv',list(nodes[0]),nodes)
meshes=[]
for n in manifest['meshInstances']:
    d={k:n.get(k) for k in ('nodeIndex','name','meshIndex','semanticCategory','hierarchyPath',
                            'vertexCount','triangleCount')}
    d['center_world_m']=str(n['worldBoundingCenterMeters'])
    d['size_m']=str(n['worldBoundingSizeMeters'])
    d['material_names']=str(n['materialNames'])
    meshes.append(d)
write('glb_mesh_instances_61.csv',list(meshes[0]),meshes)
rows=[]
for p in leds['ring24']['pixels']:
    rows.append({'channel':'ring24','componentNodeIndex':133,'virtualIndex':p['virtualIndex'],
                 'row':'','col':'','x_m':p['worldPositionMeters'][0],
                 'y_m':p['worldPositionMeters'][1],'z_m':p['worldPositionMeters'][2],
                 'realHardwareMapping':'UNKNOWN'})
for e in leds['eyes']:
    for p in e['pixels']:
        rows.append({'channel':e['name'],'componentNodeIndex':e['meshNodeIndex'],
                     'virtualIndex':p['matrixIndex'],'row':p['row'],'col':p['col'],
                     'x_m':p['worldPositionMeters'][0],
                     'y_m':p['worldPositionMeters'][1],'z_m':p['worldPositionMeters'][2],
                     'realHardwareMapping':'UNKNOWN'})
write('emitter_positions_152.csv',list(rows[0]),rows)
