import React, { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInAnonymously, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth } from "../firebase";
import { createFunctionsClient } from "../api/functionsClient";
import { PORTAL_THEMES } from "../theme/themes";
import {
  addTicketActivity,
  createEpic,
  createProject,
  createTicket,
  getIntegrationHealth,
  listEpics,
  listProjects,
  listTickets,
  seedTrackerStarterData,
  updateTicket,
  upsertIntegrationHealth,
  type TrackerDiagnosticsCallbacks,
} from "./firestore";
import { buildGitHubLookupCurl, parseGitHubReference } from "./github";
import {
  IMPACT_LEVELS,
  PRIORITIES,
  SEVERITIES,
  TICKET_STATUSES,
  type ErrorTrace,
  type FirestoreQueryTrace,
  type FirestoreWriteTrace,
  type GitHubIssueRef,
  type GitHubSyncTrace,
  type ImpactLevel,
  type IntegrationHealth,
  type Priority,
  type Severity,
  type TicketStatus,
  type TrackerEpic,
  type TrackerProject,
  type TrackerTicket,
} from "./types";
import "./TrackerApp.css";

type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_FUNCTIONS_BASE_URL?: string;
  VITE_USE_AUTH_EMULATOR?: string;
  VITE_REPO_BLOB_BASE_URL?: string;
};

const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const FUNCTIONS_BASE_URL = ENV.VITE_FUNCTIONS_BASE_URL ? String(ENV.VITE_FUNCTIONS_BASE_URL) : DEFAULT_FUNCTIONS_BASE_URL;
const ALLOW_LOCAL_BYPASS = ENV.DEV === true && ENV.VITE_USE_AUTH_EMULATOR === "true";
const REPO_BLOB_BASE_URL = ENV.VITE_REPO_BLOB_BASE_URL ? String(ENV.VITE_REPO_BLOB_BASE_URL).replace(/\/+$/, "") : "";

const TICKET_DOC_PATHS = [
  "tickets/README.md",
  "tickets/P0-portal-hosting-cutover.md",
  "tickets/P1-agent-api-v1-contracts.md",
  "tickets/P1-agent-events-feed-and-webhooks.md",
  "tickets/P1-agent-integration-tokens.md",
  "tickets/P1-agent-client-registry-and-key-rotation.md",
  "tickets/P1-agent-delegated-authz-and-scoped-actions.md",
  "tickets/P1-agent-service-catalog-and-pricing-controls.md",
  "tickets/P1-agent-quote-reserve-pay-status-v1.md",
  "tickets/P1-agent-staff-ops-console-and-kill-switch.md",
  "tickets/P1-agent-audit-ledger-and-observability.md",
  "tickets/P2-agent-independent-accounts-prepay-and-limits.md",
  "tickets/P2-agent-risk-engine-fraud-velocity-and-manual-review.md",
  "tickets/P2-agent-ip-copyright-and-prohibited-commissions.md",
  "tickets/P2-agent-x1c-print-intake-validation-and-safety.md",
  "tickets/P2-agent-legal-terms-refunds-and-incident-playbook.md",
  "tickets/P1-website-a11y-baseline-and-policy.md",
  "tickets/P1-website-a11y-blind-low-vision-and-screenreader.md",
  "tickets/P1-website-a11y-deaf-hard-of-hearing.md",
  "tickets/P1-website-a11y-motor-cognitive-and-neurodiverse.md",
  "tickets/P1-portal-a11y-baseline-and-policy.md",
  "tickets/P1-portal-a11y-navigation-and-bypass-blocks.md",
  "tickets/P1-portal-a11y-forms-and-status-semantics.md",
  "tickets/P1-portal-a11y-interactive-semantics-and-nested-controls.md",
  "tickets/P1-portal-a11y-target-size-and-operability.md",
  "tickets/P1-community-reporting-foundation.md",
  "tickets/P1-community-reporting-card-ui-and-modal.md",
  "tickets/P1-community-reporting-create-report-endpoint.md",
  "tickets/P1-community-reporting-staff-triage-dashboard.md",
  "tickets/P1-community-reporting-staff-content-actions.md",
  "tickets/P1-community-reporting-rules-and-security-tests.md",
  "tickets/P2-portal-a11y-regression-guardrails.md",
  "tickets/P2-community-reporting-ops-policy-and-retention.md",
  "tickets/P2-website-a11y-ongoing-qa-and-regression-guardrails.md",
  "tickets/P2-portal-integrations-ui.md",
];

const METADATA_DOC_PATHS = [
  "docs/API_CONTRACTS.md",
  "docs/PORTAL_ACCESSIBILITY_ASSESSMENT_2026-02-11.md",
  "docs/SCHEMA_PROFILE.md",
  "docs/SCHEMA_RESERVATIONS.md",
  "docs/SCHEMA_SUPPORT.md",
];

const STATUS_LABELS: Record<TicketStatus, string> = {
  Backlog: "Backlog",
  Ready: "Ready",
  InProgress: "In Progress",
  Blocked: "Blocked",
  Done: "Done",
};

const PRIORITY_WEIGHT: Record<Priority, number> = { P0: 400, P1: 300, P2: 200, P3: 100 };
const SEVERITY_WEIGHT: Record<Severity, number> = { Sev1: 40, Sev2: 30, Sev3: 20, Sev4: 10 };

type TrackerView = "dashboard" | "board";

type LinkDraft = {
  rawUrlOrPath: string;
  ownerRepo: string;
  number: string;
  type: "issue" | "pr";
  busy: boolean;
  error: string;
};

function readViewFromPath(pathname: string): TrackerView {
  return pathname.startsWith("/tracker/board") ? "board" : "dashboard";
}

function toErrorTrace(error: unknown): ErrorTrace {
  const atIso = new Date().toISOString();
  if (error instanceof Error) {
    return { atIso, message: error.message, stack: error.stack ?? null };
  }
  return { atIso, message: String(error), stack: null };
}

function formatTime(ms: number | null): string {
  if (!ms || ms <= 0) return "-";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return new Date(ms).toISOString();
  }
}

function parseCsv(input: string): string[] {
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatProjectLabel(project: TrackerProject | undefined): string {
  if (!project) return "Unknown project";
  return `${project.key} - ${project.name}`;
}

function makeDefaultLinkDraft(): LinkDraft {
  return {
    rawUrlOrPath: "",
    ownerRepo: "",
    number: "",
    type: "issue",
    busy: false,
    error: "",
  };
}

function toRepoDocUrl(path: string): string | null {
  if (!REPO_BLOB_BASE_URL) return null;
  return `${REPO_BLOB_BASE_URL}/${path}`;
}

class TrackerErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    console.error("TrackerErrorBoundary caught", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="tracker-fatal">
        <h1>Tracker failed to render</h1>
        <p>{this.state.message || "Unknown rendering error"}</p>
      </div>
    );
  }
}

function TrackerSignIn({ authError }: { authError: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const signInWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message || "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const signInLocal = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try {
      await signInAnonymously(auth);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message || "Emulator sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tracker-auth-page">
      <div className="tracker-auth-card">
        <h1>Project Progress Tracker</h1>
        <p>Internal workspace for Monsoon Fire Portal and Website planning and execution.</p>
        <button className="tracker-btn tracker-btn-primary" onClick={() => void signInWithGoogle()} disabled={busy}>
          {busy ? "Signing in..." : "Continue with Google"}
        </button>
        {ALLOW_LOCAL_BYPASS ? (
          <button className="tracker-btn tracker-btn-secondary" onClick={() => void signInLocal()} disabled={busy}>
            Sign in with local emulator bypass
          </button>
        ) : null}
        {status ? <div className="tracker-error">{status}</div> : null}
        {authError ? <div className="tracker-error">{authError}</div> : null}
      </div>
    </div>
  );
}

function TroubleshootingPanel({
  lastWrite,
  lastQuery,
  lastGitHubSync,
  lastError,
  githubCurlHint,
}: {
  lastWrite: FirestoreWriteTrace | null;
  lastQuery: FirestoreQueryTrace | null;
  lastGitHubSync: GitHubSyncTrace | null;
  lastError: ErrorTrace | null;
  githubCurlHint: string;
}) {
  const [status, setStatus] = useState("");

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("Copied to clipboard.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <details className="tracker-troubleshooting">
      <summary>Troubleshooting</summary>
      <p className="tracker-subtle">Collapsed by default. Includes last writes, queries, GitHub sync call, and error stack.</p>

      <div className="tracker-trace-block">
        <h4>Last Firestore write attempt</h4>
        <pre>{JSON.stringify(lastWrite, null, 2) || "null"}</pre>
        <button className="tracker-btn tracker-btn-secondary" onClick={() => void copyText(JSON.stringify(lastWrite, null, 2))}>
          Copy write JSON
        </button>
      </div>

      <div className="tracker-trace-block">
        <h4>Last query params</h4>
        <pre>{JSON.stringify(lastQuery, null, 2) || "null"}</pre>
        <button className="tracker-btn tracker-btn-secondary" onClick={() => void copyText(JSON.stringify(lastQuery, null, 2))}>
          Copy query JSON
        </button>
      </div>

      <div className="tracker-trace-block">
        <h4>Last GitHub sync call</h4>
        <pre>{JSON.stringify(lastGitHubSync, null, 2) || "null"}</pre>
        <button className="tracker-btn tracker-btn-secondary" onClick={() => void copyText(JSON.stringify(lastGitHubSync, null, 2))}>
          Copy GitHub call JSON
        </button>
        <div className="tracker-subtle">Curl-like hint</div>
        <pre>{githubCurlHint || "(none yet)"}</pre>
        <button className="tracker-btn tracker-btn-secondary" onClick={() => void copyText(githubCurlHint)} disabled={!githubCurlHint}>
          Copy curl hint
        </button>
      </div>

      <div className="tracker-trace-block">
        <h4>Last error stack/message</h4>
        <pre>{JSON.stringify(lastError, null, 2) || "null"}</pre>
      </div>

      {status ? <div className="tracker-status">{status}</div> : null}
    </details>
  );
}

function DocumentationLinksCard() {
  const [copyStatus, setCopyStatus] = useState("");

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopyStatus(`Copied path: ${path}`);
    } catch (error: unknown) {
      setCopyStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const renderGroup = (title: string, paths: string[]) => (
    <div className="tracker-doc-group">
      <h4>{title}</h4>
      <ul className="tracker-doc-list">
        {paths.map((path) => {
          const url = toRepoDocUrl(path);
          return (
            <li key={path}>
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {path}
                </a>
              ) : (
                <code>{path}</code>
              )}
              {!url ? (
                <button className="tracker-btn tracker-btn-secondary" onClick={() => void copyPath(path)}>
                  Copy path
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <section className="tracker-card">
      <h2>Tickets & metadata docs</h2>
      <p className="tracker-subtle">
        Set <code>VITE_REPO_BLOB_BASE_URL</code> (for example
        {" "}
        <code>https://github.com/ORG/REPO/blob/main</code>) to make these links open directly.
      </p>
      <div className="tracker-doc-grid">
        {renderGroup("Existing tickets", TICKET_DOC_PATHS)}
        {renderGroup("Metadata documentation", METADATA_DOC_PATHS)}
      </div>
      {copyStatus ? <div className="tracker-status">{copyStatus}</div> : null}
    </section>
  );
}

function TrackerAppInner() {
  const [authInitialized, setAuthInitialized] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<TrackerView>(readViewFromPath(window.location.pathname));

  const [loading, setLoading] = useState(false);
  const [loadingError, setLoadingError] = useState("");

  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [epics, setEpics] = useState<TrackerEpic[]>([]);
  const [tickets, setTickets] = useState<TrackerTicket[]>([]);
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealth | null>(null);

  const [lastWrite, setLastWrite] = useState<FirestoreWriteTrace | null>(null);
  const [lastQuery, setLastQuery] = useState<FirestoreQueryTrace | null>(null);
  const [lastGitHubSync, setLastGitHubSync] = useState<GitHubSyncTrace | null>(null);
  const [lastError, setLastError] = useState<ErrorTrace | null>(null);
  const [githubCurlHint, setGithubCurlHint] = useState("");

  const [projectForm, setProjectForm] = useState({ key: "", name: "", description: "" });
  const [projectBusy, setProjectBusy] = useState(false);

  const [epicForm, setEpicForm] = useState({
    projectId: "",
    title: "",
    description: "",
    status: "Backlog" as TicketStatus,
    priority: "P2" as Priority,
    tags: "",
  });
  const [epicBusy, setEpicBusy] = useState(false);

  const [ticketForm, setTicketForm] = useState({
    projectId: "",
    epicId: "",
    title: "",
    description: "",
    status: "Backlog" as TicketStatus,
    priority: "P2" as Priority,
    severity: "Sev3" as Severity,
    component: "portal",
    impact: "med" as ImpactLevel,
    tags: "",
    links: "",
    blocked: false,
    blockedReason: "",
    blockedByTicketId: "",
  });
  const [ticketBusy, setTicketBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);

  const [ticketUpdateBusy, setTicketUpdateBusy] = useState<Record<string, boolean>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkDraft>>({});
  const [showCreatePanels, setShowCreatePanels] = useState(false);

  const [filterProjectId, setFilterProjectId] = useState("all");
  const [filterComponent, setFilterComponent] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterImpact, setFilterImpact] = useState("all");
  const [filterTag, setFilterTag] = useState("all");

  const functionsClient = useMemo(() => {
    if (!user) return null;
    return createFunctionsClient({
      baseUrl: FUNCTIONS_BASE_URL,
      getIdToken: async () => await user.getIdToken(),
    });
  }, [user]);

  const diagnosticsCallbacks: TrackerDiagnosticsCallbacks = useMemo(
    () => ({
      onWrite: (event) => setLastWrite(event),
      onQuery: (event) => setLastQuery(event),
    }),
    []
  );

  useEffect(() => {
    const unsub = onIdTokenChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setAuthInitialized(true);
      },
      (error) => {
        setAuthError(error.message || "Auth listener failed.");
        setAuthInitialized(true);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const onPopState = () => setView(readViewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!projects.length) return;
    if (!epicForm.projectId) {
      setEpicForm((prev) => ({ ...prev, projectId: projects[0].id }));
    }
    if (!ticketForm.projectId) {
      setTicketForm((prev) => ({ ...prev, projectId: projects[0].id }));
    }
  }, [projects, epicForm.projectId, ticketForm.projectId]);

  const projectById = useMemo(() => {
    const map = new Map<string, TrackerProject>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      for (const tag of ticket.tags) set.add(tag);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const allComponents = useMemo(() => {
    const set = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.component) set.add(ticket.component);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      if (filterProjectId !== "all" && ticket.projectId !== filterProjectId) return false;
      if (filterComponent !== "all" && ticket.component !== filterComponent) return false;
      if (filterPriority !== "all" && ticket.priority !== filterPriority) return false;
      if (filterSeverity !== "all" && ticket.severity !== filterSeverity) return false;
      if (filterImpact !== "all" && ticket.impact !== filterImpact) return false;
      if (filterTag !== "all" && !ticket.tags.includes(filterTag)) return false;
      return true;
    });
  }, [tickets, filterProjectId, filterComponent, filterPriority, filterSeverity, filterImpact, filterTag]);

  const ticketCountsByStatus = useMemo(() => {
    const counts: Record<TicketStatus, number> = {
      Backlog: 0,
      Ready: 0,
      InProgress: 0,
      Blocked: 0,
      Done: 0,
    };
    for (const ticket of tickets) counts[ticket.status] += 1;
    return counts;
  }, [tickets]);

  const blockedCount = useMemo(() => tickets.filter((ticket) => ticket.blocked).length, [tickets]);

  const recentlyUpdated = useMemo(
    () => [...tickets].sort((a, b) => b.updatedAtMs - a.updatedAtMs).slice(0, 8),
    [tickets]
  );

  const topPriority = useMemo(() => {
    return [...tickets]
      .sort((a, b) => {
        const scoreA = PRIORITY_WEIGHT[a.priority] + SEVERITY_WEIGHT[a.severity];
        const scoreB = PRIORITY_WEIGHT[b.priority] + SEVERITY_WEIGHT[b.severity];
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.updatedAtMs - a.updatedAtMs;
      })
      .slice(0, 8);
  }, [tickets]);

  const fetchAllData = async (uid: string) => {
    setLoading(true);
    setLoadingError("");
    try {
      const [projectsList, epicsList, ticketsList, health] = await Promise.all([
        listProjects(uid, diagnosticsCallbacks),
        listEpics(uid, diagnosticsCallbacks),
        listTickets(uid, diagnosticsCallbacks),
        getIntegrationHealth(uid, diagnosticsCallbacks),
      ]);

      setProjects(projectsList);
      setEpics(epicsList);
      setTickets(ticketsList);
      setIntegrationHealth(health);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
      setLoadingError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void fetchAllData(user.uid);
  }, [user, diagnosticsCallbacks]);

  const navigate = (nextView: TrackerView) => {
    const pathname = nextView === "dashboard" ? "/tracker" : "/tracker/board";
    window.history.pushState({}, "", pathname);
    setView(nextView);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
    }
  };

  const handleCreateProject = async () => {
    if (!user || projectBusy) return;
    if (!projectForm.key.trim() || !projectForm.name.trim()) {
      setLoadingError("Project key and name are required.");
      return;
    }
    setProjectBusy(true);
    setLoadingError("");
    try {
      await createProject(
        user.uid,
        {
          key: projectForm.key.trim(),
          name: projectForm.name.trim(),
          description: projectForm.description.trim() || null,
        },
        diagnosticsCallbacks
      );
      setProjectForm({ key: "", name: "", description: "" });
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
      setLoadingError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const handleCreateEpic = async () => {
    if (!user || epicBusy) return;
    if (!epicForm.projectId || !epicForm.title.trim()) {
      setLoadingError("Epic project and title are required.");
      return;
    }
    setEpicBusy(true);
    setLoadingError("");
    try {
      await createEpic(
        user.uid,
        {
          projectId: epicForm.projectId,
          title: epicForm.title.trim(),
          description: epicForm.description.trim() || null,
          status: epicForm.status,
          priority: epicForm.priority,
          tags: parseCsv(epicForm.tags),
        },
        diagnosticsCallbacks
      );
      setEpicForm((prev) => ({ ...prev, title: "", description: "", tags: "" }));
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
      setLoadingError(error instanceof Error ? error.message : String(error));
    } finally {
      setEpicBusy(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!user || ticketBusy) return;
    if (!ticketForm.projectId || !ticketForm.title.trim()) {
      setLoadingError("Ticket project and title are required.");
      return;
    }

    if (ticketForm.blocked && !ticketForm.blockedReason.trim()) {
      setLoadingError("Blocked tickets require a blocked reason.");
      return;
    }

    setTicketBusy(true);
    setLoadingError("");
    try {
      await createTicket(
        user.uid,
        {
          projectId: ticketForm.projectId,
          epicId: ticketForm.epicId.trim() || null,
          title: ticketForm.title.trim(),
          description: ticketForm.description.trim() || null,
          status: ticketForm.status,
          priority: ticketForm.priority,
          severity: ticketForm.severity,
          component: ticketForm.component.trim(),
          impact: ticketForm.impact,
          tags: parseCsv(ticketForm.tags),
          links: parseCsv(ticketForm.links),
          blocked: ticketForm.blocked,
          blockedReason: ticketForm.blocked ? ticketForm.blockedReason.trim() || null : null,
          blockedByTicketId: ticketForm.blockedByTicketId.trim() || null,
        },
        diagnosticsCallbacks
      );

      setTicketForm((prev) => ({
        ...prev,
        title: "",
        description: "",
        tags: "",
        links: "",
        blocked: false,
        blockedReason: "",
        blockedByTicketId: "",
      }));
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
      setLoadingError(error instanceof Error ? error.message : String(error));
    } finally {
      setTicketBusy(false);
    }
  };

  const markTicketBusy = (ticketId: string, busy: boolean) => {
    setTicketUpdateBusy((prev) => ({ ...prev, [ticketId]: busy }));
  };

  const handleTicketPatch = async (ticketId: string, patch: Parameters<typeof updateTicket>[1], activityType?: string) => {
    if (!user || ticketUpdateBusy[ticketId]) return;
    markTicketBusy(ticketId, true);
    setLoadingError("");
    try {
      await updateTicket(ticketId, patch, diagnosticsCallbacks);
      if (activityType) {
        await addTicketActivity(ticketId, activityType, patch, diagnosticsCallbacks);
      }
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      setLastError(toErrorTrace(error));
      setLoadingError(error instanceof Error ? error.message : String(error));
    } finally {
      markTicketBusy(ticketId, false);
    }
  };

  const getLinkDraft = (ticketId: string): LinkDraft => linkDrafts[ticketId] ?? makeDefaultLinkDraft();

  const setLinkDraft = (ticketId: string, patch: Partial<LinkDraft>) => {
    setLinkDrafts((prev) => ({
      ...prev,
      [ticketId]: {
        ...getLinkDraft(ticketId),
        ...patch,
      },
    }));
  };

  const updateIntegrationHealthState = async (
    uid: string,
    update: { success: boolean; message: string | null; status: number | null }
  ) => {
    const now = Date.now();
    if (update.success) {
      await upsertIntegrationHealth(
        uid,
        {
          lastSuccessAtMs: now,
          lastSyncStatus: update.status,
          lastFailureMessage: null,
        },
        diagnosticsCallbacks
      );
    } else {
      await upsertIntegrationHealth(
        uid,
        {
          lastFailureAtMs: now,
          lastFailureMessage: update.message,
          lastSyncStatus: update.status,
        },
        diagnosticsCallbacks
      );
    }

    const refreshed = await getIntegrationHealth(uid, diagnosticsCallbacks);
    setIntegrationHealth(refreshed);
  };

  const handleGitHubLink = async (ticket: TrackerTicket) => {
    if (!functionsClient || !user) return;
    const draft = getLinkDraft(ticket.id);
    if (draft.busy) return;

    setLinkDraft(ticket.id, { busy: true, error: "" });
    try {
      const parsed = parseGitHubReference({
        rawUrlOrPath: draft.rawUrlOrPath,
        ownerRepo: draft.ownerRepo,
        numberInput: draft.number,
      });

      const request = { ...parsed, type: draft.type };
      setGithubCurlHint(buildGitHubLookupCurl(FUNCTIONS_BASE_URL, request));

      const response = await functionsClient.postJson<{ ok: true; data: { url: string; title: string; state: string; updatedAt: string; merged?: boolean } }>(
        "githubLookup",
        request
      );

      const lastReq = functionsClient.getLastRequest();
      setLastGitHubSync({
        atIso: new Date().toISOString(),
        request,
        status: typeof lastReq?.status === "number" ? lastReq.status : null,
        response,
      });

      const syncedAtMs = Date.parse(response.data.updatedAt) || Date.now();
      const githubRef: GitHubIssueRef = {
        owner: parsed.owner,
        repo: parsed.repo,
        number: parsed.number,
        url: response.data.url,
        title: response.data.title || null,
        state: response.data.state || null,
        merged: typeof response.data.merged === "boolean" ? response.data.merged : undefined,
        lastSyncedAtMs: syncedAtMs,
      };

      if (draft.type === "issue") {
        await handleTicketPatch(ticket.id, { githubIssue: githubRef }, "github_issue_linked");
      } else {
        const nextPrs = [...ticket.githubPRs.filter((pr) => !(pr.owner === githubRef.owner && pr.repo === githubRef.repo && pr.number === githubRef.number)), githubRef];
        await handleTicketPatch(ticket.id, { githubPRs: nextPrs }, "github_pr_linked");
      }

      await updateIntegrationHealthState(user.uid, { success: true, message: null, status: typeof lastReq?.status === "number" ? lastReq.status : null });
      setLinkDraft(ticket.id, { rawUrlOrPath: "", ownerRepo: "", number: "", busy: false, error: "" });
    } catch (error: unknown) {
      const trace = toErrorTrace(error);
      setLastError(trace);
      setLinkDraft(ticket.id, { busy: false, error: trace.message });
      const status = functionsClient.getLastRequest()?.status;
      setLastGitHubSync({
        atIso: new Date().toISOString(),
        request: getLinkDraft(ticket.id),
        status: typeof status === "number" ? status : null,
        response: { ok: false, message: trace.message },
      });
      await updateIntegrationHealthState(user.uid, {
        success: false,
        message: trace.message,
        status: typeof status === "number" ? status : null,
      });
    }
  };

  const handleRefreshGithubMetadata = async (ticket: TrackerTicket) => {
    if (!functionsClient || !user || ticketUpdateBusy[ticket.id]) return;

    const refs: Array<{ type: "issue" | "pr"; ref: GitHubIssueRef }> = [];
    if (ticket.githubIssue) refs.push({ type: "issue", ref: ticket.githubIssue });
    for (const pr of ticket.githubPRs) refs.push({ type: "pr", ref: pr });

    if (!refs.length) {
      setLoadingError("No linked GitHub issue or PR to refresh.");
      return;
    }

    markTicketBusy(ticket.id, true);
    setLoadingError("");

    try {
      let nextIssue = ticket.githubIssue;
      const nextPrs = [...ticket.githubPRs];
      let lastStatus: number | null = null;

      for (const entry of refs) {
        const request = {
          owner: entry.ref.owner,
          repo: entry.ref.repo,
          number: entry.ref.number,
          type: entry.type,
        };

        setGithubCurlHint(buildGitHubLookupCurl(FUNCTIONS_BASE_URL, request));
        const response = await functionsClient.postJson<{ ok: true; data: { url: string; title: string; state: string; updatedAt: string; merged?: boolean } }>(
          "githubLookup",
          request
        );

        const reqMeta = functionsClient.getLastRequest();
        lastStatus = typeof reqMeta?.status === "number" ? reqMeta.status : null;
        setLastGitHubSync({
          atIso: new Date().toISOString(),
          request,
          status: lastStatus,
          response,
        });

        const syncedAtMs = Date.parse(response.data.updatedAt) || Date.now();
        const refreshedRef: GitHubIssueRef = {
          owner: entry.ref.owner,
          repo: entry.ref.repo,
          number: entry.ref.number,
          url: response.data.url,
          title: response.data.title || null,
          state: response.data.state || null,
          merged: typeof response.data.merged === "boolean" ? response.data.merged : undefined,
          lastSyncedAtMs: syncedAtMs,
        };

        if (entry.type === "issue") {
          nextIssue = refreshedRef;
        } else {
          const index = nextPrs.findIndex(
            (pr) => pr.owner === refreshedRef.owner && pr.repo === refreshedRef.repo && pr.number === refreshedRef.number
          );
          if (index >= 0) nextPrs[index] = refreshedRef;
        }
      }

      await updateTicket(ticket.id, { githubIssue: nextIssue, githubPRs: nextPrs }, diagnosticsCallbacks);
      await addTicketActivity(ticket.id, "github_metadata_refreshed", { refs: refs.length }, diagnosticsCallbacks);
      await updateIntegrationHealthState(user.uid, { success: true, message: null, status: lastStatus });
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      const trace = toErrorTrace(error);
      setLastError(trace);
      setLoadingError(trace.message);
      const status = functionsClient.getLastRequest()?.status;
      await updateIntegrationHealthState(user.uid, {
        success: false,
        message: trace.message,
        status: typeof status === "number" ? status : null,
      });
    } finally {
      markTicketBusy(ticket.id, false);
    }
  };

  const handleCreateThemeTicket = async () => {
    if (!user || ticketBusy) return;
    const trackerProject = projects.find((project) => project.key === "PORTAL") ?? projects[0];
    if (!trackerProject) {
      setLoadingError("Create at least one project first.");
      return;
    }

    setTicketBusy(true);
    try {
      await createTicket(
        user.uid,
        {
          projectId: trackerProject.id,
          epicId: null,
          title: "Apply the new portal theme to Tracker UI",
          description:
            "Deferred follow-up. Apply the approved Portal theme and motion system to /tracker dashboard + board without reducing troubleshooting clarity.",
          status: "Backlog",
          priority: "P2",
          severity: "Sev3",
          component: "portal",
          impact: "med",
          tags: ["tracker", "theme", "followup"],
          links: [],
          blocked: false,
          blockedReason: null,
          blockedByTicketId: null,
        },
        diagnosticsCallbacks
      );
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      const trace = toErrorTrace(error);
      setLastError(trace);
      setLoadingError(trace.message);
    } finally {
      setTicketBusy(false);
    }
  };

  const handleSeedStarterData = async () => {
    if (!user || seedBusy) return;
    setSeedBusy(true);
    setLoadingError("");
    try {
      await seedTrackerStarterData(user.uid, diagnosticsCallbacks);
      await fetchAllData(user.uid);
    } catch (error: unknown) {
      const trace = toErrorTrace(error);
      setLastError(trace);
      setLoadingError(trace.message);
    } finally {
      setSeedBusy(false);
    }
  };

  if (!authInitialized) {
    return <div className="tracker-loading">Initializing tracker auth...</div>;
  }

  if (!user) {
    return <TrackerSignIn authError={authError} />;
  }

  const renderDashboard = () => (
    <div className="tracker-content-grid">
      <section className="tracker-card tracker-metric-grid">
        {TICKET_STATUSES.map((status) => (
          <article key={status} className="tracker-metric">
            <h3>{STATUS_LABELS[status]}</h3>
            <strong>{ticketCountsByStatus[status]}</strong>
          </article>
        ))}
        <article className="tracker-metric tracker-metric-alert">
          <h3>Blocked</h3>
          <strong>{blockedCount}</strong>
        </article>
      </section>

      <section className="tracker-card">
        <h2>Recently updated</h2>
        {recentlyUpdated.length ? (
          <ul className="tracker-list">
            {recentlyUpdated.map((ticket) => (
              <li key={ticket.id}>
                <div>
                  <strong>{ticket.title}</strong>
                  <span>{formatProjectLabel(projectById.get(ticket.projectId))}</span>
                </div>
                <span>{formatTime(ticket.updatedAtMs)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tracker-empty">No tickets yet. Create one from the Board page.</div>
        )}
      </section>

      <section className="tracker-card">
        <h2>Top priority</h2>
        {topPriority.length ? (
          <ul className="tracker-list">
            {topPriority.map((ticket) => (
              <li key={ticket.id}>
                <div>
                  <strong>{ticket.title}</strong>
                  <span>
                    {ticket.priority} / {ticket.severity}
                  </span>
                </div>
                <span>{STATUS_LABELS[ticket.status]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tracker-empty">No priority data yet.</div>
        )}
      </section>

      <section className="tracker-card">
        <h2>Integration health</h2>
        <div className="tracker-health-grid">
          <div>
            <label>Last GitHub sync success</label>
            <strong>{formatTime(integrationHealth?.lastSuccessAtMs ?? null)}</strong>
          </div>
          <div>
            <label>Last sync status</label>
            <strong>{integrationHealth?.lastSyncStatus ?? "-"}</strong>
          </div>
          <div>
            <label>Last failure</label>
            <strong>{formatTime(integrationHealth?.lastFailureAtMs ?? null)}</strong>
          </div>
          <div>
            <label>Failure message</label>
            <strong>{integrationHealth?.lastFailureMessage || "-"}</strong>
          </div>
        </div>
      </section>

      <DocumentationLinksCard />
    </div>
  );

  const renderBoard = () => (
    <div className="tracker-board-wrap">
      {showCreatePanels ? (
        <section className="tracker-card tracker-form-grid">
          <article>
            <h3>New project</h3>
            <input
              placeholder="Key (PORTAL / WEB)"
              value={projectForm.key}
              onChange={(event) => setProjectForm((prev) => ({ ...prev, key: event.target.value }))}
            />
            <input
              placeholder="Project name"
              value={projectForm.name}
              onChange={(event) => setProjectForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <textarea
              placeholder="Description (optional)"
              value={projectForm.description}
              onChange={(event) => setProjectForm((prev) => ({ ...prev, description: event.target.value }))}
            />
            <button className="tracker-btn tracker-btn-primary" onClick={() => void handleCreateProject()} disabled={projectBusy}>
              {projectBusy ? "Saving..." : "Create project"}
            </button>
          </article>

          <article>
            <h3>New epic / feature</h3>
            <select value={epicForm.projectId} onChange={(event) => setEpicForm((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {formatProjectLabel(project)}
                </option>
              ))}
            </select>
            <input
              placeholder="Epic title"
              value={epicForm.title}
              onChange={(event) => setEpicForm((prev) => ({ ...prev, title: event.target.value }))}
            />
            <textarea
              placeholder="Description"
              value={epicForm.description}
              onChange={(event) => setEpicForm((prev) => ({ ...prev, description: event.target.value }))}
            />
            <div className="tracker-inline-grid">
              <select value={epicForm.status} onChange={(event) => setEpicForm((prev) => ({ ...prev, status: event.target.value as TicketStatus }))}>
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <select value={epicForm.priority} onChange={(event) => setEpicForm((prev) => ({ ...prev, priority: event.target.value as Priority }))}>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="Tags (comma separated)"
              value={epicForm.tags}
              onChange={(event) => setEpicForm((prev) => ({ ...prev, tags: event.target.value }))}
            />
            <button className="tracker-btn tracker-btn-primary" onClick={() => void handleCreateEpic()} disabled={epicBusy}>
              {epicBusy ? "Saving..." : "Create epic"}
            </button>
          </article>

          <article>
            <h3>New ticket</h3>
            <p className="tracker-subtle">Visibility is mandatory: all tickets are published to tracker website by default.</p>
            <select value={ticketForm.projectId} onChange={(event) => setTicketForm((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {formatProjectLabel(project)}
                </option>
              ))}
            </select>
            <select value={ticketForm.epicId} onChange={(event) => setTicketForm((prev) => ({ ...prev, epicId: event.target.value }))}>
              <option value="">No epic</option>
              {epics
                .filter((epic) => !ticketForm.projectId || epic.projectId === ticketForm.projectId)
                .map((epic) => (
                  <option key={epic.id} value={epic.id}>
                    {epic.title}
                  </option>
                ))}
            </select>
            <input
              placeholder="Ticket title"
              value={ticketForm.title}
              onChange={(event) => setTicketForm((prev) => ({ ...prev, title: event.target.value }))}
            />
            <textarea
              placeholder="Description"
              value={ticketForm.description}
              onChange={(event) => setTicketForm((prev) => ({ ...prev, description: event.target.value }))}
            />
            <div className="tracker-inline-grid">
              <select value={ticketForm.status} onChange={(event) => setTicketForm((prev) => ({ ...prev, status: event.target.value as TicketStatus }))}>
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <select value={ticketForm.priority} onChange={(event) => setTicketForm((prev) => ({ ...prev, priority: event.target.value as Priority }))}>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <select value={ticketForm.severity} onChange={(event) => setTicketForm((prev) => ({ ...prev, severity: event.target.value as Severity }))}>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
              <select value={ticketForm.impact} onChange={(event) => setTicketForm((prev) => ({ ...prev, impact: event.target.value as ImpactLevel }))}>
                {IMPACT_LEVELS.map((impact) => (
                  <option key={impact} value={impact}>
                    {impact}
                  </option>
                ))}
              </select>
            </div>
            <input
              placeholder="Component (portal, website, functions, infra)"
              value={ticketForm.component}
              onChange={(event) => setTicketForm((prev) => ({ ...prev, component: event.target.value }))}
            />
            <input
              placeholder="Tags (comma separated)"
              value={ticketForm.tags}
              onChange={(event) => setTicketForm((prev) => ({ ...prev, tags: event.target.value }))}
            />
            <input
              placeholder="Optional links (comma separated URLs)"
              value={ticketForm.links}
              onChange={(event) => setTicketForm((prev) => ({ ...prev, links: event.target.value }))}
            />
            <label className="tracker-checkbox">
              <input
                type="checkbox"
                checked={ticketForm.blocked}
                onChange={(event) => setTicketForm((prev) => ({ ...prev, blocked: event.target.checked }))}
              />
              Blocked
            </label>
            {ticketForm.blocked ? (
              <>
                <input
                  placeholder="Blocked reason"
                  value={ticketForm.blockedReason}
                  onChange={(event) => setTicketForm((prev) => ({ ...prev, blockedReason: event.target.value }))}
                />
                <input
                  placeholder="Blocked by ticket ID (optional)"
                  value={ticketForm.blockedByTicketId}
                  onChange={(event) => setTicketForm((prev) => ({ ...prev, blockedByTicketId: event.target.value }))}
                />
              </>
            ) : null}
            <div className="tracker-inline-grid">
              <button className="tracker-btn tracker-btn-primary" onClick={() => void handleCreateTicket()} disabled={ticketBusy}>
                {ticketBusy ? "Saving..." : "Create ticket"}
              </button>
              <button className="tracker-btn tracker-btn-secondary" onClick={() => void handleCreateThemeTicket()} disabled={ticketBusy}>
                Add deferred theme ticket
              </button>
            </div>
          </article>
        </section>
      ) : null}

      <section className="tracker-card tracker-filters">
        <h3>Filters</h3>
        <div className="tracker-filter-row">
          <select value={filterProjectId} onChange={(event) => setFilterProjectId(event.target.value)}>
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {formatProjectLabel(project)}
              </option>
            ))}
          </select>
          <select value={filterComponent} onChange={(event) => setFilterComponent(event.target.value)}>
            <option value="all">All components</option>
            {allComponents.map((component) => (
              <option key={component} value={component}>
                {component}
              </option>
            ))}
          </select>
          <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value)}>
            <option value="all">All priorities</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          <select value={filterSeverity} onChange={(event) => setFilterSeverity(event.target.value)}>
            <option value="all">All severities</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
          <select value={filterImpact} onChange={(event) => setFilterImpact(event.target.value)}>
            <option value="all">All impacts</option>
            {IMPACT_LEVELS.map((impact) => (
              <option key={impact} value={impact}>
                {impact}
              </option>
            ))}
          </select>
          <select value={filterTag} onChange={(event) => setFilterTag(event.target.value)}>
            <option value="all">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="tracker-board-grid">
        {TICKET_STATUSES.map((status) => {
          const columnTickets = filteredTickets.filter((ticket) => ticket.status === status);
          return (
            <article key={status} className="tracker-column">
              <header>
                <h3>{STATUS_LABELS[status]}</h3>
                <span>{columnTickets.length}</span>
              </header>

              {columnTickets.length ? (
                <div className="tracker-card-list">
                  {columnTickets.map((ticket) => {
                    const busy = !!ticketUpdateBusy[ticket.id];
                    const draft = getLinkDraft(ticket.id);
                    return (
                      <div key={ticket.id} className="tracker-ticket-card">
                        <div className="tracker-ticket-head">
                          <strong>{ticket.title}</strong>
                          <span>{projectById.get(ticket.projectId)?.key || "-"}</span>
                        </div>
                        <div className="tracker-ticket-badges">
                          <span className="tracker-badge tracker-badge-visible">Visible</span>
                          <span className="tracker-badge">{ticket.priority}</span>
                          <span className="tracker-badge">{ticket.severity}</span>
                          <span className="tracker-badge">{ticket.impact}</span>
                          <span className="tracker-badge">{ticket.component}</span>
                          {ticket.blocked ? <span className="tracker-badge tracker-badge-alert">Blocked</span> : null}
                        </div>
                        {ticket.tags.length ? (
                          <div className="tracker-ticket-tags">
                            {ticket.tags.map((tag) => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        ) : null}

                        {ticket.githubIssue ? (
                          <div className="tracker-github-row">
                            <a href={ticket.githubIssue.url} target="_blank" rel="noreferrer">
                              Issue #{ticket.githubIssue.number}
                            </a>
                            <span>{ticket.githubIssue.state || "-"}</span>
                          </div>
                        ) : null}

                        {ticket.githubPRs.length ? (
                          <div className="tracker-github-pr-list">
                            {ticket.githubPRs.map((pr) => (
                              <div key={`${pr.owner}/${pr.repo}#${pr.number}`} className="tracker-github-row">
                                <a href={pr.url} target="_blank" rel="noreferrer">
                                  PR #{pr.number}
                                </a>
                                <span>{pr.merged ? "merged" : pr.state || "-"}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {ticket.blocked && ticket.blockedReason ? (
                          <div className="tracker-blocked-note">Reason: {ticket.blockedReason}</div>
                        ) : null}

                        <div className="tracker-ticket-actions">
                          <select
                            value={ticket.status}
                            onChange={(event) =>
                              void handleTicketPatch(ticket.id, { status: event.target.value as TicketStatus }, "status_changed")
                            }
                            disabled={busy}
                          >
                            {TICKET_STATUSES.map((nextStatus) => (
                              <option key={nextStatus} value={nextStatus}>
                                {STATUS_LABELS[nextStatus]}
                              </option>
                            ))}
                          </select>
                          <button
                            className="tracker-btn tracker-btn-secondary"
                            onClick={() => {
                              if (ticket.blocked) {
                                void handleTicketPatch(
                                  ticket.id,
                                  { blocked: false, blockedReason: null, blockedByTicketId: null, status: "InProgress" },
                                  "unblocked"
                                );
                                return;
                              }

                              const reason = window.prompt("Blocked reason", ticket.blockedReason || "") || "";
                              if (!reason.trim()) return;
                              const blockedBy = window.prompt("Blocked by ticket ID (optional)", ticket.blockedByTicketId || "") || "";
                              void handleTicketPatch(
                                ticket.id,
                                {
                                  blocked: true,
                                  blockedReason: reason.trim(),
                                  blockedByTicketId: blockedBy.trim() || null,
                                  status: "Blocked",
                                },
                                "blocked"
                              );
                            }}
                            disabled={busy}
                          >
                            {ticket.blocked ? "Unblock" : "Block"}
                          </button>
                          <button
                            className="tracker-btn tracker-btn-secondary"
                            onClick={() => void handleRefreshGithubMetadata(ticket)}
                            disabled={busy}
                          >
                            Refresh GitHub metadata
                          </button>
                        </div>

                        <details className="tracker-link-card">
                          <summary>Link GitHub issue / PR</summary>
                          <div className="tracker-link-grid">
                            <select
                              value={draft.type}
                              onChange={(event) => setLinkDraft(ticket.id, { type: event.target.value as "issue" | "pr" })}
                              disabled={draft.busy}
                            >
                              <option value="issue">Issue</option>
                              <option value="pr">PR</option>
                            </select>
                            <input
                              placeholder="Paste GitHub URL"
                              value={draft.rawUrlOrPath}
                              onChange={(event) => setLinkDraft(ticket.id, { rawUrlOrPath: event.target.value })}
                              disabled={draft.busy}
                            />
                            <input
                              placeholder="owner/repo"
                              value={draft.ownerRepo}
                              onChange={(event) => setLinkDraft(ticket.id, { ownerRepo: event.target.value })}
                              disabled={draft.busy}
                            />
                            <input
                              placeholder="Issue or PR number"
                              value={draft.number}
                              onChange={(event) => setLinkDraft(ticket.id, { number: event.target.value })}
                              disabled={draft.busy}
                            />
                            <button
                              className="tracker-btn tracker-btn-primary"
                              onClick={() => void handleGitHubLink(ticket)}
                              disabled={draft.busy}
                            >
                              {draft.busy ? "Linking..." : "Link GitHub"}
                            </button>
                            {draft.error ? <div className="tracker-error">{draft.error}</div> : null}
                          </div>
                        </details>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="tracker-empty">No tickets in this column after filters.</div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );

  return (
    <div className="tracker-shell">
      <aside className="tracker-nav">
        <div className="tracker-brand">
          <h1>Monsoon Fire Tracker</h1>
          <p>Portal + Website only</p>
        </div>
        <nav>
          <button
            className={view === "dashboard" ? "active" : ""}
            onClick={() => navigate("dashboard")}
            type="button"
          >
            Dashboard
          </button>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => navigate("board")}
            type="button"
          >
            Board
          </button>
        </nav>
        <div className="tracker-nav-footer">
          <div className="tracker-user">{user.displayName || user.email || user.uid}</div>
          <button className="tracker-btn tracker-btn-secondary" onClick={() => void handleSignOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="tracker-main">
        <header className="tracker-top">
          <div>
            <h2>{view === "dashboard" ? "Dashboard" : "Kanban board"}</h2>
            <p>Single-user internal tracker. Status updates are written to Firestore immediately.</p>
          </div>
          <div className="tracker-top-actions">
            <button className="tracker-btn tracker-btn-secondary" onClick={() => void fetchAllData(user.uid)} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            {view === "board" ? (
              <button className="tracker-btn tracker-btn-secondary" onClick={() => setShowCreatePanels((prev) => !prev)}>
                {showCreatePanels ? "Hide create forms" : "Show create forms"}
              </button>
            ) : null}
            <button className="tracker-btn tracker-btn-secondary" onClick={() => void handleSeedStarterData()} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed starter data"}
            </button>
          </div>
        </header>

        {loadingError ? <div className="tracker-error tracker-error-banner">{loadingError}</div> : null}
        {loading ? <div className="tracker-loading">Loading tracker data...</div> : null}

        {!loading ? (view === "dashboard" ? renderDashboard() : renderBoard()) : null}

        {!loading && projects.length === 0 ? (
          <section className="tracker-card">
            <h3>Empty workspace</h3>
            <p className="tracker-subtle">Create projects manually or seed starter Portal/Website data for a fast first run.</p>
            <button className="tracker-btn tracker-btn-primary" onClick={() => void handleSeedStarterData()} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed starter data now"}
            </button>
          </section>
        ) : null}

        <TroubleshootingPanel
          lastWrite={lastWrite}
          lastQuery={lastQuery}
          lastGitHubSync={lastGitHubSync}
          lastError={lastError}
          githubCurlHint={githubCurlHint}
        />
      </main>
    </div>
  );
}

/**
 * How to run:
 * - `cd web && npm run dev`
 * Routes:
 * - `/tracker` dashboard
 * - `/tracker/board` kanban board
 */
export default function TrackerApp() {
  return (
    <div className="tracker-theme-memoria" style={PORTAL_THEMES.memoria}>
      <TrackerErrorBoundary>
        <TrackerAppInner />
      </TrackerErrorBoundary>
    </div>
  );
}
