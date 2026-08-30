export function mobileReadMateUrl(documentId?: string): string {
  return documentId
    ? `readmate://document/${encodeURIComponent(documentId)}`
    : "readmate://";
}
