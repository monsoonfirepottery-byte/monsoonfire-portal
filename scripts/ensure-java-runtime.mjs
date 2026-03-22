#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_MAJOR_VERSION = 21;
const DEFAULT_INSTALL_ROOT = resolve(repoRoot, ".codex", "tools", "java");

function parseArgs(argv) {
  const options = {
    majorVersion: Number.parseInt(process.env.PORTAL_JAVA_MAJOR || `${DEFAULT_MAJOR_VERSION}`, 10) || DEFAULT_MAJOR_VERSION,
    installRoot: process.env.PORTAL_JAVA_INSTALL_ROOT || DEFAULT_INSTALL_ROOT,
    forceInstall: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--major" && argv[index + 1]) {
      options.majorVersion = Number.parseInt(String(argv[index + 1]), 10);
      index += 1;
      continue;
    }
    if (arg.startsWith("--major=")) {
      options.majorVersion = Number.parseInt(arg.slice("--major=".length), 10);
      continue;
    }

    if (arg === "--install-root" && argv[index + 1]) {
      options.installRoot = resolve(process.cwd(), String(argv[index + 1]));
      index += 1;
      continue;
    }
    if (arg.startsWith("--install-root=")) {
      options.installRoot = resolve(process.cwd(), arg.slice("--install-root=".length));
      continue;
    }

    if (arg === "--force-install") {
      options.forceInstall = true;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  if (!Number.isInteger(options.majorVersion) || options.majorVersion < 8) {
    throw new Error("--major must be an integer >= 8.");
  }

  return options;
}

export function getJavaExecutableName(platform = process.platform) {
  return platform === "win32" ? "java.exe" : "java";
}

function resolveJavaBin(javaHome, platform = process.platform) {
  return resolve(javaHome, "bin", getJavaExecutableName(platform));
}

function resolveJavaHomeCandidates(baseHome) {
  return [baseHome, resolve(baseHome, "Contents", "Home")];
}

export function normalizePlatformFor(platform = process.platform, arch = process.arch) {
  const archMap = {
    x64: "x64",
    arm64: "aarch64",
  };
  const osMap = {
    linux: "linux",
    darwin: "mac",
    win32: "windows",
  };

  const normalizedArch = archMap[arch];
  const os = osMap[platform];
  if (!normalizedArch) {
    throw new Error(`Unsupported CPU architecture for Java bootstrap: ${arch}`);
  }
  if (!os) {
    throw new Error(`Unsupported OS for Java bootstrap: ${platform}`);
  }
  return { arch: normalizedArch, os };
}

function normalizePlatform() {
  return normalizePlatformFor();
}

function probeJava(javaBin) {
  const result = spawnSync(javaBin, ["-version"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  const output = `${String(result.stdout || "")}\n${String(result.stderr || "")}`.trim();
  const firstLine = output.split(/\r?\n/).find((line) => line.trim()) || "";
  return {
    ok: result.status === 0,
    versionLine: firstLine.trim(),
    exitCode: typeof result.status === "number" ? result.status : 1,
    output,
  };
}

function locateCommandOnPath(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || "";
}

function resolveJavaFromHome(javaHome, source) {
  for (const candidateHome of resolveJavaHomeCandidates(javaHome)) {
    const javaBin = resolveJavaBin(candidateHome);
    const probe = probeJava(javaBin);
    if (!probe.ok) continue;
    return {
      source,
      javaBin,
      javaHome: candidateHome,
      versionLine: probe.versionLine,
    };
  }
  return null;
}

function resolveExistingJava(installRoot) {
  const localJava = resolveJavaFromHome(resolve(installRoot, "current"), "local-cache");
  if (localJava) {
    return localJava;
  }

  const configuredJavaHome = String(process.env.JAVA_HOME || "").trim();
  if (configuredJavaHome) {
    const configuredJava = resolveJavaFromHome(configuredJavaHome, "env");
    if (configuredJava) {
      return configuredJava;
    }
  }

  const javaCommand = locateCommandOnPath("java");
  if (!javaCommand) return null;

  const systemProbe = probeJava(javaCommand);
  if (!systemProbe.ok) return null;
  const resolvedJavaBin = basename(javaCommand).toLowerCase().startsWith("java") ? javaCommand : locateCommandOnPath(getJavaExecutableName());
  const javaBin = resolvedJavaBin || javaCommand;
  const javaHome = resolve(javaBin, "..", "..");
  return {
    source: "system",
    javaBin,
    javaHome,
    versionLine: systemProbe.versionLine,
  };
}

function listDirectories(path) {
  try {
    return new Set(
      readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    );
  } catch {
    return new Set();
  }
}

async function fetchReleaseMetadata(majorVersion, arch, os) {
  const url = new URL(`https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot`);
  url.searchParams.set("architecture", arch);
  url.searchParams.set("heap_size", "normal");
  url.searchParams.set("image_type", "jre");
  url.searchParams.set("jvm_impl", "hotspot");
  url.searchParams.set("os", os);
  url.searchParams.set("project", "jdk");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to query Adoptium release metadata (${response.status}).`);
  }
  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`No Adoptium JRE assets found for os=${os}, arch=${arch}, major=${majorVersion}.`);
  }
  const binary = data[0]?.binary;
  const pkg = binary?.package;
  if (!pkg?.link || !pkg?.name) {
    throw new Error("Adoptium metadata is missing binary package link.");
  }
  return {
    name: String(pkg.name),
    link: String(pkg.link),
    checksum: String(pkg.checksum || ""),
    checksumType: String(pkg.checksum_link ? "sha256" : ""),
  };
}

async function downloadArchive(link, targetPath) {
  const response = await fetch(link);
  if (!response.ok) {
    throw new Error(`Failed to download Java archive (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, buffer);
  return buffer;
}

function verifyChecksum(buffer, expectedChecksum) {
  if (!expectedChecksum) return;
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual.toLowerCase() !== expectedChecksum.toLowerCase()) {
    throw new Error("Downloaded Java archive checksum mismatch.");
  }
}

function extractArchive(archivePath, installRoot) {
  const before = listDirectories(installRoot);
  const isZipArchive = archivePath.toLowerCase().endsWith(".zip");
  const result = isZipArchive
    ? spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${installRoot.replace(/'/g, "''")}' -Force`,
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )
    : spawnSync("tar", ["-xzf", archivePath, "-C", installRoot], {
        cwd: repoRoot,
        encoding: "utf8",
      });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    throw new Error(`Failed to extract Java archive: ${stderr || `exit ${result.status}`}`);
  }

  const after = listDirectories(installRoot);
  const created = Array.from(after).find((name) => !before.has(name) && name !== "current");
  if (!created) {
    // Fallback to newest directory when tar extraction reused an existing folder.
    const candidates = Array.from(after).filter((name) => name !== "current");
    if (candidates.length === 0) {
      throw new Error("Java archive extracted but no runtime directory was found.");
    }
    candidates.sort();
    return resolve(installRoot, candidates[candidates.length - 1]);
  }
  return resolve(installRoot, created);
}

function updateCurrentSymlink(installRoot, extractedHome) {
  const currentPath = resolve(installRoot, "current");
  rmSync(currentPath, { force: true, recursive: true });
  symlinkSync(extractedHome, currentPath, process.platform === "win32" ? "junction" : "dir");
  return currentPath;
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`source: ${result.source}\n`);
  process.stdout.write(`javaHome: ${result.javaHome}\n`);
  process.stdout.write(`javaBin: ${result.javaBin}\n`);
  process.stdout.write(`version: ${result.versionLine}\n`);
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();
  mkdirSync(options.installRoot, { recursive: true });

  if (!options.forceInstall) {
    const existing = resolveExistingJava(options.installRoot);
    if (existing) {
      const result = {
        status: "ok",
        installed: false,
        startedAtIso,
        finishedAtIso: new Date().toISOString(),
        ...existing,
      };
      printResult(result, options.asJson);
      return;
    }
  }

  const { arch, os } = normalizePlatform();
  const metadata = await fetchReleaseMetadata(options.majorVersion, arch, os);
  const tempDir = await mkdtemp(resolve(tmpdir(), "mf-java-bootstrap-"));
  try {
    const archivePath = resolve(tempDir, metadata.name);
    const archiveBuffer = await downloadArchive(metadata.link, archivePath);
    verifyChecksum(archiveBuffer, metadata.checksum);

    const extractedHome = extractArchive(archivePath, options.installRoot);
    const currentJavaHome = updateCurrentSymlink(options.installRoot, extractedHome);
    const resolvedJavaHome =
      resolveJavaFromHome(currentJavaHome, "local-bootstrap")?.javaHome || currentJavaHome;
    const javaBin = resolveJavaBin(resolvedJavaHome);
    const probe = probeJava(javaBin);
    if (!probe.ok) {
      throw new Error(`Java verification failed after install: ${probe.output || `exit ${probe.exitCode}`}`);
    }

    const result = {
      status: "ok",
      installed: true,
      source: "local-bootstrap",
      startedAtIso,
      finishedAtIso: new Date().toISOString(),
      javaHome: resolvedJavaHome,
      javaBin,
      versionLine: probe.versionLine,
      archive: {
        name: metadata.name,
        link: metadata.link,
      },
    };
    printResult(result, options.asJson);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const result = {
      status: "failed",
      message,
    };
    process.stderr.write(`${JSON.stringify(result)}\n`);
    process.exit(1);
  });
}
