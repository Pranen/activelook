export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter. `on()` returns an unsubscribe function. */
export class Emitter<M extends object> {
  private readonly listeners = new Map<keyof M, Set<Listener<never>>>();

  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    const off = this.on(type, payload => { off(); fn(payload); });
    return off;
  }

  off<K extends keyof M>(type: K, fn: Listener<M[K]>): void {
    this.listeners.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      try { (fn as Listener<M[K]>)(payload); }
      catch (e) { console.error(`ActiveLook: "${String(type)}" listener failed`, e); }
    }
  }
}
