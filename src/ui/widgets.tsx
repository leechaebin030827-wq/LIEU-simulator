import { useMemo } from 'react';
import { useStore, applyLive } from '../store';
import { evaluateSequenceAt } from '../engine/evaluate';
import { getKeys, type TrackPath } from '../engine/edit';

export function useDesired() {
  const seq = useStore((s) => s.seq), t = useStore((s) => s.tSec), live = useStore((s) => s.live);
  return useMemo(() => applyLive(evaluateSequenceAt(seq, t), live), [seq, t, live]);
}

export function useKeyedAt(path: TrackPath | null): boolean {
  const seq = useStore((s) => s.seq), t = useStore((s) => s.tSec);
  return !!path && getKeys(seq, path).some((k) => Math.abs(k.tSec - t) < 1e-3);
}

export function KeyBtn({ path }: { path: TrackPath }) {
  const add = useStore((s) => s.addKeyNow);
  const keyed = useKeyedAt(path);
  return <button className={'keybtn' + (keyed ? ' keyed' : '')} title="Add/update key (◆) at the current time" onClick={() => add(path)}>◆</button>;
}

export function NumRow(props: {
  label: string; value: number; min: number; max: number; step: number; unit?: string; digits?: number;
  onChange: (v: number) => void; path?: TrackPath; warnRange?: [number, number]; scale?: number;
}) {
  const { label, value, min, max, step, unit, onChange, path, warnRange, digits = 3 } = props;
  const bad = warnRange && (value < warnRange[0] - 1e-9 || value > warnRange[1] + 1e-9);
  return (
    <div className="row">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input type="number" step={step} value={Number(value.toFixed(digits))} onChange={(e) => onChange(Number(e.target.value))} style={bad ? { borderColor: 'var(--warn)' } : undefined} />
      <span className="dim small" style={{ width: 16 }}>{unit}</span>
      {path ? <KeyBtn path={path} /> : <span style={{ width: 20 }} />}
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return <div className="sec"><h3><span>{title}</span>{right}</h3>{children}</div>;
}

export const rgbCss = (p: readonly number[], b = 1) => {
  const r = Math.min(255, (p[0] + p[3] * 0.95) * b), g = Math.min(255, (p[1] + p[3] * 0.95) * b), bl = Math.min(255, (p[2] + p[3] * 0.9) * b);
  return `rgb(${r | 0},${g | 0},${bl | 0})`;
};
