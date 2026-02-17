"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const postgresEventStore_1 = require("../stores/postgresEventStore");
const auditExport_1 = require("../observability/auditExport");
function arg(name, fallback) {
    const prefix = `--${name}=`;
    const row = process.argv.find((entry) => entry.startsWith(prefix));
    if (!row)
        return fallback;
    return row.slice(prefix.length);
}
async function main() {
    const outDir = arg("out", "reports") ?? "reports";
    const limitRaw = Number(arg("limit", "1000"));
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 50_000)) : 1000;
    const signingKey = process.env.STUDIO_BRAIN_EXPORT_SIGNING_KEY;
    const store = new postgresEventStore_1.PostgresEventStore();
    const rows = await store.listRecent(limit);
    const bundle = (0, auditExport_1.buildAuditExportBundle)(rows, { signingKey });
    const stamp = bundle.generatedAt.slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `audit-export-${stamp}.json`;
    await promises_1.default.mkdir(outDir, { recursive: true });
    const outputPath = node_path_1.default.join(outDir, fileName);
    await promises_1.default.writeFile(outputPath, JSON.stringify(bundle, null, 2), "utf8");
    process.stdout.write(JSON.stringify({
        ok: true,
        outputPath,
        rows: bundle.manifest.rowCount,
        payloadHash: bundle.manifest.payloadHash,
        signatureAlgorithm: bundle.manifest.signatureAlgorithm,
    }, null, 2) + "\n");
}
void main().catch((error) => {
    process.stderr.write(`exportAudit fatal: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
});
