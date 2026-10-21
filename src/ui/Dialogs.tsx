import { useEffect } from 'react';
import { useUi, closeHelp } from './ui-store';

export function Dialogs() {
  const { dialog, toasts, help } = useUi();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = useUi.getState().dialog;
      if (d && e.key === 'Escape') d.resolve(false);
      else if (d && e.key === 'Enter') d.resolve(true);
      else if (useUi.getState().help && e.key === 'Escape') closeHelp();
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      {dialog && (
        <div className="overlay" onMouseDown={() => dialog.resolve(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2>{dialog.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{dialog.body}</p>
            <div className="modal-actions">
              <button onClick={() => dialog.resolve(false)}>{dialog.cancelLabel}</button>
              <button className={dialog.danger ? 'danger' : 'on'} autoFocus onClick={() => dialog.resolve(true)}>{dialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
      {help && <Help />}
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={'toastmsg ' + t.kind}>{t.msg}</div>)}</div>
    </>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>;

function Help() {
  return (
    <div className="overlay" onMouseDown={closeHelp}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2>How to use the LIEU Sequence Editor</h2>
        <p className="dim">A tool for building and previewing the robot's <b>motion, LEDs, eyes, projector and sound</b> on a single timeline. Nothing is sent to the real robot (PREVIEW ONLY).</p>
        <div className="helpgrid">
          <div>
            <h3>Quick start</h3>
            <ol>
              <li>Load Boarding from <b>Examples</b>, or start an empty sequence with <b>New</b>.</li>
              <li>Move the red line (playhead) in the <b>timeline</b> below to the time you want. Click or drag on the ruler.</li>
              <li>Change values in the <b>inspector</b> on the right. <b>With Auto-key on</b>, a key (◆) is recorded automatically at that time.</li>
              <li>▶ <b>Play</b>(Space) plays all channels together. Any point in time always looks the same.</li>
              <li>Use <b>Save</b> at the top left to download a file (.lieu.json). Your work is also autosaved in this browser.</li>
            </ol>
            <h3>Common actions</h3>
            <ul>
              <li><b>Add a key:</b> double-click a timeline row, or use the ◆ button next to a value</li>
              <li><b>Move a key:</b> drag the ◆ (Shift+click to select several)</li>
              <li><b>Delete a key:</b> select it, then press <Kbd>Delete</Kbd></li>
              <li><b>Effect, video and sound clips:</b> drag within their row to move; drag either end to resize</li>
              <li><b>LED:</b> in the LED Ring tab, click an LED (Shift = several) and adjust R/G/B/W</li>
              <li><b>Eyes:</b> in the Eyes tab, click/drag the 8×8 dots to draw, or use the preset buttons</li>
            </ul>
          </div>
          <div>
            <h3>Keyboard shortcuts</h3>
            <table className="keys"><tbody>
              <tr><td><Kbd>Space</Kbd></td><td>Play / Pause</td></tr>
              <tr><td><Kbd>←</Kbd> <Kbd>→</Kbd></td><td>Step one frame</td></tr>
              <tr><td><Kbd>Ctrl/⌘</Kbd>+<Kbd>Z</Kbd></td><td>Undo</td></tr>
              <tr><td><Kbd>Ctrl/⌘</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd></td><td>Redo</td></tr>
              <tr><td><Kbd>Ctrl/⌘</Kbd>+<Kbd>S</Kbd></td><td>Save to file (.lieu.json)</td></tr>
              <tr><td><Kbd>Delete</Kbd></td><td>Delete selected keys/clips</td></tr>
              <tr><td><Kbd>Ctrl/⌘</Kbd>+<Kbd>C</Kbd> / <Kbd>V</Kbd></td><td>Copy selected keys / paste at current time</td></tr>
              <tr><td><Kbd>Esc</Kbd></td><td>Exit Present mode / close dialog</td></tr>
            </tbody></table>
            <h3>Good to know</h3>
            <ul>
              <li>With <b>Auto-key off</b>, changed values become an unsaved temporary preview (<span className="warn">LIVE</span>) that disappears when you move the time.</li>
              <li><b>Tilt is limited to ±15°</b>. The other Preview limits (Rail, Yaw) are demo values, not the real mechanism's safe range.</li>
              <li>The eye board's real I²C address, LED 0 / byte order, projector optics and motor specs are <b>still UNKNOWN</b>, and are saved as unknown in the file.</li>
              <li>Reloading the browser restores your last work, but <b>uploaded image/audio files are not restored.</b> Save important work as a <b>ZIP</b>.</li>
              <li>In <b>Scene / Rig</b> on the left, you can change which stage (fixed, Yaw, Tilt) each part belongs to.</li>
            </ul>
          </div>
        </div>
        <div className="modal-actions"><button className="on" autoFocus onClick={closeHelp}>Get started</button></div>
      </div>
    </div>
  );
}
