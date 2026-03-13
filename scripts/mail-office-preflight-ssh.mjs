#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCliArgs, readBoolFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const normalized = String(line || "").trim();
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const assignment = normalized.startsWith("export ") ? normalized.slice(7).trim() : normalized;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) {
      continue;
    }
    process.env[key] = value;
  }
}

function looksLikeGuid(value) {
  return GUID_RE.test(String(value || "").trim());
}

function isTenantIdentifier(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (looksLikeGuid(normalized)) return true;
  if (normalized.toLowerCase() === "common") return true;
  return TENANT_DOMAIN_RE.test(normalized);
}

function splitScopes(rawScopes) {
  return String(rawScopes || "")
    .split(/\s+/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function hasScope(scopes, expected) {
  const token = String(expected || "").trim().toLowerCase();
  const normalized = scopes.map((entry) => String(entry || "").trim().toLowerCase());
  return normalized.includes(token);
}

function parseAadstsCode(errorDescription) {
  const match = String(errorDescription || "").match(/AADSTS(\d{5,})/i);
  return match ? match[1] : "";
}

async function probeClientSecret({ tenantId, clientId, clientSecret }) {
  const endpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  return {
    ok: response.ok,
    status: response.status,
    error: String(payload?.error || "").trim(),
    errorDescription: String(payload?.error_description || "").trim(),
    accessToken: String(payload?.access_token || "").trim(),
    raw,
  };
}

async function probeGraphMailboxRead({ mailboxUser, accessToken }) {
  const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUser)}/messages?$top=1&$select=id`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  return {
    ok: response.ok,
    status: response.status,
    error: String(payload?.error?.code || payload?.error || "").trim(),
    errorDescription: String(payload?.error?.message || payload?.error_description || "").trim(),
    raw,
  };
}

function record(checks, { id, ok, severity = "error", message }) {
  checks.push({
    id,
    ok: Boolean(ok),
    severity,
    message: String(message || "").trim(),
  });
}

function usage() {
  process.stdout.write(
    [
      "Office mailbox preflight (SSH helper)",
      "",
      "Usage:",
      "  node ./scripts/mail-office-preflight-ssh.mjs --provider office365",
      "",
      "Options:",
      "  --provider office365|imap-generic (default: office365)",
      "  --load-env-file true|false (default: true)",
      "  --env-file <path> (default: secrets/studio-brain/open-memory-mail-import.env)",
      "  --load-portal-env-file true|false (default: true)",
      "  --portal-env-file <path> (default: secrets/portal/portal-automation.env)",
      "  --skip-secret-probe true|false (default: false)",
      "  --client-secret <value> (alias: --outlook-client-secret)",
      "  --json true|false (default: false)",
    ].join("\n")
  );
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolve(readStringFlag(flags, "env-file", "secrets/studio-brain/open-memory-mail-import.env"));
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolve(readStringFlag(flags, "portal-env-file", "secrets/portal/portal-automation.env"));
  const provider = readStringFlag(flags, "provider", "office365").toLowerCase().trim() || "office365";
  const printJson = readBoolFlag(flags, "json", false);
  const skipSecretProbe = readBoolFlag(flags, "skip-secret-probe", false);

  if (!["office365", "imap-generic"].includes(provider)) {
    throw new Error(`Invalid --provider "${provider}". Use office365 or imap-generic.`);
  }

  if (loadEnvFileFlag) {
    loadEnvFile(envFilePath);
  }
  if (loadPortalEnvFileFlag) {
    loadEnvFile(portalEnvFilePath);
  }

  const checks = [];

  if (provider === "office365") {
    const tenantId = readStringFlag(flags, "tenant-id", process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || "");
    const clientId = readStringFlag(flags, "client-id", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "");
    const explicitClientSecret = readStringFlag(
      flags,
      "client-secret",
      readStringFlag(flags, "outlook-client-secret", "")
    );
    const clientSecret = explicitClientSecret || process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "";
    const outlookUser = readStringFlag(flags, "outlook-user", process.env.MAIL_IMPORT_OUTLOOK_USER || "");
    const scopes = splitScopes(
      readStringFlag(flags, "scopes", process.env.MAIL_IMPORT_OUTLOOK_SCOPES || "https://graph.microsoft.com/Mail.Read offline_access")
    );

    record(checks, {
      id: "tenant-id-present",
      ok: Boolean(tenantId),
      message: tenantId ? `Using tenant "${tenantId}".` : "Missing MAIL_IMPORT_OUTLOOK_TENANT_ID.",
    });
    record(checks, {
      id: "tenant-id-shape",
      ok: isTenantIdentifier(tenantId),
      message: isTenantIdentifier(tenantId)
        ? "Tenant id format looks valid."
        : "Tenant id should be a GUID, tenant domain, or 'common'.",
    });
    record(checks, {
      id: "client-id-present",
      ok: Boolean(clientId),
      message: clientId ? `Using client id "${clientId}".` : "Missing MAIL_IMPORT_OUTLOOK_CLIENT_ID.",
    });
    record(checks, {
      id: "client-id-shape",
      ok: looksLikeGuid(clientId),
      message: looksLikeGuid(clientId) ? "Client id format looks valid." : "Client id should be an application GUID.",
    });
    record(checks, {
      id: "client-secret-present",
      ok: Boolean(clientSecret),
      message: clientSecret
        ? "Client secret is present."
        : "Missing MAIL_IMPORT_OUTLOOK_CLIENT_SECRET / MS_CLIENT_SECRET for confidential-client device flow.",
    });
    record(checks, {
      id: "client-secret-shape",
      ok: !Boolean(clientSecret) || !looksLikeGuid(clientSecret),
      severity: Boolean(clientSecret) ? "error" : "warning",
      message: !Boolean(clientSecret)
        ? "Skipped secret shape validation because no secret is configured yet."
        : !looksLikeGuid(clientSecret)
        ? "Client secret shape looks plausible."
        : "Client secret value looks like a GUID/permission id. Use a real secret value from Certificates & secrets.",
    });
    record(checks, {
      id: "outlook-user-present",
      ok: Boolean(outlookUser),
      message: outlookUser ? `Using mailbox user "${outlookUser}".` : "Missing MAIL_IMPORT_OUTLOOK_USER.",
    });
    record(checks, {
      id: "scopes-mail-read",
      ok: hasScope(scopes, "https://graph.microsoft.com/Mail.Read") || hasScope(scopes, "mail.read"),
      message: "Configured scopes include Mail.Read.",
    });
    record(checks, {
      id: "scopes-offline-access",
      ok: hasScope(scopes, "offline_access"),
      message: "Configured scopes include offline_access.",
    });

    const canProbe = Boolean(tenantId && clientId && clientSecret && !looksLikeGuid(clientSecret));
    if (skipSecretProbe) {
      record(checks, {
        id: "client-secret-live-probe",
        ok: true,
        severity: "warning",
        message: "Skipped live secret probe (--skip-secret-probe true).",
      });
      record(checks, {
        id: "graph-mailbox-app-read-probe",
        ok: true,
        severity: "warning",
        message: "Skipped Graph mailbox app-read probe because secret probe was skipped.",
      });
    } else if (!canProbe) {
      record(checks, {
        id: "client-secret-live-probe",
        ok: true,
        severity: "warning",
        message: "Skipped live secret probe until tenant/client/secret checks pass.",
      });
      record(checks, {
        id: "graph-mailbox-app-read-probe",
        ok: true,
        severity: "warning",
        message: "Skipped Graph mailbox app-read probe until tenant/client/secret checks pass.",
      });
    } else {
      try {
        const probe = await probeClientSecret({ tenantId, clientId, clientSecret });
        if (probe.ok) {
          record(checks, {
            id: "client-secret-live-probe",
            ok: true,
            message: "Live token endpoint probe succeeded.",
          });
          if (!outlookUser) {
            record(checks, {
              id: "graph-mailbox-app-read-probe",
              ok: true,
              severity: "warning",
              message: "Skipped Graph mailbox app-read probe because outlook user is missing.",
            });
          } else if (!probe.accessToken) {
            record(checks, {
              id: "graph-mailbox-app-read-probe",
              ok: false,
              message: "Token endpoint probe succeeded but did not return an access token for mailbox-read probe.",
            });
          } else {
            const mailboxProbe = await probeGraphMailboxRead({
              mailboxUser: outlookUser,
              accessToken: probe.accessToken,
            });
            if (mailboxProbe.ok) {
              record(checks, {
                id: "graph-mailbox-app-read-probe",
                ok: true,
                message: "Graph mailbox app-read probe succeeded.",
              });
            } else if (mailboxProbe.status === 403 || mailboxProbe.error === "ErrorAccessDenied") {
              record(checks, {
                id: "graph-mailbox-app-read-probe",
                ok: false,
                message:
                  "Graph mailbox probe returned AccessDenied. Add Microsoft Graph Application permission Mail.Read and grant admin consent for the tenant.",
              });
            } else if (mailboxProbe.status === 404) {
              record(checks, {
                id: "graph-mailbox-app-read-probe",
                ok: false,
                message: `Graph mailbox probe returned 404 for ${outlookUser}. Confirm the mailbox exists in this tenant.`,
              });
            } else {
              record(checks, {
                id: "graph-mailbox-app-read-probe",
                ok: false,
                message: `Graph mailbox probe failed (HTTP ${mailboxProbe.status}). ${mailboxProbe.errorDescription || mailboxProbe.raw}`,
              });
            }
          }
        } else if (probe.error === "invalid_client") {
          record(checks, {
            id: "client-secret-live-probe",
            ok: false,
            message:
              "Live probe failed with invalid_client. Secret is missing, wrong, or expired for this app registration.",
          });
          record(checks, {
            id: "graph-mailbox-app-read-probe",
            ok: true,
            severity: "warning",
            message: "Skipped Graph mailbox app-read probe because token endpoint probe failed.",
          });
        } else if (probe.error === "invalid_scope") {
          record(checks, {
            id: "client-secret-live-probe",
            ok: false,
            message: `Live probe failed with invalid_scope. ${probe.errorDescription || "Check app permissions and scope."}`,
          });
          record(checks, {
            id: "graph-mailbox-app-read-probe",
            ok: true,
            severity: "warning",
            message: "Skipped Graph mailbox app-read probe because token endpoint probe failed.",
          });
        } else if (probe.error === "unauthorized_client") {
          record(checks, {
            id: "client-secret-live-probe",
            ok: true,
            severity: "warning",
            message:
              "Live probe returned unauthorized_client for client_credentials. Secret appears accepted; delegated device flow can still work.",
          });
          record(checks, {
            id: "graph-mailbox-app-read-probe",
            ok: true,
            severity: "warning",
            message: "Skipped Graph mailbox app-read probe because client_credentials is unauthorized.",
          });
        } else {
          const aadCode = parseAadstsCode(probe.errorDescription);
          record(checks, {
            id: "client-secret-live-probe",
            ok: false,
            message: `Live probe failed (${probe.error || probe.status}${aadCode ? ` / AADSTS${aadCode}` : ""}). ${probe.errorDescription || probe.raw}`,
          });
          record(checks, {
            id: "graph-mailbox-app-read-probe",
            ok: true,
            severity: "warning",
            message: "Skipped Graph mailbox app-read probe because token endpoint probe failed.",
          });
        }
      } catch (error) {
        record(checks, {
          id: "client-secret-live-probe",
          ok: false,
          message: `Live probe error: ${error instanceof Error ? error.message : String(error)}`,
        });
        record(checks, {
          id: "graph-mailbox-app-read-probe",
          ok: true,
          severity: "warning",
          message: "Skipped Graph mailbox app-read probe because token endpoint probe errored.",
        });
      }
    }
  } else {
    const host = readStringFlag(flags, "imap-host", process.env.MAIL_IMPORT_IMAP_HOST || "");
    const user = readStringFlag(flags, "imap-user", process.env.MAIL_IMPORT_IMAP_USER || "");
    const password = readStringFlag(flags, "imap-password", process.env.MAIL_IMPORT_IMAP_PASSWORD || "");
    record(checks, {
      id: "imap-host-present",
      ok: Boolean(host),
      message: host ? `Using IMAP host "${host}".` : "Missing MAIL_IMPORT_IMAP_HOST.",
    });
    record(checks, {
      id: "imap-user-present",
      ok: Boolean(user),
      message: user ? `Using IMAP user "${user}".` : "Missing MAIL_IMPORT_IMAP_USER.",
    });
    record(checks, {
      id: "imap-password-present",
      ok: Boolean(password),
      message: password ? "IMAP password is present." : "Missing MAIL_IMPORT_IMAP_PASSWORD.",
    });
  }

  const hardFailures = checks.filter((entry) => !entry.ok && entry.severity !== "warning");
  const warnings = checks.filter((entry) => entry.severity === "warning");
  const status = hardFailures.length === 0 ? "pass" : "fail";

  if (printJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status,
          provider,
          checks,
          hardFailureCount: hardFailures.length,
          warningCount: warnings.length,
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stdout.write(`Office preflight (${provider}): ${status.toUpperCase()}\n`);
    for (const entry of checks) {
      const tag = entry.ok ? "PASS" : entry.severity === "warning" ? "WARN" : "FAIL";
      process.stdout.write(`[${tag}] ${entry.id} - ${entry.message}\n`);
    }
  }

  if (hardFailures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`mail-office-preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
