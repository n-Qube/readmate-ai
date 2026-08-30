import { describe, expect, it } from "vitest";
import {
  READMATE_DECLARATIVE_TOOL_CONTRACTS,
  READMATE_IMPERATIVE_TOOL_CONTRACTS,
  READMATE_TOOL_CONTRACTS
} from "./tool-contracts";
import { READMATE_TOOL_NAMES } from "./tool-names";

describe("ReadMate WebMCP tool contracts", () => {
  it("keeps exactly six stable, unique, compact snake-case names", () => {
    expect(READMATE_TOOL_CONTRACTS.map((tool) => tool.name)).toEqual(READMATE_TOOL_NAMES);
    expect(new Set(READMATE_TOOL_NAMES).size).toBe(6);
    for (const name of READMATE_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(name.length).toBeLessThanOrEqual(30);
    }
  });

  it("exposes three imperative tools and three manually confirmed declarative contracts", () => {
    expect(READMATE_IMPERATIVE_TOOL_CONTRACTS.map((tool) => tool.name)).toEqual([
      "readmate_search_library",
      "readmate_get_document_context",
      "readmate_prepare_listening"
    ]);
    expect(READMATE_DECLARATIVE_TOOL_CONTRACTS.map((tool) => tool.name)).toEqual([
      "readmate_add_web_page",
      "readmate_subscribe_rss",
      "readmate_generate_study_pack"
    ]);
  });

  it("marks saved and external content untrusted and read tools read-only", () => {
    for (const contract of READMATE_TOOL_CONTRACTS) {
      expect(contract.annotations.untrustedContentHint).toBe(true);
      expect(contract.inputSchema.additionalProperties).toBe(false);
      expect(contract.description.length).toBeLessThan(500);
    }
    expect(READMATE_IMPERATIVE_TOOL_CONTRACTS.map((tool) => tool.annotations.readOnlyHint)).toEqual([
      true,
      true,
      false
    ]);
    expect(READMATE_DECLARATIVE_TOOL_CONTRACTS.every((tool) => !tool.annotations.readOnlyHint)).toBe(true);
  });

  it("describes the human and safety boundary for each write contract", () => {
    for (const contract of READMATE_DECLARATIVE_TOOL_CONTRACTS) {
      expect(contract.description).toMatch(/visible review form/i);
      expect(contract.description).toMatch(/user submit|manual user submission/i);
    }
  });
});

