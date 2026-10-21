#!/usr/bin/env python3
"""Creates three PREVIEW-ONLY LIEU sequence examples. No physical actuator claims."""
import json, math, wave, struct
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'examples'; media=out/'media'; media.mkdir(parents=True,exist_ok=True)
ZERO=[0,0,0,0]
WHITE_DIM=[0,0,0,9]
YELLOW=[35,48,0,18]
NEUTRAL=[0]+[0b00011100]*6+[0]  # default eye: 3x6 bar (cols 3-5, rows 1-6)
BLINK=[0,0,0,0b01111110,0,0,0,0]
SMILE=[0,0b01100110,0b01000010,0b01000010,0b01011010,0b00100100,0,0]
OPEN=[0,0b00111100,0b01111110,0b01000010,0b01000010,0b01111110,0b00111100,0]

def key(t,value,id, interp='smoothstep'):
 return {'id':str(id), 'tSec':t,'value':value,'interpolationToNext':interp}
def num(pairs, name):
 return {'kind':'numeric','keys':[key(t,v,f'{name}_{i}') for i,(t,v) in enumerate(pairs)]}
def ring_frame(color):
 return [list(color) for _ in range(24)]
def frame(pairs,name):
 return {'kind':'rgbw24','keys':[key(t,ring_frame(v),f'{name}_frame_{i}', 'linear') for i,(t,v) in enumerate(pairs)]}
def eye(pairs,name):
 return {'kind':'eyeBitmap','keys':[key(t,v,f'{name}_eye_{i}', 'hold') for i,(t,v) in enumerate(pairs)]}
def prjprops(duration, on, off, label, rot=0):
 return {'opacity':num(([(0,0.78)] if on<=0 else [(0,0),(on,0),(on+0.7,0.78)])+[(off-0.8,0.78),(off,0),(duration,0)],label+'_opacity'),
         'brightness':num([(0,0.85)],label+'_brightness'),
         'rotationDeg':num([(0,rot)],label+'_rot'),
         'scale':num([(0,1)],label+'_scale'),
         'offsetXm':num([(0,0)],label+'_xm'),
         'offsetZm':num([(0,0)],label+'_zm')}
def create(name, duration, motion, lights, led_effect, eyes, projector_clips, cue_events, audio_span=None, proj_rot=0):
 seq={'schema':'lieu.sequence/v1', 'id':name, 'title':name.replace('_',' ').title(),
      'durationSec':duration,'fps':30,'loop':False,'demoPreviewOnly':True,
      'notes':'PREVIEW ONLY. Motion limits/pivots/gear ratios are not physically verified.',
      'tracks':{
        'motion':{axis:num(motion[axis],name+'_'+axis) for axis in ('railX','yawY','tiltZ')},
        'ring24':{'baseFrames':frame(lights,name), 'brightness':num([(0,1)],name+'_ringbrite'), 'effects':led_effect if isinstance(led_effect,list) else [led_effect]},
        'eyes':{'left':eye(eyes,name+'_left'),'right':eye(eyes,name+'_right'), 'intensity':num([(0,.7)],name+'_eyeBrightness')},
        'projector':{'clips':[{'id':f'projector_{i+1}','fromSec':a,'toSec':b,
                               'assetId':src,'visible':True} for i,(src,a,b) in enumerate(projector_clips)],
                    'properties':prjprops(duration,min(c[1] for c in projector_clips),max(c[2] for c in projector_clips),name+'_projector',proj_rot)},
        'audio':[] if audio_span is None else [
          {'id':name+'_audio','fromSec':audio_span[0],'toSec':audio_span[1],
           'assetId':'media/intro-chime.wav','mediaOffsetSec':0,'gain':.35,
           'fadeInSec':0.05,'fadeOutSec':0.3,'loop':False}],
        'events':[{'id':name+'_event_'+str(i),'tSec':t,'type':event,'payload':payload}
                  for i,(t,event,payload) in enumerate(cue_events)]}}
 assert len(seq['tracks']['ring24']['baseFrames']['keys'][0]['value'])==24
 (out/(name+'.lieu.json')).write_text(json.dumps(seq,ensure_ascii=False,indent=2),encoding='utf8')
 return seq
# Starts already turned 90deg and holds ~5s, then returns to front.
# NOTE: Lieu faces +X; +yawY turns toward -Z (viewport right in the default Persp view, Lieu's left). Viewport-based direction.
create('01_boarding',9,
       {'railX':[(0,0),(9,0)],
        'yawY':[(0,90),(5.0,90),(8.0,0),(9,0)],
        'tiltZ':[(0,0),(9,0)]},
       [(0,ZERO),(9,ZERO)],
       [{'id':'sky_breathe','type':'breathe','fromSec':0,'toSec':5,'seed':1,
         'priority':1,'blend':'max','params':{'color':[60,150,255,130],'speedHz':.2}}],
       [(0,NEUTRAL)],
       [('media/welcome.svg',0,5.5)],
       [(0.3,'passenger_arrives',{'door':'right'})],None,180)

create('02_driving_a',12,
       {'railX':[(0,0),(2,0),(5,-.08),(9,-.08),(11,0)],
        'yawY':[(0,90),(2,0),(4,-8),(6,-8),(8,10),(10,10),(11.5,0)],
        'tiltZ':[(0,0),(3,5),(7,5),(11,0)]},
       [(0,WHITE_DIM),(3,[25,36,0,20]),(11,WHITE_DIM)],
       {'id':'detour_wave','type':'wave','fromSec':3,'toSec':11,'seed':12,
        'priority':1,'blend':'max','params':{'whiteLevel':45,'speedHz':.5,'width':3,'direction':1}},
       [(0,NEUTRAL),(2.5,OPEN),(6,NEUTRAL),(7.5,BLINK),(7.8,NEUTRAL)],
       [('media/traffic.svg',3,6.5),('media/detour.svg',7,11.5)],
       [(2.5,'traffic_detected',{}),(7,'reroute_started',{'direction':'right'})],(7,7.7))
create('03_arrival',10,
       {'railX':[(0,0),(10,0)],
        'yawY':[(0,90),(1,8),(5,8),(8,0)],
        'tiltZ':[(0,0),(1.5,4),(5,4),(8,0)]},
       [(0,WHITE_DIM),(1,YELLOW),(5,[0,0,0,46]),(8.5,WHITE_DIM)],
       {'id':'farewell_pulse','type':'pulse','fromSec':5,'toSec':9,'seed':1,
        'priority':1,'blend':'max','params':{'whiteLevel':55,'periodSec':2.0}},
       [(0,NEUTRAL),(1,OPEN),(5,SMILE),(9,NEUTRAL)],
       [('media/arriving.svg',1,5),('media/goodbye.svg',5.2,9.5)],
       [(1,'arrival_near',{}),(5.2,'passenger_exit',{})],(5.2,5.9))

for name,txt in [('welcome','WELCOME\nROBOWORLD2026'),('seatbelt','안전벨트를 확인해 주세요\n출발합니다~'),('traffic','교통 상황을\n탐색 중입니다'),('detour','우회 경로로\n안내합니다 ↪'),('arriving','목적지에\n거의 다 왔습니다'),('goodbye','안녕히 가세요\n감사합니다')]:
 import html
 lines=txt.splitlines()
 svg='''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512"><rect width="1024" height="512" fill="#000000"/><g fill="#e8f3b5" font-family="Apple SD Gothic Neo, Noto Sans KR, Malgun Gothic, Arial, sans-serif" font-size="56" font-weight="700" text-anchor="middle">'''
 svg+=''.join(f'<text x="512" y="{195+i*103}">{html.escape(line)}</text>' for i,line in enumerate(lines))
 svg+='</g></svg>'
 (media/(name+'.svg')).write_text(svg,encoding='utf8')
# quiet synthetic chime for scheduler smoke-test; not a voice recording
fs=16000
frames=[]
for i in range(int(fs*.72)):
 t=i/fs
 env=(1-math.exp(-40*t))*math.exp(-5*t)
 sample=(math.sin(2*math.pi*523.25*t)*.45+math.sin(2*math.pi*659.25*t)*.25)*env*.3
 frames.append(int(max(-1,min(1,sample))*32767))
with wave.open(str(media/'intro-chime.wav'),'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(fs)
 f.writeframes(struct.pack('<'+'h'*len(frames),*frames))
print('Demo sequences and media generated at', out)
