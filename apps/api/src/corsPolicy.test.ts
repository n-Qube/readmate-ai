import { describe, expect, it, vi } from "vitest";
import { configuredCorsOrigins, createCorsOptions, parseCorsOrigins } from "./corsPolicy.js";

describe("CORS policy", () => {
  it("fails closed when a production allowlist is missing", () => {
    expect(() => createCorsOptions("", "production")).toThrow("WEB_APP_ORIGIN");
  });

  it("builds the production allowlist from separate extension and web origin variables", () => {
    expect(configuredCorsOrigins({
      EXTENSION_ORIGIN: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      WEB_APP_ORIGIN: "https://app.readmate.example"
    })).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop,https://app.readmate.example");
  });

  it("allows only exact configured browser origins", () => {
    const options = createCorsOptions("https://app.readmate.example,chrome-extension://abcdefghijklmnop", "production");
    const origin = options.origin;
    if (typeof origin !== "function") throw new Error("Expected a CORS origin callback.");
    const allowed = vi.fn();
    const denied = vi.fn();

    origin("https://app.readmate.example", allowed);
    origin("https://evil.example", denied);

    expect(allowed).toHaveBeenCalledWith(null, true);
    expect(denied).toHaveBeenCalledWith(null, false);
  });

  it("allows the configured web and extension origins but not a lookalike subdomain", () => {
    const options = createCorsOptions(configuredCorsOrigins({
      EXTENSION_ORIGIN: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      WEB_APP_ORIGIN: "https://app.readmate.example"
    }), "production");
    const origin = options.origin;
    if (typeof origin !== "function") throw new Error("Expected a CORS origin callback.");
    const web = vi.fn();
    const extension = vi.fn();
    const lookalike = vi.fn();

    origin("https://app.readmate.example", web);
    origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop", extension);
    origin("https://app.readmate.example.evil.invalid", lookalike);

    expect(web).toHaveBeenCalledWith(null, true);
    expect(extension).toHaveBeenCalledWith(null, true);
    expect(lookalike).toHaveBeenCalledWith(null, false);
  });

  it("rejects origins containing paths or credentials", () => {
    expect(() => parseCorsOrigins("https://app.readmate.example/path")).toThrow("Invalid CORS origin");
    expect(() => parseCorsOrigins("https://user:password@app.readmate.example")).toThrow("Invalid CORS origin");
  });
});
