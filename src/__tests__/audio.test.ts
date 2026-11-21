import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptySequence } from '../engine/edit';
let audio: typeof import('../runtime/audio');
let sources: any[], pans: any[];
let decode: ReturnType<typeof vi.fn>;
const node = () => ({ connect: vi.fn(function(this: unknown, target: unknown) { return target; }), disconnect: vi.fn() });
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); sources = []; pans = [];
  decode = vi.fn(async () => ({ duration: 20 }));
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 10; destination = {};
    decodeAudioData = decode;
    createBufferSource() { const n = { ...node(), start: vi.fn(), stop: vi.fn(), playbackRate: { value: 1 }, onended: null }; sources.push(n); return n; }
    createGain() { return { ...node(), gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } }; }
    createStereoPanner() { const n = { ...node(), pan: { value: 0 } }; pans.push(n); return n; }
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  audio = await import('../runtime/audio'); audio.unlockAudio();
});
afterEach(() => { audio.stopAudio(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const sequence = () => {
  const seq = emptySequence('audio');
  seq.tracks.audio = [{ id: 'sound', assetId: 'sound.wav', fromSec: 0, toSec: 10, mediaOffsetSec: 0, gain: 1, fadeInSec: 0, fadeOutSec: 0, loop: false }];
  return seq;
};
it('compensates initial decode delay instead of replaying late audio', async () => {
  let finish!: (buffer: { duration: number }) => void;
  decode.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = audio.syncAudio(sequence(), 0, true, 1, (id) => id);
  await vi.advanceTimersByTimeAsync(2000); finish({ duration: 20 }); await pending;
  const [at, offset, duration] = sources[0].start.mock.calls[0];
  expect(at).toBeCloseTo(10.03); expect(offset).toBeCloseTo(2.03); expect(duration).toBeCloseTo(7.97);
});
it('cannot start a decoded clip after stop', async () => {
  let finish!: (buffer: { duration: number }) => void;
  decode.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = audio.syncAudio(sequence(), 0, true, 1, (id) => id);
  await vi.advanceTimersByTimeAsync(0); audio.stopAudio(); finish({ duration: 20 }); await pending;
  expect(sources).toHaveLength(0);
});
it('disconnects panners and skips offsets beyond the media', async () => {
  await audio.syncAudio(sequence(), 0, true, 1, (id) => id);
  sources[0].onended(); expect(pans[0].disconnect).toHaveBeenCalled();
  const seq = sequence(); seq.tracks.audio[0].mediaOffsetSec = 30;
  await audio.syncAudio(seq, 0, true, 1, (id) => id);
  expect(sources).toHaveLength(1);
});
