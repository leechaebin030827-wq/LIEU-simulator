#!/usr/bin/env python3
"""Builds the hand-directed LIEU scenarios (PREVIEW ONLY):
   01_boarding  - car arrives, Lieu greets, checks seating, spins when the start button is pressed
   02_driving_a - construction detected, Lieu looks ahead, returns, explains the detour
   03_arrival   - destination nearly reached, Lieu comes out, glances at the door side, says goodbye
   04_driving_b - "Hey LIEU" -> startled, then every cute trick (giggle, heart eyes, wink, shy, stars, bow)
   07_bonus_aegyo - bonus: every form factor at once, maximum cuteness (38 s)
   05_web_cover - web motion "cover": the 21 s eye-extractor gaze sequence (curious -> L/R/up/down -> diagonals -> eyes shut -> down -> excited) with the head following the gaze
   (run `build_scenarios.py arrival` to rebuild only one; plain run rebuilds all and overwrites saved edits)
Writes examples/<id>.lieu.json and public/examples/<id>.lieu.json.

Conventions (see memory notes): Lieu faces +X; yaw +  = turn toward the viewport-right in the default view;
tilt - = nose down; railX -0.25 = back, 0 = front end.
"""
import json
import sys
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
import sfx_mix, tv_copy, math, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZERO24 = [[0, 0, 0, 0] for _ in range(24)]
BR = 0.8    # ring brightness used everywhere (the hardware side still caps the real LEDs: Hardware panel max brightness / current budget)

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
    """illusion spin: right end (eyes off) -> fast hidden swing -> left end (eyes on) -> front. 9.2 s: every leg stays under the 60 deg/s yaw cap (cosine ease peaks at 1.5x the mean speed)."""
    A, B, C = 2.3, 4.6, 2.3
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


def build(id_, title, dur, notes, motion, ring_fx, brightness, eyes, intensity, clips, opacity, rot, audio, events, partial=None, extra=None):
    seq = {'schema': 'lieu.sequence/v1', 'id': id_, 'title': title, 'durationSec': dur, 'fps': 30, 'loop': False,
           'demoPreviewOnly': True, 'notes': notes,
           'tracks': {
               'motion': {a: motion[a].out() for a in ('railX', 'yawY', 'tiltZ', 'liftY') if a in motion},
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
    if extra: seq.update(extra)
    tv_copy.apply(seq)
    sfx_mix.apply(seq)
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
    DUR = 32.3
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
             sfx('cue4', 'sfx_cue.wav', W0 - 0.8, 0.45), sfx('spin', 'sfx_spin_long.wav', W0, tC - W0, 0.55, 0.2, 0.4),
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



# ---------------------------------------------------------------- 04 driving B: ring light show
def _fx(id, type, a, b, seed, params, prio=1, blend='max'):
    return {'id': id, 'type': type, 'fromSec': a, 'toSec': b, 'seed': seed, 'priority': prio, 'blend': blend, 'params': params}


def driving_b_ring():
    """24-LED ring for 04: one look per beat of the scene (call, giggle wiggles, heartbeat, wink flash, blush + peek, star party on the bounce beats, sweet glow).
    Colours are RGBW; white channel gives the pastel tones. Beat times match the yaw wiggles (0.7 s apart) and the chime/wink at 10.6 s."""
    PINK, ROSE, SKY, LILAC = [255, 130, 180, 0], [255, 90, 150, 40], [110, 205, 255, 0], [185, 150, 255, 0]
    PEACH, GOLD, MINT, WARM = [255, 170, 130, 80], [255, 205, 100, 60], [120, 255, 200, 0], [255, 190, 150, 90]
    BLUE = [90, 185, 255, 40]
    f = []
    # 0-3 waiting: soft blue breath with a slow cyan comet
    f += [breathe('idle', 1, BLUE, 0, 3.0, 1 / 3.0),
          _fx('idle_comet', 'chase', 0, 3.0, 11, {'color': [60, 120, 170, 0], 'speedHz': 0.15, 'width': 5, 'direction': 1})]
    # 3.0-3.5 "Hey LIEU": white flash, a fast white spin and a cyan ripple that fills the ring
    f += [_fx('wake', 'solid', 3.0, 3.5, 2, {'whiteLevel': 255}, 2),
          _fx('wake_spin', 'chase', 3.0, 3.6, 12, {'color': [255, 255, 255, 255], 'speedHz': 2.0, 'width': 7, 'direction': 1}, 3),
          _fx('wake_fill', 'progress', 3.0, 3.6, 13, {'color': [150, 220, 255, 100]}, 2)]
    # 3.5-7.5 giggle: pink glow, gold and lilac waves running opposite ways, a pulse on every wiggle (4.8 / 5.5 / 6.2), white glitter
    f += [breathe('giggle', 3, PINK, 3.5, 7.5, 1.4),
          _fx('giggle_gold', 'wave', 3.7, 5.6, 14, {'color': GOLD, 'speedHz': 1.2, 'width': 12, 'direction': 1}),
          _fx('giggle_lilac', 'wave', 4.8, 7.5, 15, {'color': LILAC, 'speedHz': 1.2, 'width': 12, 'direction': -1}),
          _fx('giggle_beat', 'pulse', 4.45, 6.9, 16, {'color': [255, 150, 200, 60], 'periodSec': 0.7}, 2),
          _fx('giggle_glitter', 'sparkle', 3.8, 7.5, 17, {'color': [255, 255, 255, 200], 'rateHz': 8, 'density': 0.14}, 3, 'add')]
    # 7.5-12.2 hearts: rose/pink waves, a lub-dub heartbeat, a warm-white flash on the wink (10.6)
    f += [wave('love_a', 4, ROSE, 0, 7.5, 12.2, 0.6), wave('love_b', 5, PINK, math.pi, 7.5, 12.2, 0.6),
          _fx('heartbeat', 'pulse', 7.5, 12.2, 18, {'color': [255, 50, 100, 0], 'periodSec': 0.9}, 2),
          _fx('wink', 'solid', 10.55, 10.85, 19, {'color': [255, 245, 200, 200]}, 4)]
    # 12.3-16.5 shy: lilac -> peach blush that breathes slowly, a soft pink dot sneaking round when it peeks back (15.4)
    f += [_fx('shy_a', 'wave', 12.3, 16.5, 20, {'color': LILAC, 'speedHz': 0.12, 'width': 24, 'direction': 1}),
          _fx('shy_b', 'wave', 12.3, 16.5, 21, {'color': PEACH, 'speedHz': 0.12, 'width': 24, 'direction': 1, 'phase': math.pi}),
          breathe('shy', 6, [255, 160, 190, 60], 12.3, 16.5, 0.5),
          _fx('peek', 'chase', 15.4, 16.5, 22, {'color': [255, 170, 200, 40], 'speedHz': 0.5, 'width': 8, 'direction': -1}, 2)]
    # 16.5-22 star party: gold glitter, four coloured waves, three comets circling in different directions, a flash on each bounce (17.1 ... 19.9)
    f += [_fx('stars', 'sparkle', 16.5, 22.0, 7, {'color': [255, 240, 160, 60], 'rateHz': 9, 'density': 0.45}),
          _fx('comet_gold', 'chase', 16.6, 22.0, 23, {'color': GOLD, 'speedHz': 0.9, 'width': 4, 'direction': 1}, 2),
          _fx('comet_mint', 'chase', 17.0, 22.0, 24, {'color': MINT, 'speedHz': 0.6, 'width': 4, 'direction': -1}, 2),
          _fx('comet_pink', 'chase', 17.0, 21.6, 25, {'color': PINK, 'speedHz': 1.2, 'width': 4, 'direction': 1}, 2),
          _fx('bounce_beat', 'pulse', 16.75, 20.25, 26, {'color': [255, 190, 110, 50], 'periodSec': 0.7}, 3)]
    f += [wave('party_' + n, 30 + i, c, ph, 17.0, 22.0, 1.1) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    # 22-28 sweet goodbye: warm breath, slow peach/rose blend, a few warm sparkles, one slow golden glow circling
    f += [breathe('sweet', 8, WARM, 22.0, 28.0, 0.5),
          _fx('sweet_a', 'wave', 22.0, 28.0, 40, {'color': PEACH, 'speedHz': 0.1, 'width': 24, 'direction': 1}),
          _fx('sweet_b', 'wave', 22.0, 28.0, 41, {'color': ROSE, 'speedHz': 0.1, 'width': 24, 'direction': 1, 'phase': math.pi}),
          _fx('sweet_glow', 'chase', 22.0, 28.0, 42, {'color': GOLD, 'speedHz': 0.12, 'width': 10, 'direction': 1}),
          _fx('sweet_sparkle', 'sparkle', 22.5, 27.5, 43, {'color': [255, 230, 190, 120], 'rateHz': 4, 'density': 0.1}, 3, 'add')]
    # 28-31.5 back to waiting
    f += [breathe('idle_b', 9, BLUE, 28.0, 31.5, 1 / 3.0), _fx('idle_b_comet', 'chase', 28.0, 31.5, 44, {'color': [60, 120, 170, 0], 'speedHz': 0.15, 'width': 5, 'direction': 1})]
    return f


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
    fx = driving_b_ring()
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


# ---------------------------------------------------------------- 05 web motion - cover
def web_cover():
    """21.0 s, same beats as the eye-extractor sequence. The head follows each gaze block (yaw +/-, tilt + = nose up) and returns to centre between blocks."""
    DUR = 21.0
    # eye-extractor sequence (same blocks as tools/bake_eyes.ts WEB_COVER): halftone "dot curve" long eyes, white, transparent bg, spacing 100 %, glow 160 %, blend 350 ms
    BLOCKS = [('mood-curious-soft', 4.0), ('mo-lookLeft', 1.6), ('mo-lookRight', 1.6), ('mo-lookUp', 1.6), ('mo-lookDown', 1.6), ('mo-upLeft', 1.7), ('mo-upRight', 1.7),
              ('mo-downLeft', 1.7), ('mo-downRight', 1.7), ('mo-closeEyes', 1.0), ('mo-lookDown', 1.6), ('mood-excited', 1.2)]
    STUDIO = {'blocks': [{'id': f'b{i}', 'assetId': a, 'seconds': d} for i, (a, d) in enumerate(BLOCKS)], 'blend': 350, 'eyeColor': '#FFFFFF', 'bg': '#000000',
              'mode': 'halftone', 'shape': 'long', 'spacing': 100, 'custom': None, 'useCustom': False, 'glow': 160}
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    # 0-4 s: the column starts turned to the left, then swirls (yaw/tilt a quarter-turn apart, fading out) round to face front.
    # 4-17.2 s: stays facing front; the look-around blocks only nudge it very subtly (yaw <= 5 deg, tilt <= 2 deg).
    # 17.2-21 s: still facing front: the whole body (visual-only liftY, not a real axis) rises a little, slips down, then rises back as the excited eyes appear.
    LOOKS = [(4.0, 1.6, -5, 0), (5.6, 1.6, 5, 0), (7.2, 1.6, 0, 2), (8.8, 1.6, 0, -2),
             (10.4, 1.7, -4, 1.5), (12.1, 1.7, 4, 1.5), (13.8, 1.7, -4, -1.5), (15.5, 1.7, 4, -1.5)]
    rail.add(0, -0.06).add(4.0, 0).add(DUR, 0)
    pts = {'yaw': [], 'tilt': []}      # (t, value, interp)
    HOLD, END = 1.0, 3.9
    for i in range(0, int(END * 30) + 1):
        t = i / 30
        u = min(1, max(0, (t - HOLD) / (END - HOLD)))
        env = math.sin(math.pi * u) if u > 0 else 0
        ph = 2 * math.pi * (t - HOLD) / 1.5
        y = -30 * (1 - es(u)) + 11 * env * math.sin(ph) * (1 - u)
        k = 1.4 * env * math.cos(ph) * (1 - u)
        pts['yaw'].append((t, y, 'linear')); pts['tilt'].append((t, k, 'linear'))
    pts['yaw'].append((END + 0.1, 0, 'smoothstep')); pts['tilt'].append((END + 0.1, 0, 'smoothstep'))
    for (t0, d, y, t) in LOOKS:
        for key, v in (('yaw', y), ('tilt', t)):
            pts[key] += [(t0, 0, 'smoothstep'), (t0 + d / 2, v, 'smoothstep'), (t0 + d, 0, 'smoothstep')]
    pts['tilt'] += [(17.2, 0, 'smoothstep'), (DUR, 0, 'smoothstep')]
    pts['yaw'] += [(17.2, 0, 'smoothstep'), (DUR, 0, 'smoothstep')]
    lift = Tr('lift')
    for t, v in [(0, 0), (17.2, 0), (18.0, 0.02), (19.2, -0.06), (20.2, 0), (DUR, 0)]: lift.add(t, v)
    for tr, key in ((yaw, 'yaw'), (tilt, 'tilt')):
        last = -1
        for t, v, ip in sorted(pts[key], key=lambda e: e[0]):
            if t > last + 1e-6: tr.add(t, v, ip); last = t
    eyes = [(0, N)]
    baked = ROOT / 'tools/baked_eyes/05_web_cover.json'
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    inten = Tr('int').add(0, 1)
    fx = [breathe('curious', 1, [90, 185, 255, 40], 0, 17.2, 1 / 3.0), breathe('rest', 2, [150, 225, 255, 70], 17.2, 19.8, 1 / 2.4)]
    fx += [wave('joy_' + n, 10 + i, c, ph, 19.8, DUR, 1.0) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    bright = Tr('br').add(0, BR).add(DUR, BR)
    opac = Tr('op').add(0, 0).add(DUR, 0)
    audio = [sfx('cue', 'sfx_cue.wav', 0.0, 0.45, 0.5), sfx('nod', 'sfx_nod.wav', 17.5, 0.35, 0.6),
             sfx('sparkle', 'sfx_sparkle.wav', 19.8, 1.1, 0.5), sfx('boing', 'sfx_boing.wav', 20.0, 0.5, 0.5)]
    ev = [scene(0, '① 살짝 호기심', '왼쪽을 보고 있다가 기둥이 빙그르르 흔들리듯 돌며 정면을 봅니다 (4.0s)'),
          scene(4.0, '② 왼쪽 · 오른쪽 보기', '정면을 응시한 채 아주 미세하게만 움직입니다 (각 1.6s)'),
          scene(7.2, '③ 위 · 아래 보기', '정면 응시, 아주 미세한 움직임 (각 1.6s)'),
          scene(10.4, '④ 대각선 보기', '왼쪽 위 → 오른쪽 위 → 왼쪽 아래 → 오른쪽 아래 (각 1.7s)'),
          scene(17.2, '⑤ 눈 감기 · 아래 보기', '정면을 본 채 몸통 전체가 살짝 올라갔다가 아래로 수웅 내려갑니다 (연출용 예외 동작)'),
          scene(19.8, '⑥ 신남', '다시 올라오며 신남 눈이 나옵니다, 링이 알록달록 물결칩니다')]
    build('05_web_cover', '05 Web Motion - Cover', DUR,
          'PREVIEW ONLY. 웹 모션 - 표지: 눈 추출기 시퀀스(21.0s, 긴 눈·간격 100%·연결 부드러움 350ms)와 같은 길이/순서에 맞춰 로봇이 시선을 따라 고개를 움직입니다.',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt, 'liftY': lift}, fx, bright, eyes, inten, [], opac, 0, audio, ev, extra={'eyeLook': {'startSec': 0, 'studio': STUDIO}})


# ---------------------------------------------------------------- 07 bonus: aegyo overload
def bonus_aegyo_ring():
    PINK, ROSE, SKY, LILAC = [255, 130, 180, 0], [255, 90, 150, 40], [110, 205, 255, 0], [185, 150, 255, 0]
    PEACH, GOLD, MINT, WARM, RED = [255, 170, 130, 80], [255, 205, 100, 60], [120, 255, 200, 0], [255, 190, 150, 90], [255, 60, 90, 0]
    BLUE = [90, 185, 255, 40]
    f = [breathe('idle', 1, BLUE, 0, 2.4, 1 / 3.0), _fx('idle_comet', 'chase', 0, 2.4, 11, {'color': [60, 120, 170, 0], 'speedHz': 0.15, 'width': 5, 'direction': 1})]
    # 2.4-6.4 entrance: white flash, four-colour rainbow spin, soft pink glow, glitter
    f += [_fx('in_flash', 'solid', 2.4, 2.8, 2, {'whiteLevel': 255}, 3),
          *[_fx(f'in_spin{i}', 'chase', 2.5, 4.6, 20 + i, {'color': c, 'speedHz': 1.5, 'width': 5, 'direction': 1, 'phase': 6 * i}, 2) for i, c in enumerate([ROSE, GOLD, MINT, SKY])],
          breathe('in_glow', 3, PINK, 4.4, 6.4, 1.0), _fx('in_glit', 'sparkle', 3.0, 6.4, 17, {'color': [255, 255, 255, 200], 'rateHz': 9, 'density': 0.15}, 3, 'add')]
    # 6.4-11 giggle wiggle: a pulse on every body wiggle (1.0 s), gold / lilac waves running opposite ways
    f += [_fx('gig_gold', 'wave', 6.4, 11.0, 30, {'color': GOLD, 'speedHz': 1.2, 'width': 12, 'direction': 1}),
          _fx('gig_lilac', 'wave', 6.4, 11.0, 31, {'color': LILAC, 'speedHz': 1.2, 'width': 12, 'direction': -1}),
          _fx('gig_beat', 'pulse', 6.72, 11.0, 32, {'color': [255, 150, 200, 60], 'periodSec': 1.3}, 2),
          _fx('gig_glit', 'sparkle', 6.4, 11.0, 33, {'color': [255, 255, 255, 220], 'rateHz': 10, 'density': 0.2}, 3, 'add')]
    # 11-15.5 heart eyes: rose / pink waves, lub-dub heartbeat, a slow pink comet
    f += [wave('love_a', 4, ROSE, 0, 11.0, 15.5, 0.6), wave('love_b', 5, PINK, math.pi, 11.0, 15.5, 0.6),
          _fx('heartbeat', 'pulse', 11.0, 15.5, 18, {'color': RED, 'periodSec': 0.9}, 2),
          _fx('love_comet', 'chase', 11.4, 15.5, 34, {'color': [255, 200, 220, 80], 'speedHz': 0.3, 'width': 6, 'direction': 1}, 2)]
    # 15.5-19 winks: a gold flash on each wink, glitter in between
    f += [breathe('wink_base', 6, PEACH, 15.5, 19.0, 0.7),
          _fx('wink_a', 'solid', 15.7, 16.0, 35, {'color': [255, 240, 190, 200]}, 4), _fx('wink_b', 'solid', 16.95, 17.2, 36, {'color': [255, 240, 190, 200]}, 4),
          _fx('wink_c', 'solid', 18.05, 18.3, 37, {'color': [255, 240, 190, 200]}, 4),
          _fx('wink_glit', 'sparkle', 15.5, 19.0, 38, {'color': GOLD, 'rateHz': 7, 'density': 0.25}, 3, 'add')]
    # 19-23.5 shy: lilac / peach blush, slow breath, a pink dot sneaks round when it peeks back
    f += [_fx('shy_a', 'wave', 19.0, 23.5, 40, {'color': LILAC, 'speedHz': 0.12, 'width': 24, 'direction': 1}),
          _fx('shy_b', 'wave', 19.0, 23.5, 41, {'color': PEACH, 'speedHz': 0.12, 'width': 24, 'direction': 1, 'phase': math.pi}),
          breathe('shy', 7, [255, 160, 190, 60], 19.0, 23.5, 0.5), _fx('peek', 'chase', 22.2, 23.5, 42, {'color': [255, 170, 200, 40], 'speedHz': 0.5, 'width': 8, 'direction': -1}, 2)]
    # 23.5-29 star party: glitter, four waves, three comets, beat on every bounce
    f += [_fx('stars', 'sparkle', 23.5, 29.0, 7, {'color': [255, 240, 160, 60], 'rateHz': 10, 'density': 0.5}),
          _fx('c_gold', 'chase', 23.6, 29.0, 43, {'color': GOLD, 'speedHz': 0.9, 'width': 4, 'direction': 1}, 2),
          _fx('c_mint', 'chase', 23.8, 29.0, 44, {'color': MINT, 'speedHz': 0.6, 'width': 4, 'direction': -1}, 2),
          _fx('c_pink', 'chase', 23.8, 28.6, 45, {'color': PINK, 'speedHz': 1.3, 'width': 4, 'direction': 1}, 2),
          _fx('party_beat', 'pulse', 23.68, 29.0, 46, {'color': [255, 190, 110, 50], 'periodSec': 1.047}, 3)]
    f += [wave('party_' + n, 50 + i, c, ph, 23.5, 29.0, 1.1) for i, (n, c, ph) in enumerate(WHIRL_COLORS)]
    # 29 - 37 TWIRL: four rainbow comets racing round the ring, the four whirl waves, white glitter, a flash when the head crosses the front
    TW = 8.0
    f += [*[_fx(f'tw_spin{i}', 'chase', 29.0, 29.0 + TW, 70 + i, {'color': c, 'speedHz': 1.8, 'width': 5, 'direction': 1, 'phase': 6 * i}, 2) for i, c in enumerate([ROSE, GOLD, MINT, SKY])],
          *[wave('tw_' + n, 80 + i, c, ph, 29.0, 29.0 + TW, 1.5) for i, (n, c, ph) in enumerate(WHIRL_COLORS)],
          _fx('tw_glit', 'sparkle', 29.0, 29.0 + TW, 75, {'color': [255, 255, 255, 220], 'rateHz': 12, 'density': 0.3}, 3, 'add'),
          _fx('tw_cross1', 'solid', 29.0 + TW / 2 - 0.12, 29.0 + TW / 2 + 0.12, 76, {'color': [255, 245, 220, 200]}, 4)]
    # 37-42 WINK BOMB: hot-pink strobe, comets racing both ways, a pink flash on every wink, pink glitter everywhere
    HOT = [255, 60, 140, 0]
    WB0 = 29.0 + TW
    f += [breathe('wb_glow', 90, HOT, WB0, WB0 + 5.0, 2.0), _fx('wb_beat', 'pulse', WB0, WB0 + 5.0, 91, {'color': [255, 110, 170, 40], 'periodSec': 0.6}, 2),
          _fx('wb_ca', 'chase', WB0, WB0 + 5.0, 92, {'color': PINK, 'speedHz': 2.5, 'width': 5, 'direction': 1}, 2),
          _fx('wb_cb', 'chase', WB0, WB0 + 5.0, 93, {'color': [255, 255, 255, 200], 'speedHz': 1.7, 'width': 4, 'direction': -1, 'phase': 12}, 2),
          _fx('wb_glit', 'sparkle', WB0, WB0 + 5.0, 94, {'color': [255, 150, 200, 120], 'rateHz': 14, 'density': 0.35}, 3, 'add'),
          *[_fx(f'wb_flash{i}', 'solid', round(t0, 2), round(t0 + 0.22, 2), 95 + i, {'color': [255, 70, 150, 120]}, 4) for i, t0 in enumerate([37.3, 38.25, 39.05, 39.85, 40.65, 41.45])]]
    # 42-50 TWIRL #2 (the other way round): comets reversed, white / pink / lilac / gold, a pink strobe, a flash when the head crosses the front
    T2 = WB0 + 5.0
    f += [*[_fx(f'tw2_spin{i}', 'chase', T2, T2 + TW, 110 + i, {'color': c, 'speedHz': 2.0, 'width': 5, 'direction': -1, 'phase': 6 * i}, 2) for i, c in enumerate([PINK, [0, 0, 0, 230], LILAC, GOLD])],
          *[_fx('tw2_' + n, 'wave', T2, T2 + TW, 120 + i, {'color': c, 'speedHz': 1.5, 'width': 24, 'direction': -1, 'phase': round(ph, 4)}) for i, (n, c, ph) in enumerate(WHIRL_COLORS)],
          _fx('tw2_strobe', 'pulse', T2, T2 + TW, 130, {'color': [255, 80, 160, 0], 'periodSec': 0.5}, 3),
          _fx('tw2_glit', 'sparkle', T2, T2 + TW, 131, {'color': [255, 255, 255, 220], 'rateHz': 13, 'density': 0.3}, 3, 'add'),
          _fx('tw2_cross', 'solid', T2 + TW / 2 - 0.12, T2 + TW / 2 + 0.12, 132, {'color': [255, 245, 220, 200]}, 4)]
    # 50-55 heart bow: warm glow, heartbeat, slow rainbow, flash on the bow
    B0 = T2 + TW
    f += [breathe('bow', 8, WARM, B0, B0 + 5.0, 0.5), _fx('bow_beat', 'pulse', B0, B0 + 5.0, 60, {'color': [255, 90, 130, 0], 'periodSec': 0.9}, 2),
          _fx('bow_rainbow', 'chase', B0, B0 + 5.0, 61, {'color': GOLD, 'speedHz': 0.25, 'width': 12, 'direction': 1}),
          _fx('bow_flash', 'solid', B0 + 2.45, B0 + 2.75, 62, {'color': [255, 235, 200, 180]}, 4),
          _fx('bow_glit', 'sparkle', B0 + 0.5, B0 + 4.5, 63, {'color': [255, 230, 190, 120], 'rateHz': 5, 'density': 0.12}, 3, 'add')]
    f += [breathe('idle_b', 9, BLUE, B0 + 5.0, B0 + 9.0, 1 / 3.0), _fx('idle_b_comet', 'chase', B0 + 5.0, B0 + 9.0, 64, {'color': [60, 120, 170, 0], 'speedHz': 0.15, 'width': 5, 'direction': 1})]
    return f


def bonus_aegyo():
    """Bonus: every form factor at once, as cute as it gets. 38 s: sleepy -> startled -> hello -> giggle-wiggle -> heart eyes -> winks -> shy -> star party -> heart bow -> calm.
    The head does not stop at extremes: yaw and tilt are continuous sine waves a quarter cycle apart (the head draws circles / rolling waves), cross-faded between scenes.
    Amplitudes are chosen so speed AND acceleration stay inside the real axes (yaw 60 deg/s & 80 deg/s^2 via tools/limit_yaw_speed.ts, tilt +-12 deg & 30 deg/s, rail 0.06 m/s)."""
    CENTER = -0.125
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    # tilt trails yaw by a quarter cycle (-pi/2) = circular wave
    Q = -math.pi / 2
    TW = 8.0   # each twirl is TW seconds long
    WB = 5.0   # wink bomb
    T1, TWB, T2 = 29.0, 29.0 + TW, 29.0 + TW + WB       # twirl 1 / wink bomb / twirl 2 start
    TB = T2 + TW                                        # heart bow starts
    DUR = TB + 9.0
    WT = 2 * math.pi / TW
    # scene = (t_start, yaw offset, yaw amp, tilt offset, tilt amp, omega rad/s, yaw phase (None = continue the previous wave in phase), tilt phase, tilt frequency multiplier)
    SC = [(0.0, -2, 8, 0, 2, 1.6, None, Q, 1),          # sleepy look-around
          (2.4, 0, 13, 3, 6, 2.0, None, Q, 1),          # hello wave
          (6.4, 0, 11.5, 0, 10.5, 2.4, None, Q, 1),     # giggle wiggle (yaw peaks every 1.3 s)
          (11.0, 0, 22, 4, 7, 1.2, None, Q, 1),         # slow heart sway
          (15.5, 16, 5, 6, 4, 2.2, None, Q, 1),         # head tilted to the side + bob (winks)
          (19.0, -28, 3, -9, 2, 1.5, None, Q, 1),       # shy: turned away and bowed
          (23.0, 0, 8, 0, 9.5, 3.0, None, Q, 1),        # star party: fast small circles
          (T1, 0, 0, 0, 5, WT, -WT * T1, Q, 2),         # TWIRL 1: the yaw swing is added below (tw); tilt is a wave at double speed
          (TWB, 0, 8, 0, 9, 3.0, None, Q, 1),           # WINK BOMB: quick head-tilting bobs
          (T2, 0, 0, 0, 5, WT, -WT * T2, Q, 2),         # TWIRL 2 (the other way round)
          (TB, 0, 27, -6.5, 5.5, 1.1, None, Q, 1),      # big slow sweep + bow
          (TB + 5.0, 0, 0, 0, 0, 1.0, None, Q, 1)]      # settle
    FADE = [1.2, 1.2, 1.6, 1.6, 2.0, 2.0, 1.6, 1.6, 1.6, 1.6, 2.4]   # cross-fade length at each scene boundary (long where the offsets differ a lot)
    def smooth(u): u = min(1, max(0, u)); return u * u * (3 - 2 * u)
    PH = [0.0]   # phase-continuous frequency changes: both waves are in phase at every scene boundary, so the cross-fade never fights itself
    for i in range(1, len(SC)):
        PH.append(SC[i][6] if SC[i][6] is not None else PH[-1] + (SC[i - 1][5] - SC[i][5]) * SC[i][0])
    def weights(t):
        w = [0.0] * len(SC); w[0] = 1.0
        for i in range(1, len(SC)):
            m = smooth((t - (SC[i][0] - FADE[i - 1] / 2)) / FADE[i - 1])  # 0 before the boundary, 1 after
            w = [x * (1 - m) for x in w]; w[i] = m
        return w
    def tw(t):  # the twirls: one slow full swing (twirl 1: right, front, left, front; twirl 2 the other way) that starts and ends at rest; amplitude 72.5 gives about +-47 deg at the highest speed/accel the yaw axis allows
        out = 0.0
        for t0, sign in ((T1, 1), (T2, -1)):
            u = (t - t0) / TW
            if 0 <= u <= 1: out += sign * 72.5 * math.sin(2 * math.pi * u) * math.sin(math.pi * u) ** 2
        return out
    def wave(t, ch):
        w = weights(t)
        if ch == 'yaw': return tw(t) +  sum(wi * (sc[1] + sc[2] * math.sin(sc[5] * t + ph)) for wi, sc, ph in zip(w, SC, PH))
        return sum(wi * (sc[3] + sc[4] * math.sin(sc[8] * (sc[5] * t + ph) + sc[7])) for wi, sc, ph in zip(w, SC, PH))
    N30 = int(DUR * 30)
    def gauss(xs, sigma=0.14):  # zero-phase smoothing: takes the corners off the cross-fades without delaying the motion
        r = int(3 * sigma * 30); k = [math.exp(-0.5 * (j / (sigma * 30)) ** 2) for j in range(-r, r + 1)]; z = sum(k)
        pad = [xs[0]] * r + xs + [xs[-1]] * r
        return [sum(pad[i + j] * k[j] for j in range(len(k))) / z for i in range(len(xs))]
    ys = gauss([wave(i / 30, 'yaw') for i in range(N30 + 1)]); ts = gauss([wave(i / 30, 'tilt') for i in range(N30 + 1)])
    for i in range(N30 + 1):
        yaw.add(i / 30, ys[i], 'linear'); tilt.add(i / 30, ts[i], 'linear')
    # rail: the lean-in path plus a small bob during the two wiggle scenes
    base = [(0, CENTER), (2.4, CENTER), (6.0, -0.03), (11.0, -0.03), (13.5, 0.0), (15.5, 0.0), (17.0, -0.02), (19.0, -0.02), (21.5, -0.11), (23.5, -0.11),
            (25.0, -0.08), (27.0, -0.10), (29.0, -0.05), (33.0, -0.02), (TWB, -0.02), (40.0, -0.06), (T2, -0.04), (46.0, -0.10), (TB, 0.0), (TB + 2.0, 0.0), (DUR, CENTER)]
    def rail_base(t):
        for (t0, v0), (t1, v1) in zip(base, base[1:]):
            if t0 <= t <= t1: return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0))
        return base[-1][1]
    for i in range(N30 + 1):
        t = i / 30
        bob = 0.012 * math.sin(2.4 * t) * smooth((t - 6.4) / 0.8) * (1 - smooth((t - 10.6) / 0.8)) + 0.012 * math.sin(3.0 * t) * smooth((t - 23.5) / 0.8) * (1 - smooth((t - 28.2) / 0.8)) + 0.01 * math.sin(3.0 * t) * smooth((t - TWB - 0.4) / 0.6) * (1 - smooth((t - T2 + 0.6) / 0.6))
        rail.add(t, min(0.0, rail_base(t) + bob), 'linear')
    eyes = [(0, N)]
    baked = ROOT / 'tools/baked_eyes/07_bonus_aegyo.json'
    if baked.exists():
        ks = json.loads(baked.read_text())
        eyes = {'left': [(k['t'], k['l']) for k in ks], 'right': [(k['t'], k['r']) for k in ks]}
    inten = Tr('int').add(0, 1)
    bright = Tr('br').add(0, BR).add(DUR, BR)
    clips = [{'id': 'hello', 'fromSec': 2.6, 'toSec': 6.4, 'assetId': 'media/aegyo_hello.svg', 'visible': True},
             {'id': 'hearts', 'fromSec': 11.0, 'toSec': 15.5, 'assetId': 'media/aegyo_hearts.svg', 'visible': True},
             {'id': 'party', 'fromSec': 23.5, 'toSec': TWB, 'assetId': 'media/aegyo_party.svg', 'visible': True},
             {'id': 'hearts3', 'fromSec': TWB, 'toSec': T2, 'assetId': 'media/aegyo_hearts.svg', 'visible': True},
             {'id': 'party2', 'fromSec': T2, 'toSec': TB, 'assetId': 'media/aegyo_party.svg', 'visible': True},
             {'id': 'hearts2', 'fromSec': TB, 'toSec': TB + 5.0, 'assetId': 'media/aegyo_hearts.svg', 'visible': True}]
    opac = Tr('op').add(0, 0).add(2.6, 0).add(3.2, 0.8).add(6.0, 0.8).add(6.4, 0).add(11.0, 0).add(11.6, 0.8).add(15.0, 0.8).add(15.5, 0) \
        .add(23.5, 0).add(24.0, 0.8).add(TWB - 0.4, 0.8).add(TWB, 0).add(TWB + 0.4, 0.8).add(T2 - 0.4, 0.8).add(T2, 0).add(T2 + 0.4, 0.8).add(TB - 0.4, 0.8).add(TB, 0).add(TB + 0.4, 0.8).add(TB + 4.6, 0.8).add(TB + 5.0, 0).add(DUR, 0)
    audio = [sfx('hey', 'sfx_cue.wav', 2.1, 0.8, 0.7), sfx('glide', 'sfx_glide.wav', 2.6, 3.4, 0.35, 0.4, 0.8), sfx('hello', 'sfx_sparkle.wav', 3.0, 1.0, 0.5),
             sfx('giggle1', 'sfx_giggle.wav', 6.6, 0.9, 0.55), *[sfx(f'boing{i}', 'sfx_boing.wav', round(7.37 + 1.3 * i, 3), 0.6, 0.5) for i in range(3)], sfx('giggle2', 'sfx_giggle.wav', 9.0, 0.9, 0.5),
             sfx('love', 'sfx_sparkle.wav', 11.2, 1.7, 0.5), {**sfx('chime', 'intro-chime.wav', 14.4, 1.0, 0.4), 'fadeOutSec': 0.2},
             sfx('wink', 'sfx_cue.wav', 15.7, 0.5, 0.55), sfx('wink2', 'sfx_cue.wav', 16.95, 0.5, 0.5), sfx('wink3', 'sfx_cue.wav', 18.05, 0.5, 0.5),
             sfx('shy', 'sfx_turn.wav', 19.3, 1.8, 0.4), sfx('peek', 'sfx_nod.wav', 22.4, 0.5, 0.5),
             sfx('stars', 'sfx_sparkle.wav', 23.6, 1.7, 0.5), sfx('giggle3', 'sfx_giggle.wav', 25.0, 0.9, 0.55), *[sfx(f'boing_p{i}', 'sfx_boing.wav', round(24.2 + 2.065 * i, 3), 0.6, 0.5) for i in range(3)],
             {**sfx('bye', 'intro-chime.wav', 29.0, 1.6, 0.45), 'fadeOutSec': 0.3}, sfx('twirl', 'sfx_spin.wav', 29.2, 5.8, 0.5, 0.5, 1.2), sfx('twirl_giggle', 'sfx_giggle.wav', 33.5, 0.9, 0.5),
             *[sfx(f'wbcue{i}', 'sfx_cue.wav', round(t0, 2), 0.5, 0.55) for i, t0 in enumerate([37.3, 38.25, 39.05, 39.85, 40.65, 41.45])], sfx('wbspark', 'sfx_sparkle.wav', 37.2, 1.7, 0.45), sfx('wbgig', 'sfx_giggle.wav', 39.6, 0.9, 0.5),
             {**sfx('chime2', 'intro-chime.wav', T2, 1.6, 0.45), 'fadeOutSec': 0.3}, sfx('twirl2', 'sfx_spin.wav', T2 + 0.2, 5.8, 0.5, 0.5, 1.2), sfx('twirl2_giggle', 'sfx_giggle.wav', T2 + 4.5, 0.9, 0.5), sfx('twirl2_boing', 'sfx_boing.wav', T2 + 6.6, 0.6, 0.5),
             sfx('bow', 'sfx_nod.wav', TB + 2.5, 0.5, 0.6), sfx('end', 'sfx_sparkle.wav', TB + 4.0, 1.7, 0.4)]
    ev = [scene(0, '으응? 누가 불렀나?', '졸린 눈으로 두리번거리다 깜짝 놀랍니다'),
          scene(2.4, '① 짠! 등장', '무지개 링이 번쩍! 레일로 쏙 나와서 고개를 갸웃, 손 흔들듯 인사합니다'),
          scene(6.4, '② 깔깔 몸 흔들기', '요와 틸트가 4분의 1박자 어긋나게 물결치며 머리가 동그라미를 그립니다 (링은 요가 끝까지 갈 때마다 번쩍)'),
          scene(11.0, '③ 하트 눈 발사', '맨 앞까지 다가와서 두근두근 하트 눈, 링은 심장박동'),
          scene(15.5, '④ 윙크 윙크 윙크', '고개를 갸웃하고 윙크를 세 번, 윙크마다 링이 번쩍'),
          scene(19.0, '⑤ 부끄러워서 숨기', '고개를 돌려 숙이고 뒤로 물러났다가 슬쩍 다시 쳐다봅니다'),
          scene(23.5, '⑥ 별 눈 파티', '모든 축이 동시에 통통! 링은 알록달록 혜성과 반짝이'),
          scene(29.0, '⑦ 빙그르르!', '소용돌이 눈으로 몸을 크게 한 바퀴 휘이익 (요는 오른쪽 끝 → 정면 → 왼쪽 끝 → 정면), 링은 무지개가 빙글빙글'),
          scene(TWB, '⑧ 윙크 폭탄 + 핑크 폭발', '윙크를 연달아 날릴 때마다 링이 핫핑크로 번쩍, 머리는 통통 갸웃갸웃'),
          scene(T2, '⑨ 이번엔 반대로 빙그르르!', '왼쪽으로 먼저 한 바퀴 더 휘이익, 링 혜성은 거꾸로 질주하고 핑크 스트로보'),
          scene(TB, '⑩ 하트 날리며 인사', '크게 좌우로 손 흔들고 깊이 목례, 하트를 투사합니다'),
          scene(TB + 5.0, '다시 대기', '안내 위치로 얌전히 돌아와 숨을 고릅니다')]
    build('07_bonus_aegyo', '07 Bonus · 애교 대폭발', DUR,
          'PREVIEW ONLY. 번외: 레일·요·틸트·눈·링·프로젝터·소리를 전부 쓰는 애교 총동원 시나리오(깔깔, 하트 눈, 윙크, 수줍음, 별 눈 파티, 빙그르르, 윙크 폭탄+핑크 폭발, 반대로 빙그르르, 하트 인사). 실물 한계 안에서 작성(요 60°/s 이하, 틸트 ±12°·30°/s 이하, 레일 0.06m/s 이하).',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, bonus_aegyo_ring(), bright, eyes, inten, clips, opac, 0, audio, ev)


if __name__ == '__main__':
    import sys
    todo = sys.argv[1:] or ['boarding', 'driving_a', 'arrival', 'driving_b', 'web_cover', 'bonus_aegyo']
    for n in todo: globals()[n]()
    print('built', ', '.join(todo))
