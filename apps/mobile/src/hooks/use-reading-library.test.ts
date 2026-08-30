import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearDocumentHistory: vi.fn(),
  clearReadingHistory: vi.fn(),
  createDocument: vi.fn(),
  deleteLearningData: vi.fn(),
  deleteDocument: vi.fn(),
  deleteSource: vi.fn(),
  getDocuments: vi.fn(),
  getSources: vi.fn(),
  getToken: vi.fn(),
  getUserSettings: vi.fn(),
  saveUrlContent: vi.fn(),
  updateDocument: vi.fn(),
  updateDocumentProgress: vi.fn(),
  updateSource: vi.fn(),
  updateUserSettings: vi.fn(),
  uploadPdfDocument: vi.fn()
}));

const queryClient = vi.hoisted(() => ({
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
  setQueryData: vi.fn()
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({
    isSignedIn: true,
    getToken: mocks.getToken
  })
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => options,
  useQuery: () => ({ data: [] }),
  useQueryClient: () => queryClient
}));

vi.mock("@/api/documents", () => ({
  clearDocumentHistory: mocks.clearDocumentHistory,
  clearReadingHistory: mocks.clearReadingHistory,
  createDocument: mocks.createDocument,
  deleteLearningData: mocks.deleteLearningData,
  deleteDocument: mocks.deleteDocument,
  deleteSource: mocks.deleteSource,
  getDocuments: mocks.getDocuments,
  getSources: mocks.getSources,
  getUserSettings: mocks.getUserSettings,
  saveUrlContent: mocks.saveUrlContent,
  updateDocument: mocks.updateDocument,
  updateDocumentProgress: mocks.updateDocumentProgress,
  updateSource: mocks.updateSource,
  updateUserSettings: mocks.updateUserSettings,
  uploadPdfDocument: mocks.uploadPdfDocument
}));

vi.mock("@/utils/document-list", () => ({
  balanceFeedDocuments: (documents: unknown[]) => documents,
  dedupeDocuments: (documents: unknown[]) => documents,
  prependDocument: (documents: unknown[], document: unknown) => [document, ...documents]
}));

vi.mock("@/utils/screenshot-mode", () => ({
  screenshotMode: false
}));

import { useReadingLibrary } from "./use-reading-library";

type CapturedMutation<TInput, TResult> = {
  mutationFn: (input: TInput) => Promise<TResult>;
};

describe("useReadingLibrary destructive actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getToken.mockResolvedValue("test-token");
  });

  it("removes a History item through playback reset only", async () => {
    const resetDocument = { id: "document-1" };
    mocks.clearDocumentHistory.mockResolvedValue(resetDocument);

    const { removeHistoryItem } = useReadingLibrary();
    const mutation = removeHistoryItem as unknown as CapturedMutation<string, typeof resetDocument>;

    await expect(mutation.mutationFn("document-1")).resolves.toBe(resetDocument);

    expect(mocks.clearDocumentHistory).toHaveBeenCalledOnce();
    expect(mocks.clearDocumentHistory).toHaveBeenCalledWith("document-1", "test-token");
    expect(mocks.deleteLearningData).not.toHaveBeenCalled();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it("performs Study cleanup and document deletion for an explicit Library delete", async () => {
    mocks.deleteLearningData.mockResolvedValue(undefined);
    mocks.deleteDocument.mockResolvedValue(undefined);

    const { removeDocument } = useReadingLibrary();
    const mutation = removeDocument as unknown as CapturedMutation<string, string>;

    await expect(mutation.mutationFn("document-1")).resolves.toBe("document-1");

    expect(mocks.clearDocumentHistory).not.toHaveBeenCalled();
    expect(mocks.deleteLearningData).toHaveBeenCalledOnce();
    expect(mocks.deleteLearningData).toHaveBeenCalledWith("test-token", "document-1");
    expect(mocks.deleteDocument).toHaveBeenCalledOnce();
    expect(mocks.deleteDocument).toHaveBeenCalledWith("document-1", "test-token");
    expect(mocks.deleteLearningData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDocument.mock.invocationCallOrder[0]
    );
  });
});
