export type ActiveLookErrorCode =
  | 'unsupported'
  | 'cancelled'
  | 'gatt'
  | 'not-connected'
  | 'disconnected'
  | 'timeout'
  | 'device';

export class ActiveLookError extends Error {
  constructor(message: string, readonly code: ActiveLookErrorCode, readonly cause?: unknown) {
    super(message);
    this.name = 'ActiveLookError';
  }
}
