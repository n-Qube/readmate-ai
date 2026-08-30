export type AbortableLifecycle = {
  readonly signal: AbortSignal;
  readonly disposed: boolean;
  dispose(reason?: unknown): void;
};

export type LinkedAbortSignal = {
  readonly signal: AbortSignal;
  unlink(): void;
};

export function createAbortableLifecycle(onDispose?: () => void): AbortableLifecycle {
  const controller = new AbortController();
  let disposed = false;

  return {
    signal: controller.signal,
    get disposed() {
      return disposed;
    },
    dispose(reason?: unknown) {
      if (disposed) return;
      disposed = true;
      controller.abort(reason);
      onDispose?.();
    }
  };
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

/**
 * Links invocation cancellation with registration/principal lifecycle changes.
 * Chrome no longer guarantees that unregistering a tool cancels an execution,
 * so handlers must observe both signals explicitly.
 */
export function linkAbortSignals(signals: readonly AbortSignal[]): LinkedAbortSignal {
  const controller = new AbortController();
  const removers: Array<() => void> = [];
  let linked = true;

  const unlink = () => {
    if (!linked) return;
    linked = false;
    for (const remove of removers.splice(0)) remove();
  };

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(abortReason(signal));
      unlink();
      break;
    }
    const onAbort = () => {
      controller.abort(abortReason(signal));
      unlink();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removers.push(() => signal.removeEventListener("abort", onAbort));
  }

  return { signal: controller.signal, unlink };
}
