import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { asyncHandler } from "./asyncHandler.js";

describe("asyncHandler", () => {
  it("forwards rejected Express 4 route promises", async () => {
    const failure = new Error("database unavailable");
    const next = vi.fn();
    const handler = asyncHandler(async () => {
      throw failure;
    });

    handler({} as Request, {} as Response, next as NextFunction);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure));
  });

  it("does not invoke error middleware for a successful route", async () => {
    const next = vi.fn();
    let completed = false;
    const handler = asyncHandler(async () => {
      completed = true;
    });

    handler({} as Request, {} as Response, next as NextFunction);
    await vi.waitFor(() => expect(completed).toBe(true));
    expect(next).not.toHaveBeenCalled();
  });
});
