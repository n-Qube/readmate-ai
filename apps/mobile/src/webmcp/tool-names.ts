export const READMATE_TOOL_NAMES = [
  "readmate_search_library",
  "readmate_get_document_context",
  "readmate_prepare_listening",
  "readmate_add_web_page",
  "readmate_subscribe_rss",
  "readmate_generate_study_pack"
] as const;

export type ReadMateToolName = (typeof READMATE_TOOL_NAMES)[number];

export const READMATE_IMPERATIVE_TOOL_NAMES = [
  "readmate_search_library",
  "readmate_get_document_context",
  "readmate_prepare_listening"
] as const satisfies readonly ReadMateToolName[];

export type ReadMateImperativeToolName = (typeof READMATE_IMPERATIVE_TOOL_NAMES)[number];

export const READMATE_DECLARATIVE_TOOL_NAMES = [
  "readmate_add_web_page",
  "readmate_subscribe_rss",
  "readmate_generate_study_pack"
] as const satisfies readonly ReadMateToolName[];

export type ReadMateDeclarativeToolName = (typeof READMATE_DECLARATIVE_TOOL_NAMES)[number];

export const READMATE_TARGET_LANGUAGES = ["en", "tw", "ee", "gaa"] as const;
export type ReadMateTargetLanguage = (typeof READMATE_TARGET_LANGUAGES)[number];

