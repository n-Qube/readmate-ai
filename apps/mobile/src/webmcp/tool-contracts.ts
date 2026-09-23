import { READMATE_TOOL_SCHEMAS, type ReadMateInputSchema } from "./schemas";
import {
  READMATE_DECLARATIVE_TOOL_NAMES,
  READMATE_IMPERATIVE_TOOL_NAMES,
  type ReadMateToolName
} from "./tool-names";

export type ReadMateToolMode = "imperative" | "declarative";
export type ReadMateToolActionClass = "read" | "ui_state" | "write" | "paid_ai";

export type ReadMateToolContract = {
  readonly name: ReadMateToolName;
  readonly title: string;
  readonly mode: ReadMateToolMode;
  readonly actionClass: ReadMateToolActionClass;
  readonly description: string;
  readonly inputSchema: ReadMateInputSchema;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: boolean;
    /** Chrome WebMCP hint for actions that save data or spend AI quota. */
    readonly consequentialHint: boolean;
  };
};

export const READMATE_TOOL_CONTRACTS = [
  {
    name: "readmate_search_library",
    title: "Search ReadMate library",
    mode: "imperative",
    actionClass: "read",
    description:
      "Search the signed-in user's ReadMate library by title or metadata. Use it to identify saved items; do not use it to retrieve document text. Read-only.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_search_library,
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false }
  },
  {
    name: "readmate_get_document_context",
    title: "Get document context",
    mode: "imperative",
    actionClass: "read",
    description:
      "Get compact metadata and learning availability for one owned document. Use it after search to confirm an item; do not use it for full text. Read-only.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_get_document_context,
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false }
  },
  {
    name: "readmate_prepare_listening",
    title: "Prepare listening",
    mode: "imperative",
    actionClass: "ui_state",
    description:
      "Prepare an owned document for listening in English, Twi, Ewe, or Ga. Use it after confirming the document; it changes visible player state but never starts speech or consumes speech quota. The user must press Play.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_prepare_listening,
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false }
  },
  {
    name: "readmate_add_web_page",
    title: "Add a webpage",
    mode: "declarative",
    actionClass: "write",
    description:
      "Fill a visible review form to save one public HTTPS webpage to the signed-in ReadMate library. Do not use it for files, private-network URLs, or deletion. Data changes only after the user submits the form.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_add_web_page,
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true }
  },
  {
    name: "readmate_subscribe_rss",
    title: "Subscribe to RSS",
    mode: "declarative",
    actionClass: "write",
    description:
      "Fill a visible review form to create or reactivate one public HTTPS RSS or Atom subscription. Do not use it to remove sources. Data changes only after the user submits the form.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_subscribe_rss,
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true }
  },
  {
    name: "readmate_generate_study_pack",
    title: "Generate study pack",
    mode: "declarative",
    actionClass: "paid_ai",
    description:
      "Fill a visible review form to generate learning material for one owned document. Use only after confirming the document; it can consume AI quota and changes learning data only after manual user submission.",
    inputSchema: READMATE_TOOL_SCHEMAS.readmate_generate_study_pack,
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true }
  }
] as const satisfies readonly ReadMateToolContract[];

export type ReadMateToolContractByName = {
  readonly [TName in ReadMateToolName]: Extract<
    (typeof READMATE_TOOL_CONTRACTS)[number],
    { readonly name: TName }
  >;
};

export const READMATE_TOOL_CONTRACT_BY_NAME = Object.fromEntries(
  READMATE_TOOL_CONTRACTS.map((contract) => [contract.name, contract])
) as ReadMateToolContractByName;

export const READMATE_IMPERATIVE_TOOL_CONTRACTS = [
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_IMPERATIVE_TOOL_NAMES[0]],
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_IMPERATIVE_TOOL_NAMES[1]],
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_IMPERATIVE_TOOL_NAMES[2]]
] as const;

export const READMATE_DECLARATIVE_TOOL_CONTRACTS = [
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_DECLARATIVE_TOOL_NAMES[0]],
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_DECLARATIVE_TOOL_NAMES[1]],
  READMATE_TOOL_CONTRACT_BY_NAME[READMATE_DECLARATIVE_TOOL_NAMES[2]]
] as const;
