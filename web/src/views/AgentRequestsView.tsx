import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import "./AgentRequestsView.css";

type RequestKind = "firing" | "pickup" | "delivery" | "shipping" | "commission" | "x1c_print" | "other";
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
  commissionOrderId: string | null;
  commissionPaymentStatus: string | null;
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
type AgentCheckoutResponse = {
  ok: boolean;
  message?: string;
  checkoutUrl?: string | null;
  sessionId?: string | null;
};

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
      rawKind === "x1c_print" ||
      rawKind === "other"
        ? rawKind
        : "other",
    linkedBatchId: typeof row.linkedBatchId === "string" ? row.linkedBatchId : null,
    logisticsMode: typeof logistics.mode === "string" ? logistics.mode : null,
    createdAtMs: tsMs(row.createdAt),
    updatedAtMs: tsMs(row.updatedAt),
    commissionOrderId: typeof row.commissionOrderId === "string" ? row.commissionOrderId : null,
    commissionPaymentStatus: typeof row.commissionPaymentStatus === "string" ? row.commissionPaymentStatus : null,
  };
}

function sanitizeLastRequest(request: LastRequest | null) {
  if (!request) return null;
  return {
    ...request,
    payload: (request as { payloadRedacted?: unknown }).payloadRedacted ?? request.payload,
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
  const [rightsAttested, setRightsAttested] = useState(false);
  const [intendedUse, setIntendedUse] = useState("");
  const [x1cFileType, setX1cFileType] = useState("3mf");
  const [x1cMaterialProfile, setX1cMaterialProfile] = useState("pla");
  const [x1cDimX, setX1cDimX] = useState("120");
  const [x1cDimY, setX1cDimY] = useState("120");
  const [x1cDimZ, setX1cDimZ] = useState("120");
  const [x1cQuantity, setX1cQuantity] = useState("1");
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
      rightsAttested,
      intendedUse: intendedUse.trim() || null,
      x1cFileType: kind === "x1c_print" ? x1cFileType : null,
      x1cMaterialProfile: kind === "x1c_print" ? x1cMaterialProfile : null,
      x1cDimensionsMm:
        kind === "x1c_print"
          ? {
              x: Number(x1cDimX) || 0,
              y: Number(x1cDimY) || 0,
              z: Number(x1cDimZ) || 0,
            }
          : null,
      x1cQuantity: kind === "x1c_print" ? Number(x1cQuantity) || 0 : null,
      metadata: {
        source: "portal_member_requests",
      },
    });
    if (!resp.ok) throw new Error(resp.message ?? "Unable to create request.");
    setTitle("");
    setSummary("");
    setNotes("");
    setIntendedUse("");
    setRightsAttested(false);
    await load();
    setStatus(`Request created (${resp.data?.agentRequestId ?? "ok"}). Staff will triage it soon.`);
  };
  const openCommissionCheckout = async (orderId: string) => {
    const resp = await client.postJson<AgentCheckoutResponse>("createAgentCheckoutSession", {
      orderId,
    });
    if (!resp.ok) throw new Error(resp.message ?? "Unable to create checkout session.");
    const checkoutUrl = typeof resp.checkoutUrl === "string" ? resp.checkoutUrl : "";
    if (!checkoutUrl) throw new Error("Checkout URL was not returned.");
    window.location.assign(checkoutUrl);
  };

  const filtered = useMemo(
    () => requests.filter((row) => (statusFilter === "all" ? true : row.status === statusFilter)),
    [requests, statusFilter]
  );
  const x1cInputValid =
    kind !== "x1c_print" ||
    (Number(x1cDimX) > 0 &&
      Number(x1cDimY) > 0 &&
      Number(x1cDimZ) > 0 &&
      Number(x1cDimX) <= 256 &&
      Number(x1cDimY) <= 256 &&
      Number(x1cDimZ) <= 256 &&
      Number(x1cQuantity) >= 1 &&
      Number(x1cQuantity) <= 20);

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
              <option value="x1c_print">X1C print</option>
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
        {kind === "commission" ? (
          <>
            <label className="requests-field">
              Intended use
              <input
                value={intendedUse}
                onChange={(event) => setIntendedUse(event.target.value)}
                placeholder="Personal studio use, resale line, educational kit, etc."
              />
            </label>
            <label className="requests-field requests-check">
              <input
                type="checkbox"
                checked={rightsAttested}
                onChange={(event) => setRightsAttested(event.target.checked)}
              />
              <span>I confirm I have rights/permission to request this commission work.</span>
            </label>
          </>
        ) : null}
        {kind === "x1c_print" ? (
          <>
            <div className="requests-grid">
              <label className="requests-field">
                File type
                <select value={x1cFileType} onChange={(event) => setX1cFileType(event.target.value)}>
                  <option value="3mf">3mf</option>
                  <option value="stl">stl</option>
                  <option value="step">step</option>
                </select>
              </label>
              <label className="requests-field">
                Material profile
                <select value={x1cMaterialProfile} onChange={(event) => setX1cMaterialProfile(event.target.value)}>
                  <option value="pla">pla</option>
                  <option value="petg">petg</option>
                  <option value="abs">abs</option>
                  <option value="asa">asa</option>
                  <option value="pa_cf">pa_cf</option>
                  <option value="tpu">tpu</option>
                </select>
              </label>
            </div>
            <div className="requests-grid">
              <label className="requests-field">
                X (mm)
                <input value={x1cDimX} onChange={(event) => setX1cDimX(event.target.value)} />
              </label>
              <label className="requests-field">
                Y (mm)
                <input value={x1cDimY} onChange={(event) => setX1cDimY(event.target.value)} />
              </label>
              <label className="requests-field">
                Z (mm)
                <input value={x1cDimZ} onChange={(event) => setX1cDimZ(event.target.value)} />
              </label>
              <label className="requests-field">
                Quantity
                <input value={x1cQuantity} onChange={(event) => setX1cQuantity(event.target.value)} />
              </label>
            </div>
          </>
        ) : null}
        <div className="requests-actions">
          <button
            className="btn btn-primary"
            disabled={Boolean(busy) || !title.trim() || (kind === "commission" && !rightsAttested) || !x1cInputValid}
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
                  <th>Payment</th>
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
                      {row.kind === "commission" ? (
                        row.commissionOrderId ? (
                          <>
                            <div className="requests-mini">{row.commissionPaymentStatus || "checkout_pending"}</div>
                            {row.commissionPaymentStatus !== "paid" ? (
                              <button
                                className="btn btn-secondary"
                                disabled={Boolean(busy)}
                                onClick={() => void run(`commissionCheckout:${row.id}`, () => openCommissionCheckout(row.commissionOrderId as string))}
                              >
                                Open checkout
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <span className="requests-mini">Awaiting staff checkout link</span>
                        )
                      ) : (
                        <span className="requests-mini">n/a</span>
                      )}
                    </td>
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
          <pre>{JSON.stringify(sanitizeLastRequest(lastRequest), null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}
