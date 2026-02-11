export const TICKET_STATUSES = [
  "Backlog",
  "Ready",
  "InProgress",
  "Blocked",
  "Done",
] as const;

export const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export const SEVERITIES = ["Sev1", "Sev2", "Sev3", "Sev4"] as const;
export const IMPACT_LEVELS = ["low", "med", "high"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export type TrackerProject = {
  id: string;
  ownerUid: string;
  key: string;
  name: string;
  description: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TrackerEpic = {
  id: string;
  ownerUid: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority | null;
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type GitHubIssueRef = {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string | null;
  state: string | null;
  merged?: boolean;
  lastSyncedAtMs: number | null;
};

export type TrackerTicket = {
  id: string;
  ownerUid: string;
  trackerVisible: boolean;
  projectId: string;
  epicId: string | null;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: Priority;
  severity: Severity;
  component: string;
  impact: ImpactLevel;
  tags: string[];
  blocked: boolean;
  blockedReason: string | null;
  blockedByTicketId: string | null;
  links: string[];
  githubIssue: GitHubIssueRef | null;
  githubPRs: GitHubIssueRef[];
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
};

export type IntegrationHealth = {
  ownerUid: string;
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
  lastFailureMessage: string | null;
  lastSyncStatus: number | null;
  updatedAtMs: number | null;
};

export type FirestoreWriteTrace = {
  atIso: string;
  collection: string;
  docId: string;
  payload: unknown;
};

export type FirestoreQueryTrace = {
  atIso: string;
  collection: string;
  params: Record<string, unknown>;
};

export type GitHubSyncTrace = {
  atIso: string;
  request: unknown;
  status: number | null;
  response: unknown;
};

export type ErrorTrace = {
  atIso: string;
  message: string;
  stack: string | null;
};
