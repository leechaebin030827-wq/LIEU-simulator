import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { LieuSequence, RigState } from './types';
import { LED_COUNT } from './types';

export const PROJECT_SCHEMA = 'lieu.project/v1';
export type AssetRecord = { assetId: string; filename: string; mime: string; builtin?: boolean };
export type CalibrationStatus = {
  verifiedOnHardware: false;
  unknowns: Record<string, null | 'UNKNOWN'>;
};
export type ProjectFile = {
  schema: typeof PROJECT_SCHEMA;
  sequence: LieuSequence;
  rig: RigState;
  assets: AssetRecord[];
  calibrationStatus: CalibrationStatus;
};

/** All of these remain unknown; they round-trip through export/import untouched. */
export const UNKNOWN_CALIBRATION: CalibrationStatus = {
  verifiedOnHardware: false,
  unknowns: {
    ledPhysicalIndex0: null, ledByteOrder: 'UNKNOWN', ledChipset: null,
    eyeLeftI2cAddress: null, eyeRightI2cAddress: null, eyeRowColMap: null,
    projectorThrowRatio: null, railPhysicalStrokeM: null, motorModels: null, gearRatio: null,
  },
};

export class ValidationError extends Error {}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkKeys(name: string, keys: unknown, each: (v: unknown) => boolean) {
  if (!Array.isArray(keys)) throw new ValidationError(`${name}: keys not an array`);
  for (const k of keys) {
    if (!k || typeof k.id !== 'string' || !isNum(k.tSec) || !each(k.value)) throw new ValidationError(`${name}: bad keyframe ${JSON.stringify(k)?.slice(0, 80)}`);
  }
}

/** Runtime check of the LieuSequence contract (Zod-equivalent, dependency free). Throws ValidationError. */
export function validateSequence(s: any): LieuSequence {
  if (!s || s.schema !== 'lieu.sequence/v1') throw new ValidationError('schema must be lieu.sequence/v1');
  if (typeof s.id !== 'string' || typeof s.title !== 'string') throw new ValidationError('id/title missing');
  if (!isNum(s.durationSec) || s.durationSec <= 0 || !isNum(s.fps)) throw new ValidationError('duration/fps invalid');
  const T = s.tracks;
  if (!T) throw new ValidationError('tracks missing');
  for (const c of ['railX', 'yawY', 'tiltZ']) checkKeys(`motion.${c}`, T.motion?.[c]?.keys, isNum);
  checkKeys('ring24.baseFrames', T.ring24?.baseFrames?.keys, (v) => Array.isArray(v) && v.length === LED_COUNT && v.every((p) => Array.isArray(p) && p.length === 4 && p.every((x) => isNum(x) && x >= 0 && x <= 255)));
  checkKeys('ring24.brightness', T.ring24?.brightness?.keys, isNum);
  if (!Array.isArray(T.ring24?.effects)) throw new ValidationError('ring24.effects');
  for (const side of ['left', 'right']) checkKeys(`eyes.${side}`, T.eyes?.[side]?.keys, (v) => Array.isArray(v) && v.length === 8 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255));
  checkKeys('eyes.intensity', T.eyes?.intensity?.keys, isNum);
  if (!Array.isArray(T.projector?.clips) || !T.projector?.properties) throw new ValidationError('projector');
  if (!Array.isArray(T.audio) || !Array.isArray(T.events)) throw new ValidationError('audio/events');
  return s as LieuSequence;
}

/** Version migration hook. v1 is current; unknown future versions are rejected rather than guessed. */
export function migrate(raw: any): ProjectFile | { sequence: LieuSequence } {
  if (raw?.schema === PROJECT_SCHEMA) { validateSequence(raw.sequence); return raw as ProjectFile; }
  if (raw?.schema === 'lieu.sequence/v1') return { sequence: validateSequence(raw) };
  throw new ValidationError(`Unsupported schema: ${raw?.schema}`);
}

export function serializeProject(p: ProjectFile): string { return JSON.stringify(p, null, 2); }

export function buildZip(p: ProjectFile, blobs: Record<string, Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array> = { 'project.lieu.json': strToU8(serializeProject(p)) };
  for (const a of p.assets) if (!a.builtin && blobs[a.assetId]) files[`assets/${a.assetId.replace(/[^\w.\-]/g, '_')}`] = blobs[a.assetId];
  return zipSync(files);
}

export function readZip(data: Uint8Array): { project: any; blobs: Record<string, Uint8Array> } {
  const files = unzipSync(data);
  const proj = files['project.lieu.json'];
  if (!proj) throw new ValidationError('project.lieu.json missing in zip');
  const blobs: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) if (name.startsWith('assets/')) blobs[name.slice(7)] = bytes;
  return { project: JSON.parse(strFromU8(proj)), blobs };
}
