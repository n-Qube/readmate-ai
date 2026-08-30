const DATABASE_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2037"]);
const DATABASE_UNAVAILABLE_MESSAGES = [
  /timed out fetching a new connection/i,
  /max client connections reached/i,
  /can't reach database server/i,
  /server has closed the connection/i,
  /connection terminated unexpectedly/i
];

export function databaseUnavailableCode(error: unknown): string | null {
  return availabilityCode(error, new Set(), 0);
}

export function isDatabaseUnavailableError(error: unknown): boolean {
  return databaseUnavailableCode(error) !== null;
}

function availabilityCode(error: unknown, seen: Set<object>, depth: number): string | null {
  if (!error || typeof error !== "object" || depth > 3 || seen.has(error)) return null;
  seen.add(error);
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && DATABASE_UNAVAILABLE_CODES.has(candidate.code)) return candidate.code;
  const message = typeof candidate.message === "string" ? candidate.message : undefined;
  if (message && DATABASE_UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(message))) {
    return "CONNECTION_UNAVAILABLE";
  }
  return availabilityCode(candidate.cause, seen, depth + 1);
}
