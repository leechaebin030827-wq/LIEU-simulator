#!/usr/bin/env python3
"""Builds the hand-directed LIEU scenarios (PREVIEW ONLY):
   01_boarding  - car arrives, Lieu greets, checks seating, spins when the start button is pressed
   02_driving_a - construction detected, Lieu looks ahead, returns, explains the detour
   03_arrival   - destination nearly reached, Lieu comes out, glances at the door side, says goodbye
   04_driving_b - "Hey LIEU" -> startled, then every cute trick (giggle, heart eyes, wink, shy, stars, bow)
   (run `build_scenarios.py arrival` to rebuild only one; plain run rebuilds all and overwrites saved edits)
Writes examples/<id>.lieu.json and public/examples/<id>.lieu.json.

Conventions (see memory notes): Lieu faces +X; yaw +  = turn toward the viewport-right in the default view;
tilt - = nose down; railX -0.25 = back, 0 = front end.
"""
import json
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import tv_copy, math, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZERO24 = [[0, 0, 0, 0] for _ in range(24)]
BR = 0.12   # ring brightness used everywhere (same level as the projection scene)

# 8x8 eye bitmaps (bit7 = column 0)
N = [0] + [0b00011100] * 6 + [0]                 # default eye: 3x6 bar
F1 = [0, 0] + [0b00011100] * 4 + [0, 0]
F2 = [0, 0, 0, 0b00011100, 0b00011100, 0, 0, 0]
F3 = [0, 0, 0, 0b00111100, 0, 0, 0, 0]
SM = [0, 0, 0b00111100, 0b01100110, 0b01000010, 0, 0, 0]   # ^ smile
es = lambda u: 0.5 - 0.5 * math.cos(math.pi * min(1, max(0, u)))


class Tr:
    """numeric track builder with strictly increasing keys"""
    def __init__(self, name): self.name, self.k = name, []
    def add(self, t, v, interp='smoothstep'):
        self.k.append({'id': f'{self.name}_{len(self.k)}', 'tSec': round(t, 4), 'value': round(v, 4), 'interpolationToNext': interp}); return self
    def out(self):
        assert all(a['tSec'] < b['tSec'] for a, b in zip(self.k, self.k[1:])), (self.name, [(a['tSec'], b['tSec']) for a, b in zip(self.k, self.k[1:]) if a['tSec'] >= b['tSec']][:3])
        return {'kind': 'numeric', 'keys': self.k}


def eyes_track(name, pairs):
    ks = [{'id': f'{name}_{i}', 'tSec': round(t, 4), 'value': v, 'interpolationToNext': 'hold'} for i, (t, v) in enumerate(pairs)]
    assert all(a['tSec'] < b['tSec'] for a, b in zip(ks, ks[1:])), name
    return {'kind': 'eyeBitmap', 'keys': ks}


def wave(id, seed, color, phase, a, b, speed=0.7):
    return {'id': id, 'type': 'wave', 'fromSec': a, 'toSec': b, 'seed': seed, 'priority': 1, 'blend': 'max',
            'params': {'color': color, 'speedHz': speed, 'width': 24, 'direction': 1, 'phase': round(phase, 4)}}


def breathe(id, seed, color, a, b, speed):
    return {'id': id, 'type': 'breathe', 'fromSec': a, 'toSec': b, 'seed': seed, 'priority': 1, 'blend': 'max',
            'params': {'color': color, 'speedHz': round(speed, 4)}}


WHIRL_COLORS = [('white', [0, 0, 0, 230], 0), ('sky', [110, 205, 255, 0], math.pi / 2), ('lilac', [185, 150, 255, 0], math.pi), ('pink', [255, 150, 195, 0], 3 * math.pi / 2)]


def whirl(yaw: Tr, tilt: Tr, t0):
    """illusion spin: right end (eyes off) -> fast hidden swing -> left end (eyes on) -> front. 5.4 s, same values everywhere."""
    A, B, C = 1.4, 2.6, 1.4
    tA, tB, tC = t0 + A, t0 + A + B, t0 + A + B + C
    def y(t):
        if t <= t0: return 0
        if t <= tA: return 90 * es((t - t0) / A)
        if t <= tB: return 90 - 180 * es((t - tA) / B)
        if t <= tC: return -90 + 90 * es((t - tB) / C)
        return 0
    S = tC - t0
    def tl(t):
        s = t - t0
        return 15 * math.sin(2 * math.pi * s / S) * es(s / 1.6) * es((S - s) / 1.6)
    n = int(S * 30)
    for i in range(0, n + 1):
        t = t0 + i / 30
        yaw.add(t, y(t), 'linear'); tilt.add(t, tl(t), 'linear')
    return tA, tB, tC


def build(id_, title, dur, notes, motion, ring_fx, brightness, eyes, intensity, clips, opacity, rot, audio, events, partial=None):
    seq = {'schema': 'lieu.sequence/v1', 'id': id_, 'title': title, 'durationSec': dur, 'fps': 30, 'loop': False,
           'demoPreviewOnly': True, 'notes': notes,
           'tracks': {
               'motion': {a: motion[a].out() for a in ('railX', 'yawY', 'tiltZ')},
               'ring24': {'baseFrames': {'kind': 'rgbw24', 'keys': [
                              {'id': 'f0', 'tSec': 0, 'value': ZERO24, 'interpolationToNext': 'linear'},
                              {'id': 'f1', 'tSec': dur, 'value': ZERO24, 'interpolationToNext': 'linear'}]},
                          'brightness': brightness.out(), 'effects': ring_fx},
               'eyes': {'left': eyes_track('L', eyes['left'] if isinstance(eyes, dict) else eyes), 'right': eyes_track('R', eyes['right'] if isinstance(eyes, dict) else eyes), 'intensity': intensity.out()},
               'projector': {'clips': clips, 'properties': {
                   'opacity': opacity.out(),
                   'brightness': {'kind': 'numeric', 'keys': [{'id': 'pb', 'tSec': 0, 'value': 0.85, 'interpolationToNext': 'smoothstep'}]},
                   'rotationDeg': {'kind': 'numeric', 'keys': [{'id': 'pr', 'tSec': 0, 'value': rot, 'interpolationToNext': 'smoothstep'}]},
                   'scale': {'kind': 'numeric', 'keys': [{'id': 'ps', 'tSec': 0, 'value': 1, 'interpolationToNext': 'smoothstep'}]},
                   'offsetXm': {'kind': 'numeric', 'keys': [{'id': 'px', 'tSec': 0, 'value': 0, 'interpolationToNext': 'smoothstep'}]},
                   'offsetZm': {'kind': 'numeric', 'keys': [{'id': 'pz', 'tSec': 0, 'value': 0, 'interpolationToNext': 'smoothstep'}]}}},
               'audio': audio,
               'events': [{'id': f'ev{i}', 'tSec': t, 'type': ty, 'payload': pl} for i, (t, ty, pl) in enumerate(events)]}}
    tv_copy.apply(seq)
    for out in (ROOT / 'examples', ROOT / 'public/examples'):
        (out / f'{id_}.lieu.json').write_text(json.dumps(seq, ensure_ascii=False, indent=2), encoding='utf8')


def scene(t, title, desc): return (t, 'scene', {'title': title, 'desc': desc})


def chase(id, seed, a, direction, color=(90, 185, 255, 60)):
    """short one-revolution sweep = 'which way I am about to move' cue"""
    return {'id': id, 'type': 'chase', 'fromSec': a, 'toSec': round(a + 0.65, 3), 'seed': seed, 'priority': 1, 'blend': 'max',
            'params': {'color': list(color), 'speedHz': 1.7, 'width': 6, 'direction': direction}}


def sfx(id, name, a, dur, gain=0.6, fade_in=0.02, fade_out=0.05):
    return {'id': id, 'fromSec': a, 'toSec': round(a + dur, 3), 'assetId': f'media/{name}', 'mediaOffsetSec': 0, 'gain': gain,
            'fadeInSec': fade_in, 'fadeOutSec': fade_out, 'loop': False}


# ---------------------------------------------------------------- 01 boarding
def boarding():
    """base position = just inside the front end of the rail. cue -> glide out -> nod -> one left->right seating check -> cue -> glide back to base -> start pressed -> spin."""
    BASE = -0.06           # a little inside the front end (0)
    DUR = 28.5
    ARR, NOD = 3.7, 4.0      # arrival at the front end, nod start
    CK = 6.4                 # check cue
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    rail.add(0, BASE).add(0.7, BASE).add(ARR, 0).add(13.4, 0).add(16.4, BASE).add(DUR, BASE)
    yaw.add(0, 0).add(7.0, 0).add(8.4, -45).add(9.0, -45).add(11.2, 45).add(12.6, 0)
    tilt.add(0, 0).add(NOD, 0).add(NOD + 0.9, -8).add(NOD + 1.3, -8).add(NOD + 2.2, 0).add(7.0, 0).add(8.4, -10).add(9.8, -12).add(11.2, -10).add(12.6, 0)
    # start button on the screen (drawn by the viewer from the 'screen_button' cue): shown once Lieu is back at base, pressed, then the spin
    BTN = {'show': 16.6, 'pressDown': 18.0, 'hold': 18.35, 'release': 18.85, 'hide': 19.3, 'gone': 19.7}
    W0 = 20.0
    tA, tB, tC = whirl(yaw, tilt, W0)
    yaw.add(tC + 1, 0); tilt.add(tC + 1, 0)
    F3 = [0, 0, 0, 0b00111100, 0, 0, 0, 0]   # eyes shut (smiling blink)
    # smiling eyes that keep blinking while scanning the seats; 9.0 / 9.35 is a quick double blink
    smile_blinks = [e for t in (6.7, 7.9, 9.0, 9.35, 10.5, 11.5) for e in ((t, F3), (round(t + 0.12, 3), SM))]
    eyes = [(0, F2), (0.15, SM)] + smile_blinks + [(12.3, F2), (12.45, N), (W0 - 0.15, F2), (W0, SM), (tC, F2), (tC + 0.15, N)]
    baked = ROOT / 'tools/baked_eyes/01_boarding.json'    # eye-studio expressions (tools/bake_eyes.ts); falls back to the hand-made bitmaps above
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    inten = Tr('int').add(0, 1).add(tA - 0.3, 1).add(tA, 0).add(tB, 0).add(tB + 0.6, 1)
    fx = [chase('cue_out', 20, 0.0, 1), chase('cue_check', 21, CK, -1), chase('cue_back', 22, 12.8, -1), chase('cue_spin', 23, W0 - 0.8, 1),
          breathe('greet_breath', 1, [90, 185, 255, 40], 0.7, ARR, 1 / 3.0),
          breathe('nod_glow', 2, [150, 225, 255, 110], NOD, NOD + 2.2, 1 / 2.2),
          breathe('check_glow', 3, [150, 225, 255, 110], 7.0, 12.0, 1 / 5.0)]
    fx += [wave('spin_' + n, 10 + i, c, ph, W0, tC + 0.2) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    bright = Tr('br').add(0, BR).add(W0 - 0.2, BR).add(W0 - 0.1, 0).add(W0 + 0.8, BR).add(tC - 0.8, BR).add(tC + 0.2, 0).add(DUR, 0)
    clips = [{'id': 'welcome', 'fromSec': 0.7, 'toSec': 6.9, 'assetId': 'media/welcome.svg', 'visible': True}]
    opac = Tr('op').add(0, 0).add(0.7, 0).add(1.7, 0.78).add(5.6, 0.78).add(6.9, 0).add(DUR, 0)
    audio = [sfx('cue1', 'sfx_cue.wav', 0.0, 0.45), sfx('glide1', 'sfx_glide.wav', 0.7, 3.0, 0.5, 0.4, 0.8),
             {**sfx('chime', 'intro-chime.wav', ARR, 0.72, 0.5), 'fadeOutSec': 0.2},
             sfx('nod', 'sfx_nod.wav', NOD + 0.3, 0.35, 0.6),
             sfx('cue2', 'sfx_cue.wav', CK, 0.45), sfx('turn', 'sfx_turn.wav', 7.0, 1.5, 0.5), sfx('scan', 'sfx_scan.wav', 9.0, 2.2, 0.5),
             sfx('cue3', 'sfx_cue.wav', 12.8, 0.45), sfx('glide2', 'sfx_glide.wav', 13.4, 3.0, 0.5, 0.4, 0.8),
             sfx('cue4', 'sfx_cue.wav', W0 - 0.8, 0.45), sfx('spin', 'sfx_spin.wav', W0, 5.4, 0.55, 0.2, 0.4),
             {**sfx('chime2', 'intro-chime.wav', tC, 0.72, 0.5), 'fadeOutSec': 0.2}]
    ev = [scene(0, '① 차량 도착 · 탑승자 환영', '기본 위치(레일 맨 앞에서 조금 들어간 곳)에서 웃는 눈으로 WELCOME을 투사하고, 이동 방향을 알리는 라이트가 먼저 돈 뒤 레일 맨 앞까지 나옵니다'),
          scene(ARR, '② 도착 · 인사하기', '가볍고 부드럽게 목례합니다'),
          scene(CK, '③ 탑승 확인 (사람이 앉는 중)', '방향 라이트 후 고개를 숙이고 왼쪽에서 오른쪽으로 쓰윽 둘러보며 다 앉았는지 확인합니다'),
          scene(12.6, '④ 확인 후 기본 위치로 복귀', '기본 눈으로 돌아오고, 방향 라이트 후 레일을 타고 기본 위치로 살짝 들어갑니다'),
          scene(BTN['show'], '⑤ 출발 버튼', '스크린 중앙에 큰 글래스 "출발" 버튼이 떠오릅니다'),
          scene(BTN['pressDown'], '⑥ 출발 버튼이 눌림', '버튼이 꾹 눌렸다가 튕기듯 올라오며 사라집니다'),
          scene(W0 - 0.8, '⑦ 출발 · 빙그르르', '루가 빙그르르 돕니다 (눈이 오른쪽 끝에서 꺼지고 왼쪽에서 다시 켜짐)'),
          scene(tC + 0.5, '대기', '출발 후 기본 위치에서 대기합니다'),
          (0.3, 'vehicle_arrived', {}), (NOD, 'greeting_nod', {}), (CK, 'seat_check', {}), (BTN['show'], 'screen_button', BTN), (BTN['pressDown'], 'start_pressed', {})]
    build('01_boarding', '01 Boarding', DUR,
          'PREVIEW ONLY. 탑승: 기본 위치(앞에서 조금 들어간 곳) -> 맨 앞까지 나와 환영/인사/착석 확인 -> 기본 위치 복귀 -> 출발 버튼 -> 빙그르르. 효과음은 합성음(tools/make_sfx.py).',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, fx, bright, eyes, inten, clips, opac, 180, audio, ev)


# ---------------------------------------------------------------- 02 driving A
def driving_a():
    DUR = 39
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    CENTER, BACK = -0.125, -0.25
    # front end -> backs along the rail toward the monitor while glancing around (dynamic) -> returns to the guide position
    rail.add(0, 0).add(5.0, 0).add(13.0, BACK).add(13.5, BACK).add(17.5, CENTER).add(DUR, CENTER)
    # the head swings round to +90 (eyes slide round to the side and out of sight), then keeps shaking side to side facing the monitor, then swings back
    yaw.add(0, 0).add(4.0, 0).add(6.2, 90)
    for t, v in [(7.4, 64), (8.6, 90), (9.8, 66), (11.0, 90), (12.0, 70), (12.8, 90)]: yaw.add(t, v)
    yaw.add(14.8, 0).add(DUR, 0)
    tilt.add(0, 0).add(4.0, 0).add(6.2, -8).add(7.4, -5).add(8.6, -12).add(9.8, -6).add(11.0, -12).add(12.0, -6).add(12.8, -9).add(14.8, -4).add(17.0, 0).add(DUR, 0)
    eyes = [(0, N)]
    baked = ROOT / 'tools/baked_eyes/02_driving_a.json'   # expressions from the eye studio (tools/bake_eyes.ts); falls back to the plain eye
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    # eyes stay lit while the head swings round (they slide out of view with the turn); once they are side-on / behind they are switched off, and back on as the head comes round again
    inten = Tr('int').add(0, 1).add(5.2, 1).add(5.7, 0).add(13.1, 0).add(13.6, 1)
    ramp = Tr('wl').add(4.0, 0).add(5.2, 200).add(16.0, 200).add(17.2, 0)
    fx = [breathe('idle_a', 1, [0, 0, 0, 200], 0, 4.0, 0.25),
          {'id': 'attention', 'type': 'solid', 'fromSec': 4.0, 'toSec': 17.2, 'seed': 2, 'priority': 1, 'blend': 'max',
           'params': {'whiteLevel': 200}, 'parameterTracks': {'whiteLevel': ramp.out()}},
          breathe('arrive_glow', 3, [0, 0, 0, 200], 17.5, 19.5, 0.5),
          breathe('talk', 4, [0, 0, 0, 90], 18.0, 22.5, 1.1),
          breathe('idle_b', 5, [0, 0, 0, 200], 29.0, 37.0, 0.25)]
    bright = Tr('br').add(0, BR).add(DUR, BR)
    clips = [{'id': 'detour_1', 'fromSec': 18.3, 'toSec': 20.6, 'assetId': 'media/detour_1.svg', 'visible': True},
             {'id': 'detour_2', 'fromSec': 20.6, 'toSec': 22.9, 'assetId': 'media/detour_2.svg', 'visible': True},
             {'id': 'detour_3', 'fromSec': 22.9, 'toSec': 29.4, 'assetId': 'media/detour_3.svg', 'visible': True}]
    opac = Tr('op').add(0, 0).add(18.3, 0).add(19.1, 0.8).add(27.6, 0.8).add(29.4, 0).add(DUR, 0)
    audio = [{'id': 'voice', 'fromSec': 18.0, 'toSec': 22.46, 'assetId': 'media/voice_detour.wav', 'mediaOffsetSec': 0, 'gain': 0.8, 'fadeInSec': 0.05, 'fadeOutSec': 0.2, 'loop': False}]
    # screen: the drive video is treated like the car's wheels. It is already rolling at 0 s and brakes smoothly to a stop on its last frame (the
    # road work) exactly when Lieu reacts at 4.0 s, stays stopped while Lieu backs to the monitor, looks around and comes back, then, when
    # Lieu starts back along the rail (13.5 s), the car sets off again in reverse with it: slowly gathers speed, cruises, and brakes to rest on the first frame.
    screen_clips = [{'src': 'assets/screen_drive.mp4', 'from': 0, 'dur': 4.0, 'accel': 0, 'decel': 2.2},
                    {'src': 'assets/screen_drive_rev.mp4', 'from': 13.5, 'dur': 9.5, 'accel': 2.0, 'decel': 2.6}]
    ev = [scene(0, '대기 · 레일 맨 앞', 'LED 링이 낮은 밝기로 천천히 호흡하고, 루는 레일 맨 앞에서 수평으로 대기합니다'),
          scene(4.0, '공사 구간 감지 · 모니터 쪽으로 두리번', '호흡을 멈추고 밝아지며, 고개가 90도 돌아가 눈이 옆으로 넘어가 보이지 않게 되고, 레일을 따라 모니터 쪽(뒤)으로 이동하면서 도리도리하며 살펴봅니다'),
          scene(13.0, '모니터 쪽 끝 도착', '잠시 살핀 뒤 몸을 돌려 눈이 다시 켜지고, 몸을 천천히 수평으로 되돌리며 안내 위치(중앙)로 돌아옵니다'),
          scene(17.5, '안내 시작', 'LED를 한 번 부드럽게 밝힌 뒤 음성 안내와 함께 바닥에 우회 경로를 투사합니다'),
          scene(22.9, '우회 경로 안내', '현재 위치 → 공사 구간 → 갈라지는 우회 경로 순으로 그려지고, 안내가 끝난 뒤에도 잠시 유지됩니다'),
          scene(27.6, '조용히 물러나기', '프로젝션이 서서히 사라지고 LED는 다시 낮은 호흡, 본체는 수평 대기 상태로 돌아갑니다'),
          (0, 'screen_video', {'clips': screen_clips}), (4.0, 'detour_info_received', {'reason': 'road_work', 'direction': 'right'}), (17.5, 'guidance_start', {})]
    build('02_driving_a', '02 Driving A', DUR,
          'PREVIEW ONLY. 주행A: 공사 구간 감지 -> 레일 맨 앞에서 모니터 쪽으로 물러나며 두리번 -> 안내 위치에서 음성+바닥 투사로 우회 안내 -> 조용히 대기.',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, fx, bright, eyes, inten, clips, opac, 0, audio, ev)


# ---------------------------------------------------------------- 03 arrival
def arrival():
    """base -> glide to the front end ("almost there") -> look over the cabin -> arrival: smile + nod + goodbye -> face the door side (Lieu's right) -> back to base."""
    BASE = -0.06
    DUR = 31
    OUT, LOOK, ARR, DOOR, BACK = 2.2, 6.2, 14.0, 16.8, 25.0
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    rail.add(0, BASE).add(OUT + 0.6, BASE).add(OUT + 3.4, 0).add(BACK, 0).add(BACK + 3.0, BASE).add(DUR, BASE)
    # gentle look over the cabin (left -> right), then eyes front for the arrival nod, then turn to the door side and hold
    yaw.add(0, 0).add(LOOK, 0).add(LOOK + 1.4, -35).add(LOOK + 2.2, -35).add(LOOK + 4.6, 35).add(LOOK + 6.0, 0)\
       .add(DOOR, 0).add(DOOR + 1.6, 40).add(BACK - 1.6, 40).add(BACK, 0).add(DUR, 0)
    tilt.add(0, 0).add(LOOK, 0).add(LOOK + 1.4, -8).add(LOOK + 4.6, -8).add(LOOK + 6.0, 0).add(ARR + 0.4, 0) \
        .add(ARR + 1.4, -8).add(ARR + 1.9, -8).add(ARR + 3.0, 0).add(DUR, 0)
    blink = lambda *ts: [e for t in ts for e in ((t, F2), (t + 0.15, N))]
    eyes = [(0, F2), (0.15, N)] + blink(5.0, 11.0) + [(ARR - 0.2, F2), (ARR, SM), (BACK - 0.2, F2), (BACK, N)] + blink(28.0)
    eyes.sort()
    baked = ROOT / 'tools/baked_eyes/03_arrival.json'
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    inten = Tr('int').add(0, 1)
    fx = [breathe('idle_a', 1, [90, 185, 255, 40], 0, OUT, 1 / 3.0),
          chase('cue_out', 20, OUT - 0.4, 1),
          breathe('near_glow', 2, [90, 185, 255, 70], OUT + 0.6, ARR, 1 / 3.5),
          chase('cue_arrive', 21, ARR - 0.8, 1, (255, 200, 120, 60)),
          breathe('bye_glow', 3, [255, 190, 160, 90], ARR, BACK, 1 / 2.4),
          chase('cue_back', 22, BACK - 0.8, -1),
          breathe('idle_b', 4, [90, 185, 255, 40], BACK + 3.0, DUR - 0.5, 1 / 3.0)]
    fx += [wave('bye_' + n, 30 + i, c, ph, ARR + 0.4, DOOR + 4.0, 0.5) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    bright = Tr('br').add(0, BR).add(DUR, BR)
    clips = [{'id': 'arriving', 'fromSec': OUT + 0.4, 'toSec': ARR - 0.6, 'assetId': 'media/arriving.svg', 'visible': True},
             {'id': 'goodbye', 'fromSec': ARR + 0.6, 'toSec': BACK - 0.4, 'assetId': 'media/goodbye.svg', 'visible': True}]
    opac = Tr('op').add(0, 0).add(OUT + 0.4, 0).add(OUT + 1.6, 0.78).add(ARR - 1.8, 0.78).add(ARR - 0.6, 0) \
        .add(ARR + 0.6, 0).add(ARR + 1.8, 0.8).add(BACK - 1.8, 0.8).add(BACK - 0.4, 0).add(DUR, 0)
    audio = [sfx('cue1', 'sfx_cue.wav', OUT - 0.4, 0.45), sfx('glide1', 'sfx_glide.wav', OUT + 0.6, 2.8, 0.5, 0.4, 0.8),
             sfx('scan', 'sfx_scan.wav', LOOK + 1.4, 2.2, 0.5), sfx('cue2', 'sfx_cue.wav', ARR - 0.8, 0.45),
             {**sfx('chime', 'intro-chime.wav', ARR, 0.72, 0.5), 'fadeOutSec': 0.2}, sfx('nod', 'sfx_nod.wav', ARR + 1.0, 0.35, 0.6),
             sfx('turn', 'sfx_turn.wav', DOOR + 0.2, 1.5, 0.5), sfx('cue3', 'sfx_cue.wav', BACK - 0.8, 0.45),
             sfx('glide2', 'sfx_glide.wav', BACK + 0.2, 2.8, 0.5, 0.4, 0.8)]
    ev = [scene(0, '① 대기 · 주행 중', '기본 위치(레일 맨 앞에서 조금 들어간 곳)에서 낮은 호흡으로 대기합니다'),
          scene(OUT, '② 곧 도착 · 앞으로 나옴', '방향 라이트 후 레일 맨 앞까지 나오며 바닥에 "목적지에 거의 다 왔습니다"를 투사합니다'),
          scene(LOOK, '③ 차 안 둘러보기', '고개를 살짝 숙이고 왼쪽에서 오른쪽으로 천천히 둘러보며 놓고 내리는 물건이 없는지 살핍니다'),
          scene(ARR, '④ 도착 · 작별 인사', '웃는 눈과 차임, 목례와 함께 "안녕히 가세요, 감사합니다"를 투사하고 LED가 따뜻한 색으로 물결칩니다'),
          scene(DOOR, '⑤ 문 쪽 안내', '루의 오른쪽(탑승/하차 문 쪽)으로 몸을 돌려 내리는 방향을 알려줍니다'),
          scene(BACK, '⑥ 기본 위치로 복귀', '방향 라이트 후 정면을 보고 기본 위치로 들어가 다음 손님을 기다립니다'),
          (OUT, 'approaching_destination', {}), (ARR, 'vehicle_arrived_destination', {}), (DOOR, 'door_side_guidance', {})]
    build('03_arrival', '03 Arrival', DUR,
          'PREVIEW ONLY. 도착: 기본 위치 -> 앞으로 나와 곧 도착 안내 -> 차 안 둘러보기 -> 웃으며 작별 인사 -> 문 쪽(루 기준 오른쪽)으로 안내 -> 기본 위치 복귀. 문 방향의 yaw 부호(+)는 가정값입니다.',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, fx, bright, eyes, inten, clips, opac, 0, audio, ev)


# ---------------------------------------------------------------- 04 driving B
def driving_b():
    """a passenger says "Hey LIEU" -> Lieu is startled, then does every cute thing it knows: giggle-wiggle, heart eyes, wink, shy, star-struck bounce, sweet bow."""
    DUR = 32
    CENTER = -0.125
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    # rail (<= 0.06 m/s): leans in when called, comes right up to the front for the hearts, shyly backs off, bounces forward, then settles back
    rail.add(0, CENTER).add(3.0, CENTER).add(5.6, -0.07).add(7.5, -0.07).add(11.0, 0).add(12.3, 0).add(15.6, -0.10).add(16.5, -0.10).add(19.6, -0.04).add(22.0, -0.04).add(28.0, CENTER).add(DUR, CENTER)
    # yaw: perk glance, giggle wiggle, slow heart sway, shy turn-away + peek, excited wiggle, face front
    yaw.add(0, 0).add(3.0, 0).add(3.7, -10).add(4.2, 0)
    for t, v in [(4.8, 14), (5.5, -14), (6.2, 14), (6.9, 0), (8.6, -22), (10.0, 22), (11.0, 0), (13.6, -38), (14.6, -38), (15.4, -10), (16.2, 0),
                 (17.1, 18), (17.8, -18), (18.5, 18), (19.2, -18), (19.9, 12), (20.7, 0)]:
        yaw.add(t, v)
    yaw.add(DUR, 0)
    # tilt (<= 20 deg/s, 60 deg/s^2): perk up, bouncy nods, shy hide, excited bounce, polite bow
    tilt.add(0, 0).add(3.0, 0).add(4.0, 5).add(5.2, 0).add(6.0, 3).add(6.9, 0).add(8.4, 3).add(10.0, 0).add(11.0, 0).add(11.9, -4).add(12.9, 0)
    for t, v in [(13.8, -8), (14.6, -8), (15.8, 0), (17.0, 4), (17.9, -2), (18.8, 4), (19.7, -2), (20.6, 0), (22.4, 0), (23.4, -8), (24.0, -8), (25.0, 0)]:
        tilt.add(t, v)
    tilt.add(DUR, 0)
    eyes = [(0, N)]
    baked = ROOT / 'tools/baked_eyes/04_driving_b.json'
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    inten = Tr('int').add(0, 1)
    PINK, ROSE, SKY, WARM = [255, 130, 180, 0], [255, 90, 150, 40], [110, 205, 255, 0], [255, 190, 150, 90]
    fx = [breathe('idle', 1, [90, 185, 255, 40], 0, 3.0, 1 / 3.0),
          # wake word: a bright pulse around the ring
          {'id': 'wake', 'type': 'solid', 'fromSec': 3.0, 'toSec': 3.5, 'seed': 2, 'priority': 2, 'blend': 'max', 'params': {'whiteLevel': 255}},
          breathe('giggle', 3, PINK, 3.5, 7.5, 1.4),
          wave('love_a', 4, ROSE, 0, 7.5, 12.2, 0.6), wave('love_b', 5, PINK, math.pi, 7.5, 12.2, 0.6),
          breathe('shy', 6, [255, 160, 190, 60], 12.3, 16.5, 0.9),
          {'id': 'stars', 'type': 'sparkle', 'fromSec': 16.5, 'toSec': 22.0, 'seed': 7, 'priority': 1, 'blend': 'max', 'params': {'color': [255, 240, 160, 60], 'rateHz': 9, 'density': 0.45}}]
    fx += [wave('party_' + n, 20 + i, c, ph, 17.0, 22.0, 1.1) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    fx += [breathe('sweet', 8, WARM, 22.0, 28.0, 0.5), breathe('idle_b', 9, [90, 185, 255, 40], 28.0, 31.5, 1 / 3.0)]
    bright = Tr('br').add(0, BR).add(DUR, BR)
    clips = [{'id': 'hey', 'fromSec': 2.6, 'toSec': 4.4, 'assetId': 'media/hey_lieu.svg', 'visible': True},
             {'id': 'reply', 'fromSec': 4.4, 'toSec': 12.0, 'assetId': 'media/lieu_reply.svg', 'visible': True},
             {'id': 'anytime', 'fromSec': 22.2, 'toSec': 29.0, 'assetId': 'media/lieu_anytime.svg', 'visible': True}]
    opac = Tr('op').add(0, 0).add(2.6, 0).add(3.2, 0.8).add(4.0, 0.8).add(4.6, 0).add(4.9, 0).add(5.6, 0.8).add(11.0, 0.8).add(12.0, 0) \
        .add(22.2, 0).add(23.2, 0.8).add(27.6, 0.8).add(29.0, 0).add(DUR, 0)
    audio = [sfx('hey', 'sfx_cue.wav', 2.9, 0.45, 0.7), sfx('boing', 'sfx_boing.wav', 3.3, 0.5, 0.6), sfx('giggle1', 'sfx_giggle.wav', 4.8, 0.6, 0.55),
             sfx('love', 'sfx_sparkle.wav', 7.6, 1.1, 0.5), {**sfx('chime', 'intro-chime.wav', 10.6, 0.72, 0.4), 'fadeOutSec': 0.2},
             sfx('glide', 'sfx_glide.wav', 8.2, 2.8, 0.35, 0.4, 0.8), sfx('shy', 'sfx_turn.wav', 13.0, 1.5, 0.4),
             sfx('giggle2', 'sfx_giggle.wav', 17.0, 0.6, 0.55), sfx('stars', 'sfx_sparkle.wav', 16.6, 1.1, 0.5), sfx('boing2', 'sfx_boing.wav', 19.4, 0.5, 0.6),
             sfx('nod', 'sfx_nod.wav', 23.6, 0.35, 0.6), {**sfx('bye', 'intro-chime.wav', 22.1, 0.72, 0.45), 'fadeOutSec': 0.2}]
    ev = [scene(0, '대기 · 주행 중', '안내 위치(레일 중앙)에서 낮은 호흡으로 대기합니다'),
          scene(3.0, '"Hey LIEU!" 호출', '이름을 부르자 링이 번쩍! 눈이 동그래지며 호출한 사람 쪽으로 고개를 쏙 내밉니다'),
          scene(4.2, '① 깔깔 · 몸을 흔들흔들', '"네~ 불렀어요?" 웃는 눈으로 좌우로 신나게 몸을 흔듭니다'),
          scene(7.5, '② 하트 눈 · 다가오기', '하트 눈으로 천천히 몸을 살랑살랑 흔들며 앞으로 다가옵니다 (링은 분홍빛 물결)'),
          scene(10.5, '③ 윙크', '살짝 고개를 끄덕이며 윙크 한 번'),
          scene(12.3, '④ 수줍음', '부끄러워서 고개를 돌려 숙였다가, 슬쩍 다시 쳐다봅니다'),
          scene(16.5, '⑤ 별 눈 · 신나서 통통', '별 눈으로 반짝반짝, 링이 알록달록 물결치며 통통 튑니다'),
          scene(22.0, '⑥ 마무리 인사', '다정하게 목례하고 "언제든 불러주세요"를 투사합니다'),
          scene(28.0, '대기', '안내 위치로 돌아와 차분히 대기합니다'),
          (3.0, 'wake_word', {'phrase': 'Hey LIEU'})]
    build('04_driving_b', '04 Driving B', DUR,
          'PREVIEW ONLY. 주행B: 탑승자가 "Hey LIEU"를 부르면 놀란 뒤 애교 총출동(깔깔, 하트 눈, 윙크, 수줍음, 별 눈 통통, 목례). 호출 음성은 실제 음성 인식이 아니라 연출 이벤트입니다. 효과음은 합성음(tools/make_sfx.py, tools/make_sfx_cute.py).',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, fx, bright, eyes, inten, clips, opac, 0, audio, ev)


if __name__ == '__main__':
    import sys
    todo = sys.argv[1:] or ['boarding', 'driving_a', 'arrival', 'driving_b']
    for n in todo: globals()[n]()
    print('built', ', '.join(todo))
