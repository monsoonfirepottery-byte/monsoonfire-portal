#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (!key) continue;
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

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function run(command) {
  return spawnSync("bash", ["-lc", command], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parsePgrep(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1], 10),
        command: String(match[2] || "").trim(),
      };
    })
    .filter((row) => row && Number.isFinite(row.pid) && row.pid > 1 && row.pid !== process.pid);
}

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@,-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function removeArgPair(tokens, flag) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === flag) {
      i += 1;
      continue;
    }
    if (token.startsWith(`${flag}=`)) continue;
    out.push(token);
  }
  return out;
}

function extractArgValue(tokens, flag, fallback = null) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === flag) {
      return i + 1 < tokens.length ? tokens[i + 1] : fallback;
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }
  return fallback;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Mail Import Watchdog Retune",
        "",
        "Usage:",
        "  node ./scripts/mail-import-watchdog-retune.mjs --run-root <path> --import-concurrency-cap 2 --json true",
        "",
        "Options:",
        "  --run-root <path>                    Required run root to target",
        "  --import-concurrency-cap <n>         New importer concurrency cap for watchdog restarts (default: 2)",
        "  --dry-run true|false                 Show plan without applying (default: false)",
        "  --json true|false                    Emit JSON output (default: true)",
      ].join("\n") + "\n"
    );
    return;
  }

  const runRoot = readString(flags, "run-root", "");
  if (!runRoot) {
    throw new Error("Missing --run-root.");
  }

  const importConcurrencyCap = readInt(flags, "import-concurrency-cap", 2, { min: 1, max: 32 });
  const dryRun = readBool(flags, "dry-run", false);
  const outputJson = readBool(flags, "json", true);

  const escapedRunRoot = runRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pgrepPattern = `mail-import-watchdog\\.sh.*--run-root[= ]${escapedRunRoot}`;
  const procRes = run(`pgrep -af '${pgrepPattern}'`);
  const matches = parsePgrep(procRes.stdout);

  const payload = {
    ok: false,
    dryRun,
    runRoot,
    requestedImportConcurrencyCap: importConcurrencyCap,
    found: matches.length,
    actions: [],
    errors: [],
  };

  if (matches.length <= 0) {
    payload.errors.push("No watchdog process matched the requested run root.");
    emit(payload, outputJson);
    process.exit(1);
  }

  const target = matches[0];
  const originalTokens = String(target.command).split(/\s+/).filter(Boolean);
  const currentCap = Number.parseInt(
    String(extractArgValue(originalTokens, "--import-concurrency-cap", extractArgValue(originalTokens, "--chunk-size", "0"))),
    10
  );

  const nextTokens = removeArgPair(originalTokens, "--import-concurrency-cap");
  nextTokens.push("--import-concurrency-cap", String(importConcurrencyCap));
  const nextCommand = nextTokens.map(shellQuote).join(" ");

  payload.current = {
    pid: target.pid,
    command: target.command,
    importConcurrencyCap: Number.isFinite(currentCap) ? currentCap : null,
  };
  payload.next = {
    command: nextCommand,
    importConcurrencyCap,
  };

  if (Number.isFinite(currentCap) && currentCap <= importConcurrencyCap) {
    payload.ok = true;
    payload.actions.push("noop:already-at-or-below-target");
    emit(payload, outputJson);
    return;
  }

  if (dryRun) {
    payload.ok = true;
    payload.actions.push("dry-run-only");
    emit(payload, outputJson);
    return;
  }

  const paneInfo = findTmuxPaneByPid(target.pid);
  if (paneInfo) {
    payload.tmux = paneInfo;
    const sessionName = paneInfo.sessionName;
    const sessionKill = run(`tmux kill-session -t ${shellQuote(sessionName)}`);
    if (sessionKill.status !== 0) {
      payload.errors.push(`Failed to kill tmux session ${sessionName}.`);
      emit(payload, outputJson);
      process.exit(1);
    }
    payload.actions.push(`tmux-session-killed:${sessionName}`);

    const sessionStartCommand = `cd ${shellQuote(process.cwd())} && ${nextCommand}`;
    const sessionStart = run(`tmux new-session -d -s ${shellQuote(sessionName)} ${shellQuote(sessionStartCommand)}`);
    if (sessionStart.status !== 0) {
      payload.errors.push(`Failed to start tmux session ${sessionName} with retuned command.`);
      emit(payload, outputJson);
      process.exit(1);
    }
    payload.actions.push(`tmux-session-started:${sessionName}`);

    const paneAfter = findTmuxPaneBySession(sessionName);
    if (paneAfter) {
      payload.newPid = paneAfter.panePid;
      payload.tmux.after = paneAfter;
    }
    payload.ok = true;
    emit(payload, outputJson);
    return;
  }

  const stopRes = run(`kill -TERM ${target.pid}`);
  if (stopRes.status !== 0) {
    payload.errors.push(`Failed to stop watchdog pid ${target.pid}.`);
    emit(payload, outputJson);
    process.exit(1);
  }
  payload.actions.push(`stopped:${target.pid}`);

  const startRes = run(`nohup ${nextCommand} >/tmp/mail-import-watchdog-retune.log 2>&1 & echo $!`);
  const newPid = Number.parseInt(String(startRes.stdout || "").trim().split(/\r?\n/).slice(-1)[0] || "0", 10);
  if (startRes.status !== 0 || !Number.isFinite(newPid) || newPid <= 1) {
    payload.errors.push("Failed to start retuned watchdog command.");
    emit(payload, outputJson);
    process.exit(1);
  }

  payload.ok = true;
  payload.actions.push(`started:${newPid}`);
  payload.newPid = newPid;

  emit(payload, outputJson);
}

function findTmuxPaneByPid(pid) {
  const rows = listTmuxPanes();
  for (const row of rows) {
    if (row.panePid === pid) return row;
  }
  return null;
}

function findTmuxPaneBySession(sessionName) {
  const rows = listTmuxPanes();
  for (const row of rows) {
    if (row.sessionName === sessionName) return row;
  }
  return null;
}

function listTmuxPanes() {
  const res = run("tmux list-panes -a -F '#{session_name}|#{pane_id}|#{pane_pid}|#{pane_start_command}'");
  if (res.status !== 0) return [];
  return String(res.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|");
      if (parts.length < 4) return null;
      const panePid = Number.parseInt(parts[2], 10);
      if (!Number.isFinite(panePid) || panePid <= 1) return null;
      return {
        sessionName: parts[0],
        paneId: parts[1],
        panePid,
        paneStartCommand: parts.slice(3).join("\t"),
      };
    })
    .filter(Boolean);
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  const lines = [];
  lines.push("Mail Import Watchdog Retune");
  lines.push(`ok: ${String(payload.ok)}`);
  lines.push(`runRoot: ${payload.runRoot}`);
  lines.push(`requestedImportConcurrencyCap: ${payload.requestedImportConcurrencyCap}`);
  if (payload.current) {
    lines.push(`current: pid=${payload.current.pid} cap=${String(payload.current.importConcurrencyCap)}`);
  }
  if (payload.newPid) {
    lines.push(`newPid: ${payload.newPid}`);
  }
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    lines.push(`actions: ${payload.actions.join(", ")}`);
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    lines.push(`errors: ${payload.errors.join(" | ")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
