import { ActiveLook, MockTransport } from '@pranen/activelook';
import './style.css';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

export interface Demo {
  gl: ActiveLook;
  log: (message: string) => void;
  /** Wraps an async handler: errors are logged instead of thrown. */
  guard: <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => Promise<void>;
}

/**
 * Wires the #connect button and #log element.
 * URL flags: `?debug` logs every frame, `?mock` runs without glasses.
 */
export function setupDemo(options: { controls?: string[]; onConnect?: (demo: Demo) => void | Promise<void> } = {}): Demo {
  const params = new URLSearchParams(location.search);
  const logEl = $('log');
  const log = (m: string) => {
    logEl.textContent += `\n${m}`;
    logEl.scrollTop = logEl.scrollHeight;
  };
  const writeMode = params.get('write');
  const gl = new ActiveLook({
    log,
    verbose: params.has('debug'),
    keepAwake: true,
    transport: params.has('mock') ? new MockTransport({ battery: 76 }) : undefined,
    bluetooth: writeMode === 'auto' || writeMode === 'noResponse' || writeMode === 'response' ? { writeMode } : {},
  });
  gl.on('error', e => log(`⚠ Device: ${e.message}`));
  if (writeMode) log(`Write mode: ${writeMode}`);
  const guard: Demo['guard'] = fn => async (...args) => {
    try { await fn(...args); }
    catch (e) { log(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const demo: Demo = { gl, log, guard };

  const setEnabled = (on: boolean) =>
    options.controls?.forEach(id => { $<HTMLButtonElement>(id).disabled = !on; });
  setEnabled(false);

  const button = $<HTMLButtonElement>('connect');
  button.onclick = guard(async () => {
    if (gl.connected) { gl.disconnect(); return; }
    await gl.connect();
    button.textContent = 'Disconnect';
    setEnabled(true);
    await options.onConnect?.(demo);
  });
  gl.on('disconnect', () => {
    button.textContent = 'Connect glasses';
    setEnabled(false);
  });
  if (params.has('mock')) log('Mock mode: no glasses needed, commands go nowhere.');
  return demo;
}
