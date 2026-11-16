export {
  ActiveLook,
  type ActiveLookEvents,
  type ActiveLookOptions,
  type DeviceError,
  type DrawOptions,
  type FontInfo,
  type InputEvent,
  type Point,
  type Settings,
  type TextOptions,
  type VersionInfo,
} from './activelook.js';
export { ActiveLookError, type ActiveLookErrorCode } from './errors.js';
export { ENGO3, defineProfile, detectColor, visibleArea, type DeviceProfile, type Rect, type Shift } from './devices/profiles.js';

export { CMD, CONTROL, LED, HOLD, DEVICE_ERRORS, type CommandName, type LedState } from './protocol/commands.js';
export { encodeFrame, FrameDecoder, MAX_DATA_SIZE, MAX_FRAME_SIZE, type Frame } from './protocol/frame.js';
export { ByteReader, toHex, u8, u16, s16, u32, bool, cstring } from './protocol/bytes.js';
export { COLORS, RG_PALETTE, rg, rgLevels, rgToCss, rgToGrey, type ColorName } from './protocol/palette.js';

export type { DeviceInfo, Transport, TransportEvents } from './transport/types.js';
export {
  WebBluetoothTransport,
  UUIDS,
  DEFAULT_NAME_PREFIXES,
  type WebBluetoothOptions,
  type WriteMode,
} from './transport/web-bluetooth.js';
export { MockTransport, type MockTransportOptions } from './transport/mock.js';
export { WriteQueue } from './queue.js';

export { ScreenPager, type Screen, type PagerOptions } from './extras/pager.js';
export { toAscii } from './extras/ascii.js';
export { keepScreenAwake } from './extras/wake-lock.js';

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
