import fs from "node:fs/promises";
import path from "node:path";
import { HubitatConnector } from "../hubitatConnector";
import { RoborockConnector } from "../roborockConnector";
import { runReadOnlyConnectorContract } from "./contractHarness";

type HarnessRow = {
  connectorId: string;
  passed: boolean;
  checks: string[];
  error?: string;
};

type HarnessSummary = {
  generatedAt: string;
  allPassed: boolean;
  rows: HarnessRow[];
};

async function runConnectorCase(connectorId: string): Promise<HarnessRow> {
  try {
    if (connectorId === "hubitat") {
      const connector = new HubitatConnector(async (route) => {
        if (route === "/health") return { ok: true };
        return { devices: [{ id: "hub-1", label: "Kiln Vent", switch: "on", battery: 88 }] };
      });
      await runReadOnlyConnectorContract(connector);
      await assertNegativeCases(connectorId, connector.readStatus.bind(connector));
    } else if (connectorId === "roborock") {
      const connector = new RoborockConnector(async (route) => {
        if (route === "/health") return { ok: true };
        return { devices: [{ id: "rr-1", name: "Studio Vacuum", online: true, battery: 61 }] };
      });
      await runReadOnlyConnectorContract(connector);
      await assertNegativeCases(connectorId, connector.readStatus.bind(connector));
    } else {
      return { connectorId, passed: false, checks: [], error: "Unknown connector id." };
    }

    return {
      connectorId,
      passed: true,
      checks: ["contract_read_only", "negative_auth", "negative_timeout", "negative_malformed"],
    };
  } catch (error) {
    return {
      connectorId,
      passed: false,
      checks: ["contract_read_only", "negative_auth", "negative_timeout", "negative_malformed"],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function assertNegativeCases(
  connectorId: string,
  readStatus: (ctx: { requestId: string }, input: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  const authFactory = connectorId === "hubitat" ? new HubitatConnector(async () => { throw new Error("401 unauthorized"); }) : new RoborockConnector(async () => { throw new Error("403 unauthorized"); });
  await authFactory
    .readStatus({ requestId: `${connectorId}-auth` }, {})
    .then(() => {
      throw new Error(`${connectorId}: expected auth failure`);
    })
    .catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (code !== "AUTH") {
        throw new Error(`${connectorId}: expected AUTH error, received ${String(code ?? "unknown")}`);
      }
    });

  const timeoutFactory = connectorId === "hubitat" ? new HubitatConnector(async () => { throw new Error("request timeout"); }) : new RoborockConnector(async () => { throw new Error("request timeout"); });
  await timeoutFactory
    .readStatus({ requestId: `${connectorId}-timeout` }, {})
    .then(() => {
      throw new Error(`${connectorId}: expected timeout failure`);
    })
    .catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (code !== "TIMEOUT") {
        throw new Error(`${connectorId}: expected TIMEOUT error, received ${String(code ?? "unknown")}`);
      }
    });

  const malformedFactory = connectorId === "hubitat" ? new HubitatConnector(async () => ({ devices: "bad-shape" })) : new RoborockConnector(async () => ({ devices: "bad-shape" }));
  await malformedFactory
    .readStatus({ requestId: `${connectorId}-malformed` }, {})
    .then(() => {
      throw new Error(`${connectorId}: expected malformed payload failure`);
    })
    .catch((error: unknown) => {
      const code = (error as { code?: string }).code;
      if (code !== "BAD_RESPONSE") {
        throw new Error(`${connectorId}: expected BAD_RESPONSE error, received ${String(code ?? "unknown")}`);
      }
    });

  await readStatus({ requestId: `${connectorId}-noop` }, { locationId: "studio-main" });
}

async function main(): Promise<void> {
  const rows = await Promise.all([runConnectorCase("hubitat"), runConnectorCase("roborock")]);
  const summary: HarnessSummary = {
    generatedAt: new Date().toISOString(),
    allPassed: rows.every((row) => row.passed),
    rows,
  };

  const reportsDir = path.join(process.cwd(), "reports");
  await fs.mkdir(reportsDir, { recursive: true });
  const outputPath = path.join(reportsDir, "connector-contract-summary.json");
  await fs.writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (!summary.allPassed) {
    process.stderr.write(`Connector contract harness failed. See ${outputPath}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Connector contract harness passed. Summary: ${outputPath}\n`);
}

void main().catch((error) => {
  process.stderr.write(`Connector contract harness failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
