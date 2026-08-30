import type {
  AgentActionCompletion,
  AgentActionErrorOutput,
  DeclarativeToolName
} from "./forms/types";

const studyDocumentPath = /^\/document\/[^/?#]+(?:\?[^#]*)?$/;

/**
 * Returns the safe in-app route that may be opened after a confirmed study
 * action. A completed idempotent replay represents the same successful action
 * and is therefore opened just like a fresh completion. Error results and
 * pending, in-progress, or failed statuses stay on the current page so the
 * status panel can explain what happened without navigating.
 */
export function completedStudyPackPath(
  toolName: DeclarativeToolName,
  result: AgentActionCompletion | AgentActionErrorOutput | undefined
): string | undefined {
  if (!result || !("output" in result)) return undefined;
  const completion = result;
  if (toolName !== "readmate_generate_study_pack") return undefined;
  if (!completion.output.ok || completion.resource.resourceType !== "study_pack") return undefined;
  const normalizedStatus = completion.resource.status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["in_progress", "pending", "error", "failed", "cancelled", "canceled"].includes(normalizedStatus)) {
    return undefined;
  }

  const deepLink = completion.resource.deepLink?.trim();
  return deepLink && studyDocumentPath.test(deepLink) ? deepLink : undefined;
}

/**
 * Applies the completion policy before asking the app router to navigate. The
 * boolean result lets the provider keep its completed fallback panel visible
 * whenever no safe destination exists.
 */
export function navigateToCompletedStudyPack(
  toolName: DeclarativeToolName,
  result: AgentActionCompletion | AgentActionErrorOutput | undefined,
  navigate: (path: string) => void
): boolean {
  const path = completedStudyPackPath(toolName, result);
  if (!path) return false;
  navigate(path);
  return true;
}
