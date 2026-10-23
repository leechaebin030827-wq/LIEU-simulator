import type { MoodId, Mode, Project, Timeline } from './engine/types';
import { defaultProject, emptyTimeline } from './engine/params';
import { MOTION_BY_ID, makeMotionEvent } from './engine/motions';
import { uid } from './engine/util';
import { evaluateEye } from './engine/controller';
import { generateMatrixFrame } from './render/matrixRenderer';
import { gridToPattern } from './engine/patterns';

/** An "emotion asset": a mood to hold and/or a motion to play. Blocks are placed back to back. */
export interface Asset {
  id: string;
  label: string;
  group: '감정' | '동작' | '시선' | '이모지';
  symbol?: string;
  mood?: MoodId;
  strength?: number;
  motion?: string;
  seconds: number; // default length
  dirX?: number;
  min: number;
  max: number;
}

const mood = (id: MoodId, label: string, s = 100, key = ''): Asset => ({ id: `mood-${id}${key}`, label, group: '감정', mood: id, strength: s, seconds: 3, min: 0.8, max: 12 });
const move = (id: string, label: string, group: Asset['group'] = '동작', m?: MoodId, extra: Partial<Asset> = {}): Asset => {
  const d = MOTION_BY_ID[id].defaults.duration / 1000;
  return { id: `mo-${id}${extra.dirX !== undefined ? (extra.dirX < 0 ? '-l' : '-r') : ''}`, label, group, motion: id, mood: m, strength: 100, seconds: d, min: Math.max(0.2, d * 0.5), max: d * 3, ...extra };
};

export const ASSETS: Asset[] = [
  // ── 감정 (표정을 유지) ──
  mood('default', '기본'), mood('happy', '행복'), mood('happy', '살짝 행복', 45, '-soft'), mood('excited', '신남'), mood('shy', '수줍음'),
  mood('calm', '차분'), mood('reassuring', '안심'), mood('curious', '호기심'), mood('attentive', '집중'), mood('surprised', '놀람'),
  mood('worried', '걱정'), mood('sad', '슬픔'), mood('sad', '살짝 슬픔', 45, '-soft'), mood('tired', '피곤'), mood('sleepy', '졸림'),
  mood('bored', '지루함'), mood('smug', '우쭐'), mood('suspicious', '의심'), mood('irritated', '짜증'), mood('angry', '화남'),
  mood('angry', '살짝 화남', 45, '-soft'), mood('curious', '살짝 호기심', 45, '-soft'),
  // ── 동작 ──
  move('gentleGreeting', '인사', '동작', 'happy'), move('nod', '끄덕임'), move('shakeNo', '아니요'), move('wakeUp', '깨어나기'),
  move('sleep', '잠들기', '동작', 'sleepy'), move('yawn', '하품', '동작', 'sleepy'), move('laugh', '웃음', '동작', 'happy'),
  move('joyBounce', '기쁨 반짝', '동작', 'happy'), move('excited', '신남 통통', '동작', 'excited'), move('surprise', '놀람 깜짝', '동작', 'surprised'),
  move('confused', '혼란'), move('thinking', '생각 중', '동작', 'attentive'), move('shy', '수줍어하기', '동작', 'shy'),
  move('proud', '우쭐대기', '동작', 'smug'), move('cry', '울먹임', '동작', 'sad'), move('worry', '걱정 떨림', '동작', 'worried'),
  move('squint', '찡그림', '동작', 'irritated'), move('glare', '노려보기', '동작', 'angry'), move('attentiveListening', '경청', '동작', 'attentive'),
  move('curiousInspection', '살펴보기', '동작', 'curious'), move('calmBreathing', '숨쉬기', '동작', 'calm'),
  move('blink', '깜빡임'), move('doubleBlink', '두 번 깜빡'), move('tripleBlink', '연속 깜빡'), move('closeEyes', '눈 감기'),
  move('sleepyBlink', '졸린 깜빡임', '동작', 'sleepy'), move('reassuringBlink', '안심 깜빡임', '동작', 'reassuring'),
  move('winkLeft', '윙크 ◀'), move('winkRight', '윙크 ▶'), move('happyWink', '웃으며 윙크', '동작', 'happy'),
  move('passengerAttention', '대상 주목 ▶', '동작', 'attentive'), move('passengerAttention', '대상 주목 ◀', '동작', 'attentive', { dirX: -1 }),
  // ── 시선 ──
  move('lookLeft', '왼쪽 보기', '시선'), move('lookRight', '오른쪽 보기', '시선'), move('lookUp', '위 보기', '시선'), move('lookDown', '아래 보기', '시선'),
  move('upLeft', '왼쪽 위 보기', '시선'), move('upRight', '오른쪽 위 보기', '시선'), move('downLeft', '왼쪽 아래 보기', '시선'), move('downRight', '오른쪽 아래 보기', '시선'),
  move('glanceLeftQuick', '왼쪽 힐끗', '시선'), move('glanceRightQuick', '오른쪽 힐끗', '시선'), move('peek', '살짝 엿보기', '시선'),
  move('sideGlance', '곁눈질', '시선', 'suspicious'), move('lookAround', '두리번', '시선'), move('sweep', '훑어보기 ▶', '시선'),
  move('sweepBack', '훑어보기 ◀', '시선'), move('scanVertical', '위아래 훑기', '시선'), move('rollEyes', '눈 굴리기', '시선', 'bored'),
  move('rollEyesBack', '눈 굴리기 ↺', '시선'), move('lookForwardReturn', '정면 보기', '시선'), move('focusStare', '정면 응시', '시선', 'attentive'),
  move('lookDownSad', '고개 숙임', '시선', 'sad'),
];
const emoji = (symbol: string, label: string): Asset => ({ id: `sym-${symbol}`, label, group: '이모지', symbol, seconds: 2.5, min: 0.8, max: 12 });
ASSETS.push(
  emoji('heart', '하트 눈 ❤'), emoji('star', '별 눈 ★'), emoji('sparkle', '반짝 눈 ✦'), emoji('joy', '기쁨 ^ ^'), emoji('cheer', '신남 > <'),
  emoji('dizzy', 'X 눈'), emoji('spiral', '어지러움 @'), emoji('sleep', '졸음 - -'), emoji('cry', '울음 ˘ ˘'), emoji('ring', '놀람 O O'),
  emoji('moon', '달 눈'), emoji('dot', '점 눈'), emoji('diamond', '다이아 눈'), emoji('wink', '윙크 ^ -'), emoji('bigeye', '왕눈'),
);
export const ASSET_BY_ID = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

export interface Block { id: string; assetId: string; seconds: number }
export type Style = 'matrix' | 'freeform' | 'halftone' | 'halftoneGrid';
export interface Sequence { blocks: Block[]; blend: number; eyeColor: string; bg: string; mode: Style; shape: 'round' | 'long'; spacing: number; custom: { left: string[]; right: string[] } | null; useCustom: boolean; glow: number }

export const newBlock = (assetId: string): Block => ({ id: uid('b'), assetId, seconds: ASSET_BY_ID[assetId]?.seconds ?? 2 });

export const defaultSequence = (): Sequence => ({
  blocks: ['mo-wakeUp', 'mo-gentleGreeting', 'mood-calm', 'mo-curiousInspection', 'mo-passengerAttention', 'mo-reassuringBlink', 'mood-default'].map(newBlock),
  blend: 450, eyeColor: '#FFFFFF', bg: '#000000', mode: 'halftone', shape: 'long', spacing: 115, custom: null, useCustom: false, glow: 100,
});

export const totalMs = (s: Sequence) => Math.max(500, Math.round(s.blocks.reduce((a, b) => a + b.seconds * 1000, 0)));

/**
 * Compile blocks into a timeline. Moods cross-fade across block boundaries (keys sit `blend` ms inside each block),
 * motions fade in/out with the same blend, gaze returns to where it was (motion curves start/end at the live gaze),
 * and seeded idle drift + auto-blink keep running underneath so the cuts feel continuous.
 */
export function compile(seq: Sequence): Timeline {
  const tl = emptyTimeline(totalMs(seq));
  tl.loop = true;
  let t = 0;
  let current: { mood: MoodId; strength: number } = { mood: 'default', strength: 100 };
  for (const b of seq.blocks) {
    const a = ASSET_BY_ID[b.assetId];
    if (!a) continue;
    const d = b.seconds * 1000;
    if (a.mood) current = { mood: a.mood, strength: a.strength ?? 100 };
    const T = Math.min(seq.blend, d / 2);
    const ease = { type: 'easeInOut' as const };
    tl.tracks.mood.push(
      { id: uid('k'), t: Math.round(t + T), mood: current.mood, strength: current.strength, ease },
      { id: uid('k'), t: Math.round(t + d - T), mood: current.mood, strength: current.strength, ease },
    );
    if (a.symbol) tl.tracks.symbols.push({ id: uid('s'), t: Math.round(t), duration: Math.round(d), symbol: a.symbol, fade: Math.round(Math.max(60, Math.min(seq.blend, d / 3))) });
    if (a.motion) {
      tl.tracks.motions.push(makeMotionEvent(a.motion, Math.round(t), {
        duration: Math.round(d), speed: 1, loop: false, dirX: a.dirX ?? 1, transition: Math.round(Math.min(seq.blend, d / 3)),
      }));
    }
    t += d;
  }
  tl.tracks.mood.sort((x, y) => x.t - y.t);
  return tl;
}

/** The still default eye of a preset shape as two 8×8 patterns (starting point for the custom eye editor). */
export function presetEyePattern(shape: 'round' | 'long'): { left: string[]; right: string[] } {
  const p = buildProject({ ...defaultSequence(), blocks: [], shape, useCustom: false, custom: null, mode: 'matrix', glow: 100 });
  const f = evaluateEye(p, 0, 'matrix');
  const mf = generateMatrixFrame(f, p.matrix.geometry);
  return { left: gridToPattern(mf.left), right: gridToPattern(mf.right) };
}

export function buildProject(seq: Sequence): Project {
  const p = defaultProject();
  p.mode = seq.mode === 'matrix' ? 'matrix' : 'freeform';
  if (seq.mode === 'halftone') p.variant = 'halftone';
  if (seq.mode === 'halftoneGrid') p.variant = 'halftoneGrid';
  p.timeline = compile(seq);
  p.matrix.physical.ledColor = seq.eyeColor;
  p.matrix.physical.dimensions = false;
  p.matrix.physical.gridVisible = true;
  p.freeform.geometry.eyeColor = seq.eyeColor;
  const glow = (seq.glow ?? 100) / 100;
  p.matrix.physical.glow = glow;
  p.freeform.geometry.glow = Math.min(1.5, 0.45 * glow);
  if (seq.shape === 'long') {
    // tall pill eyes
    const m = p.matrix.geometry; m.leftW = 3; m.rightW = 3; m.eyeH = 6; m.corner = 1;
    const f = p.freeform.geometry; f.widthL = f.widthR = 160; f.heightL = f.heightR = 320; f.pill = true; f.spacing = 180;  // 1:2, fully round ends
  }
  if (seq.useCustom && seq.custom) { p.matrix.geometry.customL = seq.custom.left; p.matrix.geometry.customR = seq.custom.right; }
  // eye spacing: percentage of the default (freeform: eye spacing, matrix: physical gap between the two modules)
  const k = (seq.spacing ?? 100) / 100;
  p.freeform.geometry.spacing *= k;
  p.matrix.physical.gap = Math.round(p.matrix.physical.gap * k * 10) / 10;
  // an empty timeline shows a perfectly still eye (no drift, saccades or blinks)
  const empty = seq.blocks.length === 0;
  p.shared.autoBlink = !empty;
  p.shared.idle = !empty;
  p.shared.microSaccade = empty ? 0 : p.shared.microSaccade;
  return p;
}
