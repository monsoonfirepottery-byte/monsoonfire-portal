import type { Logger } from "../config/logger";
import { checkPgConnection, closePgPool, getPgPool } from "../db/postgres";
import { runMigrations } from "../db/migrate";
import { withRetry } from "./retry";

export type DatabaseHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type DatabaseConnection = {
  healthcheck: () => Promise<DatabaseHealth>;
  migrate: () => Promise<{ applied: string[] }>;
  close: () => Promise<void>;
};

export async function createDatabaseConnection(logger: Logger): Promise<DatabaseConnection> {
  const migrate = async (): Promise<{ applied: string[] }> => {
    return withRetry(
      "postgres_migrate",
      async () => {
        const result = await runMigrations();
        logger.info("studio_brain_migrations_complete", {
          appliedCount: result.applied.length,
          applied: result.applied,
        });
        return result;
      },
      logger,
      { attempts: 3, baseDelayMs: 250 }
    );
  };

  const healthcheck = async (): Promise<DatabaseHealth> => {
    return checkPgConnection(logger);
  };

  getPgPool();
  await healthcheck();
  await migrate();

  return {
    healthcheck,
    migrate,
    close: closePgPool,
  };
}
