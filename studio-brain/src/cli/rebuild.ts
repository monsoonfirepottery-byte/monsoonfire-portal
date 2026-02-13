import { PostgresEventStore } from "../stores/postgresEventStore";
import { PostgresStateStore } from "../stores/postgresStateStore";
import { runStudioStateRebuild } from "../ops/rebuild";

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const row = process.argv.find((entry) => entry.startsWith(prefix));
  if (!row) return fallback;
  return row.slice(prefix.length);
}

async function main(): Promise<void> {
  const actorId = arg("actorId");
  const actorType = (arg("actorType", "staff") ?? "staff") as "staff" | "system";
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

  const stateStore = new PostgresStateStore();
  const eventStore = new PostgresEventStore();
  const result = await runStudioStateRebuild({
    stateStore,
    eventStore,
    actorId: actorId.trim(),
    actorType,
    projectId,
    scanLimit,
    correlationId,
  });

  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        ...result,
      },
      null,
      2
    ) + "\n"
  );
}

void main().catch((error) => {
  process.stderr.write(`rebuild fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
