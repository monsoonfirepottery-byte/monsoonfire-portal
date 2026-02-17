"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDatabaseConnection = createDatabaseConnection;
const postgres_1 = require("../db/postgres");
const migrate_1 = require("../db/migrate");
const retry_1 = require("./retry");
async function createDatabaseConnection(logger) {
    const migrate = async () => {
        return (0, retry_1.withRetry)("postgres_migrate", async () => {
            const result = await (0, migrate_1.runMigrations)();
            logger.info("studio_brain_migrations_complete", {
                appliedCount: result.applied.length,
                applied: result.applied,
            });
            return result;
        }, logger, { attempts: 3, baseDelayMs: 250 });
    };
    const healthcheck = async () => {
        return (0, postgres_1.checkPgConnection)(logger);
    };
    (0, postgres_1.getPgPool)();
    await healthcheck();
    await migrate();
    return {
        healthcheck,
        migrate,
        close: postgres_1.closePgPool,
    };
}
