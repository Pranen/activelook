import { COLORS, ScreenPager, type ActiveLook, type Screen } from '@pranen/activelook';
import { $, setupDemo } from './shared';

const batteryColor = (gl: ActiveLook) =>
  gl.battery == null ? COLORS.yellow : gl.battery > 50 ? COLORS.green : gl.battery > 20 ? COLORS.amber : COLORS.red;
const batteryText = (gl: ActiveLook) => (gl.battery == null ? '--' : `${gl.battery}%`);

/** Visible area of the glasses: left/top/right/bottom edges and size. */
const area = (g: ActiveLook) => {
  const { x, y, width, height } = g.safeArea;
  return { x, y, width, height, right: x + width - 1, bottom: y + height - 1 };
};

// Each screen only draws; ScreenPager wraps render() in gl.draw() (hold → clear → render → flush).
// All positions are relative to the visible area, so a different calibration needs no changes here.
const screens: Screen[] = [
  {
    name: 'Clock',
    live: true,
    render: g => {
      const a = area(g);
      const now = new Date();
      void g.text(`Batt ${batteryText(g)}`, a.right - 110, a.y + 4, { font: 0, color: batteryColor(g) });
      void g.text(now.toLocaleTimeString('de-CH'), a.x + 12, a.y + 45, { font: 2 });
      void g.text(now.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' }), a.x + 12, a.y + 95, { font: 0 });
      void g.grey(15);
      void g.rect(a.x, a.bottom - 18, a.right, a.bottom - 4);
      void g.color(COLORS.green);
      const w = Math.round((now.getSeconds() / 60) * (a.width - 6));
      if (w > 0) void g.fillRect(a.x + 2, a.bottom - 16, a.x + 2 + w, a.bottom - 6);
    },
  },
  {
    name: 'Battery',
    live: true,
    render: g => {
      const a = area(g);
      const w = g.battery == null ? 0 : Math.round((g.battery / 100) * (a.width - 16));
      void g.text('BATTERY', a.x + 10, a.y + 6, { font: 1 });
      void g.text(batteryText(g), a.x + 10, a.y + 48, { font: 3, color: batteryColor(g) });
      void g.grey(15);
      void g.rect(a.x + 5, a.bottom - 28, a.right - 5, a.bottom - 4);
      void g.color(batteryColor(g));
      if (w > 0) void g.fillRect(a.x + 7, a.bottom - 26, a.x + 7 + w, a.bottom - 6);
    },
  },
  {
    name: 'Info',
    render: g => {
      const a = area(g);
      void g.text('ENGO 3', a.x + 12, a.y + 20, { font: 3, color: COLORS.green });
      void g.text('Temple = next', a.x + 12, a.y + 110, { font: 1 });
    },
  },
];

const label = (i: number) => `Screen ${i + 1}/${screens.length}: ${screens[i]!.name}`;
let pager: ScreenPager | null = null;

const { gl, log } = setupDemo({
  controls: ['prev', 'next'],
  onConnect: async ({ gl }) => {
    await gl.gestureDetection(true); // on ENGO 3 the temple press is reported by the gesture sensor
    pager?.stop();
    pager = new ScreenPager(gl, screens, {
      onChange: i => { $('screen').textContent = label(i); log(`→ ${screens[i]!.name}`); },
      onError: e => log(`Error: ${(e as Error).message}`),
    });
    pager.start();
    $('screen').textContent = label(0);
  },
});

gl.on('gesture', e => log(`◉ gesture ${e.value}`));
gl.on('disconnect', () => pager?.stop());
$('next').onclick = () => pager?.next();
$('prev').onclick = () => pager?.prev();
