import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type PlanningControlPlaneModule = {
  loadPlanningGovernance: (repoRoot: string, governanceDir?: string) => Record<string, unknown>;
  validatePlanningGovernance: (repoRoot: string, governance: Record<string, unknown>) => {
    status: string;
    summary: Record<string, unknown>;
    findings: Array<Record<string, unknown>>;
  };
  buildRoleSourceSync: (governance: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
  buildRoleScoreReport: (governance: Record<string, unknown>, extractedCandidates?: unknown[], options?: Record<string, unknown>) => Record<string, unknown>;
  buildPlanningPreparation: (input: Record<string, unknown>, governance: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
  buildPlanningPacket: (input: Record<string, unknown>, governance: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
  embedPlanningPacketArtifacts: (packet: Record<string, unknown>, artifacts: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>;
};

export function findPlanningRepoRoot(startDir = process.cwd()): string {
  let current = path.resolve(startDir);
  for (let index = 0; index < 8; index += 1) {
    if (
      fs.existsSync(path.join(current, ".governance", "planning")) &&
      fs.existsSync(path.join(current, "contracts"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Unable to locate planning control-plane root from current working directory.");
}

function isPlanningRepoRoot(candidateRoot: string): boolean {
  return (
    fs.existsSync(path.join(candidateRoot, ".governance", "planning"))
    && fs.existsSync(path.join(candidateRoot, "contracts"))
    && fs.existsSync(path.join(candidateRoot, "scripts", "lib", "planning-control-plane.mjs"))
  );
}

export function resolvePlanningRepoRoot(repoRoot?: string, startDir = process.cwd()): string {
  const trimmedRepoRoot = typeof repoRoot === "string" ? repoRoot.trim() : "";
  if (trimmedRepoRoot) {
    const candidates = [trimmedRepoRoot, path.resolve(startDir, trimmedRepoRoot)];
    for (const candidate of candidates) {
      if (candidate && isPlanningRepoRoot(candidate)) {
        return candidate;
      }
    }
  }
  return findPlanningRepoRoot(startDir);
}

const cachedModulePromises = new Map<string, Promise<PlanningControlPlaneModule>>();
const dynamicImport = new Function("modulePath", "return import(modulePath);") as (modulePath: string) => Promise<PlanningControlPlaneModule>;

export async function loadPlanningControlPlaneModule(repoRoot = findPlanningRepoRoot()): Promise<PlanningControlPlaneModule> {
  const effectiveRepoRoot = resolvePlanningRepoRoot(repoRoot);
  const cachedModulePromise = cachedModulePromises.get(effectiveRepoRoot);
  if (cachedModulePromise) {
    return cachedModulePromise;
  }
  const moduleUrl = pathToFileURL(path.join(effectiveRepoRoot, "scripts", "lib", "planning-control-plane.mjs")).href;
  const modulePromise = dynamicImport(moduleUrl);
  cachedModulePromises.set(effectiveRepoRoot, modulePromise);
  return modulePromise;
}
