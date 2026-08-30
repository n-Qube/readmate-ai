import type {
  AddWebPageInput as ContractAddWebPageInput,
  GenerateStudyPackInput as ContractGenerateStudyPackInput,
  SubscribeRssInput as ContractSubscribeRssInput
} from "../schemas";
import {
  READMATE_DECLARATIVE_TOOL_NAMES,
  type ReadMateDeclarativeToolName,
  type ReadMateTargetLanguage
} from "../tool-names";
import type { ReadMateToolFailure, ReadMateToolSuccess } from "../tool-results";

export const declarativeToolNames = READMATE_DECLARATIVE_TOOL_NAMES;

export type DeclarativeToolName = ReadMateDeclarativeToolName;

export type AgentActionStage = "ready" | "pending" | "running" | "completed" | "error";

export type TargetLanguage = ReadMateTargetLanguage;

export type AddWebPageInput = Omit<ContractAddWebPageInput, "category" | "preferredLanguage"> & {
  category: string;
  preferredLanguage: TargetLanguage;
};

export type SubscribeRssInput = Omit<ContractSubscribeRssInput, "topics" | "articlesPerRefresh"> & {
  topics: string[];
  articlesPerRefresh: number;
};

export type GenerateStudyPackInput = Omit<ContractGenerateStudyPackInput, "targetLanguage" | "flashcardCount" | "quizCount"> & {
  targetLanguage: TargetLanguage;
  flashcardCount: number;
  quizCount: number;
};

export type DeclarativeToolInputMap = {
  readmate_add_web_page: AddWebPageInput;
  readmate_subscribe_rss: SubscribeRssInput;
  readmate_generate_study_pack: GenerateStudyPackInput;
};

export type AgentActionResource = {
  resourceType: "document" | "source" | "study_pack";
  resourceId: string;
  title: string;
  status: string;
  deepLink?: string;
};

export type AgentActionOutput = ReadMateToolSuccess<unknown>;

export type AgentActionErrorOutput = ReadMateToolFailure;

export type AgentActionCompletion = {
  output: AgentActionOutput;
  resource: AgentActionResource;
  /** True when the server returned a previously completed idempotent action. */
  replayed?: boolean;
  viewLabel?: string;
  undoLabel?: string;
  undo?: (signal: AbortSignal) => Promise<void>;
};

export type AgentActionExecutionContext = {
  signal: AbortSignal;
  requestId: string;
};

export type AgentActionExecutors = {
  addWebPage: (input: AddWebPageInput, context: AgentActionExecutionContext) => Promise<AgentActionCompletion>;
  subscribeRss: (input: SubscribeRssInput, context: AgentActionExecutionContext) => Promise<AgentActionCompletion>;
  generateStudyPack: (input: GenerateStudyPackInput, context: AgentActionExecutionContext) => Promise<AgentActionCompletion>;
};

export type AgentActionStatus = {
  stage: AgentActionStage;
  toolName?: DeclarativeToolName;
  title: string;
  message: string;
  completion?: AgentActionCompletion;
  error?: AgentActionErrorOutput;
};

export type AgentSubmitEvent = SubmitEvent & {
  readonly agentInvoked?: boolean;
  respondWith?: (response: Promise<AgentActionOutput | AgentActionErrorOutput>) => void;
};

export type DocumentOption = {
  id: string;
  title: string;
};

export type PlanNotice = {
  planLabel: "Free" | "Premium";
  detail: string;
};

export function isDeclarativeToolName(value: unknown): value is DeclarativeToolName {
  return typeof value === "string" && declarativeToolNames.includes(value as DeclarativeToolName);
}
