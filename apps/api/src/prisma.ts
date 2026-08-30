import { Prisma, PrismaClient } from "@prisma/client";
import { getRlsContext } from "./rls.js";
import { databaseUrlForRuntime } from "./databaseUrl.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const runtimeDatabaseUrl = databaseUrlForRuntime(process.env.DATABASE_URL, {
  production: process.env.NODE_ENV === "production"
});
const basePrisma = globalForPrisma.prisma ?? new PrismaClient(
  runtimeDatabaseUrl ? { datasources: { db: { url: runtimeDatabaseUrl } } } : undefined
);

export const prisma = basePrisma.$extends({
  name: "readmate-rls-context",
  query: {
    async $allOperations({ args, query }) {
      const context = getRlsContext();
      if (!context?.userId) {
        return query(args);
      }

      const configQueries: Prisma.PrismaPromise<unknown>[] = [];
      configQueries.push(basePrisma.$executeRaw`select set_config('app.current_user_id', ${context.userId}, true)`);

      const results = await basePrisma.$transaction([...configQueries, query(args)]);
      return results[results.length - 1];
    }
  }
});

export async function withRlsTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const context = getRlsContext();
  return basePrisma.$transaction(async (transaction) => {
    if (context?.userId) {
      await transaction.$executeRaw`select set_config('app.current_user_id', ${context.userId}, true)`;
    }
    return operation(transaction);
  });
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}
