import { AsyncLocalStorage } from "node:async_hooks";

export type RlsContext = {
  userId?: string;
};

const rlsContext = new AsyncLocalStorage<RlsContext>();

export function getRlsContext(): RlsContext | undefined {
  return rlsContext.getStore();
}

export function withRlsUser<T>(userId: string, callback: () => T): T {
  return rlsContext.run({ userId }, callback);
}
