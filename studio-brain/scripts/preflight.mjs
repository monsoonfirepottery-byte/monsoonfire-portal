import { printValidationReport, validateEnvContract } from "./env-contract-validator.mjs";
import net from "node:net";
import { isStudioBrainHostAllowed, resolveStudioBrainNetworkProfile } from "../../scripts/studio-network-profile.mjs";

const network = resolveStudioBrainNetworkProfile();
const host = process.env.PGHOST || network.host;
const port = Number(process.env.PGPORT ?? "5433");
const timeoutMs = Number(process.env.PREFLIGHT_TIMEOUT_MS ?? "2000");
const warningPrefix = "[network-profile]";

function checkTcp({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (ok, message) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true, `Connected to ${host}:${port}`));
    socket.once("timeout", () => done(false, `Timed out connecting to ${host}:${port}`));
    socket.once("error", (err) => done(false, `Connection failed: ${err.message}`));
    socket.connect(port, host);
  });
}

async function main() {
  process.stdout.write("studio-brain preflight\n");
  const report = validateEnvContract({ strict: false });
  if (!report.ok) {
    printValidationReport(report);
    process.exit(1);
  }
  if (report.warnings.length > 0) {
    process.stdout.write("WARNING: env contract checks had cautions.\n");
    report.warnings.forEach((warning) => process.stdout.write(` - ${warning}\n`));
  }

  process.stdout.write(`Network profile: ${network.requestedProfile} (${network.profile}) -> ${network.host}\n`);
  if (network.warnings.length > 0) {
    process.stdout.write(`${warningPrefix} profile warnings:\n`);
    network.warnings.forEach((warning) => process.stdout.write(` - ${warning}\n`));
  }

  if (process.env.STUDIO_BRAIN_BASE_URL) {
    try {
      const base = new URL(process.env.STUDIO_BRAIN_BASE_URL);
      if (!isStudioBrainHostAllowed(base.hostname, network)) {
        process.stdout.write(`${warningPrefix} STUDIO_BRAIN_BASE_URL host is outside profile allowlist: ${base.hostname}\n`);
        process.stdout.write(`allowed hosts: ${network.allowedStudioBrainHosts.join(", ")}\n`);
      }
    } catch {
      process.stdout.write(`${warningPrefix} STUDIO_BRAIN_BASE_URL is not a valid URL, default checks will apply.\n`);
    }
  }

  process.stdout.write(`Checking Postgres TCP at ${host}:${port}...\n`);

  const postgres = await checkTcp({ host, port, timeoutMs });
  if (postgres.ok) {
    process.stdout.write(`PASS: ${postgres.message}\n`);
    process.exit(0);
  }

  process.stderr.write(`FAIL: ${postgres.message}\n`);
  process.stderr.write("Start Postgres and retry, then run:\n");
  process.stderr.write("1) npm --prefix studio-brain run preflight\n");
  process.stderr.write("2) npm --prefix studio-brain start\n");
  process.stderr.write("3) npm --prefix studio-brain run soak\n");
  process.exit(1);
}

void main().catch((error) => {
  process.stderr.write(`preflight crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
