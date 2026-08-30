import type { ReadingDocument } from "../types";
import type { GetDocumentContextInput, SearchLibraryInput } from "./schemas";
import type {
  DocumentContextResource,
  SearchLibraryResource
} from "./tool-results";
import type { ReadMateSourceType } from "./schemas";
import type { ReadMateTargetLanguage } from "./tool-names";

export type DocumentContextTransport = {
  documentId: string;
  title: string;
  sourceType: ReadingDocument["sourceType"];
  sourceLabel?: string;
  status: ReadingDocument["status"];
  progressPercent: number;
  summaryAvailable: boolean;
  flashcardCount: number;
  quizCount: number;
  estimatedListeningSeconds?: number;
  supportedActions: string[];
};

export type LibrarySearchTransport = {
  results: Array<{
    documentId: string;
    title: string;
    sourceType: ReadMateSourceType;
    status: ReadingDocument["status"];
    progressPercent: number;
    updatedAt: string;
    deepLink: string;
  }>;
  total: number;
};

export function normalizeAgentSourceType(sourceType: ReadingDocument["sourceType"]): ReadMateSourceType {
  if (sourceType === "pdf") return "pdf";
  if (sourceType === "rss" || sourceType === "news") return "rss";
  if (sourceType === "document" || sourceType === "ocr") return "document";
  return "webpage";
}

export function buildLibrarySearchPath(input: SearchLibraryInput): string {
  const params = new URLSearchParams();
  params.set("q", input.query.trim());
  if (input.status) params.set("status", input.status);
  if (input.sourceType) params.set("sourceType", input.sourceType);
  params.set("limit", String(Math.min(10, Math.max(1, input.limit ?? 10))));
  return `/api/documents/search-context?${params.toString()}`;
}

export function compactLibrarySearch(
  response: LibrarySearchTransport,
  input: SearchLibraryInput,
  fallbackLanguage: ReadMateTargetLanguage
): SearchLibraryResource {
  const targetLanguage = input.targetLanguage ?? fallbackLanguage;
  const limit = Math.min(10, Math.max(1, input.limit ?? 10));
  const results = response.results
    .slice(0, limit)
    .map((document) => ({
      documentId: document.documentId,
      title: document.title,
      sourceType: document.sourceType,
      status: document.status,
      progressPercent: clampPercent(document.progressPercent),
      targetLanguage,
      updatedAt: document.updatedAt,
      deepLink: `/document/${encodeURIComponent(document.documentId)}`
    }));
  return { results, total: Math.max(results.length, nonNegativeInteger(response.total)) };
}

export function compactDocumentContext(
  input: GetDocumentContextInput,
  context: DocumentContextTransport
): DocumentContextResource {
  const documentId = input.documentId;
  return {
    documentId,
    title: context.title,
    sourceType: normalizeAgentSourceType(context.sourceType),
    sourceLabel: context.sourceLabel,
    status: context.status,
    progressPercent: clampPercent(context.progressPercent),
    summaryAvailable: Boolean(context.summaryAvailable),
    flashcardCount: nonNegativeInteger(context.flashcardCount),
    quizCount: nonNegativeInteger(context.quizCount),
    estimatedListeningSeconds: context.estimatedListeningSeconds === undefined
      ? undefined
      : nonNegativeInteger(context.estimatedListeningSeconds),
    supportedActions: context.supportedActions.filter(
      (action): action is "readmate_prepare_listening" | "readmate_generate_study_pack" =>
        action === "readmate_prepare_listening" || action === "readmate_generate_study_pack"
    ),
    deepLink: `/document/${encodeURIComponent(documentId)}`
  };
}

export function listeningDeepLink(input: {
  documentId: string;
  targetLanguage: ReadMateTargetLanguage;
  startAt?: "resume" | "beginning";
}): string {
  const params = new URLSearchParams({
    documentId: input.documentId,
    targetLanguage: input.targetLanguage,
    startAt: input.startAt ?? "resume"
  });
  return `/player?${params.toString()}`;
}

export function documentForListening(document: ReadingDocument, startAt: "resume" | "beginning" = "resume"): ReadingDocument {
  if (startAt === "resume") return document;
  return {
    ...document,
    status: "unread",
    progress: {
      blockIndex: 0,
      characterOffset: 0,
      sentenceIndex: 0,
      percent: 0
    }
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function nonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
