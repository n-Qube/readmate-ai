import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { toPlainUint8Array } from "./storage.js";

describe("toPlainUint8Array", () => {
  it("copies Node buffers into the binary type accepted by Supabase Storage", () => {
    const bytes = toPlainUint8Array(Buffer.from([1, 2, 3]));

    expect(bytes.constructor).toBe(Uint8Array);
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});
