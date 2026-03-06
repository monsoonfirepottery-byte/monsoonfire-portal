#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function buildService({ repoRoot, user }) {
  return [
    "[Unit]",
    "Description=Open Memory Ops Supervisor",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `User=${user}`,
    `WorkingDirectory=${repoRoot}`,
    "Restart=always",
    "RestartSec=5",
    "Environment=NODE_ENV=production",
    `ExecStart=/usr/bin/env node ${repoRoot}/scripts/open-memory-ops-supervisor.mjs --watch true --interval-ms 10000`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

function buildHealthTimer() {
  return [
    "[Unit]",
    "Description=Open Memory Ops Stack Doctor Timer",
    "",
    "[Timer]",
    "OnBootSec=2m",
    "OnUnitActiveSec=2m",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

function buildHealthService({ repoRoot, user }) {
  return [
    "[Unit]",
    "Description=Open Memory Ops Stack Doctor",
    "",
    "[Service]",
    "Type=oneshot",
    `User=${user}`,
    `WorkingDirectory=${repoRoot}`,
    `ExecStart=/usr/bin/env node ${repoRoot}/scripts/open-memory-ops-stack.mjs doctor`,
    "",
  ].join("\n");
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const repoRoot = readString(flags, "repo-root", process.cwd());
  const outDir = resolve(readString(flags, "out-dir", resolve(process.cwd(), "output", "open-memory", "systemd")));
  const user = readString(flags, "user", process.env.USER || "wuff");

  mkdirSync(outDir, { recursive: true });

  const files = [
    {
      path: resolve(outDir, "open-memory-ops-supervisor.service"),
      content: buildService({ repoRoot, user }),
    },
    {
      path: resolve(outDir, "open-memory-ops-doctor.service"),
      content: buildHealthService({ repoRoot, user }),
    },
    {
      path: resolve(outDir, "open-memory-ops-doctor.timer"),
      content: buildHealthTimer(),
    },
  ];

  for (const file of files) {
    writeFileSync(file.path, file.content, "utf8");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        outDir,
        files: files.map((file) => file.path),
        next: [
          `sudo cp ${outDir}/open-memory-ops-supervisor.service /etc/systemd/system/`,
          `sudo cp ${outDir}/open-memory-ops-doctor.service /etc/systemd/system/`,
          `sudo cp ${outDir}/open-memory-ops-doctor.timer /etc/systemd/system/`,
          "sudo systemctl daemon-reload",
          "sudo systemctl enable --now open-memory-ops-supervisor.service",
          "sudo systemctl enable --now open-memory-ops-doctor.timer",
        ],
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`open-memory-ops-systemd-bundle failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
