import { createLogger } from "../config/logger";
import { readEnv } from "../config/env";
import { runMemoryOpsSupervisorTick } from "../memoryOps/supervisor";

function arg(name: string, fallback: string | undefined = undefined): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  const token = process.argv.find((entry) => entry === exact || entry.startsWith(prefix));
  if (!token) return fallback;
  if (token === exact) return "";
  return token.slice(prefix.length);
}

function boolArg(name: string, fallback = false): boolean {
  const raw = String(arg(name, fallback ? "true" : "false") ?? "").trim().toLowerCase();
  if (raw === "" || raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

function intArg(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(arg(name, String(fallback)) ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

async function runOnce(): Promise<void> {
  const env = readEnv();
  const logger = createLogger(env.STUDIO_BRAIN_LOG_LEVEL);
  const snapshot = await runMemoryOpsSupervisorTick({
    repoRoot: arg("repo-root"),
    baseUrl: arg("base-url"),
    dryRun: boolArg("dry-run", false),
    executeSafe: boolArg("execute-safe", true),
    executeApproved: boolArg("execute-approved", false),
    logger,
  });
  if (boolArg("json", false)) {
    process.stdout.write(`${JSON.stringify({ ok: true, snapshot }, null, 2)}\n`);
  } else {
    process.stdout.write(`memory ops: ${snapshot.status} - ${snapshot.summary}\n`);
  }
}

async function run(): Promise<void> {
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
