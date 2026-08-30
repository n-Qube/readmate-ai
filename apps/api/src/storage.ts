import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { fetchWithTimeout } from "./fetchWithTimeout.js";

export const DEFAULT_UPLOAD_BUCKET = "readmate-uploads";
export const DEFAULT_MEDIA_BUCKET = "readmate-media";

let client: SupabaseClient | null = null;

export function toPlainUint8Array(bytes: Uint8Array): Uint8Array {
  // Node's Buffer extends Uint8Array, but Supabase Storage intentionally
  // rejects Buffer instances. Copy at the provider boundary so every caller
  // hands the SDK the browser-compatible binary type it expects.
  return Uint8Array.from(bytes);
}

export function getUploadBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_UPLOAD_BUCKET;
}

export function getMediaBucket(): string {
  return process.env.SUPABASE_MEDIA_BUCKET?.trim() || DEFAULT_MEDIA_BUCKET;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.");
  }

  client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    realtime: {
      transport: WebSocket as any
    },
    global: {
      fetch: (input, init) => fetchWithTimeout(input, init)
    }
  });
  return client;
}
