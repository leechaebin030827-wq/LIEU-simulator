#!/usr/bin/env python3
"""Builds the two hand-directed LIEU scenarios (PREVIEW ONLY):
   01_boarding  - car arrives, Lieu greets, checks seating, spins when the start button is pressed
   02_driving_a - construction detected, Lieu looks ahead, returns, explains the detour
Writes examples/<id>.lieu.json and public/examples/<id>.lieu.json.

Conventions (see memory notes): Lieu faces +X; yaw +  = turn toward the viewport-right in the default view;
tilt - = nose down; railX -0.25 = back, 0 = front end.
"""
import json, math, shutil
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
               'eyes': {'left': eyes_track('L', eyes), 'right': eyes_track('R', eyes), 'intensity': intensity.out()},
               'projector': {'clips': clips, 'properties': {
                   'opacity': opacity.out(),
                   'brightness': {'kind': 'numeric', 'keys': [{'id': 'pb', 'tSec': 0, 'value': 0.85, 'interpolationToNext': 'smoothstep'}]},
                   'rotationDeg': {'kind': 'numeric', 'keys': [{'id': 'pr', 'tSec': 0, 'value': rot, 'interpolationToNext': 'smoothstep'}]},
                   'scale': {'kind': 'numeric', 'keys': [{'id': 'ps', 'tSec': 0, 'value': 1, 'interpolationToNext': 'smoothstep'}]},
                   'offsetXm': {'kind': 'numeric', 'keys': [{'id': 'px', 'tSec': 0, 'value': 0, 'interpolationToNext': 'smoothstep'}]},
                   'offsetZm': {'kind': 'numeric', 'keys': [{'id': 'pz', 'tSec': 0, 'value': 0, 'interpolationToNext': 'smoothstep'}]}}},
               'audio': audio,
               'events': [{'id': f'ev{i}', 'tSec': t, 'type': ty, 'payload': pl} for i, (t, ty, pl) in enumerate(events)]}}
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
    DUR = 27
    ARR, NOD = 3.7, 4.0      # arrival at the front end, nod start
    CK = 6.4                 # check cue
    rail, yaw, tilt = Tr('rail'), Tr('yaw'), Tr('tilt')
    rail.add(0, BASE).add(0.7, BASE).add(ARR, 0).add(13.4, 0).add(16.4, BASE).add(DUR, BASE)
    yaw.add(0, 0).add(7.0, 0).add(8.4, -45).add(9.0, -45).add(11.2, 45).add(12.6, 0)
    tilt.add(0, 0).add(NOD, 0).add(NOD + 0.9, -8).add(NOD + 1.3, -8).add(NOD + 2.2, 0).add(7.0, 0).add(8.4, -10).add(9.8, -12).add(11.2, -10).add(12.6, 0)
    W0 = 18.3
    tA, tB, tC = whirl(yaw, tilt, W0)
    yaw.add(tC + 1, 0); tilt.add(tC + 1, 0)
    eyes = [(0, F2), (0.15, SM), (12.3, F2), (12.45, N), (W0 - 0.15, F2), (W0, SM), (tC, F2), (tC + 0.15, N)]
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
          scene(W0 - 0.8, '⑤ 출발 버튼이 눌림', '루가 빙그르르 돕니다 (눈이 오른쪽 끝에서 꺼지고 왼쪽에서 다시 켜짐)'),
          scene(tC + 0.5, '대기', '출발 후 기본 위치에서 대기합니다'),
          (0.3, 'vehicle_arrived', {}), (NOD, 'greeting_nod', {}), (CK, 'seat_check', {}), (W0 - 0.8, 'start_pressed', {})]
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
    glances = [(4.4, 0), (5.6, -45), (6.9, 40), (8.0, -35), (9.3, 55), (10.7, -40), (11.9, 30), (12.9, -15), (14.0, 0)]
    yaw.add(0, 0)
    for t, v in glances: yaw.add(t, v)
    yaw.add(DUR, 0)
    tilt.add(0, 0).add(4.4, 0).add(5.6, -8).add(6.9, -5).add(8.0, -12).add(9.3, -6).add(10.7, -12).add(11.9, -6).add(12.9, -9).add(14.4, -4).add(17.0, 0).add(DUR, 0)
    eyes = [(0, N)]
    inten = Tr('int').add(0, 1)
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
    ev = [scene(0, '대기 · 레일 맨 앞', 'LED 링이 낮은 밝기로 천천히 호흡하고, 루는 레일 맨 앞에서 수평으로 대기합니다'),
          scene(4.0, '공사 구간 감지 · 모니터 쪽으로 두리번', '호흡을 멈추고 밝아지며, 레일을 따라 모니터 쪽(뒤)으로 이동하면서 좌우로 빠르게 두리번거리고 고개를 까딱입니다'),
          scene(13.0, '모니터 쪽 끝 도착', '잠시 살핀 뒤 몸을 천천히 수평으로 되돌리며 안내 위치(중앙)로 돌아옵니다'),
          scene(17.5, '안내 시작', 'LED를 한 번 부드럽게 밝힌 뒤 음성 안내와 함께 바닥에 우회 경로를 투사합니다'),
          scene(22.9, '우회 경로 안내', '현재 위치 → 공사 구간 → 갈라지는 우회 경로 순으로 그려지고, 안내가 끝난 뒤에도 잠시 유지됩니다'),
          scene(27.6, '조용히 물러나기', '프로젝션이 서서히 사라지고 LED는 다시 낮은 호흡, 본체는 수평 대기 상태로 돌아갑니다'),
          (4.0, 'detour_info_received', {'reason': 'road_work', 'direction': 'right'}), (17.5, 'guidance_start', {})]
    build('02_driving_a', '02 Driving A', DUR,
          'PREVIEW ONLY. 주행A: 공사 구간 감지 -> 레일 맨 앞에서 모니터 쪽으로 물러나며 두리번 -> 안내 위치에서 음성+바닥 투사로 우회 안내 -> 조용히 대기.',
          {'railX': rail, 'yawY': yaw, 'tiltZ': tilt}, fx, bright, eyes, inten, clips, opac, 0, audio, ev)


if __name__ == '__main__':
    boarding(); driving_a(); print('built 01_boarding, 02_driving_a')
