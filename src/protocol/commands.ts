// Command ids from the ActiveLook API documentation (firmware 4.12).
// https://github.com/ActiveLook/Activelook-API-Documentation/blob/main/ActiveLook_API.md

export const CMD = {
  // General
  power: 0x00,
  clear: 0x01,
  grey: 0x02,
  demo: 0x03,
  battery: 0x05,
  version: 0x06,
  led: 0x08,
  shift: 0x09,
  settings: 0x0a,
  // Luma & sensors
  luma: 0x10,
  sensor: 0x20,
  gesture: 0x21,
  als: 0x22,
  // Graphics
  grayscale: 0x30, // grey level (0–15) for the following drawings
  point: 0x31,
  line: 0x32,
  rect: 0x33,
  rectFull: 0x34,
  circ: 0x35,
  circFull: 0x36,
  txt: 0x37,
  polyline: 0x38,
  holdFlush: 0x39,
  arc: 0x3c,
  rgColor: 0x3d,
  txtColor: 0x3e,
  // Images
  imgSave: 0x41,
  imgDisplay: 0x42,
  imgStream: 0x44,
  imgDelete: 0x46,
  imgList: 0x47,
  // Fonts
  fontList: 0x50,
  fontSave: 0x51,
  fontSelect: 0x52,
  fontDelete: 0x53,
  // Layouts
  layoutSave: 0x60,
  layoutDelete: 0x61,
  layoutDisplay: 0x62,
  layoutClear: 0x63,
  layoutList: 0x64,
  layoutPosition: 0x65,
  layoutDisplayExtended: 0x66,
  layoutGet: 0x67,
  layoutClearExtended: 0x68,
  layoutClearAndDisplay: 0x69,
  layoutClearAndDisplayExtended: 0x6a,
  layoutSaveInColor: 0x6b,
  // Gauges
  gaugeDisplay: 0x70,
  gaugeSave: 0x71,
  gaugeDelete: 0x72,
  gaugeList: 0x73,
  gaugeGet: 0x74,
  // Pages
  pageSave: 0x80,
  pageGet: 0x81,
  pageDelete: 0x82,
  pageDisplay: 0x83,
  pageClear: 0x84,
  pageList: 0x85,
  pageClearAndDisplay: 0x86,
  // Animations
  animSave: 0x95,
  animDelete: 0x96,
  animDisplay: 0x97,
  animClear: 0x98,
  animList: 0x99,
  // Statistics
  pixelCount: 0xa5,
  // Configurations
  cfgWrite: 0xd0,
  cfgRead: 0xd1,
  cfgSet: 0xd2,
  cfgList: 0xd3,
  cfgRename: 0xd4,
  cfgDelete: 0xd5,
  cfgDeleteLessUsed: 0xd6,
  cfgFreeSpace: 0xd7,
  cfgGetNb: 0xd8,
  // Device
  shutdown: 0xe0,
  reset: 0xe1,
  error: 0xe2,
  rdDevInfo: 0xe3,
} as const;

export type CommandName = keyof typeof CMD;

/** Values notified on the Control characteristic. */
export const CONTROL = {
  ready: 0x01,
  busy: 0x02,
  incomplete: 0x03,
  overflow: 0x04,
  reserved: 0x05,
  missingCfgWrite: 0x06,
} as const;

export const CONTROL_MESSAGES: Record<number, string> = {
  0x03: 'Message incomplete or corrupt, command ignored',
  0x04: 'Receive queue overflow',
  0x05: 'Reserved error',
  0x06: 'cfgWrite missing before configuration change',
};

/** Error codes reported asynchronously with command 0xE2. */
export const DEVICE_ERRORS: Record<number, string> = {
  1: 'Generic error',
  2: 'Missing cfgWrite',
  3: 'Memory read/write error',
  4: 'Protocol decoding error',
};

export const LED = { off: 0, on: 1, toggle: 2, blink: 3 } as const;
export type LedState = (typeof LED)[keyof typeof LED];

export const HOLD = { hold: 0x00, flush: 0x01, reset: 0xff } as const;
