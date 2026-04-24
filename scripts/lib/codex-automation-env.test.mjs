import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadCodexAutomationEnv } from "./codex-automation-env.mjs";

function writeEnvFile(path, body) {
  writeFileSync(path, `${body.trim()}\n`, "utf8");
}

test("loadCodexAutomationEnv binds lan-static automation runtime to the Studio Brain static IP", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automation-env-"));

  try {
    mkdirSync(join(repoRoot, "studio-brain"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets", "portal"), { recursive: true });

    writeEnvFile(
      join(repoRoot, "studio-brain", ".env"),
      `
        STUDIO_BRAIN_HOST=127.0.0.1
        STUDIO_BRAIN_PORT=8787
        STUDIO_BRAIN_NETWORK_PROFILE=local
        STUDIO_BRAIN_LOCAL_HOST=127.0.0.1
        PGHOST=127.0.0.1
        REDIS_HOST=127.0.0.1
        MINIO_API_PORT=9010
        STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT=http://127.0.0.1:9010
      `
    );
    writeEnvFile(
      join(repoRoot, "studio-brain", ".env.network.profile"),
      `
        STUDIO_BRAIN_NETWORK_PROFILE=lan-static
        STUDIO_BRAIN_HOST=
        STUDIO_BRAIN_STATIC_IP=192.168.1.226
        STUDIO_BRAIN_PORT=8787
      `
    );

    const env = {};
    loadCodexAutomationEnv({ repoRoot, env });

    assert.equal(env.STUDIO_BRAIN_NETWORK_PROFILE, "lan-static");
    assert.equal(env.STUDIO_BRAIN_HOST, "192.168.1.226");
    assert.equal(env.STUDIO_BRAIN_BASE_URL, "http://192.168.1.226:8787");
    assert.equal(env.STUDIO_BRAIN_STATIC_IP, "192.168.1.226");
    assert.equal(env.STUDIO_BRAIN_PORT, "8787");
    assert.equal(env.PGHOST, "192.168.1.226");
    assert.equal(env.REDIS_HOST, "192.168.1.226");
    assert.equal(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "http://192.168.1.226:9010");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadCodexAutomationEnv preserves explicit shell-level network and backend overrides", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automation-env-"));

  try {
    mkdirSync(join(repoRoot, "studio-brain"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets", "portal"), { recursive: true });

    writeEnvFile(
      join(repoRoot, "studio-brain", ".env"),
      `
        STUDIO_BRAIN_HOST=127.0.0.1
        STUDIO_BRAIN_NETWORK_PROFILE=local
      `
    );
    writeEnvFile(
      join(repoRoot, "studio-brain", ".env.network.profile"),
      `
        STUDIO_BRAIN_NETWORK_PROFILE=lan-static
        STUDIO_BRAIN_HOST=
        STUDIO_BRAIN_STATIC_IP=192.168.1.226
      `
    );

    const env = {
      STUDIO_BRAIN_NETWORK_PROFILE: "local",
      STUDIO_BRAIN_HOST: "10.0.0.9",
      STUDIO_BRAIN_BASE_URL: "http://10.0.0.9:8787",
      PGHOST: "10.0.0.8",
      REDIS_HOST: "10.0.0.7",
      STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT: "http://10.0.0.6:9010",
    };
    loadCodexAutomationEnv({ repoRoot, env });

    assert.equal(env.STUDIO_BRAIN_NETWORK_PROFILE, "local");
    assert.equal(env.STUDIO_BRAIN_HOST, "10.0.0.9");
    assert.equal(env.STUDIO_BRAIN_BASE_URL, "http://10.0.0.9:8787");
    assert.equal(env.PGHOST, "10.0.0.8");
    assert.equal(env.REDIS_HOST, "10.0.0.7");
    assert.equal(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "http://10.0.0.6:9010");
    assert.equal(env.STUDIO_BRAIN_STATIC_IP, "192.168.1.226");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadCodexAutomationEnv keeps local bindings when the effective profile is local", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automation-env-"));

  try {
    mkdirSync(join(repoRoot, "studio-brain"), { recursive: true });

    writeEnvFile(
      join(repoRoot, "studio-brain", ".env"),
      `
        STUDIO_BRAIN_HOST=127.0.0.1
        STUDIO_BRAIN_BASE_URL=http://127.0.0.1:8787
        STUDIO_BRAIN_NETWORK_PROFILE=local
        PGHOST=127.0.0.1
        REDIS_HOST=127.0.0.1
        STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT=http://127.0.0.1:9010
      `
    );
    writeEnvFile(
      join(repoRoot, "studio-brain", ".env.network.profile"),
      `
        STUDIO_BRAIN_HOST=
        STUDIO_BRAIN_BASE_URL=
        STUDIO_BRAIN_STATIC_IP=192.168.1.226
      `
    );

    const env = {};
    loadCodexAutomationEnv({ repoRoot, env });

    assert.equal(env.STUDIO_BRAIN_HOST, "127.0.0.1");
    assert.equal(env.STUDIO_BRAIN_BASE_URL, "http://127.0.0.1:8787");
    assert.equal(env.PGHOST, "127.0.0.1");
    assert.equal(env.REDIS_HOST, "127.0.0.1");
    assert.equal(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "http://127.0.0.1:9010");
    assert.equal(env.STUDIO_BRAIN_STATIC_IP, "192.168.1.226");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadCodexAutomationEnv keeps backend dependencies on loopback when running on the Studio Brain host itself", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automation-env-"));

  try {
    mkdirSync(join(repoRoot, "studio-brain"), { recursive: true });

    writeEnvFile(
      join(repoRoot, "studio-brain", ".env"),
      `
        STUDIO_BRAIN_HOST=127.0.0.1
        STUDIO_BRAIN_PORT=8787
        STUDIO_BRAIN_NETWORK_PROFILE=local
        PGHOST=127.0.0.1
        REDIS_HOST=127.0.0.1
        MINIO_API_PORT=9010
        STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT=http://127.0.0.1:9010
      `
    );
    writeEnvFile(
      join(repoRoot, "studio-brain", ".env.network.profile"),
      `
        STUDIO_BRAIN_NETWORK_PROFILE=lan-static
        STUDIO_BRAIN_HOST=
        STUDIO_BRAIN_STATIC_IP=192.168.1.226
        STUDIO_BRAIN_PORT=8787
      `
    );

    const env = {};
    loadCodexAutomationEnv({ repoRoot, env, localAddresses: ["192.168.1.226"] });

    assert.equal(env.STUDIO_BRAIN_HOST, "192.168.1.226");
    assert.equal(env.STUDIO_BRAIN_BASE_URL, "http://192.168.1.226:8787");
    assert.equal(env.PGHOST, "127.0.0.1");
    assert.equal(env.REDIS_HOST, "127.0.0.1");
    assert.equal(env.STUDIO_BRAIN_ARTIFACT_STORE_ENDPOINT, "http://127.0.0.1:9010");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("loadCodexAutomationEnv mirrors whichever Studio Brain admin token source is loaded for local scripts", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automation-env-"));

  try {
    mkdirSync(join(repoRoot, "secrets", "studio-brain"), { recursive: true });

    writeEnvFile(
      join(repoRoot, "secrets", "studio-brain", "studio-brain-mcp.env"),
      `
        STUDIO_BRAIN_MCP_ADMIN_TOKEN=test-admin-token
      `
    );

    const env = {};
    loadCodexAutomationEnv({ repoRoot, env });

    assert.equal(typeof env.STUDIO_BRAIN_MCP_ADMIN_TOKEN, "string");
    assert.equal(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN.length > 0, true);
    assert.equal(env.STUDIO_BRAIN_ADMIN_TOKEN, env.STUDIO_BRAIN_MCP_ADMIN_TOKEN);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
