/**
 * Minimal declarations for the experimental WebMCP browser surface.
 *
 * Keep these local until the API ships in TypeScript's DOM library. The
 * property is optional because ReadMate must continue to run in native and in
 * browsers that do not implement WebMCP.
 */
type ReadMateWebMcpInput = Record<string, unknown>;

type ReadMateWebMcpAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
};

type ReadMateWebMcpExecuteContext = {
  signal: AbortSignal;
};

type ReadMateWebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  annotations?: ReadMateWebMcpAnnotations;
  execute: (
    input: ReadMateWebMcpInput,
    context: ReadMateWebMcpExecuteContext
  ) => unknown | Promise<unknown>;
};

type ReadMateRegisteredWebMcpTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: string;
  annotations?: ReadMateWebMcpAnnotations;
  origin?: string;
};

interface ReadMateWebMcpModelContext extends EventTarget {
  registerTool(
    tool: ReadMateWebMcpTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] }
  ): Promise<void>;
  getTools?(options?: { fromOrigins?: readonly string[] }): Promise<ReadMateRegisteredWebMcpTool[]>;
  ontoolchange?: ((event: Event) => void) | null;
}

interface Document {
  readonly modelContext?: ReadMateWebMcpModelContext;
}

