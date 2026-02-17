import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Logger } from "../config/logger";
import { createSkillSandbox } from "./sandbox";

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function withTempSkillFile(code: string, run: (skillPath: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studiobrain-sandbox-skill-"));
  const skillDir = path.join(root, "skill");
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "index.js"), code, "utf8");
  try {
    await run(skillDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("skill sandbox can execute a module over stdio", async () => {
  await withTempSkillFile(
    "module.exports.execute = async (payload) => ({ answer: Number(payload.value) + 1 });",
    async (skillPath) => {
      const sandbox = await createSkillSandbox({
        enabled: true,
        egressDeny: false,
        entryTimeoutMs: 3_000,
        logger,
      });
      try {
        assert.ok(sandbox, "sandbox should be created");
        const out = await sandbox.executeSkill({
          skillPath,
          payload: { value: 2 },
          command: "default",
        });
        assert.deepEqual(out, { answer: 3 });
      } finally {
        await sandbox!.close();
      }
    }
  );
});

test("skill sandbox enforces command allowlist", async () => {
  await withTempSkillFile(
    "module.exports.execute = async () => ({ ok: true });",
    async (skillPath) => {
      const sandbox = await createSkillSandbox({
        enabled: true,
        egressDeny: false,
        entryTimeoutMs: 3_000,
        runtimeAllowlist: ["allowed"],
        logger,
      });
      try {
        assert.ok(sandbox, "sandbox should be created");
        await assert.rejects(
          () =>
            sandbox!.executeSkill({
              skillPath,
              command: "blocked",
            }),
          /command "blocked" blocked by runtime allowlist/
        );
      } finally {
        await sandbox!.close();
      }
    }
  );
});
