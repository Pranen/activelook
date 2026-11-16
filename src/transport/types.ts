/** Information read from the standard BLE Device Information service (fields may be missing). */
export interface DeviceInfo {
  name?: string;
  manufacturer?: string;
  model?: string;
  /** e.g. "ALK03-MDP08ACRG". MDP08 = colour display, MDP05 = grey display. */
  hardware?: string;
  firmware?: string;
  software?: string;
}

/** Callbacks a transport invokes. All payloads are raw bytes as received. */
export interface TransportEvents {
  /** Bytes from the TX characteristic (responses to queries, async errors). */
  onData(bytes: Uint8Array): void;
  /** Value from the Control characteristic (flow control / error codes). */
  onControl(code: number): void;
  onGesture(bytes: Uint8Array): void;
  onTouch(bytes: Uint8Array): void;
  onBattery(level: number): void;
  onDisconnect(): void;
  onLog?(message: string): void;
}

/**
 * Byte pipe to the glasses. `WebBluetoothTransport` is the browser implementation,
 * `MockTransport` is for tests and offline demos. Implement this for other stacks
 * (e.g. Node with noble, Capacitor, React Native).
 */
export interface Transport {
  readonly connected: boolean;
  /** Largest chunk passed to `write()`; longer frames are split by the library. */
  readonly maxChunkSize: number;
  connect(events: TransportEvents): Promise<DeviceInfo>;
  write(chunk: Uint8Array): Promise<void>;
  /** Battery level in % from the BLE battery service, or null if unavailable. */
  readBattery(): Promise<number | null>;
  disconnect(): void;
}
