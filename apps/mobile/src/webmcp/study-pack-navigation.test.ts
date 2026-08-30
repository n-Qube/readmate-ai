import { describe, expect, it, vi } from "vitest";
import type { AgentActionCompletion, AgentActionErrorOutput } from "./forms/types";
import { completedStudyPackPath, navigateToCompletedStudyPack } from "./study-pack-navigation";

function completion(overrides: Partial<AgentActionCompletion> = {}): AgentActionCompletion {
  return {
    output: {
      ok: true,
      action: "generated_study_pack",
      resource: { documentId: "doc-1" },
      message: "Study pack ready."
    },
    resource: {
      resourceType: "study_pack",
      resourceId: "doc-1",
      title: "Test document",
      status: "8 flashcards · 5 quiz questions",
      deepLink: "/document/doc-1?mode=summary"
    },
    ...overrides
  };
}

describe("completedStudyPackPath", () => {
  it("opens a successfully generated study pack", () => {
    expect(completedStudyPackPath("readmate_generate_study_pack", completion()))
      .toBe("/document/doc-1?mode=summary");
  });

  it("opens a completed idempotent replay using its safe internal deep link", () => {
    const replay = completion({ replayed: true });
    expect(replay.resource.deepLink).toBe("/document/doc-1?mode=summary");
    expect(completedStudyPackPath("readmate_generate_study_pack", replay))
      .toBe("/document/doc-1?mode=summary");
  });

  it("does not navigate for another action, an error, or a non-completed replay", () => {
    expect(completedStudyPackPath("readmate_add_web_page", completion())).toBeUndefined();
    const error: AgentActionErrorOutput = {
      ok: false,
      action: "generated_study_pack",
      error: {
        code: "TEMPORARY_FAILURE",
        message: "Study generation failed.",
        nextAction: "Try again."
      }
    };
    expect(completedStudyPackPath("readmate_generate_study_pack", error)).toBeUndefined();
    expect(completedStudyPackPath("readmate_generate_study_pack", undefined)).toBeUndefined();
    expect(completedStudyPackPath("readmate_generate_study_pack", completion({
      replayed: true,
      resource: {
        resourceType: "study_pack",
        resourceId: "doc-1",
        title: "Test document",
        status: "in_progress",
        deepLink: "/document/doc-1?mode=summary"
      }
    }))).toBeUndefined();
  });

  it("rejects explicit pending, failed, and cancelled completion states", () => {
    for (const status of ["pending", "in progress", "error", "failed", "cancelled", "canceled"]) {
      expect(completedStudyPackPath("readmate_generate_study_pack", completion({
        replayed: true,
        resource: {
          resourceType: "study_pack",
          resourceId: "doc-1",
          title: "Test document",
          status,
          deepLink: "/document/doc-1?mode=summary"
        }
      }))).toBeUndefined();
    }
  });

  it("still opens a completed pack when only cross-device sync remains pending", () => {
    expect(completedStudyPackPath("readmate_generate_study_pack", completion({
      resource: {
        resourceType: "study_pack",
        resourceId: "doc-1",
        title: "Test document",
        status: "Ready · Sync pending",
        deepLink: "/document/doc-1?mode=summary"
      }
    }))).toBe("/document/doc-1?mode=summary");
  });

  it("rejects missing, external, and non-document destinations", () => {
    for (const deepLink of [undefined, "https://example.com/study", "/settings"]) {
      expect(completedStudyPackPath("readmate_generate_study_pack", completion({
        resource: {
          resourceType: "study_pack",
          resourceId: "doc-1",
          title: "Test document",
          status: "Ready",
          deepLink
        }
      }))).toBeUndefined();
    }
  });
});

describe("navigateToCompletedStudyPack", () => {
  it("pushes a completed replay through the provider router callback", () => {
    const push = vi.fn();

    expect(navigateToCompletedStudyPack(
      "readmate_generate_study_pack",
      completion({ replayed: true }),
      push
    )).toBe(true);
    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/document/doc-1?mode=summary");
  });

  it("never calls the router for an unsafe replay destination", () => {
    const push = vi.fn();

    expect(navigateToCompletedStudyPack(
      "readmate_generate_study_pack",
      completion({
        replayed: true,
        resource: {
          resourceType: "study_pack",
          resourceId: "doc-1",
          title: "Test document",
          status: "Ready",
          deepLink: "https://example.com/study"
        }
      }),
      push
    )).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
