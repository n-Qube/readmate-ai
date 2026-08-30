export type WorkPermit = () => void;

export interface WorkLimiter {
  tryAcquire(): WorkPermit | null;
}

export class FixedWorkLimiter implements WorkLimiter {
  private active = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("Work limiter capacity must be a positive integer.");
    }
  }

  tryAcquire(): WorkPermit | null {
    if (this.active >= this.capacity) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

export const documentProcessingLimiter = new FixedWorkLimiter(
  positiveIntegerFromEnv(process.env.DOCUMENT_PROCESSING_CONCURRENCY, 2, 16)
);

export function positiveIntegerFromEnv(value: string | undefined, fallback: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Expected an integer between 1 and ${maximum}.`);
  }
  return parsed;
}
