import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const composePath = path.join(process.cwd(), "docker-compose.yml");
const requiredServices = ["postgres", "redis", "minio"];
const optionalServices = ["otel-collector"];

function parseServicesFromCompose(raw) {
  const lines = raw.split(/\r?\n/);
  const services = [];
  let inServices = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || /^\s*#/.test(line)) {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (indent === 0 && trimmed === "services:") {
      inServices = true;
      continue;
    }

    if (indent === 0 && trimmed !== "services:" && inServices) {
      inServices = false;
    }

    if (!inServices) continue;
    if (indent === 2 && /^[^:\s]+:\s*$/.test(trimmed)) {
      services.push(trimmed.slice(0, -1));
    }
  }

  return services;
}

function fail(message) {
  process.stderr.write(`compose validation failed: ${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const raw = await fs.readFile(composePath, "utf8");
  const file = raw.trim();
  if (!file) {
    fail("docker-compose.yml is empty");
    return;
  }

  const result = spawnSync("docker", ["compose", "-f", composePath, "config"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    fail("docker compose config failed");
    return;
  }

  const output = result.stdout || "";
  const services = parseServicesFromCompose(output);
  const missing = requiredServices.filter((service) => !services.includes(service));
  if (missing.length > 0) {
    fail(`missing required service(s) in rendered compose: ${missing.join(", ")}`);
    return;
  }

  process.stdout.write("compose validation passed\n");
  process.stdout.write("required services:\n");
  for (const service of requiredServices) {
    process.stdout.write(`  - ${service}\n`);
  }

  const disabledOptional = optionalServices.filter((service) => !services.includes(service));
  if (disabledOptional.length > 0) {
    process.stdout.write(`optional services not enabled: ${disabledOptional.join(", ")}\n`);
  }
}

void main();
