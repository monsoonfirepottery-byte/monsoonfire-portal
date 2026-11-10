import { createHash } from "node:crypto";

const digest = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

// The release `cloud.firestore/default` belongs to a named database and must
// never be used as the source for the portal's `(default)` database.
export async function inspectPortalRules({ projectId, config, rulesSource, request }) {
  const targets = Array.isArray(config?.firestore) ? config.firestore : [config?.firestore];
  if (targets.length !== 1 || !targets[0] || (targets[0].database && targets[0].database !== "(default)") || !targets[0].rules) {
    return { status: "error", message: "Firestore configuration must target only (default) with an explicit rules file." };
  }
  if (typeof rulesSource !== "string" || !rulesSource.trim()) return { status: "error", message: "Rules source is empty." };
  const release = await request(`projects/${projectId}/releases/cloud.firestore`);
  if (!release.ok) return { status: release.status === 403 ? "permission_denied" : "error", message: "Could not read the portal Firestore release." };
  const rulesetName = release.json?.rulesetName;
  const parts = typeof rulesetName === "string" ? rulesetName.split("/") : [];
  if (parts.length !== 4 || parts[0] !== "projects" || parts[1] !== projectId || parts[2] !== "rulesets" || !/^[A-Za-z0-9_-]+$/.test(parts[3])) {
    return { status: "error", message: "Portal release has an invalid ruleset reference." };
  }
  const ruleset = await request(rulesetName);
  if (!ruleset.ok) return { status: ruleset.status === 403 ? "permission_denied" : "error", message: "Could not read the portal Firestore ruleset." };
  const files = ruleset.json?.source?.files;
  if (!Array.isArray(files) || files.length !== 1 || typeof files[0]?.content !== "string") return { status: "error", message: "Portal ruleset source is unavailable or ambiguous." };
  const localSha256 = digest(rulesSource), deployedSha256 = digest(files[0].content);
  const matches = localSha256 === deployedSha256;
  return { status: matches ? "in_sync" : "drift_detected", message: matches ? "Portal (default) rules match the checked-out source." : "Portal (default) rules differ from the checked-out source; review before deployment.", rulesetName, localSha256, deployedSha256 };
}
