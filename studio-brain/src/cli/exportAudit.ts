import fs from "node:fs/promises";
import path from "node:path";
import { PostgresEventStore } from "../stores/postgresEventStore";
import { buildAuditExportBundle } from "../observability/auditExport";

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const row = process.argv.find((entry) => entry.startsWith(prefix));
  if (!row) return fallback;
  return row.slice(prefix.length);
}

async function main(): Promise<void> {
  const outDir = arg("out", "reports") ?? "reports";
  const limitRaw = Number(arg("limit", "1000"));
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 50_000)) : 1000;
  const signingKey = process.env.STUDIO_BRAIN_EXPORT_SIGNING_KEY;
  const store = new PostgresEventStore();
  const rows = await store.listRecent(limit);
  const bundle = buildAuditExportBundle(rows, { signingKey });
  const stamp = bundle.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `audit-export-${stamp}.json`;
  await fs.mkdir(outDir, { recursive: true });
  const outputPath = path.join(outDir, fileName);
  await fs.writeFile(outputPath, JSON.stringify(bundle, null, 2), "utf8");
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        rows: bundle.manifest.rowCount,
        payloadHash: bundle.manifest.payloadHash,
        signatureAlgorithm: bundle.manifest.signatureAlgorithm,
      },
      null,
      2
    ) + "\n"
  );
}

void main().catch((error) => {
  process.stderr.write(`exportAudit fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
