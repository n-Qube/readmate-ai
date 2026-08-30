import { useCallback, useEffect, useMemo, useRef } from "react";
import { beginReadMateToolRegistration } from "./readmate-tools";
import type {
  BeginReadMateToolRegistrationInput,
  ReadMateGetToken,
  ReadMateImperativeToolHandlers,
  ReadMateToolRegistration
} from "./registration";

type BeginRegistration = (
  input: BeginReadMateToolRegistrationInput
) => ReadMateToolRegistration;

export type LiveToolRegistrationInput = Pick<
  BeginReadMateToolRegistrationInput,
  "enabled" | "isAuthenticated" | "userId" | "getToken" | "handlers" | "clearAgentState"
>;

/**
 * Keeps a single WebMCP registration alive while callbacks change during
 * ordinary React renders. Authentication and route changes still replace the
 * registration, while routine effect cleanup never updates component state.
 */
export function useLiveToolRegistration(
  input: LiveToolRegistrationInput,
  beginRegistration: BeginRegistration = beginReadMateToolRegistration
): void {
  const currentUserIdRef = useRef(input.userId);
  const getTokenRef = useRef<ReadMateGetToken>(input.getToken);
  const handlersRef = useRef<ReadMateImperativeToolHandlers>(input.handlers);
  const clearAgentStateRef = useRef(input.clearAgentState);
  const previousIdentityRef = useRef({
    enabled: input.enabled,
    isAuthenticated: input.isAuthenticated,
    userId: input.userId
  });

  currentUserIdRef.current = input.userId;
  getTokenRef.current = input.getToken;
  handlersRef.current = input.handlers;
  clearAgentStateRef.current = input.clearAgentState;

  const getLiveToken = useCallback<ReadMateGetToken>(
    (options) => getTokenRef.current(options),
    []
  );
  const liveHandlers = useMemo<ReadMateImperativeToolHandlers>(() => ({
    searchLibrary: (toolInput, context) => handlersRef.current.searchLibrary(toolInput, context),
    getDocumentContext: (toolInput, context) => handlersRef.current.getDocumentContext(toolInput, context),
    prepareListening: (toolInput, context) => handlersRef.current.prepareListening(toolInput, context)
  }), []);

  useEffect(() => {
    const previousIdentity = previousIdentityRef.current;
    const identityChanged = previousIdentity.enabled !== input.enabled
      || previousIdentity.isAuthenticated !== input.isAuthenticated
      || previousIdentity.userId !== input.userId;
    previousIdentityRef.current = {
      enabled: input.enabled,
      isAuthenticated: input.isAuthenticated,
      userId: input.userId
    };
    if (identityChanged) clearAgentStateRef.current?.();

    let routineCleanup = false;
    const registration = beginRegistration({
      enabled: input.enabled,
      isAuthenticated: input.isAuthenticated,
      userId: input.userId,
      getCurrentUserId: () => currentUserIdRef.current,
      getToken: getLiveToken,
      handlers: liveHandlers,
      clearAgentState: () => {
        if (!routineCleanup) clearAgentStateRef.current?.();
      }
    });
    void registration.ready;

    return () => {
      routineCleanup = true;
      registration.dispose("ReadMate agent provider lifecycle changed.");
    };
  }, [
    beginRegistration,
    getLiveToken,
    input.enabled,
    input.isAuthenticated,
    input.userId,
    liveHandlers
  ]);
}
