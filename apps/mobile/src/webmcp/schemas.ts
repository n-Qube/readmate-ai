import {
  READMATE_TARGET_LANGUAGES,
  type ReadMateTargetLanguage,
  type ReadMateToolName
} from "./tool-names";

export const READMATE_SOURCE_TYPES = ["webpage", "pdf", "rss", "document"] as const;
export const READMATE_READING_STATUSES = ["unread", "in_progress", "completed"] as const;
export const READMATE_START_POSITIONS = ["resume", "beginning"] as const;

export type ReadMateSourceType = (typeof READMATE_SOURCE_TYPES)[number];
export type ReadMateReadingStatus = (typeof READMATE_READING_STATUSES)[number];
export type ReadMateStartPosition = (typeof READMATE_START_POSITIONS)[number];

export type SearchLibraryInput = {
  query: string;
  sourceType?: ReadMateSourceType;
  status?: ReadMateReadingStatus;
  targetLanguage?: ReadMateTargetLanguage;
  limit?: number;
};

export type GetDocumentContextInput = {
  documentId: string;
};

export type PrepareListeningInput = {
  documentId: string;
  targetLanguage: ReadMateTargetLanguage;
  voice?: string;
  startAt?: ReadMateStartPosition;
};

export type AddWebPageInput = {
  url: string;
  title?: string;
  category?: string;
  preferredLanguage?: ReadMateTargetLanguage;
};

export type SubscribeRssInput = {
  feedUrl: string;
  sourceName: string;
  topics?: string[];
  articlesPerRefresh?: number;
};

export type GenerateStudyPackInput = {
  documentId: string;
  targetLanguage?: ReadMateTargetLanguage;
  flashcardCount?: number;
  quizCount?: number;
};

export type ReadMateToolInputMap = {
  readmate_search_library: SearchLibraryInput;
  readmate_get_document_context: GetDocumentContextInput;
  readmate_prepare_listening: PrepareListeningInput;
  readmate_add_web_page: AddWebPageInput;
  readmate_subscribe_rss: SubscribeRssInput;
  readmate_generate_study_pack: GenerateStudyPackInput;
};

export type JsonSchemaProperty = {
  readonly type?: "string" | "integer" | "array";
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly format?: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly items?: JsonSchemaProperty;
};

export type ReadMateInputSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

const documentIdProperty = {
  type: "string",
  description: "Owned ReadMate document ID returned by a library search.",
  minLength: 1,
  maxLength: 80,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"
} as const;

const targetLanguageProperty = {
  type: "string",
  description: "Reading or study language: English, Twi, Ewe, or Ga.",
  enum: READMATE_TARGET_LANGUAGES
} as const;

const publicHttpsUrlProperty = {
  type: "string",
  format: "uri",
  pattern: "^https://",
  minLength: 9,
  maxLength: 2048
} as const;

export const READMATE_TOOL_SCHEMAS = {
  readmate_search_library: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Title, topic, author, or source label to find in the signed-in library.",
        minLength: 1,
        maxLength: 120
      },
      sourceType: {
        type: "string",
        description: "Optional saved-content type filter.",
        enum: READMATE_SOURCE_TYPES
      },
      status: {
        type: "string",
        description: "Optional reading-progress status filter.",
        enum: READMATE_READING_STATUSES
      },
      targetLanguage: targetLanguageProperty,
      limit: {
        type: "integer",
        description: "Maximum compact results to return.",
        minimum: 1,
        maximum: 10
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  readmate_get_document_context: {
    type: "object",
    properties: { documentId: documentIdProperty },
    required: ["documentId"],
    additionalProperties: false
  },
  readmate_prepare_listening: {
    type: "object",
    properties: {
      documentId: documentIdProperty,
      targetLanguage: targetLanguageProperty,
      voice: {
        type: "string",
        description: "Optional ReadMate voice ID appropriate for the selected language.",
        minLength: 1,
        maxLength: 80
      },
      startAt: {
        type: "string",
        description: "Resume saved progress or begin at the start.",
        enum: READMATE_START_POSITIONS
      }
    },
    required: ["documentId", "targetLanguage"],
    additionalProperties: false
  },
  readmate_add_web_page: {
    type: "object",
    properties: {
      url: {
        ...publicHttpsUrlProperty,
        description: "Public HTTPS webpage to review before saving."
      },
      title: {
        type: "string",
        description: "Optional title override shown in the review form.",
        minLength: 1,
        maxLength: 160
      },
      category: {
        type: "string",
        description: "Optional ReadMate library category.",
        minLength: 1,
        maxLength: 60
      },
      preferredLanguage: targetLanguageProperty
    },
    required: ["url"],
    additionalProperties: false
  },
  readmate_subscribe_rss: {
    type: "object",
    properties: {
      feedUrl: {
        ...publicHttpsUrlProperty,
        description: "Public HTTPS RSS or Atom feed to review before subscribing."
      },
      sourceName: {
        type: "string",
        description: "Short source name shown in ReadMate.",
        minLength: 1,
        maxLength: 120
      },
      topics: {
        type: "array",
        description: "Optional topic labels for the source.",
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 40 }
      },
      articlesPerRefresh: {
        type: "integer",
        description: "Maximum new articles considered during each refresh.",
        minimum: 1,
        maximum: 50
      }
    },
    required: ["feedUrl", "sourceName"],
    additionalProperties: false
  },
  readmate_generate_study_pack: {
    type: "object",
    properties: {
      documentId: documentIdProperty,
      targetLanguage: targetLanguageProperty,
      flashcardCount: {
        type: "integer",
        description: "Requested flashcard count.",
        minimum: 1,
        maximum: 24
      },
      quizCount: {
        type: "integer",
        description: "Requested quiz-question count.",
        minimum: 1,
        maximum: 12
      }
    },
    required: ["documentId"],
    additionalProperties: false
  }
} as const satisfies Record<ReadMateToolName, ReadMateInputSchema>;

export class ToolInputValidationError extends Error {
  readonly code = "INVALID_INPUT";

  constructor(readonly issues: readonly string[]) {
    super("The tool input did not match the required schema.");
    this.name = "ToolInputValidationError";
  }
}

export function parseReadMateToolInput<TName extends ReadMateToolName>(
  name: TName,
  input: unknown
): ReadMateToolInputMap[TName] {
  switch (name) {
    case "readmate_search_library":
      return parseSearchLibraryInput(input) as ReadMateToolInputMap[TName];
    case "readmate_get_document_context":
      return parseDocumentContextInput(input) as ReadMateToolInputMap[TName];
    case "readmate_prepare_listening":
      return parsePrepareListeningInput(input) as ReadMateToolInputMap[TName];
    case "readmate_add_web_page":
      return parseAddWebPageInput(input) as ReadMateToolInputMap[TName];
    case "readmate_subscribe_rss":
      return parseSubscribeRssInput(input) as ReadMateToolInputMap[TName];
    case "readmate_generate_study_pack":
      return parseStudyPackInput(input) as ReadMateToolInputMap[TName];
  }
}

function parseSearchLibraryInput(input: unknown): SearchLibraryInput {
  const value = objectInput(input, ["query", "sourceType", "status", "targetLanguage", "limit"]);
  return defined({
    query: requiredString(value.query, "query", 120),
    sourceType: optionalEnum(value.sourceType, "sourceType", READMATE_SOURCE_TYPES),
    status: optionalEnum(value.status, "status", READMATE_READING_STATUSES),
    targetLanguage: optionalEnum(value.targetLanguage, "targetLanguage", READMATE_TARGET_LANGUAGES),
    limit: optionalInteger(value.limit, "limit", 1, 10)
  });
}

function parseDocumentContextInput(input: unknown): GetDocumentContextInput {
  const value = objectInput(input, ["documentId"]);
  return { documentId: documentId(value.documentId) };
}

function parsePrepareListeningInput(input: unknown): PrepareListeningInput {
  const value = objectInput(input, ["documentId", "targetLanguage", "voice", "startAt"]);
  return defined({
    documentId: documentId(value.documentId),
    targetLanguage: requiredEnum(value.targetLanguage, "targetLanguage", READMATE_TARGET_LANGUAGES),
    voice: optionalString(value.voice, "voice", 80),
    startAt: optionalEnum(value.startAt, "startAt", READMATE_START_POSITIONS)
  });
}

function parseAddWebPageInput(input: unknown): AddWebPageInput {
  const value = objectInput(input, ["url", "title", "category", "preferredLanguage"]);
  return defined({
    url: publicHttpsUrl(value.url, "url"),
    title: optionalString(value.title, "title", 160),
    category: optionalString(value.category, "category", 60),
    preferredLanguage: optionalEnum(value.preferredLanguage, "preferredLanguage", READMATE_TARGET_LANGUAGES)
  });
}

function parseSubscribeRssInput(input: unknown): SubscribeRssInput {
  const value = objectInput(input, ["feedUrl", "sourceName", "topics", "articlesPerRefresh"]);
  return defined({
    feedUrl: publicHttpsUrl(value.feedUrl, "feedUrl"),
    sourceName: requiredString(value.sourceName, "sourceName", 120),
    topics: optionalStringArray(value.topics, "topics", 10, 40),
    articlesPerRefresh: optionalInteger(value.articlesPerRefresh, "articlesPerRefresh", 1, 50)
  });
}

function parseStudyPackInput(input: unknown): GenerateStudyPackInput {
  const value = objectInput(input, ["documentId", "targetLanguage", "flashcardCount", "quizCount"]);
  return defined({
    documentId: documentId(value.documentId),
    targetLanguage: optionalEnum(value.targetLanguage, "targetLanguage", READMATE_TARGET_LANGUAGES),
    flashcardCount: optionalInteger(value.flashcardCount, "flashcardCount", 1, 24),
    quizCount: optionalInteger(value.quizCount, "quizCount", 1, 12)
  });
}

function objectInput(input: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalid("input must be an object");
  }
  const value = input as Record<string, unknown>;
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length) invalid("unknown fields are not allowed");
  return value;
}

function documentId(input: unknown): string {
  const value = requiredString(input, "documentId", 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) invalid("documentId is invalid");
  return value;
}

function requiredString(input: unknown, field: string, maxLength: number): string {
  if (typeof input !== "string") invalid(`${field} must be a string`);
  const value = input.trim();
  if (!value || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    invalid(`${field} has an invalid length or characters`);
  }
  return value;
}

function optionalString(input: unknown, field: string, maxLength: number): string | undefined {
  return input === undefined ? undefined : requiredString(input, field, maxLength);
}

function requiredEnum<T extends string>(input: unknown, field: string, values: readonly T[]): T {
  if (typeof input !== "string" || !values.includes(input as T)) invalid(`${field} is not supported`);
  return input as T;
}

function optionalEnum<T extends string>(input: unknown, field: string, values: readonly T[]): T | undefined {
  return input === undefined ? undefined : requiredEnum(input, field, values);
}

function optionalInteger(input: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (input === undefined) return undefined;
  if (!Number.isInteger(input) || (input as number) < minimum || (input as number) > maximum) {
    invalid(`${field} must be an integer in range`);
  }
  return input as number;
}

function optionalStringArray(
  input: unknown,
  field: string,
  maxItems: number,
  maxItemLength: number
): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length < 1 || input.length > maxItems) invalid(`${field} is invalid`);
  const values = input.map((item) => requiredString(item, field, maxItemLength));
  if (new Set(values.map((item) => item.toLocaleLowerCase())).size !== values.length) {
    invalid(`${field} must not contain duplicates`);
  }
  return values;
}

function publicHttpsUrl(input: unknown, field: string): string {
  const value = requiredString(input, field, 2048);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    invalid(`${field} must be a public HTTPS URL`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || isBlockedHostname(hostname)) invalid(`${field} must be a public HTTPS URL`);
  return parsed.toString();
}

function isBlockedHostname(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".") && !hostname.includes(":")
  ) {
    return true;
  }

  if (hostname.includes(":")) {
    if (hostname === "::" || hostname === "::1" || hostname.startsWith("::ffff:")) return true;
    const firstGroup = Number.parseInt(hostname.split(":", 1)[0] || "0", 16);
    return (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80;
  }

  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function invalid(issue: string): never {
  throw new ToolInputValidationError([issue]);
}
