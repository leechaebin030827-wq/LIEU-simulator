import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createConnection } from 'node:net';
import { EMOTIONS, DEFAULT_EXPORT, buildEmotionTimeline, renderGrayFrame } from './src/engine/emotions';

/** Dev-only: renders the eye emotions to a 2:1 black & white mp4 (needs ffmpeg on PATH) and saves a copy in exports/. */
const exportEmotions = (): Plugin => ({
  name: 'export-emotions',
  configureServer(server) {
    server.middlewares.use('/__export-emotions', (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const q = JSON.parse(body || '{}') as { ids?: string[]; fps?: number; minSec?: number; gapSec?: number; width?: number };
          const list = (q.ids?.length ? q.ids.map((id) => EMOTIONS.find((e) => e.id === id)).filter((e) => !!e) : EMOTIONS) as typeof EMOTIONS;
          if (!list.length) { res.statusCode = 400; res.end('no emotions'); return; }
          const o = { ...DEFAULT_EXPORT, ...(q.fps ? { fps: q.fps } : {}), ...(q.minSec !== undefined ? { minSec: q.minSec } : {}), ...(q.gapSec !== undefined ? { gapSec: q.gapSec } : {}) };
          const W = Math.max(32, Math.min(3840, Math.round((q.width ?? 1280) / 16) * 16)), H = W / 2;
          mkdirSync('exports', { recursive: true });
          const name = list.length === EMOTIONS.length ? 'all' : list.map((e) => e.id).join('+');
          const out = `exports/lieu_eyes_${name}_${W}x${H}.mp4`;
          const ff = spawn('ffmpeg', ['-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${W}x${H}`, '-r', String(o.fps), '-i', '-',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'pipe'] });
          let err = '';
          ff.stderr.on('data', (d) => { err += d; });
          ff.on('error', () => { res.statusCode = 500; res.end('ffmpeg not found'); });
          ff.on('close', (code) => {
            if (code !== 0) { res.statusCode = 500; res.end(`ffmpeg failed: ${err.slice(-400)}`); return; }
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('X-Saved-As', out);
            res.end(readFileSync(out));
          });
          ff.stdin.on('error', () => {});
          for (const f of buildEmotionTimeline(list, o)) ff.stdin.write(Buffer.from(renderGrayFrame(f.l, f.r, W, H)));
          ff.stdin.end();
        } catch (e) { res.statusCode = 400; res.end(String(e)); }
      });
    });
  },
});


/** Dev-only: keeps the motor/hardware bridge (hardware/pi) running together with the dev server, so plugging the U2D2 in is all it takes.
 *  A watcher checks the port every 3 s and starts the bridge whenever nothing answers (also right after a dev-server restart, when the
 *  old bridge is still shutting down). The bridge itself finds the port / baud and keeps looking if the cable or motor power comes and goes. */
const motorBridge = (): Plugin => ({
  name: 'lieu-motor-bridge',
  apply: 'serve',
  configureServer(server) {
    let child: ChildProcess | null = null, stopped = false;
    const listening = () => new Promise<boolean>((res) => { const c = createConnection({ port: 8787, host: '127.0.0.1' }); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
    const log = (d: Buffer) => d.toString().split('\n').filter((l) => l.trim() && !l.startsWith('  ') && !l.startsWith('---')).forEach((l) => console.log('[bridge]', l));
    const ensure = async () => {
      if (stopped || child || await listening()) return;
      child = spawn('python3', ['-m', 'lieu_hw', 'serve'], { cwd: 'hardware/pi', stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout?.on('data', log); child.stderr?.on('data', log);
      child.on('error', (e) => { console.log('[bridge] not started:', e.message); child = null; });
      child.on('exit', () => { child = null; });
    };
    const timer = setInterval(() => void ensure(), 3000);
    void ensure();
    const stop = () => { stopped = true; clearInterval(timer); child?.kill('SIGINT'); };
    server.httpServer?.on('close', stop);
    process.on('exit', stop);
  },
});

/** Dev-only: lets the Save button overwrite a built-in preset (examples/ + public/examples/). */
const savePreset = (): Plugin => ({
  name: 'save-preset',
  configureServer(server) {
    server.middlewares.use('/__save-preset', (req, res) => {
      const id = new URL(req.url ?? '', 'http://x').searchParams.get('id') ?? '';
      if (req.method !== 'POST' || !/^\d\d_[a-z0-9_]+$/.test(id)) { res.statusCode = 400; res.end('bad request'); return; }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          JSON.parse(body);
          for (const dir of ['examples', 'public/examples']) writeFileSync(`${dir}/${id}.lieu.json`, body);
          res.end('ok');
        } catch { res.statusCode = 400; res.end('invalid json'); }
      });
    });
  },
});
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), savePreset(), exportEmotions(), motorBridge()],
  server: { port: 5173, fs: { allow: ['.'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
