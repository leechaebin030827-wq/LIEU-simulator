#!/usr/bin/env python3
"""Build a semantic simulation config using GLB source node indices.

WARNING: Stage ownership is an editable animation hypothesis, not evidence
that the corresponding CAD pieces rotate on the actual robot.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'config/LIEU_GLB_Node_Manifest.json').read_text(encoding='utf-8'))
mesh_by_top={g['rootNodeIndex']:g['meshNodeIndices'] for g in manifest['componentGroups']}
all_mesh=sorted(m['nodeIndex'] for m in manifest['meshInstances'])

def expand(root_nodes):
 return sorted({i for root in root_nodes for i in mesh_by_top.get(root,[])})

body_roots=[11,16,134,137,138]
yaw_roots=[0,1,2,11,16,17,20,133,134,137,138,139,140,141]
conf={
 'schema':'LIEU_Simulator_Rig/1.0',
 'sourceGlb':'../assets/LIEU_Senario.glb',
 'sourceManifest':'./LIEU_GLB_Node_Manifest.json',
 'emitterLayout':'./LIEU_LED_Calibration.json',
 'coordinates':{
   'up':'+Y','railAxis':'+X','yawAxis':'+Y','tiltAxis':'+Z',
   'frontAssumption':'+X','down':'-Y','baseUnit':'meters',
   'basisConfirmedWithHardware':False
 },
 'staticMeshes':{'railNodeIndices':[143]},
 'allCarriageMeshes': [i for i in all_mesh if i!=143],
 'previewKinematics':{
   'warning':'DESIGN HYPOTHESIS. No real CAD joints, servo limits, or hardware calibration in GLB.',
   'confirmedAsHardware':False,
   'restPivotsWorldMeters':{'yawY':[0,0.015,0], 'tiltZ':[0,0.02,0]},
   'pivotConfidence':'visual estimate only',
   'yawCandidateMeshNodeIndices':expand(yaw_roots),
   'tiltCandidateMeshNodeIndices':expand(body_roots),
   'explicitNotes':[
     'railX follows every mesh except Rail(node143), including column(node132)',
     'yaw/tilt stage membership are independent, editable per mesh node, and NOT a verified linkage simulation',
     'tilt preview targets outer shell and both eyes only: center projector, NeoPixel and bearing assemblies deliberately stay until attachment confirmed',
     'do not rotate a complete motor assembly as one rigid rotor; motor case and horn have different ownership',
     'if user changes attachment, recompute poses from GLB rest matrices; do not accumulate deltas'
   ]
 },
 'actuators':{
  'railX':{'kind':'linear','units':'meters','axisWorld':[1,0,0],
    'previewOnlyRange':[-.25,0], 'previewOnlyMaxVelocity':.06, 'previewOnlyMaxAcceleration':.12,
    'physical':{'controller':None,'motorModel':None,'minimum':None,'maximum':None,
                'maximumVelocity':None,'maximumAcceleration':None,'maximumJerk':None,
                'homingSensor':None,'homeValue':None,'gearRatio':None,'invertDirection':None}},
  'yawY':{'kind':'angular','units':'degrees','axisWorld':[0,1,0],
    'previewOnlyRange':[-90,90], 'previewOnlyMaxVelocity':110, 'previewOnlyMaxAcceleration':500,
    'physical':{'controller':None,'motorModel':None,'minimum':None,'maximum':None,
                'maximumVelocity':None,'maximumAcceleration':None,'maximumJerk':None,
                'homeValue':None,'gearRatio':None,'invertDirection':None}},
  'tiltZ':{'kind':'angular','units':'degrees','axisWorld':[0,0,1],
    'previewOnlyRange':[-15,15], 'previewOnlyMaxVelocity':20, 'previewOnlyMaxAcceleration':60,
    'physical':{'controller':None,'motorModel':None,'minimum':None,'maximum':None,
                'maximumVelocity':None,'maximumAcceleration':None,'maximumJerk':None,
                'homeValue':None,'gearRatio':None,'invertDirection':None}}
 },
 'emitters':{
  'neopixel24':{'ledCount':24, 'channels':'RGBW (design requirement; physical hardware chip unverified)',
                'sourceNodeIndex':133,'diffuserNodeIndex':17,'physicalIndex0VirtualIndex':None,
                'physicalOrder':'UNKNOWN','physicalByteOrder':'UNKNOWN',
                'perChannelRange':[0,255],'brightnessRange':[0,1],
                'supplyVoltageV':None,'powerBudgetAmps':None},
  'eyesLeft':{'grid':[8,8], 'sourceMeshNodeIndex':13,'driver':'HT16K33 (model name)',
              'physicalI2cAddress':None,'color':'UNKNOWN (likely single color per matrix)',
              'intensityStepRangeIfHT16K33':[0,15]},
  'eyesRight':{'grid':[8,8], 'sourceMeshNodeIndex':8,'driver':'HT16K33 (model name)',
              'physicalI2cAddress':None,'color':'UNKNOWN (likely single color per matrix)',
              'intensityStepRangeIfHT16K33':[0,15]}
 },
 'projector':{
  'modelLabelFromGLB':'Miniray_Beam','sourceMeshNodeIndex':18,'holderNodeIndex':139,
  'opticalEmitterWorldMeters':None,'rayWorldApprox':[0,-1,0],
  'throwRatio':None,'aspectRatio':None,'nativeResolution':None,
  'focusDistanceMeters':None,'brightnessLumens':None,
  'supportsPlaybackSource':None,'projectionSurfaceHeightWorldMeters':None,
  'followsTiltJoint':None
 },
 'audio':{'speakerMeshNodeIndex':None, 'speakerLocationWorldMeters':None,
          'maxOutputGain':None, 'supportedOutputDevice':None},
 'sensor':{'webcamMeshNodeIndex':None,'webcamLocationWorldMeters':None,
           'cameraFovDeg':None,'webcamUsePermissionRequired':True},
 'hardwareMode':{'enabled':False,'requiresUserArming':True, 'rejectIfUncalibrated':True},
 'defaultPreview':{'railX':0,'yawY':0,'tiltZ':0,'neopixelBrightness':0.2,
                   'projectorEnabled':False,'eyePattern':'neutral'}
}
assert len(conf['allCarriageMeshes']) == 60
assert set(conf['previewKinematics']['tiltCandidateMeshNodeIndices']).issubset(set(conf['previewKinematics']['yawCandidateMeshNodeIndices']))
assert set(conf['previewKinematics']['yawCandidateMeshNodeIndices']).issubset(set(conf['allCarriageMeshes']))
out=ROOT/'config/LIEU_Simulator_Config.json'
out.write_text(json.dumps(conf,ensure_ascii=False,indent=2),encoding='utf-8')
print(out, out.stat().st_size)
