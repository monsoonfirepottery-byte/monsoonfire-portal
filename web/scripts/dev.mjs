import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveStudioBrainNetworkProfile } from "../../scripts/studio-network-profile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

const networkProfile = (() => {
  const next = process.argv.find((value, index) => {
    return value === "--network-profile" && typeof process.argv[index + 1] === "string";
  });
  if (!next) {
    return "";
  }

  const index = process.argv.indexOf(next);
  return process.argv[index + 1] || "";
})();

const studioProfile = resolveStudioBrainNetworkProfile({
  env: {
    ...process.env,
    ...(networkProfile ? { STUDIO_BRAIN_NETWORK_PROFILE: networkProfile } : {}),
  },
});

const inheritedEnv = {
  ...process.env,
  ...(!process.env.VITE_DEV_HOST && { VITE_DEV_HOST: studioProfile.host }),
  ...(!process.env.VITE_PORT && !process.env.PORT && { VITE_PORT: "5173" }),
  ...(!process.env.VITE_ALLOWED_HOSTS && {
    VITE_ALLOWED_HOSTS: studioProfile.allowedStudioBrainHosts.join(","),
  }),
  ...(!process.env.VITE_STUDIO_BRAIN_PROXY_TARGET && {
    VITE_STUDIO_BRAIN_PROXY_TARGET: `http://${studioProfile.host}:8787`,
  }),
  ...(!process.env.VITE_FUNCTIONS_PROXY_TARGET && {
    VITE_FUNCTIONS_PROXY_TARGET: `http://${studioProfile.host}:5001/monsoonfire-portal/us-central1`,
  }),
};

const commands = [
  { name: "vite", args: ["./node_modules/vite/bin/vite.js"] },
  { name: "vitest", args: ["./node_modules/vitest/vitest.mjs", "--configLoader", "runner"] },
];

const children = commands.map(({ name, args }) => {
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: inheritedEnv,
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
