import { useMemo, useState } from 'react';
import manifest from '../../config/LIEU_GLB_Node_Manifest.json';
import { useStore } from '../store';
import { STAGES, type StageId } from '../engine/types';

type MI = { nodeIndex: number; name: string; semanticCategory: string };
type Group = { rootNodeIndex: number; rootName: string; category: string; meshNodeIndices: number[] };
const meshes = manifest.meshInstances as MI[];
const groups_ = manifest.componentGroups as Group[];

const CATEGORY_LABEL: Record<string, string> = {
  rail: 'Rail', column: 'Center column', bodyLower: 'Donut body (lower)', bodyUpper: 'Donut body (upper)', bearing: 'Bearing', tiltShaft: 'Tilt shaft',
  ledDiffuser: 'LED diffuser', neopixelAssembly: 'NeoPixel ring (24)', projector: 'Projector body', projectorHolder: 'Projector holder',
  eyeGuide: 'Eye LED guide', eyeMatrix: '8x8 eye matrix', servoAssembly: 'Servo assembly', passiveIdlerAssembly: 'Idler assembly',
  motorTransmissionCandidate: 'Drive part (probable)', unknown: 'Unclassified part',
};
const EYE_RIGHT_ROOT = 11, EYE_LEFT_ROOT = 16; // KeyStudio matrices: root 16 (mirrored) holds the screen-left eye mesh (node 13)

/** Human-readable label per mesh node: Korean category, + eye side / part index within its component group. */
const LABEL: Record<number, { label: string; detail: string }> = (() => {
  const out: Record<number, { label: string; detail: string }> = {};
  for (const m of meshes) {
    const g = groups_.find((q) => q.meshNodeIndices.includes(m.nodeIndex));
    const base = CATEGORY_LABEL[m.semanticCategory] ?? m.semanticCategory;
    let label = base, detail = m.name;
    if (g && g.meshNodeIndices.length > 1) {
      const i = g.meshNodeIndices.indexOf(m.nodeIndex) + 1;
      if (g.rootNodeIndex === EYE_LEFT_ROOT) label = `Left eye · part ${i}/${g.meshNodeIndices.length}`;
      else if (g.rootNodeIndex === EYE_RIGHT_ROOT) label = `Right eye · part ${i}/${g.meshNodeIndices.length}`;
      else label = `${base} ${i}/${g.meshNodeIndices.length}`;
    }
    if (g && g.rootName !== m.name) detail = `${m.name} · ${g.rootName}`;
    out[m.nodeIndex] = { label, detail };
  }
  return out;
})();
const STAGE_LABEL: Record<StageId, string> = { fixedRail: 'Rail (static)', carriage: 'Carriage (rail X)', yaw: 'Yaw drive', tilt: 'Tilt assembly' };

export function SceneTree() {
  const owner = useStore((s) => s.rig.owner);
  const sel = useStore((s) => s.selNode);
  const setNode = useStore((s) => s.setNode);
  const setOwner = useStore((s) => s.setOwner);
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const g: Record<StageId, MI[]> = { fixedRail: [], carriage: [], yaw: [], tilt: [] };
    for (const m of meshes) if (!q || (m.name + LABEL[m.nodeIndex].label + LABEL[m.nodeIndex].detail + m.semanticCategory + m.nodeIndex).toLowerCase().includes(q.toLowerCase())) g[owner[m.nodeIndex] ?? 'fixedRail'].push(m);
    return g;
  }, [owner, q]);
  return (
    <div className="tree">
      <div className="sec"><b>Scene / Rig</b><div className="note">144 glTF nodes · 61 mesh instances · 38 unique meshes. Stage assignments are an uncalibrated <b>hypothesis</b> and can be edited. Each mesh belongs to exactly one stage.</div>
        <input type="text" placeholder="filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginTop: 6 }} /></div>
      {STAGES.map((st) => (
        <div key={st}>
          <div className="stagehd"><span>{STAGE_LABEL[st]}</span><span className="dim">{groups[st].length}</span></div>
          {groups[st].map((m) => (
            <div key={m.nodeIndex} className={'tnode' + (sel === m.nodeIndex ? ' sel' : '')} onClick={() => setNode(sel === m.nodeIndex ? null : m.nodeIndex)} title={`node ${m.nodeIndex} · ${m.name} · ${m.semanticCategory}`}>
              <span className="dim small">{m.nodeIndex}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                <span>{LABEL[m.nodeIndex].label}</span><span className="dim small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{LABEL[m.nodeIndex].detail}</span>
              </span>
              <select value={owner[m.nodeIndex] ?? 'fixedRail'} disabled={m.nodeIndex === 143} onClick={(e) => e.stopPropagation()} onChange={(e) => setOwner(m.nodeIndex, e.target.value as StageId)}>
                {STAGES.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
              </select>
            </div>
          ))}
        </div>
      ))}
      <div className="stagehd"><span>Emitters</span></div>
      <div className="tnode dim">NeoPixel ×24 (node 133, 1 mesh)</div>
      <div className="tnode dim">Eye L 8×8 (node 13) · Eye R 8×8 (node 8)</div>
      <div className="tnode dim">Projector Miniray_Beam (node 18)</div>
      <div className="note" style={{ padding: '4px 8px' }}>The speaker, webcam and sensors have no geometry in the GLB (virtual events only).</div>
    </div>
  );
}
