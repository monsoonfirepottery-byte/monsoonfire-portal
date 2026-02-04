import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const commands = [
  { name: "vite", args: ["./node_modules/vite/bin/vite.js"] },
  { name: "vitest", args: ["./node_modules/vitest/vitest.mjs", "--configLoader", "runner"] },
];

const children = commands.map(({ name, args }) => {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
    console.log(`[${name}] exited with code ${code ?? 0}`);
  });
  child.on("error", (err) => {
    console.error(`[${name}] failed to start:`, err);
    process.exitCode = 1;
  });
  return child;
});

const shutdown = () => {
  children.forEach((child) => {
    if (!child.killed) {
      child.kill("SIGINT");
    }
  });
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
