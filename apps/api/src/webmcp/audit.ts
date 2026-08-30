import { createHmac } from "node:crypto";
import { z } from "zod";

export const webMcpToolNames = [
  "readmate_search_library",
  "readmate_get_document_context",
  "readmate_prepare_listening",
  "readmate_add_web_page",
  "readmate_subscribe_rss",
  "readmate_generate_study_pack"
] as const;

export const webMcpActionClasses = ["read", "ui_state", "write", "paid_ai"] as const;
export const webMcpAuditStatuses = ["started", "confirmed", "succeeded", "failed", "cancelled"] as const;
export const webMcpResourceTypes = ["document", "source", "study_pack"] as const;
export const WEBMCP_MAX_AUDIT_LATENCY_MS = 300_000;

export type WebMcpToolName = (typeof webMcpToolNames)[number];
export type WebMcpActionClass = (typeof webMcpActionClasses)[number];
export type WebMcpAuditStatus = (typeof webMcpAuditStatuses)[number];
export type WebMcpResourceType = (typeof webMcpResourceTypes)[number];

export const webMcpRequestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Request ID must be an opaque identifier.");

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Resource IDs must be opaque identifiers.");
const languageSchema = z.enum(["en", "tw", "ee", "gaa"]);
const sourceTypeSchema = z.enum(["webpage", "pdf", "rss", "document"]);
const readingStatusSchema = z.enum(["unread", "in_progress", "completed"]);

const publicHttpsUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .refine(isPublicHttpsUrl, "A public HTTPS URL without embedded credentials is required.")
  .transform(canonicalizeWebMcpUrl);

const searchLibraryInputSchema = z
  .object({
    query: z.string().trim().min(1).max(120),
    sourceType: sourceTypeSchema.optional(),
    status: readingStatusSchema.optional(),
    targetLanguage: languageSchema.optional(),
    limit: z.number().int().min(1).max(10).optional()
  })
  .strict();

const getDocumentContextInputSchema = z
  .object({
    documentId: opaqueIdSchema
  })
  .strict();

const prepareListeningInputSchema = z
  .object({
    documentId: opaqueIdSchema,
    targetLanguage: languageSchema,
    voice: z.string().trim().min(1).max(80).optional(),
    startAt: z.enum(["resume", "beginning"]).optional()
  })
  .strict();

const addWebPageInputSchema = z
  .object({
    url: publicHttpsUrlSchema,
    title: z.string().trim().min(1).max(160).optional(),
    category: z.string().trim().min(1).max(60).optional(),
    preferredLanguage: languageSchema.optional()
  })
  .strict();

const subscribeRssInputSchema = z
  .object({
    feedUrl: publicHttpsUrlSchema,
    sourceName: z.string().trim().min(1).max(120),
    topics: z
      .array(z.string().trim().min(1).max(40))
      .max(10)
      .transform((topics) => [...new Set(topics)].sort())
      .optional(),
    articlesPerRefresh: z.number().int().min(1).max(50).optional()
  })
  .strict();

const generateStudyPackInputSchema = z
  .object({
    documentId: opaqueIdSchema,
    targetLanguage: languageSchema.optional(),
    flashcardCount: z.number().int().min(1).max(24).optional(),
    quizCount: z.number().int().min(1).max(12).optional()
  })
  .strict();

const sharedAuditFields = {
  requestId: webMcpRequestIdSchema.optional(),
  status: z.enum(webMcpAuditStatuses),
  resourceType: z.enum(webMcpResourceTypes).optional(),
  resourceId: opaqueIdSchema.optional(),
  errorCode: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Z][A-Z0-9_]*$/, "Error codes must be stable uppercase identifiers.")
    .optional(),
  latencyMs: z.number().int().min(0).max(WEBMCP_MAX_AUDIT_LATENCY_MS).optional()
} as const;

export const webMcpAuditRequestSchema = z
  .discriminatedUnion("toolName", [
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_search_library"),
        actionClass: z.literal("read"),
        input: searchLibraryInputSchema.optional()
      })
      .strict(),
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_get_document_context"),
        actionClass: z.literal("read"),
        input: getDocumentContextInputSchema.optional()
      })
      .strict(),
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_prepare_listening"),
        actionClass: z.literal("ui_state"),
        input: prepareListeningInputSchema.optional()
      })
      .strict(),
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_add_web_page"),
        actionClass: z.literal("write"),
        input: addWebPageInputSchema.optional()
      })
      .strict(),
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_subscribe_rss"),
        actionClass: z.literal("write"),
        input: subscribeRssInputSchema.optional()
      })
      .strict(),
    z
      .object({
        ...sharedAuditFields,
        toolName: z.literal("readmate_generate_study_pack"),
        actionClass: z.literal("paid_ai"),
        input: generateStudyPackInputSchema.optional()
      })
      .strict()
  ])
  .superRefine((value, context) => {
    if ((value.actionClass === "write" || value.actionClass === "paid_ai") && !value.requestId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestId"],
        message: "Writes and paid AI actions require a request ID."
      });
    }
    if (value.status === "confirmed" && value.actionClass !== "write" && value.actionClass !== "paid_ai") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Only confirmed writes and paid AI actions use the confirmed status."
      });
    }
    if (Boolean(value.resourceType) !== Boolean(value.resourceId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: value.resourceType ? ["resourceId"] : ["resourceType"],
        message: "Resource type and resource ID must be provided together."
      });
    }
    if (value.status === "failed" && !value.errorCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "Failed events require a safe error code."
      });
    }
    if (value.status !== "failed" && value.errorCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCode"],
        message: "Error codes are only accepted for failed events."
      });
    }
  });

export type WebMcpAuditRequest = z.infer<typeof webMcpAuditRequestSchema>;

export function digestWebMcpInput(input: unknown, key: string): string {
  return digestWebMcpValue(input, key, "readmate-webmcp-audit-v1");
}

export function digestWebMcpActionInput(input: unknown, key: string): string {
  return digestWebMcpValue(input, key, "readmate-webmcp-action-v1");
}

function digestWebMcpValue(input: unknown, key: string, domain: string): string {
  const normalizedKey = key.trim();
  if (normalizedKey.length < 32) {
    throw new Error("WebMCP audit digest key must contain at least 32 characters.");
  }
  return createHmac("sha256", normalizedKey)
    .update(`${domain}\n`)
    .update(stableJson(input))
    .digest("hex");
}

export function resolveWebMcpAuditDigestKey(): string {
  const dedicatedKey = process.env.WEBMCP_AUDIT_DIGEST_KEY?.trim();
  const developmentFallback = process.env.NODE_ENV === "production" ? undefined : process.env.CLERK_SECRET_KEY?.trim();
  const key = dedicatedKey || developmentFallback;
  if (!key || key.length < 32) {
    throw new Error("WebMCP audit input hashing is not configured.");
  }
  return key;
}

export function canonicalizeWebMcpUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
