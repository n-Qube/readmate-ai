import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type HostLookup = (hostname: string) => Promise<string[]>;

export type SafeRemoteConnector = (
  url: URL,
  address: string,
  init: { headers?: RequestInit["headers"]; signal: AbortSignal }
) => Promise<Response>;

export type SafeRemoteFetchOptions = {
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  connector?: SafeRemoteConnector;
  headers?: RequestInit["headers"];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedProtocols?: ReadonlyArray<"http:" | "https:">;
};

export type SafeRemoteFetchResult = {
  response: Response;
  body: Uint8Array;
  url: string;
};

const defaultLookup: HostLookup = async (hostname) => {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address }) => address);
};

export async function safeRemoteFetch(input: string | URL, options: SafeRemoteFetchOptions = {}): Promise<SafeRemoteFetchResult> {
  const lookup = options.lookup ?? defaultLookup;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const allowedProtocols = new Set<"http:" | "https:">(options.allowedProtocols ?? ["http:", "https:"]);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || maxRedirects < 0) {
    throw new Error("Remote fetch limits are invalid.");
  }
  if (!allowedProtocols.size || [...allowedProtocols].some((protocol) => protocol !== "http:" && protocol !== "https:")) {
    throw new Error("Remote fetch protocol policy is invalid.");
  }
  let current = new URL(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const addresses = await assertSafeDestination(current, lookup, allowedProtocols);
    const pinnedAddress = addresses[0];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Custom fetchers support deterministic unit tests. Production sockets
      // are pinned to the same address that passed the destination check.
      const response = options.fetcher && options.fetcher !== globalThis.fetch
        ? await options.fetcher(current.href, {
            headers: options.headers,
            redirect: "manual",
            signal: controller.signal
          })
        : await (options.connector ?? pinnedHttpFetch)(current, pinnedAddress, {
            headers: options.headers,
            signal: controller.signal
          });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Remote fetch returned a redirect without a location.");
        await response.body?.cancel();
        current = new URL(location, current);
        continue;
      }
      const body = await readBoundedResponseBody(response, maxBytes);
      return { response, body, url: current.href };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Remote fetch exceeded the redirect limit.");
}

async function assertSafeDestination(
  url: URL,
  lookup: HostLookup,
  allowedProtocols: ReadonlySet<"http:" | "https:">
): Promise<string[]> {
  if (!allowedProtocols.has(url.protocol as "http:" | "https:")) {
    throw new Error("Remote fetch URL protocol is not allowed.");
  }
  if (url.username || url.password || !url.hostname) {
    throw new Error("Remote fetch URL is invalid.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [hostname] : await lookup(hostname);
  if (!addresses.length || addresses.some(isBlockedNetworkAddress)) {
    throw new Error("Remote fetch destination is not allowed.");
  }
  return [...new Set(addresses)];
}

const pinnedHttpFetch: SafeRemoteConnector = async (url, address, init) => {
  const family = isIP(address);
  if (family !== 4 && family !== 6) throw new Error("Remote fetch destination is not allowed.");

  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };

  const headers = Object.fromEntries(new Headers(init.headers).entries());
  headers["accept-encoding"] = "identity";
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const outbound = request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers,
        lookup,
        signal: init.signal,
        ...(url.protocol === "https:" ? { servername: url.hostname.replace(/^\[|\]$/g, "") } : {})
      },
      (incoming) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(name, item));
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
            headers: responseHeaders
          })
        );
      }
    );
    outbound.once("error", reject);
    outbound.end();
  });
}

export async function readBoundedResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Remote response exceeds the size limit.");
  }

  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > maxBytes) throw new Error("Remote response exceeds the size limit.");
    return body;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("Remote response exceeds the size limit.");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function isBlockedNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) return isBlockedIpv4(address);
  if (isIP(address) === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  return (
    octets[0] === 0 ||
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 0) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 198 && octets[1] === 18) ||
    (octets[0] === 198 && octets[1] === 19) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113) ||
    octets[0] >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const groups = expandIpv6(normalized);
  if (!groups) return true;
  const first = groups[0];
  const mappedTail = groups.slice(6).map((group) => Number.parseInt(group, 16));
  const mappedAddress = groups.slice(0, 6).every((group, index) => group === (index === 5 ? "ffff" : "0000"));
  if (mappedAddress) {
    const ipv4 = `${(mappedTail[0] >> 8) & 255}.${mappedTail[0] & 255}.${(mappedTail[1] >> 8) & 255}.${mappedTail[1] & 255}`;
    return isBlockedIpv4(ipv4);
  }
  return groups.slice(0, 7).every((group) => group === "0000") && (groups[7] === "0000" || groups[7] === "0001") ||
    (Number.parseInt(first, 16) & 0xfe00) === 0xfc00 ||
    (Number.parseInt(first, 16) & 0xffc0) === 0xfe80 ||
    (Number.parseInt(first, 16) & 0xff00) === 0xff00;
}

function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (left.some((group) => !/^[0-9a-f]{1,4}$/.test(group)) || right.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((group) => group.padStart(4, "0"));
}

export const __safeRemoteFetchInternals = { isBlockedAddress: isBlockedNetworkAddress, expandIpv6 };
