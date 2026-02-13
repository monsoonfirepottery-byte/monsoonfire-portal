"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const postgresEventStore_1 = require("../stores/postgresEventStore");
const postgresStateStore_1 = require("../stores/postgresStateStore");
const rebuild_1 = require("../ops/rebuild");
function arg(name, fallback) {
    const prefix = `--${name}=`;
    const row = process.argv.find((entry) => entry.startsWith(prefix));
    if (!row)
        return fallback;
    return row.slice(prefix.length);
}
async function main() {
    const actorId = arg("actorId");
    const actorType = (arg("actorType", "staff") ?? "staff");
    const adminToken = arg("adminToken") ?? "";
    const confirm = arg("confirm", "false") ?? "false";
    const projectId = arg("projectId");
    const scanLimitRaw = Number(arg("scanLimit", ""));
    const scanLimit = Number.isFinite(scanLimitRaw) ? Math.max(1, Math.min(Math.floor(scanLimitRaw), 25_000)) : undefined;
    const correlationId = arg("correlationId");
    if (!actorId || actorId.trim().length < 3) {
        throw new Error("Missing --actorId=<uid>. Provide a staff/ops actor id to log rebuild audit events.");
    }
    if (!["staff", "system"].includes(actorType)) {
        throw new Error("Invalid --actorType. Use staff or system.");
    }
    if (confirm.toLowerCase() !== "true") {
        throw new Error("Missing --confirm=true. Rebuild is destructive for local state; pass --confirm=true to proceed.");
    }
    const requiredToken = process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "";
    if (requiredToken.trim().length > 0 && adminToken.trim() !== requiredToken.trim()) {
        throw new Error("Admin token mismatch. Provide --adminToken that matches STUDIO_BRAIN_ADMIN_TOKEN.");
    }
    const stateStore = new postgresStateStore_1.PostgresStateStore();
    const eventStore = new postgresEventStore_1.PostgresEventStore();
    const result = await (0, rebuild_1.runStudioStateRebuild)({
        stateStore,
        eventStore,
        actorId: actorId.trim(),
        actorType,
        projectId,
        scanLimit,
        correlationId,
    });
    process.stdout.write(JSON.stringify({
        ok: true,
        ...result,
    }, null, 2) + "\n");
}
void main().catch((error) => {
    process.stderr.write(`rebuild fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
