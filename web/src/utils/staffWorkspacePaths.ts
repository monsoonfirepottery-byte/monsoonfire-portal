export const STAFF_PATH = "/staff";
export const STAFF_COCKPIT_PATH = "/staff/cockpit";

export type StaffWorkspaceMode = "default" | "cockpit";
export type StaffWorkspaceMatch = {
  canonicalPath: string;
  mode: StaffWorkspaceMode;
};

export type StaffWorkspaceLaunch = {
  targetNav: "staff";
  mode: StaffWorkspaceMode;
};

export type StaffCockpitOperationsModule =
  | "operations"
  | "checkins"
  | "members"
  | "pieces"
  | "firings"
  | "events"
  | "lending"
  | "lending-intake";

type StaffPathInput = string | null | undefined;

export const STAFF_WORKSPACE_PATHS: readonly string[] = [
  STAFF_PATH,
  STAFF_COCKPIT_PATH,
];

const STAFF_HOST_URL_RE =
  /^(?:(?:[a-z0-9-]+\.)+[a-z0-9-]+|localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:\/\S*)?$/i;
const STAFF_HOST_STAFF_PATH_RE = /(?:^|\/)staff(?:$|(\/|\?|#))/i;

const STAFF_COCKPIT_MODULE_SEGMENTS = new Set([
  "reports",
  "studio-reservations",
  "operations",
  "checkins",
  "members",
  "pieces",
  "firings",
  "events",
  "lending",
  "lending-intake",
]);

const STAFF_COCKPIT_TAB_ONLY_SEGMENTS = new Set([
  "ops",
  "triage",
  "automation",
  "platform",
  "finance",
  "operations",
  "policy-agent-ops",
  "policy_agent_ops",
  "module-telemetry",
  "moduleTelemetry",
]);

const STAFF_COCKPIT_SEGMENT_ALIASES: Readonly<Record<string, string>> = {
  billing: "finance",
  payments: "finance",
  ops: "operations",
  lendingintake: "lending-intake",
  lending_intake: "lending-intake",
  "policyagentops": "policy-agent-ops",
  "moduletelemetry": "module-telemetry",
  module_telemetry: "module-telemetry",
  "studioreservations": "studio-reservations",
  "studio_reservations": "studio-reservations",
  "studiobookings": "studio-reservations",
  "studio_bookings": "studio-reservations",
};

const STAFF_COCKPIT_TAB_SEGMENT_ALIASES: Readonly<Record<string, string>> = {
  overview: "triage",
  governance: "policy-agent-ops",
  policy: "policy-agent-ops",
  "agent-ops": "policy-agent-ops",
  "agent_ops": "policy-agent-ops",
  agentops: "policy-agent-ops",
  "policy-agent-ops": "policy-agent-ops",
  "policy_agent_ops": "policy-agent-ops",
};

const STAFF_COCKPIT_OPERATIONS_ROOT_ALIASES: Readonly<Record<string, StaffCockpitOperationsModule>> = {
  operations: "operations",
  checkins: "checkins",
  checkin: "checkins",
  members: "members",
  member: "members",
  pieces: "pieces",
  piece: "pieces",
  firings: "firings",
  firing: "firings",
  events: "events",
  event: "events",
  lending: "lending",
  "lending-intake": "lending-intake",
  workshop: "operations",
  workshops: "operations",
};

const STAFF_COCKPIT_ROOT_SEGMENT_ALIASES: Readonly<Record<string, string>> = {
  workshop: "operations",
  workshops: "operations",
  checkins: "checkins",
  checkin: "checkins",
  members: "members",
  member: "members",
  pieces: "pieces",
  piece: "pieces",
  firings: "firings",
  firing: "firings",
  events: "events",
  event: "events",
  lending: "lending",
  "lending-intake": "lending-intake",
  system: "platform",
  commerce: "finance",
  stripe: "finance",
  reservations: "studio-reservations",
  reservation: "studio-reservations",
  "studio-bookings": "studio-reservations",
  "studio_bookings": "studio-reservations",
  policyagentops: "policy-agent-ops",
};

const STAFF_NON_WORKSPACE_SHORTCUT_SEGMENTS = new Set([
  "message",
  "messages",
  "communication",
  "communications",
]);

const STAFF_PATH_COPY_PUNCTUATION_PREFIX_RE = /^[\s"'`<{([]+/;
const STAFF_PATH_COPY_PUNCTUATION_SUFFIX_RE = /[\])}>"'`,.;:!?]+$/;

function stripCopyPastePathNoise(value: string): string {
  let normalized = value;

  while (true) {
    const next = normalized
      .replace(STAFF_PATH_COPY_PUNCTUATION_PREFIX_RE, "")
      .replace(STAFF_PATH_COPY_PUNCTUATION_SUFFIX_RE, "")
      .trim();

    if (next === normalized) {
      return next;
    }

    normalized = next;
  }
}

function hasAbsoluteUrlScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(value);
}

function decodeUrlLikeValue(value: string): string {
  let current = value;
  let iterations = 0;

  while (current.includes("%") && iterations < 3) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
    iterations += 1;
  }

  return current;
}

function resolveConsolidatedCockpitSegment(value: string): string {
  return (
    STAFF_COCKPIT_ROOT_SEGMENT_ALIASES[value] ??
    STAFF_COCKPIT_TAB_SEGMENT_ALIASES[value] ??
    STAFF_COCKPIT_SEGMENT_ALIASES[value] ??
    value
  );
}

const STAFF_COCKPIT_KNOWN_SEGMENTS = new Set<string>([
  ...STAFF_COCKPIT_MODULE_SEGMENTS,
  ...STAFF_COCKPIT_TAB_ONLY_SEGMENTS,
]);

function normalizeCockpitSegment(value: string): string {
  const normalized = value.trim().toLowerCase();
  return STAFF_COCKPIT_SEGMENT_ALIASES[normalized] ?? normalized;
}

function resolveStaffWorkspaceRootCockpitSegment(pathname: string): string | null {
  const normalized = normalizeStaffPath(pathname);
  if (!normalized) return null;
  if (!isStaffPath(normalized)) return null;
  if (isStaffCockpitPath(normalized)) {
    return null;
  }

  const modulePath = normalized.slice(STAFF_PATH.length + 1);
  if (!modulePath) return null;
  const next = modulePath.split("/")[0];
  if (!next) return null;
  const normalizedSegment = normalizeCockpitSegment(next);
  const canonicalSegment = resolveConsolidatedCockpitSegment(normalizedSegment);
  return STAFF_COCKPIT_KNOWN_SEGMENTS.has(canonicalSegment) ? canonicalSegment : null;
}

function isNonWorkspaceStaffShortcut(pathname: string): boolean {
  const normalized = normalizeStaffPath(pathname);
  if (!normalized || !isStaffPath(normalized) || isStaffCockpitPath(normalized)) {
    return false;
  }

  const shortcutPath = normalized.slice(STAFF_PATH.length + 1);
  if (!shortcutPath) return false;

  const shortcutSegment = shortcutPath.split("/")[0]?.trim().toLowerCase() ?? "";
  return STAFF_NON_WORKSPACE_SHORTCUT_SEGMENTS.has(shortcutSegment);
}

function normalizeStaffPathInput(value: StaffPathInput): string {
  if (typeof value !== "string") return "";
  const trimmed = stripCopyPastePathNoise(value);
  if (!trimmed) return "";
  const decoded = decodeUrlLikeValue(trimmed);
  let normalized = normalizeInlineHashMode(decoded.replace(/\\/g, "/"));
  normalized = normalized.startsWith("//") ? `https:${normalized}` : normalized;
  if (
    !hasAbsoluteUrlScheme(normalized) &&
    STAFF_HOST_URL_RE.test(normalized) &&
    STAFF_HOST_STAFF_PATH_RE.test(normalized)
  ) {
    normalized = `https://${normalized}`;
  }
  if (!hasAbsoluteUrlScheme(normalized)) {
    return normalized;
  }
  try {
    const parsed = new URL(normalized);
    const normalizedPath = normalizeStaffPath(parsed.pathname || "/");
    if (normalizedPath === STAFF_PATH && parsed.hash) {
      const hashPath = normalizeStaffPath(parsed.hash);
      if (hashPath) {
        if (hashPath.startsWith(STAFF_PATH)) {
          return hashPath;
        }
        if (hashPath !== "/") {
          return `${normalizedPath}${hashPath.startsWith("/") ? hashPath : `/${hashPath}`}`;
        }
      }
    }
    const isStaffByPath = normalizedPath === STAFF_PATH || normalizedPath.startsWith(`${STAFF_PATH}/`);
    if (isStaffByPath) return normalizedPath;

    const hashBasedPath = parsed.hash ? normalizeStaffPath(parsed.hash) : "";
    const isStaffByHash = hashBasedPath === STAFF_PATH || hashBasedPath.startsWith(`${STAFF_PATH}/`);
    if (isStaffByHash) return hashBasedPath;

    return `${parsed.pathname}${parsed.hash || ""}`;
  } catch {
    return normalized;
  }
}

function normalizeInlineHashMode(path: string): string {
  const trimmed = path.trim().toLowerCase();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex < 0) {
    return path;
  }

  const basePathWithQuery = trimmed.slice(0, hashIndex).replace(/\/+$/, "");
  const rawHashPath = trimmed.slice(hashIndex + 1);
  const cleanHashPath = rawHashPath.startsWith("!") ? rawHashPath.slice(1) : rawHashPath;
  if (!cleanHashPath) {
    return basePathWithQuery || "";
  }

  const hashPath = cleanHashPath.startsWith("/") ? cleanHashPath : `/${cleanHashPath}`;
  const basePath = basePathWithQuery.split("?")[0];

  if (hashPath.startsWith("/staff")) {
    return hashPath;
  }

  if (basePath === STAFF_PATH) {
    return `${basePath}${hashPath}`;
  }

  if (basePath === STAFF_COCKPIT_PATH) {
    return `${basePath}${hashPath}`;
  }

  return trimmed;
}

function stripStaffHashMode(path: string): string {
  const normalizedWithInlineHash = normalizeInlineHashMode(path);

  return normalizedWithInlineHash
    .toLowerCase()
    .replace(/^\/#!\//, "")
    .replace(/^#!\//, "")
    .replace(/^\/#\//, "")
    .replace(/^\/#/, "/")
    .replace(/^#\//, "")
    .replace(/^#/, "/")
    .replace(/^!/, "");
}

function sanitizeStaffPathPath(path: string): string {
  const decodedPath = (() => {
    let current = path;
    let iterations = 0;

    while (current.includes("%") && iterations < 3) {
      try {
        const next = decodeURIComponent(current);
        if (next === current) break;
        current = next;
      } catch {
        break;
      }
      iterations += 1;
    }

    return current;
  })();
  const hashNormalizedPath = stripStaffHashMode(decodedPath);

  const cleanSegments = hashNormalizedPath.split("/").reduce((acc, segment) => {
    const normalizedSegment = segment.trim();
    if (!normalizedSegment || normalizedSegment === "." || normalizedSegment === "..") return acc;
    acc.push(normalizedSegment);
    return acc;
  }, [] as string[]);

  return `/${cleanSegments.join("/")}`;
}

export function normalizeStaffPath(path: StaffPathInput): string {
  const normalizedInput = normalizeStaffPathInput(path);
  if (!normalizedInput) return "";
  const lower = stripStaffHashMode(normalizedInput);
  if (!lower) return "";
  const withLeadingSlash = lower.startsWith("/") ? lower : `/${lower}`;
  const pathOnly = withLeadingSlash.split(/[?#]/)[0] ?? "";
  if (!pathOnly) return "";
  const collapsed = sanitizeStaffPathPath(pathOnly);
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "");
}

export function isStaffPath(pathname: StaffPathInput): boolean {
  const normalized = normalizeStaffPath(pathname);
  return normalized === STAFF_PATH || normalized.startsWith(`${STAFF_PATH}/`);
}

export function isStaffCockpitPath(pathname: StaffPathInput): boolean {
  const normalized = normalizeStaffPath(pathname);
  return normalized === STAFF_COCKPIT_PATH || normalized.startsWith(`${STAFF_COCKPIT_PATH}/`);
}

export function resolveStaffWorkspaceCanonicalPath(pathname: StaffPathInput): string | null {
  const normalized = normalizeStaffPath(pathname);
  if (isStaffCockpitPath(normalized)) {
    const modulePath = resolveStaffCockpitWorkspaceModule(normalized);
    if (modulePath) return `${STAFF_COCKPIT_PATH}/${modulePath}`;
    const tabSegment = resolveStaffCockpitWorkspaceTabSegment(normalized);
    return tabSegment ? `${STAFF_COCKPIT_PATH}/${tabSegment}` : STAFF_COCKPIT_PATH;
  }
  const rootCockpitSegment = resolveStaffWorkspaceRootCockpitSegment(normalized);
  if (rootCockpitSegment) {
    return `${STAFF_COCKPIT_PATH}/${rootCockpitSegment}`;
  }
  if (isNonWorkspaceStaffShortcut(normalized)) return null;
  if (isStaffPath(normalized)) return STAFF_PATH;
  return null;
}

export function resolveStaffWorkspaceMatch(pathname: StaffPathInput): StaffWorkspaceMatch | null {
  const canonicalPath = resolveStaffWorkspaceCanonicalPath(pathname);
  if (!canonicalPath) return null;
  const mode: StaffWorkspaceMode = isStaffCockpitPath(canonicalPath) ? "cockpit" : "default";

  return { canonicalPath, mode };
}

export function resolveStaffWorkspaceOpenTarget(pathname: StaffPathInput): StaffWorkspaceMatch | null {
  const normalizedTarget = normalizeStaffPath(pathname);
  if (!normalizedTarget) {
    return {
      canonicalPath: STAFF_PATH,
      mode: "default",
    };
  }
  return resolveStaffWorkspaceMatch(normalizedTarget);
}

export function shouldNavigateToStaffWorkspaceTarget(
  currentPath: StaffPathInput,
  targetPath: StaffPathInput,
  hash: StaffPathInput
): boolean {
  const normalizedCurrentPath = normalizeStaffPath(currentPath);
  const normalizedTargetPath = normalizeStaffPath(targetPath);
  if (!normalizedTargetPath) return false;
  if (normalizedCurrentPath !== normalizedTargetPath) return true;

  const currentIsStaffWorkspace = Boolean(resolveStaffWorkspaceMatch(normalizedCurrentPath));
  if (!currentIsStaffWorkspace) return false;

  const trimmedHash = typeof hash === "string" ? hash.trim() : "";
  return trimmedHash.length > 0;
}

export function resolveStaffWorkspaceLaunch(pathname: StaffPathInput, hash: StaffPathInput): StaffWorkspaceLaunch | null {
  const normalizedHashPath = normalizeStaffPath(hash);
  const normalizedPath = normalizeStaffPath(pathname);
  const pathMatch = resolveStaffWorkspaceMatch(normalizedPath);
  const pathMode = pathMatch?.mode;
  const hashMatch = resolveStaffWorkspaceMatch(normalizedHashPath);

  if (pathMatch && pathMode && pathMode !== "default") {
    return {
      targetNav: "staff",
      mode: pathMode,
    };
  }

  if (pathMode === "default" && normalizedPath === STAFF_PATH && hashMatch) {
    return {
      targetNav: "staff",
      mode: hashMatch.mode,
    };
  }

  if (!pathMatch) {
    if (!hashMatch) return null;
    return {
      targetNav: "staff",
      mode: hashMatch.mode,
    };
  }

  return pathMatch
    ? {
        targetNav: "staff",
        mode: pathMatch.mode,
      }
    : null;
}

export function resolveStaffWorkspaceRequestedPath(pathname: StaffPathInput, hash: StaffPathInput): string | null {
  const normalizedPathname = normalizeStaffPath(pathname);
  const normalizedHashPath = normalizeStaffPath(hash);
  const pathnameMatch = resolveStaffWorkspaceMatch(normalizedPathname);
  const hashMatch = resolveStaffWorkspaceMatch(normalizedHashPath);

  if (!pathnameMatch && !hashMatch) return null;

  const safeHash = typeof hash === "string" ? hash : "";
  const trimmedHash = safeHash.trim();

  if (
    normalizedPathname === STAFF_PATH &&
    trimmedHash &&
    (trimmedHash.startsWith("#") || trimmedHash.startsWith("/"))
  ) {
    const hashNoHash = safeHash.startsWith("#") ? safeHash.slice(1) : safeHash;
    const hashPath = hashNoHash ? (hashNoHash.startsWith("/") ? hashNoHash : `/${hashNoHash}`) : "";
    if (hashPath) {
      const normalizedHashOnlyPath = hashPath.startsWith(STAFF_PATH)
        ? hashPath
        : `${STAFF_PATH}${hashPath}`;
      const normalizedHashOnlyWorkspace = normalizeStaffPath(normalizedHashOnlyPath);
      const hashOnlyMatch = normalizedHashOnlyWorkspace
        ? resolveStaffWorkspaceMatch(normalizedHashOnlyWorkspace)
        : null;
      if (hashOnlyMatch) {
        return hashOnlyMatch.canonicalPath;
      }
    }
  }

  if (
    pathnameMatch &&
    normalizedPathname === STAFF_COCKPIT_PATH &&
    trimmedHash &&
    (trimmedHash.startsWith("#") || trimmedHash.startsWith("/"))
  ) {
    const hashNoHash = safeHash.startsWith("#") ? safeHash.slice(1) : safeHash;
    const hashPath = hashNoHash ? (hashNoHash.startsWith("/") ? hashNoHash : `/${hashNoHash}`) : "";
    const normalizedHashOnlyPath = hashPath.startsWith(STAFF_PATH)
      ? hashPath
      : `${STAFF_COCKPIT_PATH}${hashPath}`;
    const normalizedHashOnlyWorkspace = normalizeStaffPath(normalizedHashOnlyPath);
    const hashOnlyMatch = normalizedHashOnlyWorkspace
      ? resolveStaffWorkspaceMatch(normalizedHashOnlyWorkspace)
      : null;
    if (hashOnlyMatch) {
      return hashOnlyMatch.canonicalPath;
    }
  }

  if (
    pathnameMatch &&
    normalizedPathname === STAFF_PATH &&
    hashMatch?.mode !== undefined &&
    hashMatch.mode !== "default"
  ) {
    return hashMatch.canonicalPath;
  }

  return pathnameMatch?.canonicalPath ?? hashMatch?.canonicalPath ?? null;
}

export function isStaffWorkspaceRequest(pathname: StaffPathInput, hash: StaffPathInput): boolean {
  return resolveStaffWorkspaceRequestedPath(pathname, hash) !== null;
}

export function shouldExitStaffWorkspaceForTargetNav(
  pathname: StaffPathInput,
  hash: StaffPathInput,
  targetNav: string
): boolean {
  if (targetNav === "staff") return false;
  return isStaffWorkspaceRequest(pathname, hash);
}

function resolveStaffCockpitWorkspaceSegment(pathname: string): string | null {
  const normalized = normalizeStaffPath(pathname);
  if (!normalized) return null;
  if (!isStaffCockpitPath(normalized)) return null;
  const modulePath = normalized.slice(STAFF_COCKPIT_PATH.length + 1);
  if (!modulePath) return null;
  const next = modulePath.split("/")[0];
  if (!next) return null;
  const normalizedModule = normalizeCockpitSegment(next);
  const operationsFocusModule = STAFF_COCKPIT_OPERATIONS_ROOT_ALIASES[normalizedModule] ?? null;
  if (operationsFocusModule) return operationsFocusModule;
  const canonicalModule = resolveConsolidatedCockpitSegment(normalizedModule);
  if (!STAFF_COCKPIT_KNOWN_SEGMENTS.has(canonicalModule)) return null;
  return canonicalModule;
}

export function resolveStaffCockpitOperationsModule(pathname: StaffPathInput): StaffCockpitOperationsModule | null {
  const normalized = normalizeStaffPath(pathname);
  if (!normalized) return null;
  if (!isStaffPath(normalized)) return null;

  const subPath = normalized.startsWith(`${STAFF_COCKPIT_PATH}/`)
    ? normalized.slice(STAFF_COCKPIT_PATH.length + 1)
    : normalized.startsWith(`${STAFF_PATH}/`)
      ? normalized.slice(STAFF_PATH.length + 1)
      : "";
  if (!subPath) return null;

  const next = subPath.split("/")[0];
  if (!next) return null;

  const normalizedSegment = normalizeCockpitSegment(next);
  const operationsFocusModule = STAFF_COCKPIT_OPERATIONS_ROOT_ALIASES[normalizedSegment];
  if (operationsFocusModule) {
    return operationsFocusModule;
  }

  const normalizedOperationsSegment = resolveConsolidatedCockpitSegment(normalizedSegment);
  if (normalizedOperationsSegment !== "operations") {
    return null;
  }

  return STAFF_COCKPIT_OPERATIONS_ROOT_ALIASES[normalizedSegment] ?? "operations";
}

export function resolveStaffCockpitWorkspaceModule(pathname: string): string | null {
  const normalizedModule = resolveStaffCockpitWorkspaceSegment(pathname);
  if (!normalizedModule) return null;
  return STAFF_COCKPIT_MODULE_SEGMENTS.has(normalizedModule) ? normalizedModule : null;
}

export function resolveStaffCockpitWorkspaceTabSegment(pathname: string): string | null {
  const canonicalSegment = resolveStaffCockpitWorkspaceSegment(pathname);
  if (!canonicalSegment) return null;
  if (canonicalSegment === "operations") return "operations";
  if (STAFF_COCKPIT_MODULE_SEGMENTS.has(canonicalSegment)) return null;
  return canonicalSegment;
}
