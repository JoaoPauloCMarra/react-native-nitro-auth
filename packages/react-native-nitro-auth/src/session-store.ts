import type { AuthSessionSnapshot } from "./Auth.nitro";

type SessionSource = {
  getSessionSnapshot(): AuthSessionSnapshot;
  onSessionChanged(
    callback: (snapshot: AuthSessionSnapshot) => void,
  ): () => void;
};

/** One native subscription per service, shared by mounted React consumers. */
export function createSessionStore(source: SessionSource) {
  let current: AuthSessionSnapshot | undefined;
  let remove: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const receive = (snapshot: AuthSessionSnapshot) => {
    if (current && snapshot.revision <= current.revision) return;
    current = snapshot;
    for (const listener of [...listeners]) listener();
  };

  const refresh = () => {
    receive(source.getSessionSnapshot());
  };

  return {
    getSnapshot(): AuthSessionSnapshot {
      if (!current || listeners.size === 0) refresh();
      if (!current) throw new Error("Auth session snapshot is unavailable");
      return current;
    },
    refresh,
    subscribe(callback: () => void): () => void {
      const first = listeners.size === 0;
      listeners.add(callback);
      if (first) {
        try {
          remove = source.onSessionChanged(receive);
          // A mutation between render and native registration must not be lost.
          refresh();
        } catch (error) {
          listeners.delete(callback);
          remove?.();
          remove = undefined;
          throw error;
        }
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(callback);
        if (listeners.size === 0) {
          remove?.();
          remove = undefined;
        }
      };
    },
  };
}
