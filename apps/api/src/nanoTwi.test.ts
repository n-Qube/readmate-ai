import { afterEach, describe, expect, it } from "vitest";
import { __nanoTwiInternals, nanoTwiConfigured } from "./nanoTwi.js";

afterEach(() => {
  delete process.env.NANO_TWI_MODEL_DIR;
  delete process.env.NANO_TWI_NUM_THREADS;
  __nanoTwiInternals.resetEngineForTests();
});

describe("Nano-Twi configuration", () => {
  it("stays disabled when the model is not present", () => {
    expect(nanoTwiConfigured()).toBe(false);
  });

  it("enables the fallback for an explicit model directory", () => {
    process.env.NANO_TWI_MODEL_DIR = "/opt/readmate/nano-twi";
    expect(nanoTwiConfigured()).toBe(true);
  });

  it("limits native inference thread count", () => {
    process.env.NANO_TWI_NUM_THREADS = "3";
    expect(__nanoTwiInternals.nanoTwiThreadCount()).toBe(3);
    process.env.NANO_TWI_NUM_THREADS = "20";
    expect(__nanoTwiInternals.nanoTwiThreadCount()).toBe(1);
  });
});
