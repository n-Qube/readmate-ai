import { describe, expect, it } from "vitest";
import { FixedWorkLimiter, positiveIntegerFromEnv } from "./workLimiter.js";

describe("FixedWorkLimiter", () => {
  it("rejects excess work and releases capacity exactly once", () => {
    const limiter = new FixedWorkLimiter(1);
    const release = limiter.tryAcquire();

    expect(release).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
    release?.();
    release?.();
    expect(limiter.tryAcquire()).not.toBeNull();
  });

  it("validates environment capacity bounds", () => {
    expect(positiveIntegerFromEnv(undefined, 2, 16)).toBe(2);
    expect(positiveIntegerFromEnv("4", 2, 16)).toBe(4);
    expect(() => positiveIntegerFromEnv("0", 2, 16)).toThrow();
    expect(() => positiveIntegerFromEnv("17", 2, 16)).toThrow();
  });
});
