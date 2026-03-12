#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const SSH_RECOVERY_PATH = "/etc/ssh/sshd_config.d/99-recovery.conf";
const FAIL2BAN_SSHD_PATH = "/etc/fail2ban/jail.d/sshd.local";

const tools = [
  {
    id: "ufw",
    label: "UFW",
    versionCommand: ["bash", "-lc", "ufw version | head -n 1"],
    installHint: "sudo apt-get install -y ufw",
  },
  {
    id: "fail2ban-client",
    label: "Fail2Ban",
    versionCommand: ["bash", "-lc", "fail2ban-client -V | head -n 1"],
    installHint: "sudo apt-get install -y fail2ban",
  },
  {
    id: "lynis",
    label: "Lynis",
    versionCommand: ["bash", "-lc", "lynis show version | head -n 1"],
    installHint: "sudo apt-get install -y lynis",
  },
  {
    id: "aide",
    label: "AIDE",
    versionCommand: ["bash", "-lc", "aide --version | head -n 1"],
    installHint: "sudo apt-get install -y aide",
  },
  {
    id: "falco",
    label: "Falco",
    versionCommand: ["bash", "-lc", "falco --version | head -n 1"],
    installHint: "curl -fsSL https://falco.org/repo/falcosecurity-packages.asc | sudo gpg --dearmor -o /usr/share/keyrings/falco-archive-keyring.gpg && echo 'deb [signed-by=/usr/share/keyrings/falco-archive-keyring.gpg] https://download.falco.org/packages/deb stable main' | sudo tee /etc/apt/sources.list.d/falcosecurity.list >/dev/null && sudo apt-get update && sudo apt-get install -y falco",
  },
];

const toolStatus = tools.map((tool) => inspectTool(tool));
const sshRecovery = inspectSshRecovery();
const sshSurface = inspectSshSurface();
const fail2banSshd = inspectFail2BanSshd();

const payload = {
  generatedAt: new Date().toISOString(),
  tools: toolStatus,
  fail2banSshd,
  sshRecovery,
  sshSurface,
  recommendedNext: buildRecommendedNext(toolStatus, fail2banSshd, sshRecovery, sshSurface),
};

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

process.stdout.write("StudioBrain host hardening audit\n");
for (const tool of toolStatus) {
  process.stdout.write(`- ${tool.label}: ${tool.installed ? "installed" : "missing"}`);
  if (tool.version) {
    process.stdout.write(` (${tool.version})`);
  }
  process.stdout.write("\n");
}
process.stdout.write(`- SSH recovery override: ${sshRecovery.present ? "present" : "absent"}\n`);
if (sshRecovery.present && sshRecovery.riskyDirectives.length > 0) {
  process.stdout.write(`  risky directives: ${sshRecovery.riskyDirectives.join(", ")}\n`);
}
process.stdout.write(`- Fail2Ban sshd jail: ${fail2banSshd.present ? "present" : "not found"}\n`);
if (fail2banSshd.present) {
  process.stdout.write(`  ignoreip: ${fail2banSshd.ignoreip.join(", ") || "(none)"}\n`);
  process.stdout.write(`  maxretry/findtime/bantime: ${fail2banSshd.maxretry || "default"} / ${fail2banSshd.findtime || "default"} / ${fail2banSshd.bantime || "default"}\n`);
}
process.stdout.write(`- SSH listener: ${sshSurface.publicListener ? "public/LAN-listening" : "not exposed"}\n`);
if (payload.recommendedNext.length > 0) {
  process.stdout.write("Recommended next:\n");
  for (const item of payload.recommendedNext) {
    process.stdout.write(`- ${item}\n`);
  }
}

function inspectTool(tool) {
  const presence = spawnSync("bash", ["-lc", `command -v ${tool.id}`], {
    encoding: "utf8",
    stdio: "pipe",
  });
  const installed = presence.status === 0;
  const version = installed ? firstLine(run(tool.versionCommand).output) : "";
  return {
    id: tool.id,
    label: tool.label,
    installed,
    version,
    installHint: installed ? "" : tool.installHint,
  };
}

function inspectSshRecovery() {
  if (!existsSync(SSH_RECOVERY_PATH)) {
    return {
      present: false,
      path: SSH_RECOVERY_PATH,
      riskyDirectives: [],
    };
  }

  const text = readFileSync(SSH_RECOVERY_PATH, "utf8");
  const riskyDirectives = [];
  for (const directive of [
    "PasswordAuthentication yes",
    "KbdInteractiveAuthentication yes",
    "AuthenticationMethods any",
  ]) {
    if (text.includes(directive)) {
      riskyDirectives.push(directive);
    }
  }
  return {
    present: true,
    path: SSH_RECOVERY_PATH,
    riskyDirectives,
  };
}

function inspectSshSurface() {
  const result = run(["bash", "-lc", "ss -tulpn | rg '(^|\\s)(0\\.0\\.0\\.0|\\[::\\]):22\\s'"]);
  return {
    publicListener: result.status === 0,
    output: firstLine(result.output),
  };
}

function inspectFail2BanSshd() {
  if (!existsSync(FAIL2BAN_SSHD_PATH)) {
    return {
      present: false,
      path: FAIL2BAN_SSHD_PATH,
      ignoreip: [],
      maxretry: "",
      findtime: "",
      bantime: "",
    };
  }

  const text = readFileSync(FAIL2BAN_SSHD_PATH, "utf8");
  return {
    present: true,
    path: FAIL2BAN_SSHD_PATH,
    ignoreip: parseAssignment(text, "ignoreip").split(/\s+/).filter(Boolean),
    maxretry: parseAssignment(text, "maxretry"),
    findtime: parseAssignment(text, "findtime"),
    bantime: parseAssignment(text, "bantime"),
  };
}

function buildRecommendedNext(toolStatus, fail2banSshd, sshRecovery, sshSurface) {
  const items = [];
  for (const tool of toolStatus) {
    if (!tool.installed) {
      items.push(`${tool.label} missing. Install with: ${tool.installHint}`);
    }
  }
  if (fail2banSshd.present && fail2banSshd.ignoreip.length === 0) {
    items.push(`Fail2Ban sshd jail at ${fail2banSshd.path} has no explicit ignoreip allowlist. Add the current management IP before tightening bans.`);
  }
  if (sshRecovery.present && sshRecovery.riskyDirectives.length > 0) {
    items.push(`SSH recovery override still weakens auth at ${sshRecovery.path}. Remove password-based directives after verifying key-only access.`);
  }
  if (sshSurface.publicListener) {
    items.push("SSH is still listening on all interfaces. Pair key-only SSH with UFW rules that restrict port 22 to the management subnet.");
  }
  if (!toolStatus.find((tool) => tool.id === "ufw")?.installed) {
    items.push("Install UFW before widening any forwarding rules.");
  }
  if (items.length > 0) {
    items.push("Use `npm run studio:security:root:print` and apply the root hardening phases separately. Stage firewall rules first, then use the guarded UFW enable path with the printed rollback timer on this Docker host.");
  }
  return items;
}

function run(command) {
  const [file, ...commandArgs] = command;
  const result = spawnSync(file, commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function parseAssignment(text, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m");
  const match = text.match(pattern);
  return match ? String(match[1]).trim() : "";
}
