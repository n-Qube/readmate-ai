import { describe, expect, it } from "vitest";
import { declarativeFormAttributes } from "./declarative-attributes";
import { READMATE_TOOL_CONTRACT_BY_NAME } from "../tool-contracts";

describe("WebMCP declarative confirmation attributes", () => {
  it.each([
    "readmate_add_web_page",
    "readmate_subscribe_rss",
    "readmate_generate_study_pack"
  ] as const)("uses the canonical contract and never opts into autosubmit for %s", (toolName) => {
    const attributes = declarativeFormAttributes(toolName) as Record<string, unknown>;
    expect(attributes.toolname).toBe(toolName);
    expect(attributes.tooldescription).toBe(READMATE_TOOL_CONTRACT_BY_NAME[toolName].description);
    expect(attributes).not.toHaveProperty("toolautosubmit");
  });
});
