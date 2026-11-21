import { reportIncident, setIncidentFrame } from './incidents';

/** The monitor video currently driving the robot screen, for the 활성상태 tab. */
export const videoStats = {
  el: null as HTMLVideoElement | null,
  src: '',
  seeks: 0,                 // hard re-seeks (each one costs a keyframe decode and a visible hitch)
  lastDrift: 0,             // video minus timeline, seconds
  frame: null as number | null, // index of the frame actually presented last (requestVideoFrameCallback)
  fps: 30,                  // source frame rate, measured from presented media times
};
setIncidentFrame(() => videoStats.frame);

type FrameMeta = { mediaTime: number; presentedFrames: number };
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: FrameMeta) => void) => number };

const watched = new WeakSet<HTMLVideoElement>();
/** Track the presented frame number and log stalls/drops of a monitor video (once per element). */
export function watchVideo(v: HTMLVideoElement) {
  if (watched.has(v)) return;
  watched.add(v);
  let lastMedia = -1, minStep = Infinity, lastDropped = 0, lastDropReport = 0;
  const onFrame = (_now: number, meta: FrameMeta) => {
    (v as FrameVideo).requestVideoFrameCallback?.(onFrame);
    if (lastMedia >= 0) {
      const step = meta.mediaTime - lastMedia;
      // The smallest media step between two presented frames is one source frame.
      if (step > 0.005 && step < minStep) { minStep = step; videoStats.fps = Math.round(1 / step); }
    }
    lastMedia = meta.mediaTime;
    if (videoStats.el === v) videoStats.frame = Math.round(meta.mediaTime * videoStats.fps);
    const dropped = v.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
    if (dropped > lastDropped && performance.now() - lastDropReport > 1000) {
      reportIncident('video-drop', `${dropped - lastDropped}프레임 손실`);
      lastDropped = dropped; lastDropReport = performance.now();
    }
  };
  (v as FrameVideo).requestVideoFrameCallback?.(onFrame);
  v.addEventListener('waiting', () => { if (videoStats.el === v && !v.paused) reportIncident('video-wait', '데이터 부족으로 대기'); });
  v.addEventListener('stalled', () => { if (videoStats.el === v && !v.paused) reportIncident('video-wait', '네트워크/디코더 지연'); });
}
