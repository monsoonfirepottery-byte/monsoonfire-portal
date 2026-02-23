#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const strict = args.has("--strict");

const checks = [];

function readUtf8(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function addCheck(ok, key, message, details = null) {
  checks.push({ ok, key, message, details });
}

function hasAll(source, patterns) {
  return patterns.every((pattern) => source.includes(pattern));
}

function checkFunctionSurface() {
  const path = "functions/src/websiteKilnBoard.ts";
  const source = readUtf8(path);
  addCheck(
    hasAll(source, ["export const websiteKilnBoard", "lastUpdated", "nextFireType", "readyForPickup"]),
    "function_surface",
    "website kiln board function exposes public payload keys",
    { path }
  );
}

function checkWebsiteLoader(path) {
  const source = readUtf8(path);
  const ok = hasAll(source, ["/api/websiteKilnBoard", "/data/kiln-status.json", "lastUpdated"]);
  addCheck(ok, `loader:${path}`, "loader supports API + static fallback", { path });
}

function checkFallbackJson(path) {
  let parsed = null;
  try {
    parsed = JSON.parse(readUtf8(path));
  } catch (error) {
    addCheck(false, `json:${path}`, "fallback json parses", {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const kilns = Array.isArray(parsed?.kilns) ? parsed.kilns : [];
  const hasRequiredTop = typeof parsed?.lastUpdated === "string" && kilns.length >= 1;
  const hasRequiredKilnShape = kilns.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof row.name === "string" &&
      typeof row.controller === "string" &&
      typeof row.nextFireType === "string" &&
      typeof row.nextFirePlanned === "string" &&
      typeof row.readyForPickup === "string"
  );

  addCheck(hasRequiredTop, `json-top:${path}`, "fallback json has lastUpdated + kiln rows", { path });
  addCheck(hasRequiredKilnShape, `json-shape:${path}`, "fallback json kiln rows include required fields", {
    path,
    kilnCount: kilns.length,
  });
}

checkFunctionSurface();
checkWebsiteLoader("website/assets/js/kiln-status.js");
checkWebsiteLoader("website/ncsitebuilder/assets/js/kiln-status.js");
checkFallbackJson("website/data/kiln-status.json");
checkFallbackJson("website/ncsitebuilder/data/kiln-status.json");

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  strict,
  failed: failed.length,
  checks,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const check of checks) {
    const marker = check.ok ? "PASS" : "FAIL";
    process.stdout.write(`${marker} ${check.key}: ${check.message}\n`);
  }
}

if (failed.length > 0) {
  process.exit(1);
}
