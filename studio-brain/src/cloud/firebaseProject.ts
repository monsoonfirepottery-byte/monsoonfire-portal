export const DEFAULT_FIREBASE_PROJECT_ID = "monsoonfire-portal";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseProjectIdFromFirebaseConfig(raw: string): string {
  const trimmed = clean(raw);
  if (!trimmed.startsWith("{")) return "";
  try {
    const parsed = JSON.parse(trimmed) as { projectId?: unknown };
    return clean(parsed.projectId);
  } catch {
    return "";
  }
}

export function resolveFirebaseProjectId(
  explicitProjectId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = [
    clean(explicitProjectId),
    clean(env.FIREBASE_PROJECT_ID),
    clean(env.GOOGLE_CLOUD_PROJECT),
    clean(env.GCLOUD_PROJECT),
    clean(env.PORTAL_PROJECT_ID),
    parseProjectIdFromFirebaseConfig(clean(env.FIREBASE_CONFIG)),
    DEFAULT_FIREBASE_PROJECT_ID,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return DEFAULT_FIREBASE_PROJECT_ID;
}
