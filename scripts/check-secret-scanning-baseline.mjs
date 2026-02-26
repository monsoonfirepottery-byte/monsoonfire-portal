#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
      throw new Error(`GitHub API error ${response.status}: ${body}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) break;

    alerts.push(...payload);
    if (payload.length < 100) break;
    page += 1;
  }

  return alerts;
}

function parseArgs() {
  const baselinePath = process.argv[2] || ".github/security/secret-scanning-baseline.json";
  const reportPath = process.argv[3] || "output/security/secret-scanning-open-alerts.json";
  return { baselinePath, reportPath };
}

async function main() {
  const { baselinePath, reportPath } = parseArgs();
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  if (!repo) throw new Error("GITHUB_REPOSITORY is required.");
  if (!token) throw new Error("GITHUB_TOKEN is required.");

  const baselineRaw = await readFile(baselinePath, "utf8");
  const baseline = JSON.parse(baselineRaw);
  const allowed = new Set((baseline.allowedOpenAlertNumbers || []).map((value) => Number(value)));

  const openAlerts = await fetchOpenAlerts(repo, token);
  const openNumbers = openAlerts.map((alert) => Number(alert.number)).filter(Number.isFinite);

  const newOpenAlerts = openAlerts.filter((alert) => !allowed.has(Number(alert.number)));
  const resolvedBaselineAlerts = [...allowed].filter((number) => !openNumbers.includes(number));

  const report = {
    generatedAtUtc: new Date().toISOString(),
    repository: repo,
    baselinePath,
    openAlertCount: openAlerts.length,
    openAlertNumbers: openNumbers.sort((a, b) => a - b),
    newOpenAlerts: newOpenAlerts.map((alert) => ({
      number: alert.number,
      secret_type: alert.secret_type,
      state: alert.state,
      created_at: alert.created_at,
      html_url: alert.html_url,
    })),
    resolvedBaselineAlerts: resolvedBaselineAlerts.sort((a, b) => a - b),
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Open secret-scanning alerts: ${report.openAlertCount}`);
  console.log(`Allowed open alert numbers: ${[...allowed].sort((a, b) => a - b).join(", ") || "(none)"}`);
  if (report.resolvedBaselineAlerts.length > 0) {
    console.log(`Baseline alerts now resolved: ${report.resolvedBaselineAlerts.join(", ")}`);
  }
  if (newOpenAlerts.length === 0) {
    console.log("No new open secret-scanning alerts outside baseline.");
    return;
  }

  console.error("New open secret-scanning alerts detected:");
  for (const alert of report.newOpenAlerts) {
    console.error(`- #${alert.number} ${alert.secret_type} ${alert.html_url}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
