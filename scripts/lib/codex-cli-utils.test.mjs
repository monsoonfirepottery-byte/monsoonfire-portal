import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expandWindowsCommandVariants, resolveCodexCliCandidates } from "./codex-cli-utils.mjs";

test("expandWindowsCommandVariants prioritizes runnable Windows launchers for extensionless paths", () => {
  assert.deepEqual(expandWindowsCommandVariants("C:\\nvm4w\\nodejs\\codex", { platform: "win32" }), [
    "C:\\nvm4w\\nodejs\\codex.cmd",
    "C:\\nvm4w\\nodejs\\codex.exe",
    "C:\\nvm4w\\nodejs\\codex.bat",
    "C:\\nvm4w\\nodejs\\codex",
  ]);
});

test("resolveCodexCliCandidates prefers codex.cmd when the extensionless Windows path has no version", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-cli-utils-"));
  const basePath = join(repoRoot, "codex");
  const cmdPath = `${basePath}.cmd`;

  try {
    writeFileSync(basePath, "", "utf8");
    writeFileSync(cmdPath, "@echo off\r\n", "utf8");

    const resolution = resolveCodexCliCandidates(
      repoRoot,
      { PATH: repoRoot },
      {
        platform: "win32",
        readCommandPathFn: () => basePath,
        readAllCommandPathsFn: () => [basePath, cmdPath],
        versionReader: (candidatePath) =>
          candidatePath.endsWith(".cmd")
            ? { version: "0.105.0", raw: "codex-cli 0.105.0" }
            : { version: null, raw: "" },
      }
    );

    assert.equal(resolution.preferred?.path, cmdPath);
    assert.equal(resolution.preferred?.version, "0.105.0");
    assert.ok(resolution.candidates.some((candidate) => candidate.path === basePath));
    assert.ok(resolution.candidates.some((candidate) => candidate.path === cmdPath));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resolveCodexCliCandidates can read a real Windows .cmd launcher version", { skip: process.platform !== "win32" }, () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-cli-utils-real-"));
  const basePath = join(repoRoot, "codex");
  const cmdPath = `${basePath}.cmd`;

  try {
    writeFileSync(basePath, "", "utf8");
    writeFileSync(cmdPath, "@echo off\r\necho codex-cli 0.105.0\r\n", "utf8");

    const resolution = resolveCodexCliCandidates(
      repoRoot,
      { PATH: repoRoot, ComSpec: process.env.ComSpec || "cmd.exe" },
      {
        platform: "win32",
        readCommandPathFn: () => basePath,
        readAllCommandPathsFn: () => [basePath, cmdPath],
      }
    );

    assert.equal(resolution.preferred?.path, cmdPath);
    assert.equal(resolution.preferred?.version, "0.105.0");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
