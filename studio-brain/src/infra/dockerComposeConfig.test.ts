import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

function parseServices(raw: string): string[] {
  const services: string[] = [];
  const lines = raw.split(/\r?\n/);
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

    if (!inServices) {
      continue;
    }

    if (indent === 2 && /^[^:\s]+:\s*$/.test(trimmed)) {
      services.push(trimmed.slice(0, -1));
    }
  }

  return services;
}

test("docker-compose includes required backend services", async () => {
  const composePath = path.join(process.cwd(), "docker-compose.yml");
  const raw = await fs.readFile(composePath, "utf8");
  const services = parseServices(raw);

  assert.ok(services.includes("postgres"), "postgres service missing from compose config");
  assert.ok(services.includes("redis"), "redis service missing from compose config");
  assert.ok(services.includes("minio"), "minio service missing from compose config");
});
