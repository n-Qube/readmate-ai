import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const ACCOUNT_DELETION_FENCED_CODE = "ACCOUNT_DELETION_IN_PROGRESS";

export class AccountDeletionFencedError extends Error {
  readonly code = ACCOUNT_DELETION_FENCED_CODE;
  readonly statusCode = 409;

  constructor() {
    super("Account deletion is already in progress.");
    this.name = "AccountDeletionFencedError";
  }
}

export function isAccountDeletionFencedError(error: unknown): boolean {
  return error instanceof AccountDeletionFencedError || (
    error instanceof Error && error.message.includes(ACCOUNT_DELETION_FENCED_CODE)
  );
}

export interface WebMcpWriteFenceRunner<Delegate> {
  run<T>(userId: string, operation: (delegate: Delegate) => Promise<T>): Promise<T>;
}

export function accountDeletionUserHash(userId: string): string {
  return createHash("sha256").update(userId, "utf8").digest("hex");
}

export async function beginAccountDeletionFence(userId: string): Promise<void> {
  const withTransaction = await getTransactionRunner();
  await withTransaction(async (transaction) => {
    await lockUser(transaction, userId);
    await transaction.accountDeletionFence.createMany({
      data: [{ userHash: accountDeletionUserHash(userId) }],
      skipDuplicates: true
    });
  });
}

export async function withAccountDeletionWriteFence<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const withTransaction = await getTransactionRunner();
  return withTransaction(async (transaction) => {
    await lockUser(transaction, userId);
    const fence = await transaction.accountDeletionFence.findUnique({
      where: { userHash: accountDeletionUserHash(userId) },
      select: { userHash: true }
    });
    if (fence) throw new AccountDeletionFencedError();
    return operation(transaction);
  });
}

export async function assertAccountDeletionNotFenced(userId: string): Promise<void> {
  await withAccountDeletionWriteFence(userId, async () => undefined);
}

async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
}

async function getTransactionRunner() {
  const module = await import("../prisma.js");
  return module.withRlsTransaction;
}
