import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCodexDocsDriftCheck } from "./codex-docs-drift-check.mjs";

test("runCodexDocsDriftCheck stays clean when the installed Codex version is readable and files have no drift", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-docs-drift-"));
  const targetPath = join(repoRoot, "docs", "placeholder.md");

  try {
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeFileSync(targetPath, "# Placeholder\nNo explicit Codex CLI version here.\n", "utf8");

    const report = runCodexDocsDriftCheck({
      repoRoot,
      artifact: "output/codex-docs-drift/latest.json",
      targets: ["docs/placeholder.md"],
      codexResolution: {
        preferred: {
          path: "C:\\nvm4w\\nodejs\\codex.cmd",
          version: "0.105.0",
        },
        candidates: [
          {
            path: "C:\\nvm4w\\nodejs\\codex.cmd",
            version: "0.105.0",
            sources: ["active-path"],
            isLocal: false,
            rawVersionOutput: "codex-cli 0.105.0",
          },
        ],
        versionSet: ["0.105.0"],
        hasVersionAmbiguity: false,
      },
    });

    assert.equal(report.status, "pass");
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
