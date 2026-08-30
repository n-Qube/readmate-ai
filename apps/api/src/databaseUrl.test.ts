import { describe, expect, it } from "vitest";
import { databaseUrlForRuntime } from "./databaseUrl.js";

describe("databaseUrlForRuntime", () => {
  it("caps the production pool without exposing or replacing credentials", () => {
    const password = "secret";
    const result = new URL(databaseUrlForRuntime(
      ["postgresql://", "readmate", ":", password, "@pooler.example.test:5432/postgres?sslmode=require"].join(""),
      { production: true, connectionLimit: 2, poolTimeoutSeconds: 30 }
    )!);

    expect(result.username).toBe("readmate");
    expect(result.password).toBe("secret");
    expect(result.searchParams.get("sslmode")).toBe("require");
    expect(result.searchParams.get("connection_limit")).toBe("2");
    expect(result.searchParams.get("pool_timeout")).toBe("30");
  });

  it("caps stale explicit pool settings that exceed the runtime budget", () => {
    const password = "secret";
    const result = new URL(databaseUrlForRuntime(
      ["postgresql://", "readmate", ":", password, "@pooler.example.test:5432/postgres?connection_limit=4&pool_timeout=45"].join(""),
      { production: true, connectionLimit: 2, poolTimeoutSeconds: 30 }
    )!);

    expect(result.searchParams.get("connection_limit")).toBe("2");
    expect(result.searchParams.get("pool_timeout")).toBe("30");
  });

  it("preserves explicit pool settings that are already below the runtime cap", () => {
    const password = "secret";
    const result = new URL(databaseUrlForRuntime(
      ["postgresql://", "readmate", ":", password, "@pooler.example.test:5432/postgres?connection_limit=1&pool_timeout=10"].join(""),
      { production: true, connectionLimit: 2, poolTimeoutSeconds: 30 }
    )!);

    expect(result.searchParams.get("connection_limit")).toBe("1");
    expect(result.searchParams.get("pool_timeout")).toBe("10");
  });

  it("enables Prisma's transaction-pooler mode on the Supavisor transaction port", () => {
    const password = "secret";
    const result = new URL(databaseUrlForRuntime(
      ["postgresql://", "readmate", ":", password, "@pooler.example.test:6543/postgres"].join(""),
      { production: true, connectionLimit: 1, poolTimeoutSeconds: 30 }
    )!);

    expect(result.searchParams.get("pgbouncer")).toBe("true");
  });

  it("does not rewrite non-production URLs", () => {
    const input = "postgresql://localhost/readmate";
    expect(databaseUrlForRuntime(input, { production: false })).toBe(input);
  });
});
