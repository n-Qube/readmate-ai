import { createAbortableLifecycle } from "./lifecycle";
import type {
  BeginReadMateToolRegistrationInput,
  ReadMateToolRegistration
} from "./registration";

export type {
  BeginReadMateToolRegistrationInput,
  ReadMateGetToken,
  ReadMateImperativeToolHandlers,
  ReadMateToolExecutionContext,
  ReadMateToolRegistration,
  ReadMateToolRegistrationStatus
} from "./registration";

/** Native and unsupported-platform adapter. It has no browser side effects. */
export function beginReadMateToolRegistration(
  input: BeginReadMateToolRegistrationInput
): ReadMateToolRegistration {
  const lifecycle = createAbortableLifecycle(input.clearAgentState);
  return {
    supported: false,
    signal: lifecycle.signal,
    ready: Promise.resolve({
      supported: false,
      ready: false,
      reason: "unsupported",
      registeredTools: []
    }),
    dispose: (reason) => lifecycle.dispose(reason)
  };
}

