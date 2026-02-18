import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const args = process.argv.slice(2);

const parseArgs = () => {
  const options = {
    only: "firestore,functions,auth",
    project: "monsoonfire-portal",
    config: "firebase.json",
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (!arg.startsWith("--")) {
      continue;
    }

    if (arg.startsWith("--only=")) {
      options.only = arg.substring("--only=".length);
      continue;
    }

    if (arg === "--only" && args[i + 1]) {
      options.only = args[++i];
      continue;
    }

    if (arg.startsWith("--project=")) {
      options.project = arg.substring("--project=".length);
      continue;
    }

    if (arg === "--project" && args[i + 1]) {
      options.project = args[++i];
      continue;
    }

    if (arg.startsWith("--config=")) {
      options.config = arg.substring("--config=".length);
      continue;
    }

    if (arg === "--config" && args[i + 1]) {
      options.config = args[++i];
      continue;
    }
  }

  return options;
};

const loadDotenv = (filePath) => {
  if (!existsSync(filePath)) {
    console.log(`No ${filePath} found. Using current process environment.`);
    return;
  }

  console.log(`Loading local env from ${filePath}`);
  const text = readFileSync(filePath, "utf8");
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      return;
    }

    const splitIndex = line.indexOf("=");
    if (splitIndex === -1) {
      return;
    }

    const key = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1);
    if (!key) {
      return;
    }

    process.env[key] = value;
  });
};

const { only, project, config } = parseArgs();
const envFile = resolve(repoRoot, "functions", ".env.local");
const resolvedConfig = resolve(repoRoot, config);

loadDotenv(envFile);

console.log(`Starting Firebase emulators (${only}) for project ${project}...`);

const result = spawnSync(
  "firebase",
  ["emulators:start", "--config", resolvedConfig, "--project", project, "--only", only],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
