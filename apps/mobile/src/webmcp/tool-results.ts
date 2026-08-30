import { ToolInputValidationError } from "./schemas";
import type { ReadMateTargetLanguage, ReadMateToolName } from "./tool-names";
import type { ReadMateReadingStatus, ReadMateSourceType, ReadMateStartPosition } from "./schemas";

export const MAX_TOOL_OUTPUT_CHARS = 1_500;

export const READMATE_TOOL_ACTIONS = {
  readmate_search_library: "searched_library",
  readmate_get_document_context: "document_context",
  readmate_prepare_listening: "prepared_listening",
  readmate_add_web_page: "saved_web_page",
  readmate_subscribe_rss: "subscribed_rss",
  readmate_generate_study_pack: "generated_study_pack"
} as const satisfies Record<ReadMateToolName, string>;

export type SearchLibraryItem = {
  documentId: string;
  title: string;
  sourceType: ReadMateSourceType;
  status?: ReadMateReadingStatus;
  progressPercent: number;
  targetLanguage?: ReadMateTargetLanguage;
  updatedAt: string;
  deepLink: string;
};

export type SearchLibraryResource = {
  results: SearchLibraryItem[];
  total?: number;
};

export type DocumentContextResource = {
  documentId: string;
  title: string;
  sourceType: ReadMateSourceType;
  sourceLabel?: string;
  status: ReadMateReadingStatus;
  progressPercent: number;
  summaryAvailable: boolean;
  flashcardCount: number;
  quizCount: number;
  estimatedListeningSeconds?: number;
  supportedActions: ReadMateToolName[];
  deepLink: string;
};

export type PrepareListeningResource = {
  documentId: string;
  targetLanguage: ReadMateTargetLanguage;
  voice?: string;
  startAt: ReadMateStartPosition;
  status: "ready";
  deepLink: string;
};

export type AddWebPageResource = {
  documentId: string;
  title: string;
  status: "ready" | "processing";
  deepLink: string;
};

export type SubscribeRssResource = {
  subscriptionId: string;
  sourceName: string;
  status: "subscribed" | "reactivated" | "sync_pending";
  deepLink: string;
};

export type GenerateStudyPackResource = {
  documentId: string;
  summaryAvailable: boolean;
  keyPointCount: number;
  flashcardCount: number;
  quizCount: number;
  fallback?: boolean;
  syncPending?: boolean;
  deepLink: string;
};

export type ReadMateToolResourceMap = {
  readmate_search_library: SearchLibraryResource;
  readmate_get_document_context: DocumentContextResource;
  readmate_prepare_listening: PrepareListeningResource;
  readmate_add_web_page: AddWebPageResource;
  readmate_subscribe_rss: SubscribeRssResource;
  readmate_generate_study_pack: GenerateStudyPackResource;
};

export type ReadMateToolSuccess<TResource = Record<string, unknown>> = {
  ok: true;
  action: string;
  resource: TResource;
  message: string;
};

export const READMATE_TOOL_ERROR_CODES = [
  "AUTH_REQUIRED",
  "INVALID_INPUT",
  "NOT_FOUND",
  "BLOCKED_URL",
  "PLAN_LIMIT",
  "RATE_LIMITED",
  "CONFLICT",
  "CANCELLED",
  "TEMPORARY_FAILURE"
] as const;

export type ReadMateToolErrorCode = (typeof READMATE_TOOL_ERROR_CODES)[number];

export type ReadMateToolFailure = {
  ok: false;
  action: string;
  error: {
    code: ReadMateToolErrorCode;
    message: string;
    nextAction: string;
  };
};

export type ReadMateToolOutput<TResource = Record<string, unknown>> =
  | ReadMateToolSuccess<TResource>
  | ReadMateToolFailure;

export type ReadMateToolHandlerResult<TResource> = {
  resource: TResource;
  message: string;
};

export class ReadMateToolExecutionError extends Error {
  constructor(
    readonly code: ReadMateToolErrorCode,
    message: string,
    readonly nextAction: string
  ) {
    super(message);
    this.name = "ReadMateToolExecutionError";
  }
}

export function compactToolSuccess<TName extends ReadMateToolName>(
  name: TName,
  result: ReadMateToolHandlerResult<ReadMateToolResourceMap[TName]>
): ReadMateToolSuccess<ReadMateToolResourceMap[TName] | Record<string, unknown>> {
  const envelope = {
    ok: true as const,
    action: READMATE_TOOL_ACTIONS[name],
    resource: sanitizeRecord(result.resource),
    message: sanitizeString(result.message, 320)
  };
  return enforceOutputBudget(envelope) as ReadMateToolSuccess<
    ReadMateToolResourceMap[TName] | Record<string, unknown>
  >;
}

export function compactToolError(
  name: ReadMateToolName,
  code: ReadMateToolErrorCode,
  message: string,
  nextAction: string
): ReadMateToolFailure {
  return enforceOutputBudget({
    ok: false,
    action: READMATE_TOOL_ACTIONS[name],
    error: {
      code,
      message: sanitizeString(message, 280),
      nextAction: sanitizeString(nextAction, 280)
    }
  }) as ReadMateToolFailure;
}

export function toolErrorFromUnknown(name: ReadMateToolName, error: unknown, signal?: AbortSignal): ReadMateToolFailure {
  if (isAuthenticationFailure(error)) {
    return compactToolError(name, "AUTH_REQUIRED", "Your ReadMate session is no longer available.", "Sign in again, then retry the action.");
  }
  if (error instanceof ReadMateToolExecutionError) {
    return compactToolError(name, error.code, error.message, error.nextAction);
  }
  if (signal?.aborted || isAbortError(error)) {
    return compactToolError(name, "CANCELLED", "The ReadMate action was cancelled.", "Start the action again if you still want it.");
  }
  if (error instanceof ToolInputValidationError) {
    return compactToolError(name, "INVALID_INPUT", "The supplied fields did not match this ReadMate action.", "Correct the highlighted fields and try again.");
  }
  const status = statusFromUnknown(error);
  if (status === 404) {
    return compactToolError(name, "NOT_FOUND", "That ReadMate item is unavailable.", "Search the library again and select an owned item.");
  }
  if (status === 409) {
    return compactToolError(name, "CONFLICT", "ReadMate could not apply the action because the item changed.", "Refresh ReadMate and review the current item before retrying.");
  }
  if (status === 402 || status === 403) {
    return compactToolError(name, "PLAN_LIMIT", "This action is outside the current ReadMate plan or quota.", "Review the plan notice in ReadMate; no purchase was made.");
  }
  if (status === 429) {
    return compactToolError(name, "RATE_LIMITED", "ReadMate is temporarily limiting this action.", "Wait briefly, then retry once.");
  }
  return compactToolError(name, "TEMPORARY_FAILURE", "ReadMate could not complete the action right now.", "Keep the current selection and retry once later.");
}

export function isAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof ReadMateToolExecutionError && error.code === "AUTH_REQUIRED"
  ) || statusFromUnknown(error) === 401;
}

export function toolOutputLength(output: ReadMateToolOutput<unknown>): number {
  return JSON.stringify(output).length;
}

function enforceOutputBudget(output: ReadMateToolOutput<unknown>): ReadMateToolOutput<unknown> {
  if (toolOutputLength(output) <= MAX_TOOL_OUTPUT_CHARS) return output;

  if (output.ok && isRecord(output.resource) && Array.isArray(output.resource.results)) {
    const resource = { ...output.resource, results: [...output.resource.results], truncated: true };
    const candidate = { ...output, resource, message: sanitizeString(output.message, 180) };
    while (resource.results.length && toolOutputLength(candidate) > MAX_TOOL_OUTPUT_CHARS) {
      resource.results.pop();
    }
    if (toolOutputLength(candidate) <= MAX_TOOL_OUTPUT_CHARS) return candidate;
  }

  if (output.ok) {
    return {
      ok: true,
      action: sanitizeString(output.action, 80),
      resource: { truncated: true },
      message: sanitizeString(output.message, 240)
    };
  }

  return {
    ok: false,
    action: sanitizeString(output.action, 80),
    error: {
      code: output.error.code,
      message: sanitizeString(output.error.message, 240),
      nextAction: sanitizeString(output.error.nextAction, 240)
    }
  };
}

function sanitizeRecord(value: unknown, depth = 0): Record<string, unknown> {
  if (!isRecord(value) || depth > 4) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) continue;
    if (key.toLowerCase().includes("url") && key !== "deepLink") continue;
    if (key === "deepLink") {
      if (typeof item === "string" && isSafeDeepLink(item)) sanitized[key] = sanitizeString(item, 240, true);
      continue;
    }
    if (typeof item === "string") sanitized[key] = sanitizeString(item, 240);
    else if (typeof item === "number" && Number.isFinite(item)) sanitized[key] = item;
    else if (typeof item === "boolean" || item === null) sanitized[key] = item;
    else if (Array.isArray(item)) {
      sanitized[key] = item.slice(0, 10).map((entry) =>
        isRecord(entry) ? sanitizeRecord(entry, depth + 1) : typeof entry === "string" ? sanitizeString(entry, 200) : entry
      );
    } else if (isRecord(item)) sanitized[key] = sanitizeRecord(item, depth + 1);
  }
  return sanitized;
}

function sanitizeString(value: string, maxLength: number, allowRelativeLink = false): string {
  let sanitized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]");
  if (!allowRelativeLink) sanitized = sanitized.replace(/https?:\/\/\S+/gi, "[redacted-url]");
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  if (sanitized.length <= maxLength) return sanitized;
  return `${sanitized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isSafeDeepLink(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001F\u007F]/.test(value);
}

function isSensitiveKey(key: string): boolean {
  return /^(?:token|accessToken|refreshToken|authorization|secret|credential|cookie|apiKey|storageKey|storageUrl|signedUrl|privateUrl|providerError|providerResponse|blocks|body|content|contentHtml|raw|rawText|rawContent)$/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function statusFromUnknown(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}
