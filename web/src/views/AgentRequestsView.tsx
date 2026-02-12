import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import "./AgentRequestsView.css";

type RequestKind = "firing" | "pickup" | "delivery" | "shipping" | "commission" | "other";
type RequestStatus = "new" | "triaged" | "accepted" | "in_progress" | "ready" | "fulfilled" | "rejected" | "cancelled";

type RequestRecord = {
  id: string;
  title: string;
  summary: string | null;
  notes: string | null;
  kind: RequestKind;
  status: RequestStatus;
  linkedBatchId: string | null;
  logisticsMode: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

type ApiV1Envelope<TData> = {
  ok: boolean;
  requestId?: string;
  code?: string;
  message?: string;
  data?: TData;
};

type ListMineResponse = ApiV1Envelope<{ requests?: Array<Record<string, unknown>> }>;
type CreateResponse = ApiV1Envelope<{ agentRequestId?: string; status?: RequestStatus }>;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function tsMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object") {
    const maybe = v as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") {
      return Math.floor(maybe.seconds * 1000 + (typeof maybe.nanoseconds === "number" ? maybe.nanoseconds : 0) / 1_000_000);
    }
  }
  return 0;
}

function when(ms: number): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function normalizeRequest(row: Record<string, unknown>): RequestRecord {
  const rawStatus = str(row.status, "new");
  const rawKind = str(row.kind, "other");
  const logistics = row.logistics && typeof row.logistics === "object" ? (row.logistics as Record<string, unknown>) : {};
  return {
    id: str(row.id),
    title: str(row.title),
    summary: typeof row.summary === "string" ? row.summary : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    status:
      rawStatus === "new" ||
      rawStatus === "triaged" ||
      rawStatus === "accepted" ||
      rawStatus === "in_progress" ||
      rawStatus === "ready" ||
      rawStatus === "fulfilled" ||
      rawStatus === "rejected" ||
      rawStatus === "cancelled"
        ? rawStatus
        : "new",
    kind:
      rawKind === "firing" ||
      rawKind === "pickup" ||
      rawKind === "delivery" ||
      rawKind === "shipping" ||
      rawKind === "commission" ||
      rawKind === "other"
        ? rawKind
        : "other",
    linkedBatchId: typeof row.linkedBatchId === "string" ? row.linkedBatchId : null,
    logisticsMode: typeof logistics.mode === "string" ? logistics.mode : null,
    createdAtMs: tsMs(row.createdAt),
    updatedAtMs: tsMs(row.updatedAt),
  };
}

export default function AgentRequestsView({
  user,
  functionsBaseUrl,
}: {
  user: User;
  functionsBaseUrl: string;
}) {
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [kind, setKind] = useState<RequestKind>("firing");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [logisticsMode, setLogisticsMode] = useState("dropoff");
  const [statusFilter, setStatusFilter] = useState<"all" | RequestStatus>("all");

  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: functionsBaseUrl,
        getIdToken: async () => await user.getIdToken(),
        onLastRequest: setLastRequest,
      }),
    [functionsBaseUrl, user]
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setStatus("");
    setError("");
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const load = useCallback(async () => {
    const resp = await client.postJson<ListMineResponse>("apiV1/v1/agent.requests.listMine", {
      limit: 100,
      includeClosed: true,
    });
    const rows = Array.isArray(resp.data?.requests)
      ? resp.data.requests
          .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
          .map((row) => normalizeRequest(row))
      : [];
    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    setRequests(rows);
  }, [client]);

  useEffect(() => {
    void run("loadRequests", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const createRequest = async () => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error("Title is required.");
    const resp = await client.postJson<CreateResponse>("apiV1/v1/agent.requests.create", {
      kind,
      title: cleanTitle,
      summary: summary.trim() || null,
      notes: notes.trim() || null,
      logisticsMode: logisticsMode.trim() || null,
      metadata: {
        source: "portal_member_requests",
      },
    });
    if (!resp.ok) throw new Error(resp.message ?? "Unable to create request.");
    setTitle("");
    setSummary("");
    setNotes("");
    await load();
    setStatus(`Request created (${resp.data?.agentRequestId ?? "ok"}). Staff will triage it soon.`);
  };

  const filtered = useMemo(
    () => requests.filter((row) => (statusFilter === "all" ? true : row.status === statusFilter)),
    [requests, statusFilter]
  );

  return (
    <div className="page requests-page">
      <div className="page-header">
        <div>
          <h1>Requests</h1>
          <p className="page-subtitle">
            Ask the studio to handle firing, pickup, delivery, shipping, or other operational help.
          </p>
        </div>
      </div>

      <section className="card card-3d requests-card">
        <div className="card-title">Create request</div>
        <p className="requests-copy">
          Requests are reviewed by staff before physical work starts. Add enough detail for accurate triage.
        </p>
        <div className="requests-grid">
          <label className="requests-field">
            Kind
            <select value={kind} onChange={(event) => setKind(event.target.value as RequestKind)}>
              <option value="firing">Firing</option>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
              <option value="shipping">Shipping</option>
              <option value="commission">Commission</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="requests-field">
            Logistics mode
            <select value={logisticsMode} onChange={(event) => setLogisticsMode(event.target.value)}>
              <option value="dropoff">dropoff</option>
              <option value="pickup">pickup</option>
              <option value="ship_in">ship_in</option>
              <option value="ship_out">ship_out</option>
              <option value="local_delivery">local_delivery</option>
            </select>
          </label>
        </div>
        <label className="requests-field">
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Need bisque firing for cone 06 set" />
        </label>
        <label className="requests-field">
          Summary
          <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="2 half shelves, dropoff Thursday." />
        </label>
        <label className="requests-field">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} placeholder="Special handling constraints and timing." />
        </label>
        <div className="requests-actions">
          <button
            className="btn btn-primary"
            disabled={Boolean(busy) || !title.trim()}
            onClick={() => void run("createRequest", createRequest)}
          >
            {busy === "createRequest" ? "Creating..." : "Submit request"}
          </button>
          <button className="btn btn-secondary" disabled={Boolean(busy)} onClick={() => void run("refreshRequests", load)}>
            Refresh list
          </button>
        </div>
        {status ? (
          <div className="notice" role="status" aria-live="polite">
            {status}
          </div>
        ) : null}
        {error ? (
          <div className="alert" role="alert" aria-live="assertive">
            {error}
          </div>
        ) : null}
      </section>

      <section className="card card-3d requests-card">
        <div className="card-title-row">
          <div className="card-title">My request queue</div>
          <label className="requests-field requests-filter">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | RequestStatus)}>
              <option value="all">All statuses</option>
              <option value="new">new</option>
              <option value="triaged">triaged</option>
              <option value="accepted">accepted</option>
              <option value="in_progress">in_progress</option>
              <option value="ready">ready</option>
              <option value="fulfilled">fulfilled</option>
              <option value="rejected">rejected</option>
              <option value="cancelled">cancelled</option>
            </select>
          </label>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state">No requests yet.</div>
        ) : (
          <div className="requests-table">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Status</th>
                  <th>Kind</th>
                  <th>Batch</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.title || "(untitled request)"}</div>
                      <div className="requests-mini">
                        <code>{row.id}</code>
                      </div>
                    </td>
                    <td><span className="pill">{row.status}</span></td>
                    <td>{row.kind}</td>
                    <td>
                      <code>{row.linkedBatchId || "-"}</code>
                    </td>
                    <td>{when(row.updatedAtMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lastRequest ? (
        <details className="card card-3d requests-card requests-troubleshooting">
          <summary>Troubleshooting (last request)</summary>
          <pre>{JSON.stringify(lastRequest, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
