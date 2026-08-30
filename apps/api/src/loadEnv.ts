import { config } from "dotenv";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = process.env.READMATE_ENV_FILE?.trim();

if (envFile) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const absoluteEnvFile = isAbsolute(envFile) ? envFile : resolve(process.cwd(), envFile);
  const repositoryRelative = relative(repositoryRoot, absoluteEnvFile);
  if (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative)) {
    throw new Error("READMATE_ENV_FILE must point outside the repository. Use environment variables or a managed secret store in production.");
  }
  const result = config({ path: absoluteEnvFile, override: false });
  if (result.error) throw result.error;
}
