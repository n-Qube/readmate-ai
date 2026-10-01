import type { PropsWithChildren } from "react";

// The share sheet is native-only; the web build renders children unchanged.
export function ShareIntentRoot({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export function SharedContentHandler() {
  return null;
}
