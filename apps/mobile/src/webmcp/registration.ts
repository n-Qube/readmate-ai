import type {
  GetDocumentContextInput,
  PrepareListeningInput,
  SearchLibraryInput
} from "./schemas";
import type {
  DocumentContextResource,
  PrepareListeningResource,
  ReadMateToolHandlerResult,
  SearchLibraryResource
} from "./tool-results";
import type { ReadMateImperativeToolName } from "./tool-names";
import type { WebMcpDocumentLike } from "./feature-detection";

export type ReadMateGetToken = (options?: { skipCache?: boolean }) => Promise<string | null>;

export type ReadMateToolExecutionContext = {
  userId: string;
  token: string;
  signal: AbortSignal;
};

export type ReadMateImperativeToolHandlers = {
  searchLibrary(
    input: SearchLibraryInput,
    context: ReadMateToolExecutionContext
  ): Promise<ReadMateToolHandlerResult<SearchLibraryResource>>;
  getDocumentContext(
    input: GetDocumentContextInput,
    context: ReadMateToolExecutionContext
  ): Promise<ReadMateToolHandlerResult<DocumentContextResource>>;
  prepareListening(
    input: PrepareListeningInput,
    context: ReadMateToolExecutionContext
  ): Promise<ReadMateToolHandlerResult<PrepareListeningResource>>;
};

export type BeginReadMateToolRegistrationInput = {
  /** Set false on sensitive routes or when the product-level feature is off. */
  enabled?: boolean;
  isAuthenticated: boolean;
  userId: string | null | undefined;
  /** Optional live-principal check used immediately before and after token acquisition. */
  getCurrentUserId?: () => string | null | undefined;
  getToken: ReadMateGetToken;
  handlers: ReadMateImperativeToolHandlers;
  documentLike?: WebMcpDocumentLike | null;
  clearAgentState?: () => void;
};

export type ReadMateRegistrationReason =
  | "registered"
  | "unsupported"
  | "disabled"
  | "unauthenticated"
  | "disposed"
  | "registration_failed";

export type ReadMateToolRegistrationStatus = {
  supported: boolean;
  ready: boolean;
  reason: ReadMateRegistrationReason;
  registeredTools: readonly ReadMateImperativeToolName[];
};

export type ReadMateToolRegistration = {
  readonly supported: boolean;
  readonly signal: AbortSignal;
  readonly ready: Promise<ReadMateToolRegistrationStatus>;
  dispose(reason?: unknown): void;
};
