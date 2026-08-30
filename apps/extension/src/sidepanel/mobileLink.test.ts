import { describe, expect, it } from "vitest";
import { mobileReadMateUrl } from "./mobileLink";

describe("mobile ReadMate links", () => {
  it("opens a specific saved document when one is available", () => {
    expect(mobileReadMateUrl("doc / Ghana")).toBe("readmate://document/doc%20%2F%20Ghana");
  });

  it("falls back to the app home link", () => {
    expect(mobileReadMateUrl()).toBe("readmate://");
  });
});
