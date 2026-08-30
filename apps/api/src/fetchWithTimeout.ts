const DEFAULT_OUTBOUND_TIMEOUT_MS = 15_000;
const MAX_OUTBOUND_TIMEOUT_MS = 60_000;

type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

/** Apply a deadline that remains active while the response body is consumed. */
export function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const timeoutMs = normalizeTimeout(options.timeoutMs ?? outboundTimeoutFromEnv());
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return (options.fetcher ?? globalThis.fetch)(input, { ...init, signal });
}

function outboundTimeoutFromEnv(): number {
  const configured = Number(process.env.OUTBOUND_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) ? configured : DEFAULT_OUTBOUND_TIMEOUT_MS;
}

function normalizeTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_OUTBOUND_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_OUTBOUND_TIMEOUT_MS);
}

export const __fetchWithTimeoutInternals = { normalizeTimeout };
