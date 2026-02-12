import { useCallback, useEffect, useMemo, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";

type AgentClient = {
  id: string;
  name: string;
  status: "active" | "suspended" | "revoked";
  trustTier: "low" | "medium" | "high";
  scopes: string[];
  notes: string | null;
  keyPrefix: string | null;
  keyLast4: string | null;
  keyVersion: number;
  createdAtMs: number;
  updatedAtMs: number;
  lastUsedAtMs: number;
  rotatedAtMs: number;
  revokedAtMs: number;
  rateLimits: { perMinute: number; perHour: number };
};

type AgentAudit = {
  id: string;
  actorUid: string;
  action: string;
  clientId: string | null;
  createdAtMs: number;
  metadata: Record<string, unknown> | null;
};

type Props = {
  client: FunctionsClient;
  active: boolean;
  disabled: boolean;
};

type ListClientsResponse = { ok: boolean; clients?: Array<Record<string, unknown>> };
type ListLogsResponse = { ok: boolean; logs?: Array<Record<string, unknown>> };
type UpsertClientResponse = { ok: boolean; client?: Record<string, unknown>; apiKey?: string; warning?: string; message?: string };

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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

function normalizeClient(row: Record<string, unknown>): AgentClient {
  const rawRateLimits = row.rateLimits as { perMinute?: unknown; perHour?: unknown } | undefined;
  return {
    id: str(row.id),
    name: str(row.name),
    status: (str(row.status, "active") as AgentClient["status"]),
    trustTier: (str(row.trustTier, "medium") as AgentClient["trustTier"]),
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((entry): entry is string => typeof entry === "string") : [],
    notes: typeof row.notes === "string" ? row.notes : null,
    keyPrefix: typeof row.keyPrefix === "string" ? row.keyPrefix : null,
    keyLast4: typeof row.keyLast4 === "string" ? row.keyLast4 : null,
    keyVersion: num(row.keyVersion, 1),
    createdAtMs: tsMs(row.createdAt),
    updatedAtMs: tsMs(row.updatedAt),
    lastUsedAtMs: tsMs(row.lastUsedAt),
    rotatedAtMs: tsMs(row.rotatedAt),
    revokedAtMs: tsMs(row.revokedAt),
    rateLimits: {
      perMinute: num(rawRateLimits?.perMinute, 60),
      perHour: num(rawRateLimits?.perHour, 600),
    },
  };
}

function normalizeAudit(row: Record<string, unknown>): AgentAudit {
  return {
    id: str(row.id),
    actorUid: str(row.actorUid),
    action: str(row.action),
    clientId: typeof row.clientId === "string" ? row.clientId : null,
    createdAtMs: tsMs(row.createdAt),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null,
  };
}

export default function AgentOpsModule({ client, active, disabled }: Props) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<AgentClient[]>([]);
  const [audit, setAudit] = useState<AgentAudit[]>([]);
  const [selectedId, setSelectedId] = useState("");

  const [nameDraft, setNameDraft] = useState("");
  const [scopesDraft, setScopesDraft] = useState("quote:write,reserve:write,pay:write,status:read");
  const [trustTierDraft, setTrustTierDraft] = useState<"low" | "medium" | "high">("medium");
  const [notesDraft, setNotesDraft] = useState("");
  const [perMinuteDraft, setPerMinuteDraft] = useState("60");
  const [perHourDraft, setPerHourDraft] = useState("600");
  const [latestKey, setLatestKey] = useState("");

  const [profileName, setProfileName] = useState("");
  const [profileScopes, setProfileScopes] = useState("");
  const [profileTrustTier, setProfileTrustTier] = useState<"low" | "medium" | "high">("medium");
  const [profileNotes, setProfileNotes] = useState("");
  const [profilePerMinute, setProfilePerMinute] = useState("60");
  const [profilePerHour, setProfilePerHour] = useState("600");

  const selected = useMemo(() => clients.find((row) => row.id === selectedId) ?? null, [clients, selectedId]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy || disabled) return;
    setBusy(key);
    setError("");
    setStatus("");
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };

  const load = useCallback(async () => {
    const [clientsResp, logsResp] = await Promise.all([
      client.postJson<ListClientsResponse>("staffListAgentClients", { includeRevoked: true, limit: 200 }),
      client.postJson<ListLogsResponse>("staffListAgentClientAuditLogs", { limit: 80 }),
    ]);

    const rows = Array.isArray(clientsResp.clients) ? clientsResp.clients.map((row) => normalizeClient(row)) : [];
    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    setClients(rows);

    const logs = Array.isArray(logsResp.logs) ? logsResp.logs.map((row) => normalizeAudit(row)) : [];
    logs.sort((a, b) => b.createdAtMs - a.createdAtMs);
    setAudit(logs);

    if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? "");
    }
  }, [client, selectedId]);

  useEffect(() => {
    if (!active || disabled) return;
    void run("loadAgentOps", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled]);

  useEffect(() => {
    if (!selected) return;
    setProfileName(selected.name);
    setProfileScopes(selected.scopes.join(","));
    setProfileTrustTier(selected.trustTier);
    setProfileNotes(selected.notes ?? "");
    setProfilePerMinute(String(selected.rateLimits.perMinute || 60));
    setProfilePerHour(String(selected.rateLimits.perHour || 600));
  }, [selected]);

  const parseScopes = (text: string): string[] =>
    text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const createClient = async () => {
    const resp = await client.postJson<UpsertClientResponse>("staffCreateAgentClient", {
      name: nameDraft.trim(),
      scopes: parseScopes(scopesDraft),
      trustTier: trustTierDraft,
      notes: notesDraft.trim() || null,
      rateLimits: {
        perMinute: Math.max(Number(perMinuteDraft) || 60, 1),
        perHour: Math.max(Number(perHourDraft) || 600, 1),
      },
    });
    setLatestKey(resp.apiKey ?? "");
    await load();
    if (resp.client?.id && typeof resp.client.id === "string") setSelectedId(resp.client.id);
    setStatus(resp.warning ?? "Agent client created.");
  };

  const rotateKey = async () => {
    if (!selected) return;
    const resp = await client.postJson<UpsertClientResponse>("staffRotateAgentClientKey", {
      clientId: selected.id,
      reason: "staff-initiated-rotation",
    });
    setLatestKey(resp.apiKey ?? "");
    await load();
    setStatus(resp.warning ?? "Agent key rotated.");
  };

  const setClientStatus = async (nextStatus: "active" | "suspended" | "revoked") => {
    if (!selected) return;
    await client.postJson("staffUpdateAgentClientStatus", {
      clientId: selected.id,
      status: nextStatus,
      reason: "staff-status-change",
    });
    await load();
    setStatus(`Client status set to ${nextStatus}.`);
  };

  const saveProfile = async () => {
    if (!selected) return;
    await client.postJson("staffUpdateAgentClientProfile", {
      clientId: selected.id,
      name: profileName.trim(),
      scopes: parseScopes(profileScopes),
      trustTier: profileTrustTier,
      notes: profileNotes.trim() || null,
      rateLimits: {
        perMinute: Math.max(Number(profilePerMinute) || 60, 1),
        perHour: Math.max(Number(profilePerHour) || 600, 1),
      },
    });
    await load();
    setStatus("Client profile updated.");
  };

  const copyLatestKey = async () => {
    if (!latestKey) return;
    await navigator.clipboard.writeText(latestKey);
    setStatus("Latest API key copied.");
  };

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Agent Ops</div>
        <button className="btn btn-secondary" disabled={Boolean(busy) || disabled} onClick={() => void run("refreshAgentOps", load)}>
          Refresh
        </button>
      </div>

      <div className="staff-note">
        Agent keys are shown once at creation/rotation and never stored in plaintext.
      </div>
      {status ? <div className="staff-note">{status}</div> : null}
      {error ? <div className="staff-note staff-note-error">{error}</div> : null}

      {latestKey ? (
        <div className="staff-field">
          Latest key (copy now)
          <div className="staff-actions-row">
            <input value={latestKey} readOnly />
            <button className="btn btn-secondary" onClick={() => void copyLatestKey()}>
              Copy
            </button>
          </div>
        </div>
      ) : null}

      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Create agent client</div>
          <label className="staff-field">
            Client name
            <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Studio Fulfillment Agent" />
          </label>
          <label className="staff-field">
            Scopes (comma-separated)
            <input value={scopesDraft} onChange={(event) => setScopesDraft(event.target.value)} />
          </label>
          <div className="staff-actions-row">
            <label className="staff-field" style={{ flex: 1 }}>
              Trust tier
              <select value={trustTierDraft} onChange={(event) => setTrustTierDraft(event.target.value as "low" | "medium" | "high")}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="staff-field" style={{ flex: 1 }}>
              Per-minute limit
              <input value={perMinuteDraft} onChange={(event) => setPerMinuteDraft(event.target.value)} />
            </label>
            <label className="staff-field" style={{ flex: 1 }}>
              Per-hour limit
              <input value={perHourDraft} onChange={(event) => setPerHourDraft(event.target.value)} />
            </label>
          </div>
          <label className="staff-field">
            Notes
            <textarea value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="Optional context for staff" />
          </label>
          <button
            className="btn btn-primary"
            disabled={Boolean(busy) || disabled || !nameDraft.trim() || parseScopes(scopesDraft).length < 1}
            onClick={() => void run("createAgentClient", createClient)}
          >
            Create client
          </button>
        </div>

        <div className="staff-column">
          <div className="staff-subtitle">Registered clients</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Trust</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No agent clients yet.</td>
                  </tr>
                ) : (
                  clients.map((row) => (
                    <tr
                      key={row.id}
                      className={`staff-click-row ${row.id === selectedId ? "active" : ""}`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td>
                        <div>{row.name}</div>
                        <div className="staff-mini">
                          <code>{row.id}</code>
                        </div>
                      </td>
                      <td><span className="pill">{row.status}</span></td>
                      <td>{row.trustTier}</td>
                      <td>{when(row.updatedAtMs)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="staff-column">
          <div className="staff-subtitle">Client details</div>
          {selected ? (
            <>
              <div className="staff-note">
                <strong>{selected.name}</strong><br />
                <span>Status: {selected.status} · Trust: {selected.trustTier}</span><br />
                <span>Key v{selected.keyVersion} · {selected.keyPrefix ?? "--"}...{selected.keyLast4 ?? "----"}</span><br />
                <span>Last used: {when(selected.lastUsedAtMs)} · Rotated: {when(selected.rotatedAtMs)}</span>
              </div>
              <div className="staff-actions-row">
                <button className="btn btn-secondary" disabled={Boolean(busy) || disabled || selected.status === "revoked"} onClick={() => void run("rotateAgentKey", rotateKey)}>
                  Rotate key
                </button>
                <button className="btn btn-secondary" disabled={Boolean(busy) || disabled || selected.status === "active"} onClick={() => void run("activateAgent", async () => setClientStatus("active"))}>
                  Set active
                </button>
                <button className="btn btn-secondary" disabled={Boolean(busy) || disabled || selected.status === "suspended" || selected.status === "revoked"} onClick={() => void run("suspendAgent", async () => setClientStatus("suspended"))}>
                  Suspend
                </button>
                <button className="btn btn-secondary" disabled={Boolean(busy) || disabled || selected.status === "revoked"} onClick={() => void run("revokeAgent", async () => setClientStatus("revoked"))}>
                  Revoke
                </button>
              </div>

              <label className="staff-field">
                Name
                <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
              <label className="staff-field">
                Scopes (comma-separated)
                <input value={profileScopes} onChange={(event) => setProfileScopes(event.target.value)} />
              </label>
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 1 }}>
                  Trust tier
                  <select value={profileTrustTier} onChange={(event) => setProfileTrustTier(event.target.value as "low" | "medium" | "high")}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="staff-field" style={{ flex: 1 }}>
                  Per-minute limit
                  <input value={profilePerMinute} onChange={(event) => setProfilePerMinute(event.target.value)} />
                </label>
                <label className="staff-field" style={{ flex: 1 }}>
                  Per-hour limit
                  <input value={profilePerHour} onChange={(event) => setProfilePerHour(event.target.value)} />
                </label>
              </div>
              <label className="staff-field">
                Notes
                <textarea value={profileNotes} onChange={(event) => setProfileNotes(event.target.value)} />
              </label>
              <button
                className="btn btn-primary"
                disabled={Boolean(busy) || disabled || !profileName.trim() || parseScopes(profileScopes).length < 1}
                onClick={() => void run("saveAgentProfile", saveProfile)}
              >
                Save profile
              </button>
            </>
          ) : (
            <div className="staff-note">Select a client to inspect and update.</div>
          )}
        </div>
      </div>

      <div className="staff-subtitle">Audit log</div>
      <div className="staff-log-list">
        {audit.length === 0 ? (
          <div className="staff-note">No agent client audit events yet.</div>
        ) : (
          audit.slice(0, 40).map((entry) => (
            <div key={entry.id} className="staff-log-entry">
              <div className="staff-log-meta">
                <span className="staff-log-label">{entry.action}</span>
                <span>{when(entry.createdAtMs)}</span>
              </div>
              <div className="staff-log-message">
                <code>{entry.actorUid || "-"}</code> · client: <code>{entry.clientId || "-"}</code>
                {entry.metadata ? <pre>{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
