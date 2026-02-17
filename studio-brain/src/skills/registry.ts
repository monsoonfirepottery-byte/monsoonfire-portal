import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

export type SkillRef = {
  name: string;
  version: string;
};

export type SkillManifest = {
  name: string;
  version: string;
  description?: string;
  entrypoint?: string;
  checksum?: string;
  signature?: string;
  signatureAlgorithm?: string;
  signatureKeyId?: string;
  permissions?: {
    allowedEgressHosts?: string[];
    commands?: string[];
  };
};

export type SkillBundleSource = {
  manifest: SkillManifest;
  sourcePath: string;
};

export type RegistryHealth = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type SkillRegistryClient = {
  resolveSkill: (skillRef: SkillRef) => Promise<SkillBundleSource>;
  listSkillVersions?: (name: string) => Promise<string[]>;
  healthcheck: () => Promise<RegistryHealth>;
};

function normalizeSkillRef(input: string): SkillRef {
  if (!input || !input.includes("@")) {
    throw new Error("skill reference must be pinned as <name>@<version>");
  }
  const [name, version] = input.split("@", 2);
  if (!name || !version) {
    throw new Error("skill reference must be pinned as <name>@<version>");
  }
  const badVersion = ["latest", "head", "main", "master", "edge"].includes(version.trim().toLowerCase());
  if (badVersion) {
    throw new Error(`skill reference version must be pinned. Received ${version}`);
  }
  if (version.length > 64) {
    throw new Error(`invalid skill version '${version}'`);
  }
  return { name: name.trim(), version: version.trim() };
}

export function parsePinnedSkillRef(reference: string): SkillRef {
  return normalizeSkillRef(reference);
}

function loadManifestFromFile(filePath: string): SkillManifest {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as SkillManifest;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`invalid manifest at ${filePath}`);
  }
  if (!parsed.name || !parsed.version) {
    throw new Error(`manifest missing name/version at ${filePath}`);
  }
  return parsed;
}

export type LocalRegistryOptions = {
  rootPath: string;
};

export function createLocalRegistryClient(options: LocalRegistryOptions): SkillRegistryClient {
  const root = path.resolve(process.cwd(), options.rootPath);

  return {
    resolveSkill: async ({ name, version }): Promise<SkillBundleSource> => {
      const sourcePath = path.join(root, name, version);
      const manifestPath = path.join(sourcePath, "manifest.json");
      const manifest = loadManifestFromFile(manifestPath);
      if (manifest.name !== name || manifest.version !== version) {
        throw new Error(`local manifest mismatch for ${name}@${version}`);
      }
      return { manifest, sourcePath };
    },
    listSkillVersions: async (name) => {
      const target = path.join(root, name);
      const dirents = await fs.readdir(target, { withFileTypes: true });
      return dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    },
    healthcheck: async () => {
      const startedAt = Date.now();
      try {
        await fs.access(root);
        const check = crypto.createHash("sha256").update(root).digest("hex");
        if (!check) throw new Error("hash failure");
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export type RemoteRegistryOptions = {
  baseUrl: string;
  timeoutMs?: number;
};

export function createRemoteRegistryClient(options: RemoteRegistryOptions): SkillRegistryClient {
  const base = options.baseUrl.replace(/\/+$/, "");
  const timeoutMs = Math.max(250, options.timeoutMs ?? 10_000);

  const request = async <T>(pathname: string): Promise<T> => {
    const url = new URL(`${base}${pathname}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`remote registry ${url} -> ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    resolveSkill: async ({ name, version }): Promise<SkillBundleSource> => {
      const payload = await request<{
        manifest?: SkillManifest;
        sourcePath?: string;
        artifactUrl?: string;
      }>(`/v1/skills/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
      if (!payload.manifest) throw new Error(`remote registry returned no manifest for ${name}@${version}`);
      const manifest = payload.manifest;
      if (!manifest.name || !manifest.version) throw new Error("remote manifest missing name/version");
      if (manifest.name !== name || manifest.version !== version) {
        throw new Error(`remote manifest mismatch for ${name}@${version}`);
      }
      const sourcePath = payload.sourcePath ?? path.join(process.cwd(), ".studiobrain", "remote", name, version);
      return {
        manifest,
        sourcePath,
      };
    },
    listSkillVersions: async (name) => {
      const payload = await request<{ versions?: string[] }>(`/v1/skills/${encodeURIComponent(name)}`);
      return Array.isArray(payload.versions) ? payload.versions.sort() : [];
    },
    healthcheck: async () => {
      const startedAt = Date.now();
      try {
        await request<unknown>("/healthz");
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
