import { getWebMcpModelContext } from "./feature-detection";
import { createAbortableLifecycle, linkAbortSignals, throwIfAborted } from "./lifecycle";
import type {
  BeginReadMateToolRegistrationInput,
  ReadMateImperativeToolHandlers,
  ReadMateToolRegistration,
  ReadMateToolRegistrationStatus
} from "./registration";
import { parseReadMateToolInput } from "./schemas";
import { READMATE_IMPERATIVE_TOOL_CONTRACTS } from "./tool-contracts";
import {
  ReadMateToolExecutionError,
  compactToolSuccess,
  isAuthenticationFailure,
  toolErrorFromUnknown
} from "./tool-results";
import type { ReadMateImperativeToolName } from "./tool-names";

export type {
  BeginReadMateToolRegistrationInput,
  ReadMateGetToken,
  ReadMateImperativeToolHandlers,
  ReadMateToolExecutionContext,
  ReadMateToolRegistration,
  ReadMateToolRegistrationStatus
} from "./registration";

export function beginReadMateToolRegistration(
  input: BeginReadMateToolRegistrationInput
): ReadMateToolRegistration {
  const modelContext = getWebMcpModelContext(input.documentLike);
  const lifecycle = createAbortableLifecycle(input.clearAgentState);

  if (!modelContext) {
    return registrationWithStatus(lifecycle, false, "unsupported");
  }
  if (input.enabled === false) {
    return registrationWithStatus(lifecycle, true, "disabled");
  }
  if (!input.isAuthenticated || !input.userId) {
    return registrationWithStatus(lifecycle, true, "unauthenticated");
  }

  const userId = input.userId;
  const registeredTools: ReadMateImperativeToolName[] = [];
  const ready = (async (): Promise<ReadMateToolRegistrationStatus> => {
    try {
      for (const contract of READMATE_IMPERATIVE_TOOL_CONTRACTS) {
        throwIfAborted(lifecycle.signal);
        const name = contract.name as ReadMateImperativeToolName;
        await modelContext.registerTool(
          {
            name,
            title: contract.title,
            description: contract.description,
            inputSchema: contract.inputSchema,
            annotations: contract.annotations,
            execute: (rawInput, execution) =>
              executeAuthenticatedTool(
                name,
                rawInput,
                execution.signal,
                lifecycle.signal,
                userId,
                input,
                (reason) => lifecycle.dispose(reason)
              )
          },
          { signal: lifecycle.signal }
        );
        registeredTools.push(name);
      }
      return status(true, true, "registered", registeredTools);
    } catch (error) {
      if (lifecycle.signal.aborted) return status(true, false, "disposed", []);
      lifecycle.dispose(error);
      return status(true, false, "registration_failed", []);
    }
  })();

  return {
    supported: true,
    signal: lifecycle.signal,
    ready,
    dispose: (reason) => lifecycle.dispose(reason)
  };
}

async function executeAuthenticatedTool(
  name: ReadMateImperativeToolName,
  rawInput: unknown,
  invocationSignal: AbortSignal,
  registrationSignal: AbortSignal,
  userId: string,
  input: BeginReadMateToolRegistrationInput,
  invalidateSession: (reason?: unknown) => void
) {
  const linked = linkAbortSignals([invocationSignal, registrationSignal]);
  const signal = linked.signal;
  try {
    throwIfAborted(signal);
    assertCurrentPrincipal(input, userId, invalidateSession);
    switch (name) {
      case "readmate_search_library": {
        const parsed = parseReadMateToolInput(name, rawInput);
        const context = await authenticatedExecutionContext(userId, signal, input, invalidateSession);
        const result = await input.handlers.searchLibrary(parsed, context);
        throwIfAborted(signal);
        return compactToolSuccess(name, result);
      }
      case "readmate_get_document_context": {
        const parsed = parseReadMateToolInput(name, rawInput);
        const context = await authenticatedExecutionContext(userId, signal, input, invalidateSession);
        const result = await input.handlers.getDocumentContext(parsed, context);
        throwIfAborted(signal);
        return compactToolSuccess(name, result);
      }
      case "readmate_prepare_listening": {
        const parsed = parseReadMateToolInput(name, rawInput);
        const context = await authenticatedExecutionContext(userId, signal, input, invalidateSession);
        const result = await input.handlers.prepareListening(parsed, context);
        throwIfAborted(signal);
        return compactToolSuccess(name, result);
      }
    }
  } catch (error) {
    if (isAuthenticationFailure(error)) invalidateSession(error);
    return toolErrorFromUnknown(name, error, signal);
  } finally {
    linked.unlink();
  }
}

async function authenticatedExecutionContext(
  userId: string,
  signal: AbortSignal,
  input: BeginReadMateToolRegistrationInput,
  invalidateSession: (reason?: unknown) => void
) {
  assertCurrentPrincipal(input, userId, invalidateSession);
  let token: string | null;
  try {
    token = await input.getToken({ skipCache: true });
  } catch (error) {
    throwIfAborted(signal);
    invalidateSession(error);
    throw new ReadMateToolExecutionError(
      "AUTH_REQUIRED",
      "Your ReadMate session is no longer available.",
      "Sign in again, then retry the action."
    );
  }
  throwIfAborted(signal);
  assertCurrentPrincipal(input, userId, invalidateSession);
  if (!token) {
    const error = new ReadMateToolExecutionError(
      "AUTH_REQUIRED",
      "Your ReadMate session is no longer available.",
      "Sign in again, then retry the action."
    );
    invalidateSession(error);
    throw error;
  }
  return { userId, token, signal };
}

function assertCurrentPrincipal(
  input: BeginReadMateToolRegistrationInput,
  expectedUserId: string,
  invalidateSession: (reason?: unknown) => void
): void {
  if (!input.getCurrentUserId) return;
  const currentUserId = input.getCurrentUserId();
  if (currentUserId === expectedUserId) return;
  const error = new ReadMateToolExecutionError(
    "AUTH_REQUIRED",
    "Your ReadMate session changed before this action could run.",
    "Use the currently signed-in account and start the action again."
  );
  invalidateSession(error);
  throw error;
}

function registrationWithStatus(
  lifecycle: ReturnType<typeof createAbortableLifecycle>,
  supported: boolean,
  reason: "unsupported" | "disabled" | "unauthenticated"
): ReadMateToolRegistration {
  return {
    supported,
    signal: lifecycle.signal,
    ready: Promise.resolve(status(supported, false, reason, [])),
    dispose: (disposeReason) => lifecycle.dispose(disposeReason)
  };
}

function status(
  supported: boolean,
  ready: boolean,
  reason: ReadMateToolRegistrationStatus["reason"],
  registeredTools: readonly ReadMateImperativeToolName[]
): ReadMateToolRegistrationStatus {
  return { supported, ready, reason, registeredTools: [...registeredTools] };
}
