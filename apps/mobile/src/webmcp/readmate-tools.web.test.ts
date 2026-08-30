import { describe, expect, it, vi } from "vitest";
import { beginReadMateToolRegistration, type ReadMateImperativeToolHandlers } from "./readmate-tools.web";

type Registered = { tool: ReadMateWebMcpTool; signal?: AbortSignal };

function fakeDocument(options: { failAt?: number } = {}) {
  const registered: Registered[] = [];
  const registerTool = vi.fn(async (tool: ReadMateWebMcpTool, registrationOptions?: { signal?: AbortSignal }) => {
    if (options.failAt === registered.length) throw new Error("registration failed");
    const record = { tool, signal: registrationOptions?.signal };
    registered.push(record);
    registrationOptions?.signal?.addEventListener("abort", () => {
      const index = registered.indexOf(record);
      if (index >= 0) registered.splice(index, 1);
    }, { once: true });
  });
  return {
    documentLike: { modelContext: { registerTool } as unknown as ReadMateWebMcpModelContext },
    registerTool,
    registered
  };
}

function handlers(overrides: Partial<ReadMateImperativeToolHandlers> = {}): ReadMateImperativeToolHandlers {
  const defaults: ReadMateImperativeToolHandlers = {
    async searchLibrary(_input, context) {
      return {
      resource: {
        results: [{
          documentId: "doc-1",
          title: "Archaeology",
          sourceType: "webpage",
          progressPercent: 15,
          updatedAt: "2026-08-29T12:00:00.000Z",
          deepLink: "/document/doc-1"
        }]
      },
      message: `Found one item for ${context.userId}.`
      };
    },
    async getDocumentContext() {
      return {
      resource: {
        documentId: "doc-1",
        title: "Archaeology",
        sourceType: "webpage",
        status: "in_progress",
        progressPercent: 15,
        summaryAvailable: true,
        flashcardCount: 6,
        quizCount: 4,
        supportedActions: ["readmate_prepare_listening"],
        deepLink: "/document/doc-1"
      },
      message: "Document context is ready."
      };
    },
    async prepareListening(input) {
      return {
      resource: {
        documentId: input.documentId,
        targetLanguage: input.targetLanguage,
        startAt: input.startAt ?? "resume",
        status: "ready",
        deepLink: `/player?documentId=${input.documentId}&targetLanguage=${input.targetLanguage}`
      },
      message: "The player is ready. Press Play to request speech."
      };
    }
  };
  return {
    searchLibrary: vi.fn(defaults.searchLibrary),
    getDocumentContext: vi.fn(defaults.getDocumentContext),
    prepareListening: vi.fn(defaults.prepareListening),
    ...overrides
  };
}

describe("web WebMCP registration adapter", () => {
  it("registers only the three authenticated imperative tools on document.modelContext", async () => {
    const browser = fakeDocument();
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "fresh-token",
      handlers: handlers(),
      documentLike: browser.documentLike
    });

    await expect(registration.ready).resolves.toMatchObject({
      supported: true,
      ready: true,
      reason: "registered",
      registeredTools: [
        "readmate_search_library",
        "readmate_get_document_context",
        "readmate_prepare_listening"
      ]
    });
    expect(browser.registerTool).toHaveBeenCalledTimes(3);
    expect(browser.registered.map(({ tool }) => tool.name)).toEqual([
      "readmate_search_library",
      "readmate_get_document_context",
      "readmate_prepare_listening"
    ]);
    expect(browser.registered[0].tool.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: true });
    expect(browser.registered[0].signal).toBe(registration.signal);
  });

  it.each([
    { enabled: false, isAuthenticated: true, userId: "user-1", reason: "disabled" },
    { enabled: true, isAuthenticated: false, userId: null, reason: "unauthenticated" }
  ])("does not register when $reason", async ({ enabled, isAuthenticated, userId, reason }) => {
    const browser = fakeDocument();
    const registration = beginReadMateToolRegistration({
      enabled,
      isAuthenticated,
      userId,
      getToken: async () => "token",
      handlers: handlers(),
      documentLike: browser.documentLike
    });
    await expect(registration.ready).resolves.toMatchObject({ reason, ready: false });
    expect(browser.registerTool).not.toHaveBeenCalled();
  });

  it("gets a fresh token at execution and propagates the exact invocation signal", async () => {
    const browser = fakeDocument();
    const getToken = vi.fn(async () => "private-token");
    const searchLibrary = vi.fn(handlers().searchLibrary);
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken,
      handlers: handlers({ searchLibrary }),
      documentLike: browser.documentLike
    });
    await registration.ready;
    const invocation = new AbortController();

    const output = await browser.registered[0].tool.execute(
      { query: "archaeology", limit: 3 },
      { signal: invocation.signal }
    );

    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(searchLibrary).toHaveBeenCalledWith(
      { query: "archaeology", limit: 3 },
      { userId: "user-1", token: "private-token", signal: expect.any(AbortSignal) }
    );
    const observedSignal = searchLibrary.mock.calls[0][1].signal;
    expect(observedSignal).not.toBe(invocation.signal);
    expect(observedSignal.aborted).toBe(false);
    expect(JSON.stringify(output)).not.toContain("private-token");
  });

  it("rejects malformed input before requesting a token", async () => {
    const browser = fakeDocument();
    const getToken = vi.fn(async () => "token");
    const toolHandlers = handlers();
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken,
      handlers: toolHandlers,
      documentLike: browser.documentLike
    });
    await registration.ready;

    const output = await browser.registered[0].tool.execute(
      { query: "archaeology", extra: "exfiltrate" },
      { signal: new AbortController().signal }
    );

    expect(output).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(getToken).not.toHaveBeenCalled();
    expect(toolHandlers.searchLibrary).not.toHaveBeenCalled();
  });

  it("unregisters and clears pending state when a fresh token is missing", async () => {
    const browser = fakeDocument();
    const clearAgentState = vi.fn();
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => null,
      handlers: handlers(),
      documentLike: browser.documentLike,
      clearAgentState
    });
    await registration.ready;

    const output = await browser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: new AbortController().signal }
    );

    expect(output).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect(registration.signal.aborted).toBe(true);
    expect(browser.registered).toHaveLength(0);
    expect(clearAgentState).toHaveBeenCalledTimes(1);
  });

  it("unregisters on an API 401 but returns plan limits for a 403", async () => {
    const unauthorizedBrowser = fakeDocument();
    const unauthorizedRegistration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "token",
      handlers: handlers({ searchLibrary: vi.fn(async () => { throw { status: 401 }; }) }),
      documentLike: unauthorizedBrowser.documentLike
    });
    await unauthorizedRegistration.ready;
    const unauthorized = await unauthorizedBrowser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: new AbortController().signal }
    );
    expect(unauthorized).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(unauthorizedRegistration.signal.aborted).toBe(true);

    const planBrowser = fakeDocument();
    const planRegistration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "token",
      handlers: handlers({ searchLibrary: vi.fn(async () => { throw { status: 403 }; }) }),
      documentLike: planBrowser.documentLike
    });
    await planRegistration.ready;
    const plan = await planBrowser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: new AbortController().signal }
    );
    expect(plan).toMatchObject({ error: { code: "PLAN_LIMIT" } });
    expect(planRegistration.signal.aborted).toBe(false);
  });

  it("propagates cancellation to a long-running handler", async () => {
    const browser = fakeDocument();
    let observedSignal: AbortSignal | undefined;
    let signalObserved!: () => void;
    const started = new Promise<void>((resolve) => { signalObserved = resolve; });
    const searchLibrary = vi.fn(async (_input, context) => {
      observedSignal = context.signal;
      signalObserved();
      return new Promise<never>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    });
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "token",
      handlers: handlers({ searchLibrary }),
      documentLike: browser.documentLike
    });
    await registration.ready;
    const invocation = new AbortController();
    const outputPromise = browser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: invocation.signal }
    );
    await started;
    invocation.abort(new DOMException("Stopped", "AbortError"));

    await expect(outputPromise).resolves.toMatchObject({ error: { code: "CANCELLED" } });
    expect(observedSignal).not.toBe(invocation.signal);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("cancels an in-flight prior-user handler when the registration lifecycle ends", async () => {
    const browser = fakeDocument();
    let observedSignal: AbortSignal | undefined;
    let signalObserved!: () => void;
    const started = new Promise<void>((resolve) => { signalObserved = resolve; });
    const searchLibrary: ReadMateImperativeToolHandlers["searchLibrary"] = async (_input, context) => {
      observedSignal = context.signal;
      signalObserved();
      return new Promise<never>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
      });
    };
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getCurrentUserId: () => "user-1",
      getToken: async () => "token",
      handlers: handlers({ searchLibrary }),
      documentLike: browser.documentLike
    });
    await registration.ready;
    const outputPromise = browser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: new AbortController().signal }
    );
    await started;
    registration.dispose("principal changed");

    await expect(outputPromise).resolves.toMatchObject({ error: { code: "CANCELLED" } });
    expect(observedSignal?.aborted).toBe(true);
    expect(browser.registered).toHaveLength(0);
  });

  it("re-checks the live principal after acquiring a token", async () => {
    const browser = fakeDocument();
    let currentUserId = "user-1";
    const getToken = vi.fn(async () => {
      currentUserId = "user-2";
      return "stale-user-token";
    });
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getCurrentUserId: () => currentUserId,
      getToken,
      handlers: handlers(),
      documentLike: browser.documentLike
    });
    await registration.ready;
    const output = await browser.registered[0].tool.execute(
      { query: "archaeology" },
      { signal: new AbortController().signal }
    );

    expect(output).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(registration.signal.aborted).toBe(true);
    expect(browser.registered).toHaveLength(0);
  });

  it("aborts partial registration if a browser rejects a tool", async () => {
    const browser = fakeDocument({ failAt: 1 });
    const clearAgentState = vi.fn();
    const registration = beginReadMateToolRegistration({
      isAuthenticated: true,
      userId: "user-1",
      getToken: async () => "token",
      handlers: handlers(),
      documentLike: browser.documentLike,
      clearAgentState
    });

    await expect(registration.ready).resolves.toMatchObject({ reason: "registration_failed", ready: false });
    expect(registration.signal.aborted).toBe(true);
    expect(browser.registered).toHaveLength(0);
    expect(clearAgentState).toHaveBeenCalledTimes(1);
  });
});
