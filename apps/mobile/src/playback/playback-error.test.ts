import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { playbackErrorMessage } from "./playback-error";

describe("playbackErrorMessage", () => {
  it("explains the free daily listening limit instead of showing the raw server text", () => {
    expect(playbackErrorMessage(new ApiError("Daily usage limit reached.", 429))).toBe(
      "You've used today's free listening allowance. It resets at midnight GMT."
    );
  });

  it("asks the listener to slow down for per-minute rate limits", () => {
    expect(playbackErrorMessage(new ApiError("Too many requests, please try again later.", 429))).toBe(
      "Too many audio requests at once. Wait a moment, then tap play."
    );
  });

  it("keeps the retry message for upstream outages", () => {
    expect(playbackErrorMessage(new ApiError("Service unavailable", 503))).toBe(
      "ReadMate audio is temporarily busy. Tap play to retry in a moment."
    );
  });

  it("falls back to the error text, then a generic message", () => {
    expect(playbackErrorMessage(new Error("Something odd"))).toBe("Something odd");
    expect(playbackErrorMessage(undefined)).toBe("Could not start playback.");
  });
});
