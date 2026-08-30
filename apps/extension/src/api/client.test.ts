import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askDocumentQuestion, AUTH_REQUIRED_ERROR, clearRemoteHistory, createSyncedDocument, deleteRemoteDocument, deleteRemoteLearningData, fetchWithRetry, generateDocumentLearning, getDocumentLearningReview, getRemoteDocument, getRemoteEntitlement, listHistory, listLibrary, markRemoteFlashcardReview, requestTtsAudio, submitRemoteQuizAttempt, TTS_AUTH_REQUIRED_ERROR, updateSyncedProgress, uploadPdfDocument, UploadRequestError } from "./client";
import type { ExtensionSettings, ReadingChunk, ReadingDocument } from "../shared/types";

const settings: ExtensionSettings = {
  ttsProvider: "google",
  voice: "en-US-Neural2-J",
  speed: 1,
  instructions: "calm and clear",
  targetLanguage: "en",
  autoScroll: true,
  highlightMode: "sentence",
  preferredContentTypes: ["webpage", "pdf"],
  apiBaseUrl: "https://api.example.test"
};

describe("sync client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses an existing document with the same source URL instead of creating a duplicate", async () => {
    const existing = createDocument({ id: "doc_existing", sourceUrl: "https://example.com/article?b=2&a=1" });
    fetchMock.mockResolvedValueOnce(jsonResponse([existing]));

    const result = await createSyncedDocument(
      settings.apiBaseUrl,
      "token",
      [createChunk({ pageUrl: "https://example.com/article?a=1&b=2#comments" })],
      settings
    );

    expect(result.id).toBe("doc_existing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/documents", {
      headers: { Authorization: "Bearer token" }
    });
  });

  it("omits unsupported chrome-extension URLs when creating a synced document", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse(createDocument({ id: "doc_pdf" }), 201));

    await createSyncedDocument(
      settings.apiBaseUrl,
      "token",
      [createChunk({ sourceType: "pdf", pageUrl: "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html" })],
      settings
    );

    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(postInit.body));
    expect(body.sourceType).toBe("pdf");
    expect(body.sourceUrl).toBeUndefined();
    expect(body.canonicalUrl).toBeUndefined();
  });

  it("does not retry a POST when a response may have been committed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(textResponse("Service Unavailable", 503));
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_retry" }) }, 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk()], settings);

    expect(result.id).toBe("doc_retry");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.example.test/api/content/save-url");
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.test/api/content/save-selection");
  });

  it("falls back once to captured page text when server-side URL sync fails", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock
      .mockResolvedValueOnce(textResponse("Service Unavailable", 503))
      .mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_captured_retry" }) }, 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk()], settings);

    expect(result.id).toBe("doc_captured_retry");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/api/documents",
      "https://api.example.test/api/content/save-url",
      "https://api.example.test/api/content/save-selection"
    ]);
  });

  it("still retries idempotent GET requests after transient failures", async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse("Service Unavailable", 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const response = await fetchWithRetry("https://api.example.test/health", { method: "GET" }, 2);

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("syncs captured page text when server-side URL extraction cannot read the page", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Could not extract readable article text." }, 422));
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_captured" }) }, 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk()], settings);

    expect(result.id).toBe("doc_captured");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/api/documents",
      "https://api.example.test/api/content/save-url",
      "https://api.example.test/api/content/save-selection"
    ]);
    const [, selectionInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(selectionInit.body))).toMatchObject({
      title: "Article title",
      sourceType: "webpage",
      sourceUrl: "https://example.com/article",
      text: "Readable text for the current article."
    });
  });

  it("round-trips a Chrome capture through the shared library contract used by mobile", async () => {
    const synced = createDocument({
      id: "doc_cross_platform",
      title: "Shared Chrome article",
      blocks: [{ id: "block_1", orderIndex: 0, blockType: "paragraph", text: "Captured in Chrome and visible on mobile." }]
    });
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: synced }, 201));
    fetchMock.mockResolvedValueOnce(jsonResponse([synced]));

    const created = await createSyncedDocument(settings.apiBaseUrl, "same-account-token", [createChunk({ title: synced.title })], settings);
    const mobileLibraryContract = await listHistory(settings.apiBaseUrl, "same-account-token");

    expect(created.id).toBe("doc_cross_platform");
    expect(mobileLibraryContract).toEqual([
      expect.objectContaining({
        id: created.id,
        title: "Shared Chrome article",
        progress: expect.objectContaining({ blockIndex: 0, percent: 0 }),
        blocks: [expect.objectContaining({ text: "Captured in Chrome and visible on mobile." })]
      })
    ]);
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.test/api/documents");
    expect(fetchMock.mock.calls[2][1]).toEqual({ headers: { Authorization: "Bearer same-account-token" } });
  });

  it("loads every compact Library page, then fetches full text only for the selected owned document", async () => {
    const firstPageItems = Array.from({ length: 100 }, (_, index) => compactLibraryItem(index));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: firstPageItems, nextCursor: "page-two" }))
      .mockResolvedValueOnce(jsonResponse({ items: [compactLibraryItem(100)] }))
      .mockResolvedValueOnce(jsonResponse(createDocument({
        id: "doc_100",
        blocks: [{ id: "block_100", orderIndex: 0, text: "Full private text loaded for playback." }]
      })));

    const documents = await listLibrary(settings.apiBaseUrl, "same-account-token");

    expect(documents).toHaveLength(101);
    expect(documents[0]).toMatchObject({
      id: "doc_0",
      userId: "synced",
      title: "Saved item 0",
      progress: { percent: 0 }
    });
    expect(documents[0]?.blocks).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.example.test/api/documents/library-page?limit=100");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.example.test/api/documents/library-page?limit=100&cursor=page-two");
    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: "Bearer same-account-token" } });

    const fullDocument = await getRemoteDocument(settings.apiBaseUrl, "same-account-token", "doc_100");

    expect(fullDocument.blocks).toEqual([expect.objectContaining({ text: "Full private text loaded for playback." })]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.example.test/api/documents/doc_100");
  });

  it("fails closed if the compact Library API repeats a cursor", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [compactLibraryItem(0)], nextCursor: "repeat" }))
      .mockResolvedValueOnce(jsonResponse({ items: [compactLibraryItem(1)], nextCursor: "repeat" }));

    await expect(listLibrary(settings.apiBaseUrl, "same-account-token"))
      .rejects.toThrow("ReadMate returned a repeated page");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails loudly instead of paging forever when the compact Library exceeds its safety bound", async () => {
    let page = 0;
    fetchMock.mockImplementation(async () => {
      page += 1;
      return jsonResponse({ items: [compactLibraryItem(page)], nextCursor: `cursor-${page}` });
    });

    await expect(listLibrary(settings.apiBaseUrl, "same-account-token"))
      .rejects.toThrow("exceeds the 10000-item safety limit");
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });

  it("decodes legacy uploaded document titles returned by the shared library", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([
      createDocument({
        id: "doc_encoded_upload",
        title: "Company%20Profile-%20Don%20Emilio",
        sourceType: "document"
      })
    ]));

    const documents = await listHistory(settings.apiBaseUrl, "same-account-token");

    expect(documents[0]?.title).toBe("Company Profile- Don Emilio");
  });

  it("uses captured text instead of legacy sync when a webpage URL is unavailable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_captured_no_url" }) }, 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk({ pageUrl: undefined })], settings);

    expect(result.id).toBe("doc_captured_no_url");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "https://api.example.test/api/documents",
      "https://api.example.test/api/content/save-selection"
    ]);
  });

  it("accepts captured text responses that return a documents array", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ documents: [createDocument({ id: "doc_captured_array" })] }, 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk({ pageUrl: undefined })], settings);

    expect(result.id).toBe("doc_captured_array");
  });

  it("accepts captured text responses that return the document directly", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse(createDocument({ id: "doc_captured_direct" }), 201));

    const result = await createSyncedDocument(settings.apiBaseUrl, "token", [createChunk({ pageUrl: undefined })], settings);

    expect(result.id).toBe("doc_captured_direct");
  });

  it("reports malformed captured text success responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }, 201));

    await expect(createSyncedDocument(settings.apiBaseUrl, "token", [createChunk({ pageUrl: undefined })], settings)).rejects.toThrow(
      "Unable to save captured page text: sync API returned no document."
    );
  });

  it("treats redirected document sync responses as an auth problem", async () => {
    const response = textResponse("Found", 200);
    Object.defineProperty(response, "redirected", { value: true });
    fetchMock.mockResolvedValueOnce(response);

    await expect(createSyncedDocument(settings.apiBaseUrl, "expired-token", [createChunk()], settings)).rejects.toThrow(AUTH_REQUIRED_ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats unauthorized document sync responses as an auth problem", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Authentication required." }, 401));

    await expect(createSyncedDocument(settings.apiBaseUrl, "expired-token", [createChunk()], settings)).rejects.toThrow(AUTH_REQUIRED_ERROR);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("syncs current block progress without counting the active block as completed", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 200));

    await updateSyncedProgress(settings.apiBaseUrl, "token", "doc_1", 2, 10, settings);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).progress).toEqual({
      blockIndex: 2,
      characterOffset: 0,
      sentenceIndex: 0,
      percent: 20
    });
  });

  it("treats missing remote documents as already deleted", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Document not found." }, 404));

    const deleted = await deleteRemoteDocument(settings.apiBaseUrl, "token", "local-only-id");

    expect(deleted).toBe(false);
  });

  it("removes remote learning data for deleted or cleared items", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteRemoteLearningData(settings.apiBaseUrl, "token", "doc_study");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study", {
      method: "DELETE",
      headers: { Authorization: "Bearer token" }
    });
  });

  it("requests a bulk reading-history clear without deleting Library documents", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 3 }));

    await clearRemoteHistory(settings.apiBaseUrl, "token");

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/documents/history", {
      method: "DELETE",
      headers: { Authorization: "Bearer token" }
    });
  });

  it("sends a document to Study through the backend without exposing Gemini credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_study", summary: "Generated summary" }) }));

    const result = await generateDocumentLearning(settings.apiBaseUrl, "token", "doc_study");

    expect(result.document.summary).toBe("Generated summary");
    expect(result.syncPending).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: "{}"
    });
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("GEMINI_API_KEY");
  });

  it("sends requested flashcard and quiz counts for deeper study generation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_study", summary: "Generated summary" }) }));

    await generateDocumentLearning(settings.apiBaseUrl, "token", "doc_study", { flashcardCount: 18, quizCount: 10, targetLanguage: "ee" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: JSON.stringify({ flashcardCount: 18, quizCount: 10, targetLanguage: "ee" })
    });
  });

  it("uses the dedicated generation route for flashcards without sending UI-only mode data", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: createDocument({ id: "doc_study" }) }));

    await generateDocumentLearning(settings.apiBaseUrl, "token", "doc_study", {
      flashcardCount: 12,
      targetLanguage: "tw",
      mode: "flashcards"
    });

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/flashcards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: JSON.stringify({ flashcardCount: 12, targetLanguage: "tw" })
    });
  });

  it("preserves the backend sync-pending signal with the fresh generated document", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      document: createDocument({ id: "doc_study", summary: "Fresh fallback summary" }),
      fallback: true,
      syncPending: true
    }));

    const result = await generateDocumentLearning(settings.apiBaseUrl, "token", "doc_study");

    expect(result).toMatchObject({
      fallback: true,
      syncPending: true,
      document: { id: "doc_study", summary: "Fresh fallback summary" }
    });
  });

  it("loads study review state from the backend", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        documentId: "doc_study",
        keyPoints: ["One point"],
        topicTags: ["topic"],
        flashcards: [{ id: "card_1", documentId: "doc_study", question: "Question?", answer: "Answer.", difficulty: "medium", reviewStatus: "new", createdAt: "2026-05-29T00:00:00.000Z", updatedAt: "2026-05-29T00:00:00.000Z" }],
        quizQuestions: [],
        quizAttempts: [],
        progress: { notesCount: 0, highlightsCount: 0, flashcardsReviewed: 0, quizAttempts: 0 }
      })
    );

    const review = await getDocumentLearningReview(settings.apiBaseUrl, "token", "doc_study");

    expect(review.flashcards[0]?.question).toBe("Question?");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/review", {
      headers: { Authorization: "Bearer token" }
    });
  });

  it("marks flashcard review state on the backend", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "card_1", reviewStatus: "known" }));

    const result = await markRemoteFlashcardReview(settings.apiBaseUrl, "token", "doc_study", "card_1", "known");

    expect(result.reviewStatus).toBe("known");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/flashcards/card_1/review", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: JSON.stringify({ reviewStatus: "known" })
    });
  });

  it("submits quiz attempts to the backend", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "attempt_1", score: 100, total: 1, correct: 1, results: [] }, 201));

    const result = await submitRemoteQuizAttempt(settings.apiBaseUrl, "token", "doc_study", { quiz_1: "Answer" });

    expect(result.score).toBe(100);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/quiz/attempts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: JSON.stringify({ answers: { quiz_1: "Answer" } })
    });
  });

  it("asks document questions through the backend without exposing Gemini credentials", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ answer: "Backend answer.", citedSections: ["Section one"] }));

    const result = await askDocumentQuestion(settings.apiBaseUrl, "token", "doc_study", "What matters?");

    expect(result.answer).toBe("Backend answer.");
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/learning/doc_study/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token"
      },
      body: JSON.stringify({ question: "What matters?", targetLanguage: "en" })
    });
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("GEMINI_API_KEY");
  });

  it("does not call cloud TTS when the auth token is missing", async () => {
    await expect(requestTtsAudio(settings, null, "Hello")).rejects.toThrow(TTS_AUTH_REQUIRED_ERROR);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats redirected cloud TTS responses as an auth problem", async () => {
    const response = textResponse("Found", 200);
    Object.defineProperty(response, "redirected", { value: true });
    fetchMock.mockResolvedValueOnce(response);

    await expect(requestTtsAudio(settings, "expired-token", "Hello")).rejects.toThrow(TTS_AUTH_REQUIRED_ERROR);
  });

  it("formats a temporary TTS failure without duplicate punctuation", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(
      { error: "Text-to-speech is temporarily unavailable." },
      503
    ));

    await expect(requestTtsAudio(
      { ...settings, targetLanguage: "gaa", voice: "khaya:gaa:male_low" },
      "token",
      "Hello"
    )).rejects.toThrow("Unable to generate speech: Text-to-speech is temporarily unavailable.");
  });

  it("loads the signed-in account's document limits", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      plan: "free",
      isPremium: false,
      features: { largeDocuments: false, premiumAudio: false },
      limits: { maxUploadBytes: 10_485_760, maxDocumentCharacters: 100_000, maxPdfPages: 50, dailyTtsCharacters: 25_000 }
    }));

    const entitlement = await getRemoteEntitlement(settings.apiBaseUrl, "token");

    expect(entitlement.plan).toBe("free");
    expect(entitlement.limits.maxPdfPages).toBe(50);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.test/api/entitlements", {
      headers: { Authorization: "Bearer token" }
    });
  });

  it("reports real upload progress, then processing, before resolving the Library item", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const file = new File([new Uint8Array(10)], "report.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();
    const onUploadComplete = vi.fn();

    const resultPromise = uploadPdfDocument(settings.apiBaseUrl, "token", file, settings, "Quarterly report", {
      onProgress,
      onUploadComplete
    });
    const xhr = FakeXMLHttpRequest.latest;
    expect(xhr).toBeDefined();
    expect(xhr?.method).toBe("POST");
    expect(xhr?.url).toBe("https://api.example.test/api/content/upload-pdf");
    expect(xhr?.headers.get("Authorization")).toBe("Bearer token");
    expect(xhr?.body).toBeInstanceOf(FormData);
    expect((xhr?.body as FormData).get("title")).toBe("Quarterly report");

    xhr?.emitProgress(5, 10);
    expect(onProgress).toHaveBeenLastCalledWith({ loadedBytes: 5, totalBytes: 10, percent: 50 });
    xhr?.emitUploadComplete();
    expect(onUploadComplete).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith({ loadedBytes: 10, totalBytes: 10, percent: 100 });
    expect(xhr?.timeout).toBe(0);
    xhr?.respond(201, { document: createDocument({ id: "doc_upload", sourceType: "pdf" }) });

    await expect(resultPromise).resolves.toMatchObject({ id: "doc_upload", sourceType: "pdf" });
  });

  it("preserves a Premium document gate instead of reporting an auth failure", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const file = new File([new Uint8Array(10)], "large.pdf", { type: "application/pdf" });
    const resultPromise = uploadPdfDocument(settings.apiBaseUrl, "token", file, settings);

    FakeXMLHttpRequest.latest?.respond(403, {
      error: "This document exceeds the Free plan limit.",
      code: "PREMIUM_REQUIRED",
      feature: "large_documents"
    });

    await expect(resultPromise).rejects.toMatchObject({
      name: "UploadRequestError",
      status: 403,
      code: "PREMIUM_REQUIRED",
      feature: "large_documents"
    });
    await resultPromise.catch((error) => expect(error).toBeInstanceOf(UploadRequestError));
  });

  it("preserves upload quota details and the server retry window", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const resultPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "token",
      new File([new Uint8Array(2)], "report.pdf", { type: "application/pdf" }),
      settings
    );

    FakeXMLHttpRequest.latest?.respond(429, {
      error: "Upload quota reached.",
      code: "UPLOAD_QUOTA_REACHED"
    }, { "Retry-After": "12" });

    await expect(resultPromise).rejects.toMatchObject({
      status: 429,
      code: "UPLOAD_QUOTA_REACHED",
      retryAfterSeconds: 12
    });
  });

  it("reports network and transfer-timeout failures without inventing progress", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const networkPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "token",
      new File([new Uint8Array(2)], "network.pdf", { type: "application/pdf" }),
      settings
    );
    FakeXMLHttpRequest.latest?.emitNetworkError();
    await expect(networkPromise).rejects.toMatchObject({ status: 0 });

    const timeoutPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "token",
      new File([new Uint8Array(2)], "slow.pdf", { type: "application/pdf" }),
      settings
    );
    expect(FakeXMLHttpRequest.latest?.timeout).toBe(5 * 60 * 1000);
    FakeXMLHttpRequest.latest?.emitTimeout();
    await expect(timeoutPromise).rejects.toMatchObject({ status: 408 });
  });

  it("rejects a successful upload response that has no Library document", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const resultPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "token",
      new File([new Uint8Array(2)], "report.pdf", { type: "application/pdf" }),
      settings
    );

    FakeXMLHttpRequest.latest?.respond(201, { ok: true });

    await expect(resultPromise).rejects.toMatchObject({ status: 201 });
  });

  it("still reports an unauthorized upload as an expired session", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const resultPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "expired-token",
      new File([new Uint8Array(2)], "report.pdf", { type: "application/pdf" }),
      settings
    );

    FakeXMLHttpRequest.latest?.respond(401, { error: "Authentication required." });

    await expect(resultPromise).rejects.toThrow(AUTH_REQUIRED_ERROR);
  });

  it("allows an in-flight upload to be cancelled", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    const controller = new AbortController();
    const resultPromise = uploadPdfDocument(
      settings.apiBaseUrl,
      "token",
      new File([new Uint8Array(2)], "report.pdf", { type: "application/pdf" }),
      settings,
      undefined,
      { signal: controller.signal }
    );

    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXMLHttpRequest.latest?.aborted).toBe(true);
  });
});

function createChunk(overrides: Partial<ReadingChunk> = {}): ReadingChunk {
  return {
    id: "chunk_1",
    text: "Readable text for the current article.",
    sourceType: "webpage",
    pageUrl: "https://example.com/article",
    title: "Article title",
    ...overrides
  };
}

function createDocument(overrides: Partial<ReadingDocument> = {}): ReadingDocument {
  return {
    id: "doc_1",
    userId: "user_1",
    title: "Article title",
    sourceType: "webpage",
    sourceUrl: "https://example.com/article",
    category: "Websites",
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:00.000Z",
    progress: { blockIndex: 0, characterOffset: 0, sentenceIndex: 0, percent: 0 },
    voice: "en-US-Neural2-J",
    speed: 1,
    blocks: [],
    ...overrides
  };
}

function compactLibraryItem(index: number) {
  return {
    documentId: `doc_${index}`,
    title: `Saved item ${index}`,
    sourceType: "webpage",
    category: "Websites",
    sourceLabel: "Example News",
    author: "Ama Mensah",
    status: index === 0 ? "unread" : "in_progress",
    progressPercent: index,
    estimatedListeningSeconds: 120,
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
    lastReadAt: index === 0 ? undefined : "2026-08-29T10:01:00.000Z"
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

class FakeXMLHttpRequest {
  static latest: FakeXMLHttpRequest | undefined;

  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
    onload: (() => void) | null;
  } = { onprogress: null, onload: null };
  readonly headers = new Map<string, string>();
  readonly responseHeaders = new Map<string, string>();
  method = "";
  url = "";
  timeout = 0;
  status = 0;
  responseText = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  aborted = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXMLHttpRequest.latest = this;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  getResponseHeader(name: string): string | null {
    return this.responseHeaders.get(name) ?? null;
  }

  send(body: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  emitProgress(loaded: number, total: number): void {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }

  emitUploadComplete(): void {
    this.upload.onload?.();
  }

  emitNetworkError(): void {
    this.onerror?.();
  }

  emitTimeout(): void {
    this.ontimeout?.();
  }

  respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    Object.entries(headers).forEach(([name, value]) => this.responseHeaders.set(name, value));
    this.onload?.();
  }
}
