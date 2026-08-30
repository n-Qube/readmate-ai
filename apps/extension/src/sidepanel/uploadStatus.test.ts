import { describe, expect, it } from "vitest";
import {
  estimateUploadRemainingSeconds,
  evaluateUploadCapacity,
  formatBytes,
  formatDuration,
  uploadElapsedSeconds,
  uploadPercent,
  uploadPlanSummary,
  type DocumentUploadStatus,
  type UploadCapacity
} from "./uploadStatus";

const freeCapacity: UploadCapacity = {
  plan: "free",
  isPremium: false,
  limits: {
    maxUploadBytes: 10 * 1024 * 1024,
    maxDocumentCharacters: 100_000,
    maxPdfPages: 50
  }
};

describe("document upload status helpers", () => {
  it("allows a file exactly at the plan limit and gates the next byte", () => {
    expect(evaluateUploadCapacity(freeCapacity.limits.maxUploadBytes, freeCapacity)).toEqual({
      blocked: false,
      upgradeRequired: false
    });
    expect(evaluateUploadCapacity(freeCapacity.limits.maxUploadBytes + 1, freeCapacity)).toMatchObject({
      blocked: true,
      upgradeRequired: true
    });
  });

  it("reports a supported-size error instead of an upgrade for Premium", () => {
    const premiumCapacity: UploadCapacity = {
      ...freeCapacity,
      plan: "premium",
      isPremium: true
    };
    expect(evaluateUploadCapacity(freeCapacity.limits.maxUploadBytes + 1, premiumCapacity)).toMatchObject({
      blocked: true,
      upgradeRequired: false
    });
  });

  it("formats progress, capacity, and elapsed time for the status card", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(uploadPercent(5, 10)).toBe(50);
    expect(uploadPercent(12, 10)).toBe(100);
    expect(formatDuration(75)).toBe("1m 15s");
    expect(uploadPlanSummary(freeCapacity)).toBe("Free plan · 10 MB per file · up to 50 PDF pages");
    expect(uploadPlanSummary(undefined, "gated")).toBe("ReadMate checked the account and document limits");
    expect(uploadPlanSummary(undefined, "ready")).toBe("Saved after ReadMate verified the document limits");
  });

  it("estimates only the remaining transfer time once enough time has elapsed", () => {
    expect(estimateUploadRemainingSeconds(5_000, 10_000, 1_000, 3_000)).toBe(2);
    expect(estimateUploadRemainingSeconds(5_000, 10_000, 1_000, 1_500)).toBeNull();
    expect(estimateUploadRemainingSeconds(10_000, 10_000, 1_000, 3_000)).toBeNull();
  });

  it("starts the processing timer when transfer finishes instead of at the plan check", () => {
    const processing: DocumentUploadStatus = {
      phase: "processing",
      fileName: "report.pdf",
      fileSize: 10,
      startedAt: 1_000,
      transferStartedAt: 2_000,
      processingStartedAt: 8_000,
      loadedBytes: 10,
      totalBytes: 10
    };

    expect(uploadElapsedSeconds(processing, 11_500)).toBe(3);
    expect(uploadElapsedSeconds({ ...processing, phase: "ready", finishedAt: 12_000 }, 20_000)).toBe(11);
  });
});
