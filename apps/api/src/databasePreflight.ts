import { prisma } from "./prisma.js";

export async function assertProductionDatabaseRole(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const expectedRole = process.env.DATABASE_APP_ROLE?.trim() || "readmate_api";
  const rows = await prisma.$queryRaw<Array<{ role_name: string }>>`SELECT current_user::text AS role_name`;
  const actualRole = rows[0]?.role_name;
  if (actualRole !== expectedRole) {
    throw new Error(`Production DATABASE_URL must authenticate as the least-privilege ${expectedRole} role.`);
  }
}
