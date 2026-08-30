import { describe, expect, it } from "vitest";
import { databaseUnavailableCode, isDatabaseUnavailableError } from "./databaseErrors.js";

describe("database availability errors", () => {
  it("recognizes Prisma pool exhaustion as retryable", () => {
    expect(databaseUnavailableCode({ code: "P2024" })).toBe("P2024");
    expect(isDatabaseUnavailableError({ code: "P2024" })).toBe(true);
  });

  it("recognizes wrapped and unclassified connection-pool failures", () => {
    expect(databaseUnavailableCode({ cause: { code: "P2037" } })).toBe("P2037");
    expect(databaseUnavailableCode(new Error("Timed out fetching a new connection from the connection pool."))).toBe("CONNECTION_UNAVAILABLE");
  });

  it("does not mask application and validation failures", () => {
    expect(databaseUnavailableCode({ code: "P2002" })).toBeNull();
    expect(isDatabaseUnavailableError(new Error("invalid input"))).toBe(false);
  });
});
