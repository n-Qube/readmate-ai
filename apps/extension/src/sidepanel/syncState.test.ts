import { describe, expect, it } from "vitest";
import { deriveSyncState } from "./syncState";

describe("deriveSyncState", () => {
  it("keeps account sync healthy when Study generation fails", () => {
    expect(deriveSyncState(
      { isSignedIn: true },
      "study",
      "Could not generate Study material: Unexpected server error.",
      true
    )).toEqual({ label: "Synced", kind: "synced" });
  });

  it("shows explicit document sync failures", () => {
    expect(deriveSyncState(
      { isSignedIn: true },
      null,
      "Document sync failed.",
      true
    )).toEqual({ label: "Sync failed", kind: "failed" });
  });

  it("keeps account sync healthy when local-language speech is temporarily unavailable", () => {
    expect(deriveSyncState(
      { isSignedIn: true },
      null,
      "Unable to generate speech: Text-to-speech is temporarily unavailable.",
      true
    )).toEqual({ label: "Synced", kind: "synced" });
  });

  it("keeps account sync healthy when cloud speech asks the user to sign in again", () => {
    expect(deriveSyncState(
      { isSignedIn: true },
      null,
      "Your ReadMate session needs to be refreshed before Ga cloud audio can play. Reopen ReadMate or sign in again, then press Play.",
      true
    )).toEqual({ label: "Synced", kind: "synced" });
  });

  it("does not infer a sync failure from ordinary instructional text", () => {
    expect(deriveSyncState(
      { isSignedIn: true },
      null,
      "Sign in later if you want to sync it to mobile.",
      true
    )).toEqual({ label: "Synced", kind: "synced" });
  });

  it.each([
    "Unable to load synced settings.",
    "Unable to save synced settings.",
    "Unable to sync reading progress.",
    "Unable to sync flashcard review.",
    "Unable to sync quiz result.",
    "Unable to update flashcard review.",
    "Unable to submit quiz attempt.",
    "Settings saved locally, but synced settings could not be updated.",
    "This reading started locally because your ReadMate sign-in session expired."
  ])("shows an explicit sync failure for %s", (message) => {
    expect(deriveSyncState({ isSignedIn: true }, null, message, true))
      .toEqual({ label: "Sync failed", kind: "failed" });
  });

  it("shows offline and authentication states before action state", () => {
    expect(deriveSyncState({ isSignedIn: true }, "save", null, false).kind).toBe("offline");
    expect(deriveSyncState(null, null, null, true).kind).toBe("auth");
  });
});
