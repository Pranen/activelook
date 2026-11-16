/**
 * Keeps the phone screen on so timers (and with them BLE updates) keep running.
 * The system releases the lock when the page goes to the background; it is
 * re-acquired when the page becomes visible again. Returns a release function.
 */
export function keepScreenAwake(): () => void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined' || !('wakeLock' in navigator)) {
    return () => {};
  }
  let active = true;
  let lock: WakeLockSentinel | null = null;

  const acquire = async () => {
    if (!active || lock || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
      if (!active) release();
    } catch {
      // optional feature: ignore
    }
  };
  const onVisibility = () => { void acquire(); };
  const release = () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibility);
    lock?.release().catch(() => {});
    lock = null;
  };

  document.addEventListener('visibilitychange', onVisibility);
  void acquire();
  return release;
}
