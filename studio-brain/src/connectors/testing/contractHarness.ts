import assert from "node:assert/strict";
import type { Connector } from "../types";

export async function runReadOnlyConnectorContract(connector: Connector): Promise<void> {
  const health = await connector.health({ requestId: "contract-health" });
  assert.equal(typeof health.ok, "boolean");
  assert.equal(health.requestId, "contract-health");
  assert.ok(typeof health.inputHash === "string" && health.inputHash.length > 10);

  const read = await connector.readStatus(
    { requestId: "contract-read" },
    {
      locationId: "studio-main",
    }
  );
  assert.equal(read.requestId, "contract-read");
  assert.ok(Array.isArray(read.devices));
  assert.ok(typeof read.outputHash === "string" && read.outputHash.length > 10);

  const executeRead = await connector.execute(
    { requestId: "contract-execute-read" },
    {
      intent: "read",
      action: "devices.list",
      input: { locationId: "studio-main" },
    }
  );
  assert.equal(executeRead.requestId, "contract-execute-read");

  await assert.rejects(
    () =>
      connector.execute(
        { requestId: "contract-execute-write" },
        {
          intent: "write",
          action: "device.turnOn",
          input: { id: "device-1" },
        }
      ),
    (error: unknown) => {
      const row = error as { code?: string };
      return row.code === "READ_ONLY_VIOLATION";
    }
  );
}
