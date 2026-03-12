#!/usr/bin/env node

import {
  DEFAULT_CONFIG_PATH,
  DEFAULT_REPORT_DIR,
  DEFAULT_STATE_PATH,
  buildAutomationStatus,
  evaluateAutomationGate,
  recordAutomationQuotaFailure,
  setAutomationPause,
} from "./lib/codex-automation-control.mjs";

function printUsage() {
  process.stdout.write(
    [
      "Codex automation control",
      "",
      "Usage:",
      "  node ./scripts/codex-automation-control.mjs <command> [options]",
      "",
      "Commands:",
      "  status                 Show current automation pause/cooldown status",
      "  gate                   Evaluate whether an automated launcher may run",
      "  pause                  Persist a runtime pause flag",
      "  resume                 Clear the runtime pause flag",
      "  trip-quota             Record a quota failure and trip cooldown state",
      "",
      "Common options:",
      "  --config <path>        Budget config path",
      "  --state <path>         Runtime state path",
      "  --report-dir <path>    Codex proc report directory",
      "  --launcher <id>        Launcher id (example: monsoonfire-overnight.service)",
      "  --model <name>         Model id",
      "  --json                 Print JSON",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const parsed = {
    command: "",
    configPath: DEFAULT_CONFIG_PATH,
    statePath: DEFAULT_STATE_PATH,
    reportDir: DEFAULT_REPORT_DIR,
    launcher: "",
    model: "",
    automated: true,
    reason: "",
    note: "",
    message: "",
    asJson: false,
  };

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printUsage();
    process.exit(0);
  }

  parsed.command = String(argv[0] || "").trim().toLowerCase();

  for (let index = 1; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.asJson = true;
      continue;
    }
    if (arg === "--manual") {
      parsed.automated = false;
      continue;
    }
    if (arg === "--automated") {
      parsed.automated = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--config") {
      parsed.configPath = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--state") {
      parsed.statePath = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report-dir") {
      parsed.reportDir = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--launcher") {
      parsed.launcher = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--model") {
      parsed.model = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--reason") {
      parsed.reason = String(next);
      index += 1;
      continue;
    }
    if (arg === "--note") {
      parsed.note = String(next);
      index += 1;
      continue;
    }
    if (arg === "--message") {
      parsed.message = String(next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function emit(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${payload.status || payload.reason || "ok"}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "status") {
    const status = buildAutomationStatus({
      configPath: args.configPath,
      statePath: args.statePath,
      reportDir: args.reportDir,
      launcher: args.launcher,
      model: args.model,
    });
    emit(status, args.asJson);
    return;
  }

  if (args.command === "gate") {
    const decision = evaluateAutomationGate({
      launcher: args.launcher || "intent-codex-proc",
      model: args.model,
      automated: args.automated,
      configPath: args.configPath,
      statePath: args.statePath,
      reportDir: args.reportDir,
    });
    emit(decision, true);
    process.exit(decision.allowed ? 0 : 20);
  }

  if (args.command === "pause" || args.command === "resume") {
    const active = args.command === "pause";
    const result = setAutomationPause({
      active,
      reason: args.reason || (active ? "manual_pause" : "manual_resume"),
      note: args.note,
      statePath: args.statePath,
    });
    emit(
      {
        schema: "codex-automation-pause.v1",
        generatedAt: new Date().toISOString(),
        status: active ? "paused" : "resumed",
        statePath: args.statePath,
        globalPause: result.state.globalPause,
      },
      args.asJson
    );
    return;
  }

  if (args.command === "trip-quota") {
    const payload = recordAutomationQuotaFailure({
      launcher: args.launcher || "intent-codex-proc",
      model: args.model,
      message: args.message,
      configPath: args.configPath,
      statePath: args.statePath,
    });
    emit(payload, args.asJson);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`codex-automation-control failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
