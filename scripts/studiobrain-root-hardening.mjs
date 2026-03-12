#!/usr/bin/env node

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const TEMPLATE_ROOT = resolve(REPO_ROOT, "studio-brain", "config", "root-hardening");
const DEFAULT_PHASES = ["packages", "lynis", "aide"];
const ALL_PHASES = ["packages", "ssh", "firewall", "lynis", "aide"];
const PUBLIC_TCP_PORTS = ["80", "443"];
const PUBLIC_UDP_PORTS = ["443"];
const MONITOR_PORTS = ["18080", "18081"];

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const jsonMode = args.includes("--json");
const printOnly = !apply || args.includes("--print");
const phases = resolvePhases(args);
const lanSubnet = readFlagValue(args, "--lan-subnet") || process.env.STUDIO_BRAIN_LAN_SUBNET || "192.168.1.0/24";
const adminIp = readFlagValue(args, "--admin-ip") || process.env.STUDIO_BRAIN_ADMIN_IP || "192.168.1.141/32";
const repoHome = readFlagValue(args, "--repo-root") || process.env.STUDIO_BRAIN_REPO_ROOT || REPO_ROOT;
const studioUser = readFlagValue(args, "--user") || process.env.STUDIO_BRAIN_USER || "wuff";
const enableUfw = args.includes("--enable-ufw");
const rollbackWindow = readFlagValue(args, "--rollback-window") || process.env.STUDIO_BRAIN_UFW_ROLLBACK_WINDOW || "5m";
const routedPolicy = normalizeRoutedPolicy(readFlagValue(args, "--routed-policy") || "keep");
const confirmSecondSsh = args.includes("--i-confirm-second-ssh");
const currentSshClientIp = detectCurrentSshClientIp(process.env);
const sshAllowCidrs = unique([
  ...readFlagValues(args, "--ssh-allow-cidr"),
  currentSshClientIp ? `${currentSshClientIp}/32` : "",
  adminIp,
  lanSubnet,
]);
const monitorAllowCidrs = unique([...readFlagValues(args, "--monitor-allow-cidr"), lanSubnet]);

const firewallRules = buildFirewallRules({
  sshAllowCidrs,
  monitorAllowCidrs,
});

const commandBase = `sudo node ${relativePath(resolve(__dirname, "studiobrain-root-hardening.mjs"))}`;
const safeSequence = [
  {
    label: "Install and configure packages only",
    command: `${commandBase} --apply`,
  },
  {
    label: "Apply SSH key-only hardening after verifying a second SSH session",
    command: `${commandBase} --apply --phases ssh --i-confirm-second-ssh`,
  },
  {
    label: "Stage UFW rules without enabling them",
    command: buildFirewallCommand({
      commandBase,
      enableUfw: false,
      routedPolicy,
      sshAllowCidrs,
      monitorAllowCidrs,
    }),
  },
  {
    label: `Enable UFW with a ${rollbackWindow} auto-rollback guard after reviewing the staged rules`,
    command: buildFirewallCommand({
      commandBase,
      enableUfw: true,
      rollbackWindow,
      routedPolicy,
      sshAllowCidrs,
      monitorAllowCidrs,
    }),
  },
];

const plan = {
  phases,
  requiresRoot: true,
  currentSshClientIp,
  lanSubnet,
  adminIp,
  repoHome,
  studioUser,
  routedPolicy,
  enableUfw,
  rollbackWindow,
  packages: ["lynis", "aide", "aide-common"],
  templates: {
    ssh: resolve(TEMPLATE_ROOT, "ssh", "99-recovery.conf"),
    lynisWeekly: resolve(TEMPLATE_ROOT, "cron.weekly", "studiobrain-lynis"),
    aideLocal: resolve(TEMPLATE_ROOT, "aide", "90_studiobrain_local"),
  },
  firewall: {
    dockerSafeDefault: true,
    notes: [
      "UFW is intentionally not enabled by default.",
      "The routed policy defaults to keep because this host uses Docker-managed internet services.",
      "Review the staged rules and keep a console or second SSH session open before enabling UFW.",
      `When UFW is enabled through this script, a rollback timer is armed first via systemd-run and must be cancelled after validation succeeds.`,
    ],
    rollbackGuard: {
      requiredWhenEnabling: true,
      tool: "systemd-run",
      window: rollbackWindow,
    },
    sshAllowCidrs,
    monitorAllowCidrs,
    publicTcpPorts: PUBLIC_TCP_PORTS,
    publicUdpPorts: PUBLIC_UDP_PORTS,
    rules: firewallRules,
  },
  safeSequence,
};

if (printOnly) {
  output(
    {
      status: "planned",
      apply,
      defaultPhases: DEFAULT_PHASES,
      plan,
      safeSequence,
    },
    0,
  );
}

if (process.getuid() !== 0) {
  output(
    {
      status: "fail",
      error: "This command must run as root.",
      safeSequence,
    },
    1,
  );
}

if (phases.some((phase) => phase === "ssh" || phase === "firewall") && !confirmSecondSsh) {
  output(
    {
      status: "fail",
      error: "Pass --i-confirm-second-ssh only after verifying a second SSH session is healthy.",
      plan,
    },
    1,
  );
}

if (enableUfw && !(phases.length === 1 && phases[0] === "firewall")) {
  output(
    {
      status: "fail",
      error: "Use --enable-ufw only with --phases firewall so the rollback guard and validation flow stay isolated.",
      plan,
    },
    1,
  );
}

if (phases.includes("firewall") && currentSshClientIp && !sshAllowCidrs.some((cidr) => cidrIncludesIp(cidr, currentSshClientIp))) {
  output(
    {
      status: "fail",
      error: `The current SSH client IP ${currentSshClientIp} is not covered by the staged SSH allowlist.`,
      plan,
    },
    1,
  );
}

if (phases.includes("firewall") && routedPolicy === "deny" && isDockerPresent()) {
  output(
    {
      status: "fail",
      error: "Refusing routed-policy=deny on a Docker host. Keep the routed policy unchanged unless you have an out-of-band recovery path and a Docker-specific firewall review.",
      plan,
    },
    1,
  );
}

if (enableUfw && !isCommandAvailable("systemd-run")) {
  output(
    {
      status: "fail",
      error: "Refusing to enable UFW without systemd-run. This host needs the rollback guard path before remote firewall changes.",
      plan,
    },
    1,
  );
}

const backupDir = createBackupDir();
const backupRecords = [];
const steps = [];
let rollbackGuard = null;

captureCommandOutput(backupDir, "pre-change-sshd.txt", "sshd", ["-T"], { allowFailure: true });
captureCommandOutput(backupDir, "pre-change-ufw-status.txt", "ufw", ["status", "numbered"], { allowFailure: true });
captureCommandOutput(backupDir, "pre-change-ufw-added.txt", "ufw", ["show", "added"], { allowFailure: true });

if (phases.includes("packages") || phases.includes("lynis") || phases.includes("aide")) {
  steps.push(runCommand("apt-get", ["update"], { env: { DEBIAN_FRONTEND: "noninteractive" } }));
  steps.push(runCommand("apt-get", ["install", "-y", "lynis", "aide", "aide-common"], { env: { DEBIAN_FRONTEND: "noninteractive" } }));
}

if (phases.includes("ssh")) {
  backupRecords.push(backupFile("/etc/ssh/sshd_config.d/99-recovery.conf"));
  applyTemplate(plan.templates.ssh, "/etc/ssh/sshd_config.d/99-recovery.conf", { mode: 0o644 });
  steps.push(runCommand("sshd", ["-t"]));
  steps.push(runCommand("systemctl", ["reload", "ssh"]));
}

if (phases.includes("firewall")) {
  for (const path of [
    "/etc/default/ufw",
    "/etc/ufw/ufw.conf",
    "/etc/ufw/before.rules",
    "/etc/ufw/after.rules",
    "/etc/ufw/user.rules",
    "/etc/ufw/user6.rules",
  ]) {
    backupRecords.push(backupFile(path));
  }

  steps.push(runCommand("ufw", ["default", "deny", "incoming"]));
  steps.push(runCommand("ufw", ["default", "allow", "outgoing"]));
  if (routedPolicy !== "keep") {
    steps.push(runCommand("ufw", ["default", routedPolicy, "routed"]));
  }
  steps.push(runCommand("ufw", ["logging", "low"]));

  let ufwAddedOutput = loadUfwAddedOutput();
  const broadSshAllowCommands = findBroadSshAllowCommands(ufwAddedOutput);
  for (const command of broadSshAllowCommands) {
    steps.push(runShellCommand(command.replace(/^ufw\s+/, "ufw delete ")));
  }
  if (broadSshAllowCommands.length > 0) {
    ufwAddedOutput = loadUfwAddedOutput();
  }

  for (const rule of firewallRules) {
    if (!ufwAddedOutput.includes(rule.comment)) {
      steps.push(runCommand("ufw", [...rule.args, "comment", rule.comment]));
      ufwAddedOutput = loadUfwAddedOutput();
    }
  }

  if (enableUfw) {
    writeRollbackScript(backupDir, backupRecords, phases);
    rollbackGuard = armFirewallRollbackGuard({
      backupDir,
      rollbackPath: resolve(backupDir, "rollback.sh"),
      window: rollbackWindow,
    });
    steps.push(rollbackGuard.armResult);
    if (rollbackGuard.armResult.success) {
      steps.push(runCommand("systemctl", ["status", rollbackGuard.timerUnit, "--no-pager", "--lines=10"], { allowFailure: true }));
      steps.push(runCommand("ufw", ["--force", "enable"]));
      steps.push(runCommand("ufw", ["status", "numbered"]));
    }
  } else {
    steps.push(runCommand("ufw", ["show", "added"], { allowFailure: true }));
  }
}

if (phases.includes("lynis")) {
  mkdirSync("/var/log/security-audits/lynis", { recursive: true, mode: 0o750 });
  backupRecords.push(backupFile("/etc/cron.weekly/studiobrain-lynis"));
  applyTemplate(plan.templates.lynisWeekly, "/etc/cron.weekly/studiobrain-lynis", { mode: 0o755 });
  steps.push(runCommand("lynis", ["audit", "system", "--quick", "--cronjob"], { allowFailure: true }));
}

if (phases.includes("aide")) {
  mkdirSync("/etc/aide/aide.conf.d", { recursive: true, mode: 0o755 });
  backupRecords.push(backupFile("/etc/aide/aide.conf.d/90_studiobrain_local"));
  backupRecords.push(backupFile("/etc/aide/aide.conf"));
  applyTemplate(plan.templates.aideLocal, "/etc/aide/aide.conf.d/90_studiobrain_local", {
    mode: 0o644,
    replacements: {
      "__STUDIO_USER__": studioUser,
      "__REPO_ROOT__": repoHome,
    },
  });
  steps.push(runCommand("update-aide.conf", [], { allowFailure: true }));
  if (!existsSync("/var/lib/aide/aide.db")) {
    steps.push(runCommand("aideinit", ["-y"]));
  }
  steps.push(runCommand("systemctl", ["enable", "--now", "dailyaidecheck.timer"]));
  steps.push(runCommand("systemctl", ["status", "dailyaidecheck.timer", "--no-pager", "--lines=20"], { allowFailure: true }));
  steps.push(runCommand("aide", ["--config=/etc/aide/aide.conf", "--check"], { allowFailure: true }));
}

writeRollbackScript(backupDir, backupRecords, phases);

const failed = steps.filter((step) => !step.ok);
output(
  {
    status: failed.length === 0 ? "pass" : "warn",
    backupDir,
    plan,
    rollbackCommand: `${resolve(backupDir, "rollback.sh")}`,
    rollbackGuard,
    steps: steps.map(summarize),
  },
  failed.length === 0 ? 0 : 1,
);

function resolvePhases(argv) {
  const raw = readFlagValue(argv, "--phases") || readFlagValue(argv, "--phase");
  if (!raw) {
    return [...DEFAULT_PHASES];
  }
  const parsed = unique(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const invalid = parsed.filter((value) => !ALL_PHASES.includes(value));
  if (invalid.length > 0) {
    output(
      {
        status: "fail",
        error: `Unknown phase(s): ${invalid.join(", ")}. Valid phases: ${ALL_PHASES.join(", ")}.`,
      },
      1,
    );
  }
  return parsed;
}

function readFlagValue(argv, flag) {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === flag) {
      return String(argv[index + 1] || "").trim();
    }
    if (String(value).startsWith(`${flag}=`)) {
      return String(value).slice(flag.length + 1).trim();
    }
  }
  return "";
}

function readFlagValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === flag) {
      values.push(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }
    if (value.startsWith(`${flag}=`)) {
      values.push(value.slice(flag.length + 1).trim());
    }
  }
  return values.filter(Boolean);
}

function normalizeRoutedPolicy(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["keep", "allow", "deny"].includes(normalized)) {
    return normalized;
  }
  output(
    {
      status: "fail",
      error: `Invalid --routed-policy value "${value}". Use keep, allow, or deny.`,
    },
    1,
  );
}

function detectCurrentSshClientIp(env) {
  for (const key of ["SSH_CONNECTION", "SSH_CLIENT"]) {
    const value = String(env[key] || "").trim();
    if (!value) {
      continue;
    }
    const ip = value.split(/\s+/)[0];
    if (ip) {
      return ip;
    }
  }
  return "";
}

function buildFirewallRules(config) {
  const rules = [];
  for (const port of PUBLIC_TCP_PORTS) {
    rules.push({
      args: ["allow", `${port}/tcp`],
      comment: `studiobrain-public-${port}-tcp`,
    });
  }
  for (const port of PUBLIC_UDP_PORTS) {
    rules.push({
      args: ["allow", `${port}/udp`],
      comment: `studiobrain-public-${port}-udp`,
    });
  }
  for (const cidr of config.sshAllowCidrs) {
    rules.push({
      args: ["allow", "from", cidr, "to", "any", "port", "22", "proto", "tcp"],
      comment: `studiobrain-ssh-${commentSafe(cidr)}`,
    });
  }
  for (const cidr of config.monitorAllowCidrs) {
    for (const port of MONITOR_PORTS) {
      rules.push({
        args: ["allow", "from", cidr, "to", "any", "port", port, "proto", "tcp"],
        comment: `studiobrain-monitor-${port}-${commentSafe(cidr)}`,
      });
    }
  }
  return rules;
}

function buildFirewallCommand(config) {
  const parts = [
    config.commandBase,
    "--apply",
    "--phases",
    "firewall",
    "--i-confirm-second-ssh",
  ];
  if (config.enableUfw) {
    parts.push("--enable-ufw");
    parts.push("--rollback-window", config.rollbackWindow || rollbackWindow);
  }
  if (config.routedPolicy && config.routedPolicy !== "keep") {
    parts.push("--routed-policy", config.routedPolicy);
  }
  for (const cidr of config.sshAllowCidrs) {
    parts.push("--ssh-allow-cidr", cidr);
  }
  for (const cidr of config.monitorAllowCidrs) {
    parts.push("--monitor-allow-cidr", cidr);
  }
  return parts.join(" ");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function createBackupDir() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve("/var/backups", "studiobrain-hardening", timestamp);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

function backupFile(path) {
  const existed = existsSync(path);
  if (!existed) {
    return { path, existed: false, backupTarget: "", mode: "644" };
  }
  const stats = statSync(path);
  const target = resolve(backupDir, path.replace(/^\/+/, "").replace(/\//g, "__"));
  copyFileSync(path, target);
  return { path, existed: true, backupTarget: target, mode: String((stats.mode & 0o777).toString(8)) };
}

function applyTemplate(templatePath, targetPath, options = {}) {
  let content = readFileSync(templatePath, "utf8");
  for (const [needle, replacement] of Object.entries(options.replacements || {})) {
    content = content.split(needle).join(String(replacement));
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content, "utf8");
  if (options.mode) {
    chmodSync(targetPath, options.mode);
  }
}

function captureCommandOutput(dir, filename, command, commandArgs, options = {}) {
  const result = runCommand(command, commandArgs, { allowFailure: true, ...options });
  writeFileSync(resolve(dir, filename), `${result.command}\n\n${result.output}\n`, "utf8");
}

function loadUfwAddedOutput() {
  const result = runCommand("ufw", ["show", "added"], { allowFailure: true });
  return String(result.output || "");
}

function armFirewallRollbackGuard(config) {
  const unitBase = `studiobrain-ufw-rollback-${backupDirName(config.backupDir)}`;
  const timerUnit = `${unitBase}.timer`;
  const serviceUnit = `${unitBase}.service`;
  const armResult = runCommand("systemd-run", [
    "--unit",
    unitBase,
    "--on-active",
    config.window,
    "--collect",
    "/bin/sh",
    config.rollbackPath,
  ]);
  return {
    armed: armResult.success,
    tool: "systemd-run",
    window: config.window,
    unitBase,
    timerUnit,
    serviceUnit,
    statusCommand: `sudo systemctl status ${timerUnit} --no-pager --lines=20`,
    cancelCommand: `sudo systemctl stop ${timerUnit} ${serviceUnit} || true\nsudo systemctl reset-failed ${timerUnit} ${serviceUnit} || true`,
    rollbackCommand: config.rollbackPath,
    armResult,
  };
}

function backupDirName(value) {
  const parts = String(value || "").split("/").filter(Boolean);
  return parts[parts.length - 1] || String(Date.now());
}

function findBroadSshAllowCommands(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("ufw "))
    .filter((line) => {
      if (/^ufw allow OpenSSH(?:\s+comment\b.*)?$/i.test(line)) {
        return true;
      }
      if (/^ufw allow 22(?:\/tcp)?(?:\s+comment\b.*)?$/i.test(line)) {
        return true;
      }
      if (!/\ballow\b/i.test(line)) {
        return false;
      }
      if (!/\bport\s+22\b/i.test(line)) {
        return false;
      }
      if (/\bfrom\s+(?:any|Anywhere)\b/i.test(line)) {
        return true;
      }
      return !/\bfrom\b/i.test(line);
    });
}

function runCommand(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const ok = options.allowFailure ? true : result.status === 0;
  return {
    ok,
    success: result.status === 0,
    statusCode: result.status ?? 1,
    command: `${command} ${commandArgs.join(" ")}`.trim(),
    output,
  };
}

function runShellCommand(command, options = {}) {
  return runCommand("bash", ["-lc", command], options);
}

function isCommandAvailable(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${shellEscape(command)}`], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0;
}

function writeRollbackScript(dir, records, selectedPhases) {
  const lines = [
    "#!/bin/sh",
    "set -eu",
    "",
    "# Generated by studiobrain-root-hardening.mjs",
  ];

  if (selectedPhases.includes("firewall")) {
    lines.push("ufw disable || true");
  }

  for (const record of records) {
    if (record.existed && record.backupTarget) {
      lines.push(`install -D -m ${String(record.mode || "644")} ${shellEscape(record.backupTarget)} ${shellEscape(record.path)}`);
      continue;
    }
    lines.push(`rm -f ${shellEscape(record.path)}`);
  }

  if (selectedPhases.includes("ssh")) {
    lines.push("sshd -t || true");
    lines.push("systemctl reload ssh || true");
  }

  if (selectedPhases.includes("firewall")) {
    lines.push("ufw status numbered || true");
  }

  const target = resolve(dir, "rollback.sh");
  writeFileSync(target, `${lines.join("\n")}\n`, "utf8");
  chmodSync(target, 0o700);
}

function summarize(result) {
  return {
    ok: result.ok,
    success: result.success,
    statusCode: result.statusCode,
    command: result.command,
    output: truncateOutput(result.output, 1500),
  };
}

function isDockerPresent() {
  const docker = spawnSync("bash", ["-lc", "command -v docker >/dev/null 2>&1 && docker ps -q >/dev/null 2>&1"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return docker.status === 0;
}

function cidrIncludesIp(cidr, ip) {
  const normalizedCidr = String(cidr || "").trim();
  const normalizedIp = String(ip || "").trim();
  if (!normalizedCidr || !normalizedIp) {
    return false;
  }
  if (!normalizedCidr.includes("/")) {
    return normalizedCidr === normalizedIp;
  }
  const [network, prefixText] = normalizedCidr.split("/", 2);
  const prefix = Number(prefixText);
  if (!Number.isFinite(prefix)) {
    return false;
  }
  if (looksLikeIpv4(network) && looksLikeIpv4(normalizedIp)) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4ToInt(network) & mask) === (ipv4ToInt(normalizedIp) & mask);
  }
  return normalizedCidr === `${normalizedIp}/${prefix}`;
}

function looksLikeIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || ""));
}

function ipv4ToInt(value) {
  return String(value)
    .split(".")
    .map((part) => Number(part))
    .reduce((accumulator, part) => ((accumulator << 8) | part) >>> 0, 0);
}

function commentSafe(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function truncateOutput(value, max) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}...`;
}

function relativePath(path) {
  return path.startsWith(`${REPO_ROOT}/`) ? path.slice(REPO_ROOT.length + 1) : path;
}

function output(payload, exitCode) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(exitCode);
  }

  process.stdout.write(`studiobrain root hardening: ${String(payload.status).toUpperCase()}\n`);
  if (payload.error) {
    process.stdout.write(`  error: ${payload.error}\n`);
  }
  if (payload.backupDir) {
    process.stdout.write(`  backup dir: ${payload.backupDir}\n`);
  }
  if (payload.rollbackCommand) {
    process.stdout.write(`  rollback: ${payload.rollbackCommand}\n`);
  }
  if (payload.rollbackGuard?.armed) {
    process.stdout.write(`  rollback guard: ${payload.rollbackGuard.timerUnit} (${payload.rollbackGuard.window})\n`);
    process.stdout.write(`  guard status: ${payload.rollbackGuard.statusCommand}\n`);
    process.stdout.write("  cancel guard after validation:\n");
    for (const line of String(payload.rollbackGuard.cancelCommand || "").split("\n").filter(Boolean)) {
      process.stdout.write(`    ${line}\n`);
    }
  }
  if (payload.plan?.phases?.length) {
    process.stdout.write(`  phases: ${payload.plan.phases.join(", ")}\n`);
  }
  if (Array.isArray(payload.safeSequence) && payload.safeSequence.length > 0) {
    process.stdout.write("  safe sequence:\n");
    for (const step of payload.safeSequence) {
      process.stdout.write(`    - ${step.label}: ${step.command}\n`);
    }
  } else if (Array.isArray(payload.plan?.safeSequence) && payload.plan.safeSequence.length > 0) {
    process.stdout.write("  safe sequence:\n");
    for (const step of payload.plan.safeSequence) {
      process.stdout.write(`    - ${step.label}: ${step.command}\n`);
    }
  }
  process.exit(exitCode);
}
