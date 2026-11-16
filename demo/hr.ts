import { padValue, type AlookLayout, type AlookZone } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const { gl, log, guard } = setupDemo({
  controls: ['screen'],
  onConnect: async () => {
    await gl.assets.use(); // ALooK: layouts, icons and fonts
    log('ALooK configuration selected.');
    update(true);
  },
});

// ── Heart rate state ────────────────────────────────────────────────────
let current: number | null = null;
let max: number | null = null;
let sum = 0;
let count = 0;
const average = () => (count ? Math.round(sum / count) : null);

// ── Screens built from ALooK layouts ────────────────────────────────────
interface Line {
  layout: AlookLayout;
  /** Companion-app zone; without one the layout appears where ActiveLook designed it. */
  zone?: AlookZone;
  value: () => number | null;
}
const SCREENS: Record<string, { label: string; lines: Line[] }> = {
  three: {
    label: 'Current, average, maximum (3 lines)',
    lines: [
      { layout: 'heartbeat_full', value: () => current }, // designed for the top line
      { layout: 'heartbeat_avg_full', zone: '3D Full M', value: average },
      { layout: 'heart_beat_max_full', zone: '3D Full L', value: () => max },
    ],
  },
  big: {
    label: 'Current only (large)',
    lines: [{ layout: 'heart_beat_metric_one_data', value: () => current }],
  },
};
const screenSelect = $<HTMLSelectElement>('screen');
for (const [key, s] of Object.entries(SCREENS)) screenSelect.add(new Option(s.label, key));
screenSelect.onchange = () => update(true);

// ALooK layouts are made for 4 digits: padValue() adds invisible "ghost" digits so values
// line up. No value yet → only ghosts, i.e. the icon without a number.
const text = (v: number | null) => padValue(v == null ? '' : String(v));

const lastSent = new Map<AlookLayout, string>();
let commandsSent = 0;

/** Full frame (clear + all lines) or only the lines whose value changed. */
async function render(full: boolean): Promise<void> {
  if (!gl.connected) return;
  const lines = SCREENS[screenSelect.value]!.lines.map(line => ({ line, text: text(line.value()) }));
  if (full) lastSent.clear();
  const changed = lines.filter(l => lastSent.get(l.line.layout) !== l.text);
  if (!changed.length) return;
  await gl.draw(async g => {
    for (const { line, text } of changed) {
      await (line.zone
        ? g.assets.showLayoutInZone(line.layout, line.zone, text)
        : g.assets.showLayout(line.layout, text));
      lastSent.set(line.layout, text);
    }
  }, { clear: full });
  commandsSent += changed.length;
}

// Only one render at a time; values arriving meanwhile are folded into the next one.
let rendering = false;
let pending = false;
let pendingFull = false;
async function update(full = false): Promise<void> {
  pending = true;
  pendingFull ||= full;
  if (rendering) return;
  rendering = true;
  try {
    while (pending) {
      const f = pendingFull;
      pending = pendingFull = false;
      await render(f);
    }
  } catch (e) {
    log(`Error: ${(e as Error).message}`);
  } finally {
    rendering = false;
  }
}

function sample(bpm: number): void {
  current = bpm;
  sum += bpm;
  count++;
  max = Math.max(max ?? 0, bpm);
  $('preview').textContent = `${bpm} bpm`;
  $('stats').textContent = `average ${average()} · max ${max} · ${count} values · ${commandsSent} layout commands sent`;
  void update();
}

$('reset').onclick = () => {
  sum = 0;
  count = 0;
  max = null;
  $('stats').textContent = 'Average and maximum reset.';
  void update();
};

// ── Heart rate sensor (standard BLE Heart Rate Service) ─────────────────
// Full UUIDs: Bluefy on iOS does not accept the 16-bit short forms.
const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';

$('sensor').onclick = guard(async () => {
  if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available (needs https; on iPhone use Bluefy)');
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
  const server = await device.gatt!.connect();
  const ch = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT);
  ch.addEventListener('characteristicvaluechanged', () => {
    const v = ch.value!;
    sample(v.getUint8(0) & 0x01 ? v.getUint16(1, true) : v.getUint8(1)); // flag bit 0: 16-bit value
  });
  await ch.startNotifications();
  device.addEventListener('gattserverdisconnected', () => log('Heart rate sensor disconnected.'));
  log(`Heart rate sensor connected: ${device.name ?? 'unnamed'}.`);
});

// ── Simulation ──────────────────────────────────────────────────────────
const simBpm = $<HTMLInputElement>('simBpm');
simBpm.oninput = () => { $('simText').textContent = `${simBpm.value} bpm`; };
let simTimer: ReturnType<typeof setInterval> | null = null;
$<HTMLInputElement>('sim').onchange = e => {
  if (simTimer) clearInterval(simTimer);
  simTimer = null;
  if ((e.target as HTMLInputElement).checked) {
    simTimer = setInterval(() => sample(Number(simBpm.value) + Math.round((Math.random() - 0.5) * 6)), 1000);
  }
};
