// npx vite-node tools/check_limits.ts <scenario ids...>  -> prints PREVIEW-limit warnings of the built example sequences
import { readFileSync } from 'node:fs';
import { validateSequence } from '../src/engine/project';
import { motionWarnings } from '../src/engine/limits';
for (const id of process.argv.slice(2)) {
  const seq = validateSequence(JSON.parse(readFileSync(`examples/${id}.lieu.json`, 'utf8')));
  const w = motionWarnings(seq);
  console.log(id, w.length ? w : 'no limit warnings');
}
