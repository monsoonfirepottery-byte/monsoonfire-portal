const SNAPSHOT_MAX_AGE = 65 * 60_000;
const RUN_MAX_AGE = 36 * 60 * 60_000;
const GITHUB_REPO = "https://github.com/monsoonfirepottery-byte/monsoonfire-portal/";

type Workflow = {
  key: string;
  label: string;
  workflowFile: string;
  outputHint: string;
  runUrl: string;
  status: string;
  conclusion: string;
  createdAtMs: number;
  isStale: boolean;
};

type Issue = {
  key: string;
  title: string;
  issueNumber: number;
  issueUrl: string;
  purpose: string;
  state: string;
  updatedAtMs: number;
};

export type AutomationDashboardState = {
  loading: boolean;
  loadedAtMs: number;
  error: string;
  workflows: Workflow[];
  issues: Issue[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation status");
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid automation status");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid automation status");
  return value;
}

function githubLink(value: unknown): string {
  const url = string(value);
  return url.startsWith(GITHUB_REPO) ? url : "";
}

export function parseAutomationStatus(value: unknown, now = Date.now()): Omit<AutomationDashboardState, "loading"> {
  const snapshot = record(value);
  const generated = number(snapshot.generatedAtMs);
  if (snapshot.version !== 1 || !generated || generated > now + 5 * 60_000 ||
    !Array.isArray(snapshot.workflows) || !snapshot.workflows.length || !Array.isArray(snapshot.issues)) {
    throw new Error("Invalid automation status");
  }
  const stale = now - generated > SNAPSHOT_MAX_AGE;
  return {
    loadedAtMs: generated,
    error: stale ? "The last GitHub status update is out of date. Check GitHub directly for current results." : "",
    workflows: snapshot.workflows.map((value: unknown) => {
      const row = record(value);
      const createdAtMs = number(row.createdAtMs);
      return {
        key: string(row.key), label: string(row.label), workflowFile: string(row.workflowFile),
        outputHint: string(row.outputHint), runUrl: githubLink(row.runUrl), status: string(row.status),
        conclusion: string(row.conclusion), createdAtMs,
        isStale: stale || !createdAtMs || now - createdAtMs > RUN_MAX_AGE,
      };
    }),
    issues: snapshot.issues.map((value: unknown) => {
      const row = record(value);
      return {
        key: string(row.key), title: string(row.title), issueNumber: number(row.issueNumber),
        issueUrl: githubLink(row.issueUrl), purpose: string(row.purpose), state: string(row.state),
        updatedAtMs: number(row.updatedAtMs),
      };
    }),
  };
}
