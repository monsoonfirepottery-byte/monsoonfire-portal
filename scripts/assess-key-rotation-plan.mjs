#!/usr/bin/env node

import { readFileSync, existsSync, appendFileSync } from "node:fs";

function setOutput(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
}

function setPlan(plan) {
  setOutput("rotate", plan.rotate ? "true" : "false");
  setOutput("reason", plan.reason || "");
  setOutput("alert_number", plan.alertNumber || "");
  setOutput("dry_run", plan.dryRun || "false");
  setOutput("disable_previous", plan.disablePrevious || "true");
  setOutput("resolve_alert", plan.resolveAlert || "false");
}

async function fetchOpenAlerts(repo, token) {
  const alerts = [];
  let page = 1;

  while (true) {
    const url = new URL(`https://api.github.com/repos/${repo}/secret-scanning/alerts`);
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to list secret-scanning alerts (${response.status}): ${body}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) break;

    alerts.push(...payload);
    if (payload.length < 100) break;
    page += 1;
  }

  return alerts;
}

function loadAllowedBaselineNumbers() {
  const baselinePath = ".github/security/secret-scanning-baseline.json";
  if (!existsSync(baselinePath)) return new Set();

  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    return new Set((baseline.allowedOpenAlertNumbers || []).map((value) => Number(value)));
  } catch {
    return new Set();
  }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));

  if (eventName === "workflow_dispatch") {
    const inputs = payload.inputs || {};
    setPlan({
      rotate: true,
      reason: String(inputs.reason || "manual-rotation"),
      alertNumber: String(inputs.alert_number || ""),
      dryRun: String(inputs.dry_run || "false"),
      disablePrevious: String(inputs.disable_previous || "true"),
      resolveAlert: String(inputs.resolve_alert || "false"),
    });
    return;
  }

  if (eventName !== "schedule") {
    setPlan({
      rotate: false,
      reason: `unsupported-trigger-${eventName}`,
      dryRun: "false",
      disablePrevious: "true",
      resolveAlert: "false",
    });
    return;
  }

  const token = (process.env.SECURITY_AUTOMATION_GH_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  if (!token) {
    setPlan({
      rotate: false,
      reason: "scheduled-poll-skipped-missing-token",
      dryRun: "false",
      disablePrevious: "true",
      resolveAlert: "false",
    });
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY;
  const allowed = loadAllowedBaselineNumbers();
  const alerts = await fetchOpenAlerts(repo, token);

  const candidates = alerts
    .filter((alert) => String(alert.state) === "open")
    .filter((alert) => String(alert.secret_type) === "google_api_key")
    .filter((alert) => !allowed.has(Number(alert.number)))
    .sort((a, b) => {
      const ad = new Date(a.created_at || 0).getTime();
      const bd = new Date(b.created_at || 0).getTime();
      return bd - ad;
    });

  if (candidates.length === 0) {
    setPlan({
      rotate: false,
      reason: "scheduled-poll-no-new-google-api-key-alerts",
      dryRun: "false",
      disablePrevious: "true",
      resolveAlert: "false",
    });
    return;
  }

  setPlan({
    rotate: true,
    reason: "scheduled-new-google-api-key-alert",
    alertNumber: String(candidates[0].number || ""),
    dryRun: "false",
    disablePrevious: "true",
    resolveAlert: "true",
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
