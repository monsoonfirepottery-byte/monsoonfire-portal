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

let cachedModulePromise: Promise<PlanningControlPlaneModule> | null = null;
const dynamicImport = new Function("modulePath", "return import(modulePath);") as (modulePath: string) => Promise<PlanningControlPlaneModule>;

export async function loadPlanningControlPlaneModule(repoRoot = findPlanningRepoRoot()): Promise<PlanningControlPlaneModule> {
  if (!cachedModulePromise) {
    const moduleUrl = pathToFileURL(path.join(repoRoot, "scripts", "lib", "planning-control-plane.mjs")).href;
    cachedModulePromise = dynamicImport(moduleUrl);
  }
  return cachedModulePromise;
}
