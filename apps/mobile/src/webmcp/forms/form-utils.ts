import { ApiError } from "../../api/client";
import type {
  AgentActionErrorOutput,
  DeclarativeToolName,
  TargetLanguage
} from "./types";
import { compactToolError, toolErrorFromUnknown } from "../tool-results";

const languageLabels: Record<TargetLanguage, string> = {
  en: "English",
  tw: "Twi",
  ee: "Ewe",
  gaa: "Ga"
};

export function languageLabel(language: TargetLanguage): string {
  return languageLabels[language];
}

export function requirePublicHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete public HTTPS address.");
  }

  if (parsed.protocol !== "https:" || !parsed.hostname || isPrivateHostname(parsed.hostname)) {
    throw new Error("Use a public HTTPS address.");
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}

export function displayDomain(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return "the selected website";
  }
}

export function splitTopics(value: string): string[] {
  const topics = [...new Set(value.split(",").map((topic) => topic.trim()).filter(Boolean))];
  if (topics.some((topic) => topic.length > 40)) {
    throw new Error("Keep each RSS topic to 40 characters or fewer.");
  }
  return topics.slice(0, 10);
}

export function boundedInteger(value: FormDataEntryValue | null, minimum: number, maximum: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
    throw new Error(`Choose a whole number from ${minimum} to ${maximum}.`);
  }
  return numeric;
}

export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function targetLanguage(value: string): TargetLanguage {
  if (value === "en" || value === "tw" || value === "ee" || value === "gaa") return value;
  throw new Error("Choose English, Twi, Ewe, or Ga.");
}

export function safeErrorOutput(toolName: DeclarativeToolName, error: unknown): AgentActionErrorOutput {
  if (isAbortError(error)) {
    return compactToolError(toolName, "CANCELLED", "The action was cancelled.", "Review the preserved form and submit it again when ready.");
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return compactToolError(toolName, "AUTH_REQUIRED", "Your ReadMate session has expired.", "Sign in again, then retry this action.");
    }
    if (error.status === 402 || error.status === 403 || /premium|required|allowance|quota|limit/i.test(error.message)) {
      return compactToolError(toolName, "PLAN_LIMIT", planLimitMessage(toolName), "Review your current plan or try again after the allowance resets.");
    }
    if (error.status === 404) {
      return compactToolError(toolName, "NOT_FOUND", "ReadMate could not find that item in your library.", "Choose a current document or source and retry.");
    }
    if (error.status === 409) {
      return compactToolError(toolName, "CONFLICT", "This item is already in your ReadMate account.", "Open the existing item instead of creating another copy.");
    }
    if (error.status === 429) {
      return compactToolError(toolName, "RATE_LIMITED", "ReadMate is handling high demand right now.", "Wait a moment and safely retry with the same form values.");
    }
    if (error.status >= 500) {
      return compactToolError(toolName, "TEMPORARY_FAILURE", "ReadMate could not complete this action right now.", "Your form is preserved; retry in a moment.");
    }
  }

  const message = error instanceof Error ? error.message : "ReadMate could not complete this action.";
  if (/public HTTPS|complete public HTTPS|localhost|private/i.test(message)) {
    return compactToolError(toolName, "BLOCKED_URL", "ReadMate can only use a public HTTPS address.", "Check the address and submit the preserved form again.");
  }
  if (/network|fetch|connection|timeout/i.test(message)) {
    return compactToolError(toolName, "TEMPORARY_FAILURE", "ReadMate could not reach the service.", "Check your connection and safely retry; the form is preserved.");
  }
  if (/whole number|Choose English/i.test(message)) {
    return compactToolError(toolName, "INVALID_INPUT", message, "Correct the highlighted value and submit again.");
  }
  return toolErrorFromUnknown(toolName, error);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function planLimitMessage(toolName: DeclarativeToolName): string {
  return toolName === "readmate_generate_study_pack"
    ? "You have reached the AI allowance available on your current plan."
    : "This action is above the document allowance available on your current plan.";
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized === "::1") return true;
  if (/^(?:0|127)(?:\.|$)/.test(normalized) || /^169\.254\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  if (/^10\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}
