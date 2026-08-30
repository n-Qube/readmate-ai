export type WebMcpDocumentLike = {
  readonly modelContext?: ReadMateWebMcpModelContext;
};

export function getWebMcpModelContext(documentLike?: WebMcpDocumentLike | null): ReadMateWebMcpModelContext | null {
  const target = documentLike ?? browserDocument();
  const context = target?.modelContext;
  return context && typeof context.registerTool === "function" ? context : null;
}

export function isWebMcpAvailable(documentLike?: WebMcpDocumentLike | null): boolean {
  return getWebMcpModelContext(documentLike) !== null;
}

function browserDocument(): WebMcpDocumentLike | null {
  return typeof document === "undefined" ? null : document;
}

