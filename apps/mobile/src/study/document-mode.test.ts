import { describe, expect, it } from "vitest";
import {
  documentModeReducer,
  initialDocumentModeState,
  resolveDocumentModeRoute,
  visibleDocumentMode
} from "./document-mode";

describe("document route mode synchronization", () => {
  it("preserves a manual tab selection while the URL is unchanged", () => {
    const route = resolveDocumentModeRoute("doc-1", "summary");
    const manuallySelected = documentModeReducer(initialDocumentModeState(route), {
      type: "select",
      route,
      mode: "quiz"
    });

    const unchanged = documentModeReducer(manuallySelected, { type: "route", route });

    expect(unchanged).toBe(manuallySelected);
    expect(visibleDocumentMode(unchanged, route)).toBe("quiz");
  });

  it("adopts the requested mode when the mounted document URL changes", () => {
    const originalRoute = resolveDocumentModeRoute("doc-1", undefined);
    const manuallySelected = documentModeReducer(initialDocumentModeState(originalRoute), {
      type: "select",
      route: originalRoute,
      mode: "quiz"
    });
    const completedStudyRoute = resolveDocumentModeRoute("doc-1", "summary");

    expect(visibleDocumentMode(manuallySelected, completedStudyRoute)).toBe("summary");
    expect(documentModeReducer(manuallySelected, {
      type: "route",
      route: completedStudyRoute
    })).toEqual({
      routeKey: completedStudyRoute.key,
      mode: "summary"
    });
  });

  it("normalizes array params and rejects unsupported modes safely", () => {
    expect(resolveDocumentModeRoute(["doc-1"], ["flashcards"]).mode).toBe("flashcards");
    expect(resolveDocumentModeRoute("doc-1", "admin").mode).toBe("summary");
    expect(resolveDocumentModeRoute(undefined, undefined).mode).toBe("summary");
  });
});
