# @pranen/activelook

Unofficial TypeScript library for **ActiveLook** smart glasses (e.g. **ENGO 3**) over **Web Bluetooth**.
Draw text and graphics on the glasses, react to the temple button and gesture sensor, and query the
device, straight from a web page, with no native app.

> Not affiliated with ActiveLook, Microoled or ENGO. Protocol based on the public
> [ActiveLook API documentation](https://github.com/ActiveLook/Activelook-API-Documentation/blob/main/ActiveLook_API.md)
> (firmware 4.12) and on calibration with a real ENGO 3.

**Demos:** https://pranen.github.io/activelook/ (add `?mock` to try them without glasses).

## Requirements

Web Bluetooth needs a **secure context** (https or `localhost`) and a supporting browser:
Chrome or Edge on desktop and Android. On **iPhone** only the **[Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055)**
browser works; Safari has no Web Bluetooth. `connect()` must be called from a user gesture (click/tap).

## Install

```bash
npm install @pranen/activelook
```

Without a build step, load the IIFE bundle:

```html
<script src="https://cdn.jsdelivr.net/npm/@pranen/activelook@0.1.0/dist/index.global.js"></script>
<script>
  const { ActiveLook, COLORS } = window.ActiveLookLib;
</script>
```

## Quick start

```ts
import { ActiveLook, COLORS } from '@pranen/activelook';

const gl = new ActiveLook({ log: console.log });

button.onclick = async () => {
  await gl.connect(); // opens the Bluetooth device chooser

  // hold → clear → draw → flush: the frame appears at once, without flicker
  const { x, y, width, height } = gl.safeArea; // visible part of the display
  await gl.draw(g => {
    g.text('Hello', x + 15, y + 20, { font: 2 });
    g.text(`Battery ${g.battery}%`, x + 15, y + 80, { font: 0, color: COLORS.green });
    g.rect(x, y, x + width - 1, y + height - 1);
  });
};

gl.on('gesture', e => console.log('temple press / gesture', e.value));
gl.on('disconnect', () => console.log('gone'));
```

Commands are queued and sent in order, so you don't need to `await` each drawing call;
await the last one (or `gl.idle()`) when you need to know everything has been written.

## Coordinates

All coordinates are **logical**: origin **top-left as the wearer sees it**, x to the right, y down.
The device profile converts them to device coordinates. ENGO 3 mirrors both axes, and only part
of the 304×256 panel is visible:

| | ENGO 3 |
|---|---|
| Resolution | 304 × 256 |
| Visible area (`gl.safeArea`) | about x 0–267, y 0–249 at picture shift (0, 0); x 3–270, y 30–255 at (3, 30) |
| Fonts (firmware 4.13) | ids 0–7, line heights 24 / 24 / 38 / 64 / 75 / 82 / 32 / 48 px, printable ASCII only. The API docs list other heights; the library reads the real ones on connect (`gl.fonts.installed`). |
| Colours | 81 red-green colours (no blue/white), or 16 grey levels; neighbouring shades are hard to tell apart on the glasses |

Lay out screens relative to `gl.safeArea` instead of fixed numbers. The visible area depends on
the **picture shift stored on the glasses** (`gl.settings.shiftX/shiftY`, set for example by the
ENGO app's display position; the app shows device shift (3, 30) as x −3, y 30, i.e. it negates x).
The ENGO 3 profile stores the area measured at shift (0, 0) (`safeArea` with `safeAreaShift`).
On connect the library reads the actual shift and moves `gl.safeArea` accordingly, clipped to
the panel, so layouts based on it stay inside the visible part. Measurements at shifts (0, 0)
and (3, 30) confirmed this. To calibrate
other glasses, use the **calibrate** demo: it shows and sets the shift, measures the area and
prints a `defineProfile(...)` snippet.

`text()` positions the **top-left corner** of the text and converts umlauts and accents to ASCII
(`ä` → `ae`); pass `{ transliterate: false }` to send raw bytes.

Other glasses or a different calibration: `defineProfile(ENGO3, { safeArea: { ... }, flipX: false })`.

## API overview

**Connection:** `connect()`, `disconnect()`, `connected`, `deviceInfo`, `isColor`, `battery`

**Events** (`gl.on(type, fn)` returns an unsubscribe function):
`touch`, `gesture`, `battery`, `connect`, `disconnect`, `error`, `flow`

**Display:** `clear()`, `draw(fn, { clear })`, `hold()`, `flush()`, `resetHold()`, `power(on)`,
`luma(0–15)`, `led(LED.blink)`, `shift(x, y)`, `gestureDetection(on)`, `ambientLight(on)`

**Drawing:** `grey(0–15)`, `color(rgValue)`, `point`, `line`, `rect`, `fillRect`, `circle`, `fillCircle`,
`arc(x, y, r, startDeg, endDeg, thickness)`, `polyline(points, thickness)`, `text(str, x, y, opts)`

**Queries:** `getVersion()`, `getSettings()`, `getBattery()`, `listFonts()`. Fonts and settings
are read once on connect (`gl.fonts.installed`, `gl.settings`, `gl.fontHeight(id)`); turn this off with
`readDeviceState: false`.

**Raw protocol:** `send(cmdId, bytes)`, `query(cmdId, bytes)`, `sendMany([[cmdId, bytes], …])` (back to back), plus `CMD`, `encodeFrame`, `FrameDecoder`,
`ByteReader` and the byte helpers `u8/u16/s16/u32/cstring` for commands without a wrapper yet.

**Colours:** `COLORS` (`red`, `orange`, `amber`, `yellow`, `lime`, `green`, `black`), `RG_PALETTE`
(9×9), `rg(red, green)`, `rgToCss(value)` for browser previews. On monochrome glasses colours fall
back to grey levels.

**Extras:**
- `ScreenPager` switches between screens with the temple button (debounced) and redraws live screens.
- `keepScreenAwake()` keeps the phone screen on (also via the `keepAwake: true` option).
- `toAscii()` converts text to printable ASCII.
- `MockTransport` lets you run tests and demos without glasses.

### Screens and paging

```ts
import { ActiveLook, ScreenPager } from '@pranen/activelook';

const pager = new ScreenPager(gl, [
  { name: 'Clock', live: true, render: g => g.text(new Date().toLocaleTimeString(), 15, 55, { font: 2 }) },
  { name: 'Info', render: g => g.text('Temple = next', 15, 115) },
]);
await gl.gestureDetection(true); // ENGO 3 reports the temple press as a gesture (value 1)
pager.start();
```

## Storing things on the glasses

Images, layouts, pages, gauges, animations and fonts can be stored on the glasses and shown
later with one short command. This saves Bluetooth traffic (and battery) for screens that
are redrawn often. Everything stored lives in a **configuration**: open one with
`gl.configs.write()` before saving.

```ts
await gl.configs.write('MYAPP', { version: 1, password: 1234 });

// Image from a canvas (as the wearer should see it; mirroring is handled by the library)
const bitmap = canvas.getContext('2d')!.getImageData(0, 0, 64, 64);
await gl.images.save(1, bitmap, { format: 'grey4' }); // or mono1, greyAlpha8, color8, colorAlpha8
await gl.images.display(1, 20, 40);

// Gauge: ring of 16 portions, filled in percent
await gl.gauges.save(1, { x: 135, y: 140, radius: 80, innerRadius: 60, start: 10, end: 6 });
await gl.gauges.display(1, 75);

// Layout: clip region + text slot + drawing commands; display() only sends the new text
await gl.layouts.save(10, {
  x: 20, y: 50, width: 200, height: 70, font: 2,
  text: { x: 10, y: 28 },
  commands: [
    { type: 'rect', x0: 0, y0: 0, x1: 199, y1: 69 },
    { type: 'font', id: 0 },
    { type: 'text', x: 10, y: 3, text: 'TEMP' },
  ],
});
await gl.layouts.display(10, '21.5 C');

// Page: up to 10 layouts shown together; texts go to the layouts in order
await gl.pages.save(1, [{ layout: 10, x: 20, y: 40 }, { layout: 10, x: 20, y: 130 }]);
await gl.pages.display(1, ['21.5 C', '12:30']);
```

| Module | Methods |
|---|---|
| `gl.configs` | `write`, `read`, `select`, `list`, `rename`, `delete`, `deleteLeastUsed`, `freeSpace`, `count` |
| `gl.images` | `save`, `display`, `stream` (1-bit, not stored, no configuration needed), `list`, `delete`, `deleteAll` |
| `gl.layouts` | `save`, `display`, `clear`, `clearAndDisplay`, `position`, `displayAt`, `clearAt`, `clearAndDisplayAt`, `list`, `get`, `delete`, `deleteAll` |
| `gl.pages` | `save`, `get`, `display`, `clear`, `clearAndDisplay`, `list`, `delete`, `deleteAll` |
| `gl.gauges` | `save`, `display`, `get`, `list`, `delete`, `deleteAll` |
| `gl.animations` | `display`, `clear`, `clearAll`, `list`, `delete`, `deleteAll` |
| `gl.fonts` | `installed`, `height`, `list`, `save` (ActiveLook font format), `select`, `delete`, `deleteAll` |

Device commands on `gl`: `fill(level)`, `demo(pattern)`, `pixelCount()`, `readDeviceInfo(id)`,
`shutdown()`, `reset()`.

All positions are logical (top-left as seen by the wearer). On mirrored displays such as ENGO 3
the library flips image pixels and needs an object's size to place it, so it remembers the
sizes of images and layouts saved in the session and otherwise reads them from the glasses.
Animations need their size passed in (`width`, `height`).

Not supported: creating animations and Heatshrink-compressed images (both need a Heatshrink
encoder), and generating fonts. Fonts made with the ActiveLook
[Config-Generator](https://github.com/ActiveLook/Config-Generator) can be uploaded with
`gl.fonts.save()`.

**Where the API documentation is ambiguous**, the library follows the most plausible reading;
these points are not yet verified on hardware:

- orientation of stored images and of the 1-bit image stream on mirrored displays
- pixel format of `color8` / `colorAlpha8` (one RG palette value per pixel, sent uncompressed)
- which gauge portion sits where (rotated by half a turn on mirrored displays)
- text in layouts and pages is sent NUL-terminated
- `nb_points` of polylines inside layouts is the number of points

## Transport, flow control and errors

The default transport is Web Bluetooth. It subscribes to:

- **RX** for commands
- **TX** for query responses
- **Control** for flow control
- **gesture** and **touch** events
- the standard **battery** and **device information** services

Flow control works like this:

- When the glasses report *busy* (`0x02`), the queue pauses until *ready* (`0x01`) arrives.
- If *ready* never arrives, the queue resumes after `flowTimeoutMs`.
- Control errors (`0x03`–`0x06`) and asynchronous device errors (`0xE2`) are emitted as `error` events.

```ts
new ActiveLook({
  bluetooth: {
    writeMode: 'response', // 'response' (default) | 'auto' | 'noResponse'
    chunkSize: 512, // largest single write; shrinks automatically if long writes are rejected
    namePrefixes: ['ENGO', 'A.Look'],
  },
});
```

The default write mode waits for each write to be acknowledged, as the API documentation
recommends. `auto` writes without response (falling back to write with response) and is
faster, but on ENGO 3 long bursts of commands without pauses can be dropped.

Implement the `Transport` interface to use other BLE stacks, for example Node with noble or
Capacitor.

## Status

Covered:

- graphics, text, hold/flush, luma, LED, sensors
- input events, battery
- queries (version, settings, battery, fonts)
- flow control
- configurations, images, layouts, pages, gauges, animations (playing), fonts (uploading),
  device commands; every command of the API documentation has a wrapper

Not covered: creating animations, Heatshrink-compressed images, generating fonts.
Use `send()`/`query()`/`sendMany()` for anything else.

Verified on an ENGO 3 (firmware 4.13.15): drawing, text, colours, input events, battery, and
query responses over TX (version, settings, battery, fonts).

Not yet verified on hardware:

- the arc angle mapping
- flow control on the Control characteristic
- the `A.Look` name filter
- everything stored on the glasses (see the list above; try the **storage** demo)

## Development

```bash
npm install
npm run dev        # demo site with hot reload → http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # library → dist/ (ESM, CJS, IIFE, .d.ts)
npm run build:demo # demo site → dist-demo/
```

URL flags for the demos: `?mock` (no glasses), `?debug` (log every frame as hex).

### Release

```bash
npm version patch   # or minor / major
npm publish         # runs typecheck, tests and build first (prepublishOnly)
git push --follow-tags
```

## Links

- [ActiveLook API documentation](https://github.com/ActiveLook/Activelook-API-Documentation/blob/main/ActiveLook_API.md)
- [ActiveLook on GitHub](https://github.com/ActiveLook) (Android and iOS SDKs)
- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)

## License

MIT
