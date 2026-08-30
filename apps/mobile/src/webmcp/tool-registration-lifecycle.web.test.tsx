// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BeginReadMateToolRegistrationInput,
  ReadMateImperativeToolHandlers,
  ReadMateToolRegistration
} from "./registration";
import { useLiveToolRegistration } from "./tool-registration-lifecycle.web";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  while (mountedRoots.length) {
    const root = mountedRoots.pop();
    if (root) await act(async () => root.unmount());
  }
});

describe("live WebMCP tool registration lifecycle", () => {
  it("does not re-register when live token, handlers, or clear-state callbacks change", async () => {
    const registrations: BeginReadMateToolRegistrationInput[] = [];
    const disposals = vi.fn();
    const beginRegistration = vi.fn((input: BeginReadMateToolRegistrationInput): ReadMateToolRegistration => {
      registrations.push(input);
      return registration(disposals);
    });
    const firstToken = vi.fn(async () => "first-token");
    const secondToken = vi.fn(async () => "second-token");
    const firstSearch = vi.fn(async () => searchResult("first"));
    const secondSearch = vi.fn(async () => searchResult("second"));
    const clearAgentState = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <Harness
          beginRegistration={beginRegistration}
          clearAgentState={clearAgentState}
          getToken={firstToken}
          handlers={handlers(firstSearch)}
        />
      );
    });
    expect(beginRegistration).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <Harness
          beginRegistration={beginRegistration}
          clearAgentState={clearAgentState}
          getToken={secondToken}
          handlers={handlers(secondSearch)}
        />
      );
    });

    expect(beginRegistration).toHaveBeenCalledTimes(1);
    await expect(registrations[0].getToken()).resolves.toBe("second-token");
    await registrations[0].handlers.searchLibrary(
      { query: "Ghana" },
      { userId: "user-1", token: "token", signal: new AbortController().signal }
    );
    expect(firstToken).not.toHaveBeenCalled();
    expect(firstSearch).not.toHaveBeenCalled();
    expect(secondSearch).toHaveBeenCalledTimes(1);

    await act(async () => registrations[0].clearAgentState?.());
    expect(clearAgentState).toHaveBeenCalledTimes(1);
    expect(beginRegistration).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    mountedRoots.pop();
    expect(disposals).toHaveBeenCalledTimes(1);
    expect(clearAgentState).toHaveBeenCalledTimes(1);
  });

  it("replaces registration and clears state once when the principal changes", async () => {
    const beginRegistration = vi.fn((_input: BeginReadMateToolRegistrationInput) => registration(vi.fn()));
    const clearAgentState = vi.fn();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(
        <Harness
          beginRegistration={beginRegistration}
          clearAgentState={clearAgentState}
          getToken={async () => "token"}
          handlers={handlers()}
          userId="user-1"
        />
      );
    });
    await act(async () => {
      root.render(
        <Harness
          beginRegistration={beginRegistration}
          clearAgentState={clearAgentState}
          getToken={async () => "token"}
          handlers={handlers()}
          userId="user-2"
        />
      );
    });

    expect(beginRegistration).toHaveBeenCalledTimes(2);
    expect(clearAgentState).toHaveBeenCalledTimes(1);
  });
});

function Harness({
  beginRegistration,
  clearAgentState,
  getToken,
  handlers: toolHandlers,
  userId = "user-1"
}: {
  beginRegistration: (input: BeginReadMateToolRegistrationInput) => ReadMateToolRegistration;
  clearAgentState: () => void;
  getToken: BeginReadMateToolRegistrationInput["getToken"];
  handlers: ReadMateImperativeToolHandlers;
  userId?: string;
}) {
  const [, forceRender] = useState(0);
  useLiveToolRegistration({
    enabled: true,
    isAuthenticated: true,
    userId,
    getToken,
    handlers: toolHandlers,
    clearAgentState: () => {
      clearAgentState();
      forceRender((value) => value + 1);
    }
  }, beginRegistration);
  return null;
}

function registration(dispose: () => void): ReadMateToolRegistration {
  const controller = new AbortController();
  return {
    supported: true,
    signal: controller.signal,
    ready: Promise.resolve({
      supported: true,
      ready: true,
      reason: "registered",
      registeredTools: []
    }),
    dispose
  };
}

function handlers(
  searchLibrary: ReadMateImperativeToolHandlers["searchLibrary"] = async () => searchResult("default")
): ReadMateImperativeToolHandlers {
  return {
    searchLibrary,
    async getDocumentContext() {
      return {
        resource: {
          documentId: "doc-1",
          title: "Document",
          sourceType: "webpage",
          status: "unread",
          progressPercent: 0,
          summaryAvailable: false,
          flashcardCount: 0,
          quizCount: 0,
          supportedActions: ["readmate_prepare_listening"],
          deepLink: "/document/doc-1"
        },
        message: "Ready"
      };
    },
    async prepareListening(input) {
      return {
        resource: {
          documentId: input.documentId,
          targetLanguage: input.targetLanguage,
          startAt: "resume",
          status: "ready",
          deepLink: `/document/${input.documentId}`
        },
        message: "Ready"
      };
    }
  };
}

function searchResult(title: string) {
  return {
    resource: {
      results: [{
        documentId: "doc-1",
        title,
        sourceType: "webpage" as const,
        progressPercent: 0,
        updatedAt: "2026-08-29T00:00:00.000Z",
        deepLink: "/document/doc-1"
      }]
    },
    message: "Found"
  };
}
