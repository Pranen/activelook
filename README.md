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
| Visible area (`gl.safeArea`) | about x 3–270, y 30–255 |
| Fonts (built in) | ids 0–3, line heights 24 / 24 / 35 / 49 px, printable ASCII only |
| Colours | 81 red-green colours (no blue/white), or 16 grey levels; neighbouring shades are hard to tell apart on the glasses |

Lay out screens relative to `gl.safeArea` instead of fixed numbers. The visible area depends on
how the glasses sit; measure your own with the **calibrate** demo and pass the result as a profile.

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

**Queries:** `getVersion()`, `getSettings()`, `getBattery()`, `listFonts()`

**Raw protocol:** `send(cmdId, bytes)`, `query(cmdId, bytes)`, plus `CMD`, `encodeFrame`, `FrameDecoder`,
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
    chunkSize: 512, // split frames into smaller BLE writes if needed
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

Not covered yet:

- images (`imgSave`/`imgStream`)
- fonts, layouts, pages, gauges, animations
- configuration management (`cfgWrite` …)

Use `send()`/`query()` for these in the meantime.

Not yet verified on hardware:

- the arc angle mapping
- query responses and the TX / Control characteristics
- the `A.Look` name filter

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
