"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../config/logger");
const env_1 = require("../config/env");
const supervisor_1 = require("../memoryOps/supervisor");
function arg(name, fallback = undefined) {
    const exact = `--${name}`;
    const prefix = `${exact}=`;
    const token = process.argv.find((entry) => entry === exact || entry.startsWith(prefix));
    if (!token)
        return fallback;
    if (token === exact)
        return "";
    return token.slice(prefix.length);
}
function boolArg(name, fallback = false) {
    const raw = String(arg(name, fallback ? "true" : "false") ?? "").trim().toLowerCase();
    if (raw === "" || raw === "true" || raw === "1" || raw === "yes" || raw === "on")
        return true;
    if (raw === "false" || raw === "0" || raw === "no" || raw === "off")
        return false;
    return fallback;
}
function intArg(name, fallback, min, max) {
    const parsed = Number.parseInt(String(arg(name, String(fallback)) ?? ""), 10);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(min, Math.min(max, parsed));
}
async function runOnce() {
    const env = (0, env_1.readEnv)();
    const logger = (0, logger_1.createLogger)(env.STUDIO_BRAIN_LOG_LEVEL);
    const snapshot = await (0, supervisor_1.runMemoryOpsSupervisorTick)({
        repoRoot: arg("repo-root"),
        baseUrl: arg("base-url"),
        dryRun: boolArg("dry-run", false),
        executeSafe: boolArg("execute-safe", true),
        executeApproved: boolArg("execute-approved", false),
        logger,
    });
    if (boolArg("json", false)) {
        process.stdout.write(`${JSON.stringify({ ok: true, snapshot }, null, 2)}\n`);
    }
    else {
        process.stdout.write(`memory ops: ${snapshot.status} - ${snapshot.summary}\n`);
    }
}
async function run() {
    if (!boolArg("watch", false)) {
        await runOnce();
        return;
    }
    const intervalMs = intArg("interval-ms", 60_000, 5_000, 60 * 60_000);
    while (true) {
        await runOnce();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}
void run().catch((error) => {
    process.stderr.write(`memory ops supervisor failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
