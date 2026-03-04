#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseArgs(argv) {
  const options = {
    project: "",
    prefix: "pr",
    keep: 60,
    maxDelete: 30,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();

    if (!arg) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--project") {
      const next = String(argv[index + 1] || "").trim();
      if (next) {
        options.project = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--project=")) {
      options.project = String(arg.slice("--project=".length)).trim();
      continue;
    }
    if (arg === "--prefix") {
      const next = String(argv[index + 1] || "").trim();
      if (next) {
        options.prefix = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--prefix=")) {
      options.prefix = String(arg.slice("--prefix=".length)).trim() || options.prefix;
      continue;
    }
    if (arg === "--keep") {
      const next = Number.parseInt(String(argv[index + 1] || ""), 10);
      if (Number.isFinite(next) && next >= 0) {
        options.keep = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--keep=")) {
      const value = Number.parseInt(String(arg.slice("--keep=".length)).trim(), 10);
      if (Number.isFinite(value) && value >= 0) {
        options.keep = value;
      }
      continue;
    }
    if (arg === "--max-delete") {
      const next = Number.parseInt(String(argv[index + 1] || ""), 10);
      if (Number.isFinite(next) && next >= 0) {
        options.maxDelete = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--max-delete=")) {
      const value = Number.parseInt(String(arg.slice("--max-delete=".length)).trim(), 10);
      if (Number.isFinite(value) && value >= 0) {
        options.maxDelete = value;
      }
      continue;
    }
  }

  if (!options.project) {
    throw new Error("Missing required --project <firebase-project-id> argument.");
  }

  return options;
}

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }
      const error = new Error(`${command} ${args.join(" ")} exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.code = code;
      reject(error);
    });
  });
}

function parseJsonOutput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Failed to parse firebase-tools JSON output.");
  }
}

function getChannelList(payload) {
  if (Array.isArray(payload?.result?.channels)) {
    return payload.result.channels;
  }
  if (Array.isArray(payload?.channels)) {
    return payload.channels;
  }
  if (Array.isArray(payload?.result)) {
    return payload.result;
  }
  return [];
}

function getChannelId(channel) {
  const rawName = String(
    channel?.channelId || channel?.id || channel?.name || channel?.resource || "",
  ).trim();
  if (!rawName) return "";
  if (rawName.includes("/")) {
    return rawName.split("/").pop() || "";
  }
  return rawName;
}

function toMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function channelFreshnessMs(channel) {
  return Math.max(
    toMs(channel?.updateTime),
    toMs(channel?.release?.createTime),
    toMs(channel?.release?.releaseTime),
    toMs(channel?.createTime),
    toMs(channel?.expireTime),
  );
}

async function resolveServiceAccountEnv() {
  const existing = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (existing) {
    return {
      env: {},
      cleanup: async () => {},
      credentialSource: "GOOGLE_APPLICATION_CREDENTIALS",
    };
  }

  const serviceAccountJson = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL ||
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      "",
  ).trim();

  if (!serviceAccountJson) {
    return {
      env: {},
      cleanup: async () => {},
      credentialSource: "none",
    };
  }

  const tmpBase = await mkdtemp(join(tmpdir(), "firebase-sa-"));
  const credentialPath = join(tmpBase, "service-account.json");
  await writeFile(credentialPath, serviceAccountJson, "utf8");
  return {
    env: { GOOGLE_APPLICATION_CREDENTIALS: credentialPath },
    cleanup: async () => {
      await rm(tmpBase, { recursive: true, force: true });
    },
    credentialSource: "FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const auth = await resolveServiceAccountEnv();
  const output = {
    status: "ok",
    project: options.project,
    prefix: options.prefix,
    keep: options.keep,
    maxDelete: options.maxDelete,
    credentialSource: auth.credentialSource,
    totalChannels: 0,
    prefixedChannels: 0,
    deleted: [],
    skipped: [],
    errors: [],
  };

  try {
    const listResp = await runCommand(
      "npx",
      ["firebase-tools@latest", "hosting:channel:list", "--project", options.project, "--json"],
      auth.env,
    );
    const payload = parseJsonOutput(listResp.stdout);
    const channels = getChannelList(payload);

    const prChannels = channels
      .map((channel) => ({
        id: getChannelId(channel),
        freshnessMs: channelFreshnessMs(channel),
      }))
      .filter((item) => item.id && item.id.startsWith(options.prefix))
      .sort((left, right) => right.freshnessMs - left.freshnessMs);

    output.totalChannels = channels.length;
    output.prefixedChannels = prChannels.length;

    const prunedCandidates = prChannels.slice(options.keep, options.keep + options.maxDelete);
    for (const channel of prunedCandidates) {
      try {
        await runCommand(
          "npx",
          [
            "firebase-tools@latest",
            "hosting:channel:delete",
            channel.id,
            "--project",
            options.project,
            "--force",
          ],
          auth.env,
        );
        output.deleted.push(channel.id);
      } catch (error) {
        output.errors.push({
          channelId: channel.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (prChannels.length <= options.keep) {
      output.skipped.push(`No deletion needed (${prChannels.length} <= keep=${options.keep}).`);
    }
    if (prChannels.length > options.keep + options.maxDelete) {
      output.skipped.push(
        `Deletion capped by --max-delete=${options.maxDelete}; remaining channels were left untouched.`,
      );
    }
  } finally {
    await auth.cleanup();
  }

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(
    `firebase-preview-prune: project=${output.project} prefixed=${output.prefixedChannels} deleted=${output.deleted.length}`,
  );
  if (output.skipped.length > 0) {
    for (const note of output.skipped) {
      console.log(`- ${note}`);
    }
  }
  if (output.errors.length > 0) {
    for (const entry of output.errors) {
      console.error(`delete failed for ${entry.channelId}: ${entry.message}`);
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
