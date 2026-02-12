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
  spendingLimits: { orderMaxCents: number; maxOrdersPerHour: number };
};

type AgentAudit = {
  id: string;
  actorUid: string;
  action: string;
  clientId: string | null;
  createdAtMs: number;
  metadata: Record<string, unknown> | null;
};

type AgentCatalogService = {
  id: string;
  title: string;
  category: "kiln" | "consult" | "x1c" | "other";
  enabled: boolean;
  basePriceCents: number;
  currency: string;
  priceId: string | null;
  productId: string | null;
  leadTimeDays: number;
  maxQuantity: number;
  riskLevel: "low" | "medium" | "high";
  requiresManualReview: boolean;
  notes: string | null;
};

type AgentCatalogConfig = {
  pricingMode: "test" | "live";
  defaultCurrency: string;
  featureFlags: {
    quoteEnabled: boolean;
    reserveEnabled: boolean;
    payEnabled: boolean;
    statusEnabled: boolean;
  };
  services: AgentCatalogService[];
};

type Props = {
  client: FunctionsClient;
  active: boolean;
  disabled: boolean;
};

type ListClientsResponse = { ok: boolean; clients?: Array<Record<string, unknown>> };
type ListLogsResponse = { ok: boolean; logs?: Array<Record<string, unknown>> };
type UpsertClientResponse = { ok: boolean; client?: Record<string, unknown>; apiKey?: string; warning?: string; message?: string };
type CatalogResponse = {
  ok: boolean;
  config?: Record<string, unknown>;
  audit?: Array<Record<string, unknown>>;
};
type OpsResponse = {
  ok: boolean;
  snapshot?: Record<string, unknown>;
  quotes?: Array<Record<string, unknown>>;
  reservations?: Array<Record<string, unknown>>;
  orders?: Array<Record<string, unknown>>;
  audit?: Array<Record<string, unknown>>;
  riskByClient?: Record<
    string,
    {
      total?: number;
      quoteLimit?: number;
      payLimit?: number;
      velocity?: number;
    }
  >;
};
type AgentOpsConfigResponse = {
  ok: boolean;
  config?: {
    enabled?: boolean;
    allowPayments?: boolean;
  };
};

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
  const rawSpendingLimits = row.spendingLimits as { orderMaxCents?: unknown; maxOrdersPerHour?: unknown } | undefined;
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
    spendingLimits: {
      orderMaxCents: num(rawSpendingLimits?.orderMaxCents, 75_000),
      maxOrdersPerHour: num(rawSpendingLimits?.maxOrdersPerHour, 30),
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

function toCatalogService(row: Record<string, unknown>): AgentCatalogService {
  const category = str(row.category, "other");
  const risk = str(row.riskLevel, "medium");
  return {
    id: str(row.id),
    title: str(row.title),
    category:
      category === "kiln" || category === "consult" || category === "x1c" || category === "other"
        ? category
        : "other",
    enabled: row.enabled === true,
    basePriceCents: num(row.basePriceCents, 0),
    currency: str(row.currency, "USD") || "USD",
    priceId: typeof row.priceId === "string" ? row.priceId : null,
    productId: typeof row.productId === "string" ? row.productId : null,
    leadTimeDays: num(row.leadTimeDays, 0),
    maxQuantity: num(row.maxQuantity, 1),
    riskLevel: risk === "low" || risk === "medium" || risk === "high" ? risk : "medium",
    requiresManualReview: row.requiresManualReview === true,
    notes: typeof row.notes === "string" ? row.notes : null,
  };
}

function toCatalogConfig(row: Record<string, unknown>): AgentCatalogConfig {
  const featureFlagsRaw = row.featureFlags as Record<string, unknown> | undefined;
  const pricingModeRaw = str(row.pricingMode, "test");
  const servicesRaw = Array.isArray(row.services) ? row.services : [];
  return {
    pricingMode: pricingModeRaw === "live" ? "live" : "test",
    defaultCurrency: str(row.defaultCurrency, "USD") || "USD",
    featureFlags: {
      quoteEnabled: featureFlagsRaw?.quoteEnabled !== false,
      reserveEnabled: featureFlagsRaw?.reserveEnabled !== false,
      payEnabled: featureFlagsRaw?.payEnabled !== false,
      statusEnabled: featureFlagsRaw?.statusEnabled !== false,
    },
    services: servicesRaw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => toCatalogService(entry)),
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
  const [scopesDraft, setScopesDraft] = useState("catalog:read,quote:write,reserve:write,pay:write,status:read");
  const [trustTierDraft, setTrustTierDraft] = useState<"low" | "medium" | "high">("medium");
  const [notesDraft, setNotesDraft] = useState("");
  const [perMinuteDraft, setPerMinuteDraft] = useState("60");
  const [perHourDraft, setPerHourDraft] = useState("600");
  const [orderMaxCentsDraft, setOrderMaxCentsDraft] = useState("75000");
  const [maxOrdersPerHourDraft, setMaxOrdersPerHourDraft] = useState("30");
  const [latestKey, setLatestKey] = useState("");

  const [profileName, setProfileName] = useState("");
  const [profileScopes, setProfileScopes] = useState("");
  const [profileTrustTier, setProfileTrustTier] = useState<"low" | "medium" | "high">("medium");
  const [profileNotes, setProfileNotes] = useState("");
  const [profilePerMinute, setProfilePerMinute] = useState("60");
  const [profilePerHour, setProfilePerHour] = useState("600");
  const [profileOrderMaxCents, setProfileOrderMaxCents] = useState("75000");
  const [profileMaxOrdersPerHour, setProfileMaxOrdersPerHour] = useState("30");
  const [delegatedScopesDraft, setDelegatedScopesDraft] = useState(
    "catalog:read,quote:write,reserve:write,pay:write,status:read"
  );
  const [delegatedTtlDraft, setDelegatedTtlDraft] = useState("300");
  const [delegatedAudienceDraft, setDelegatedAudienceDraft] = useState("monsoonfire-agent-v1");
  const [delegatedPrincipalDraft, setDelegatedPrincipalDraft] = useState("");
  const [latestDelegatedToken, setLatestDelegatedToken] = useState("");
  const [catalogConfig, setCatalogConfig] = useState<AgentCatalogConfig | null>(null);
  const [catalogAudit, setCatalogAudit] = useState<Array<Record<string, unknown>>>([]);
  const [catalogJsonDraft, setCatalogJsonDraft] = useState("");
  const [opsSnapshot, setOpsSnapshot] = useState<Record<string, unknown> | null>(null);
  const [opsQuotes, setOpsQuotes] = useState<Array<Record<string, unknown>>>([]);
  const [opsReservations, setOpsReservations] = useState<Array<Record<string, unknown>>>([]);
  const [opsOrders, setOpsOrders] = useState<Array<Record<string, unknown>>>([]);
  const [riskByClient, setRiskByClient] = useState<Record<string, { total: number; quoteLimit: number; payLimit: number; velocity: number }>>({});
  const [orderNextStatus, setOrderNextStatus] = useState<Record<string, string>>({});
  const [agentApiEnabled, setAgentApiEnabled] = useState(true);
  const [agentPaymentsEnabled, setAgentPaymentsEnabled] = useState(true);

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
    const [clientsResp, logsResp, catalogResp, opsResp, opsConfigResp] = await Promise.all([
      client.postJson<ListClientsResponse>("staffListAgentClients", { includeRevoked: true, limit: 200 }),
      client.postJson<ListLogsResponse>("staffListAgentClientAuditLogs", { limit: 80 }),
      client.postJson<CatalogResponse>("staffGetAgentServiceCatalog", {}),
      client.postJson<OpsResponse>("staffListAgentOperations", { limit: 60 }),
      client.postJson<AgentOpsConfigResponse>("staffGetAgentOpsConfig", {}),
    ]);

    const rows = Array.isArray(clientsResp.clients) ? clientsResp.clients.map((row) => normalizeClient(row)) : [];
    rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    setClients(rows);

    const logs = Array.isArray(logsResp.logs) ? logsResp.logs.map((row) => normalizeAudit(row)) : [];
    logs.sort((a, b) => b.createdAtMs - a.createdAtMs);
    setAudit(logs);

    const rawConfig = catalogResp.config && typeof catalogResp.config === "object" ? catalogResp.config : null;
    const nextCatalog = rawConfig ? toCatalogConfig(rawConfig) : null;
    setCatalogConfig(nextCatalog);
    setCatalogJsonDraft(nextCatalog ? JSON.stringify(nextCatalog, null, 2) : "");
    setCatalogAudit(Array.isArray(catalogResp.audit) ? catalogResp.audit : []);

    setOpsSnapshot(opsResp.snapshot && typeof opsResp.snapshot === "object" ? opsResp.snapshot : null);
    setOpsQuotes(Array.isArray(opsResp.quotes) ? opsResp.quotes : []);
    setOpsReservations(Array.isArray(opsResp.reservations) ? opsResp.reservations : []);
    setOpsOrders(Array.isArray(opsResp.orders) ? opsResp.orders : []);
    if (opsResp.riskByClient && typeof opsResp.riskByClient === "object") {
      const next: Record<string, { total: number; quoteLimit: number; payLimit: number; velocity: number }> = {};
      for (const [clientId, value] of Object.entries(opsResp.riskByClient)) {
        next[clientId] = {
          total: num(value?.total, 0),
          quoteLimit: num(value?.quoteLimit, 0),
          payLimit: num(value?.payLimit, 0),
          velocity: num(value?.velocity, 0),
        };
      }
      setRiskByClient(next);
    } else {
      setRiskByClient({});
    }

    setAgentApiEnabled(opsConfigResp.config?.enabled !== false);
    setAgentPaymentsEnabled(opsConfigResp.config?.allowPayments !== false);

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
    setProfileOrderMaxCents(String(selected.spendingLimits.orderMaxCents || 75_000));
    setProfileMaxOrdersPerHour(String(selected.spendingLimits.maxOrdersPerHour || 30));
    setDelegatedScopesDraft(selected.scopes.length ? selected.scopes.join(",") : "catalog:read,quote:write,status:read");
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
      spendingLimits: {
        orderMaxCents: Math.max(Number(orderMaxCentsDraft) || 75_000, 100),
        maxOrdersPerHour: Math.max(Number(maxOrdersPerHourDraft) || 30, 1),
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
      spendingLimits: {
        orderMaxCents: Math.max(Number(profileOrderMaxCents) || 75_000, 100),
        maxOrdersPerHour: Math.max(Number(profileMaxOrdersPerHour) || 30, 1),
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

  const issueDelegatedToken = async () => {
    if (!selected) return;
    const ttlSeconds = Math.max(30, Math.min(Number(delegatedTtlDraft) || 300, 600));
    const resp = await client.postJson<{ ok: boolean; delegatedToken?: string; message?: string }>(
      "createDelegatedAgentToken",
      {
        agentClientId: selected.id,
        scopes: parseScopes(delegatedScopesDraft),
        ttlSeconds,
        audience: delegatedAudienceDraft.trim() || null,
        principalUid: delegatedPrincipalDraft.trim() || null,
      }
    );
    if (!resp.ok || !resp.delegatedToken) {
      throw new Error(resp.message ?? "Failed to issue delegated token.");
    }
    setLatestDelegatedToken(resp.delegatedToken);
    setStatus("Delegated token issued.");
  };

  const saveCatalogConfig = async () => {
    const parsed = JSON.parse(catalogJsonDraft) as Record<string, unknown>;
    const body: Record<string, unknown> = {};
    if (typeof parsed.pricingMode === "string") body.pricingMode = parsed.pricingMode;
    if (typeof parsed.defaultCurrency === "string") body.defaultCurrency = parsed.defaultCurrency;
    if (parsed.featureFlags && typeof parsed.featureFlags === "object") {
      body.featureFlags = parsed.featureFlags;
    }
    if (Array.isArray(parsed.services)) {
      body.services = parsed.services;
    }

    await client.postJson("staffUpdateAgentServiceCatalog", body);
    await load();
    setStatus("Agent service catalog updated.");
  };

  const reviewReservation = async (reservationId: string, decision: "approve" | "reject") => {
    await client.postJson("staffReviewAgentReservation", {
      reservationId,
      decision,
      reason: decision === "reject" ? "Rejected by staff review" : "Approved by staff review",
    });
    await load();
    setStatus(`Reservation ${reservationId} ${decision}d.`);
  };

  const saveAgentOpsConfig = async () => {
    await client.postJson("staffUpdateAgentOpsConfig", {
      enabled: agentApiEnabled,
      allowPayments: agentPaymentsEnabled,
    });
    await load();
    setStatus("Agent ops controls updated.");
  };

  const updateOrderFulfillment = async (orderId: string) => {
    const toStatus = (orderNextStatus[orderId] ?? "").trim();
    if (!toStatus) throw new Error("Select a fulfillment status first.");
    await client.postJson("staffUpdateAgentOrderFulfillment", {
      orderId,
      toStatus,
    });
    await load();
    setStatus(`Order ${orderId} moved to ${toStatus}.`);
  };

  const copyDelegatedToken = async () => {
    if (!latestDelegatedToken) return;
    await navigator.clipboard.writeText(latestDelegatedToken);
    setStatus("Delegated token copied.");
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
      <div className="staff-actions-row">
        <label className="staff-field" style={{ flex: 1 }}>
          <span>Agent API enabled</span>
          <input
            type="checkbox"
            checked={agentApiEnabled}
            onChange={(event) => setAgentApiEnabled(event.target.checked)}
          />
        </label>
        <label className="staff-field" style={{ flex: 1 }}>
          <span>Agent payments enabled</span>
          <input
            type="checkbox"
            checked={agentPaymentsEnabled}
            onChange={(event) => setAgentPaymentsEnabled(event.target.checked)}
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled}
          onClick={() => void run("saveAgentOpsConfig", saveAgentOpsConfig)}
        >
          Save controls
        </button>
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

      {latestDelegatedToken ? (
        <div className="staff-field">
          Latest delegated token (copy now)
          <div className="staff-actions-row">
            <input value={latestDelegatedToken} readOnly />
            <button className="btn btn-secondary" onClick={() => void copyDelegatedToken()}>
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
          <div className="staff-actions-row">
            <label className="staff-field" style={{ flex: 1 }}>
              Max order cents
              <input value={orderMaxCentsDraft} onChange={(event) => setOrderMaxCentsDraft(event.target.value)} />
            </label>
            <label className="staff-field" style={{ flex: 1 }}>
              Max orders / hour
              <input value={maxOrdersPerHourDraft} onChange={(event) => setMaxOrdersPerHourDraft(event.target.value)} />
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
                  <th>Risk hits</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No agent clients yet.</td>
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
                      <td>
                        {riskByClient[row.id]?.total ? (
                          <span className="pill">
                            {riskByClient[row.id].total} ({riskByClient[row.id].quoteLimit}Q/{riskByClient[row.id].payLimit}P/{riskByClient[row.id].velocity}V)
                          </span>
                        ) : (
                          <span className="staff-mini">0</span>
                        )}
                      </td>
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
                <br />
                <span>
                  Spending: max {selected.spendingLimits.orderMaxCents} cents · {selected.spendingLimits.maxOrdersPerHour}/hr
                </span>
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
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 1 }}>
                  Max order cents
                  <input value={profileOrderMaxCents} onChange={(event) => setProfileOrderMaxCents(event.target.value)} />
                </label>
                <label className="staff-field" style={{ flex: 1 }}>
                  Max orders / hour
                  <input value={profileMaxOrdersPerHour} onChange={(event) => setProfileMaxOrdersPerHour(event.target.value)} />
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

              <div className="staff-subtitle">Issue delegated token</div>
              <label className="staff-field">
                Principal UID (optional; default is your UID)
                <input value={delegatedPrincipalDraft} onChange={(event) => setDelegatedPrincipalDraft(event.target.value)} placeholder="uid_override_optional" />
              </label>
              <label className="staff-field">
                Delegated scopes (comma-separated)
                <input value={delegatedScopesDraft} onChange={(event) => setDelegatedScopesDraft(event.target.value)} />
              </label>
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 1 }}>
                  TTL seconds (30-600)
                  <input value={delegatedTtlDraft} onChange={(event) => setDelegatedTtlDraft(event.target.value)} />
                </label>
                <label className="staff-field" style={{ flex: 1 }}>
                  Audience
                  <input value={delegatedAudienceDraft} onChange={(event) => setDelegatedAudienceDraft(event.target.value)} />
                </label>
              </div>
              <button
                className="btn btn-secondary"
                disabled={Boolean(busy) || disabled || parseScopes(delegatedScopesDraft).length < 1}
                onClick={() => void run("issueDelegatedToken", issueDelegatedToken)}
              >
                Issue delegated token
              </button>
            </>
          ) : (
            <div className="staff-note">Select a client to inspect and update.</div>
          )}
        </div>
      </div>

      <div className="staff-subtitle">Agent service catalog</div>
      <div className="staff-note">
        This controls what agents can quote/reserve/pay against. Keep `pricingMode` in `test` until Stripe test flows pass.
      </div>
      <label className="staff-field">
        Catalog JSON
        <textarea
          value={catalogJsonDraft}
          onChange={(event) => setCatalogJsonDraft(event.target.value)}
          rows={14}
          placeholder="Catalog configuration JSON"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
      </label>
      <div className="staff-actions-row">
        <button
          className="btn btn-primary"
          disabled={Boolean(busy) || disabled || !catalogJsonDraft.trim()}
          onClick={() => void run("saveAgentCatalog", saveCatalogConfig)}
        >
          Save catalog config
        </button>
      </div>
      {catalogConfig ? (
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Category</th>
                <th>Price</th>
                <th>Risk</th>
                <th>Review</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {catalogConfig.services.length === 0 ? (
                <tr>
                  <td colSpan={6}>No catalog services configured.</td>
                </tr>
              ) : (
                catalogConfig.services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <div>{service.title}</div>
                      <div className="staff-mini">
                        <code>{service.id}</code>
                      </div>
                    </td>
                    <td>{service.category}</td>
                    <td>
                      {(service.basePriceCents / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: service.currency || catalogConfig.defaultCurrency || "USD",
                      })}
                    </td>
                    <td><span className="pill">{service.riskLevel}</span></td>
                    <td>{service.requiresManualReview ? "Required" : "Auto"}</td>
                    <td>{service.enabled ? "Yes" : "No"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="staff-note">Catalog not loaded yet.</div>
      )}

      <div className="staff-subtitle">Catalog audit log</div>
      <div className="staff-log-list">
        {catalogAudit.length === 0 ? (
          <div className="staff-note">No catalog audit events yet.</div>
        ) : (
          catalogAudit.slice(0, 20).map((entry, idx) => (
            <div key={`${str(entry.id, `catalog-audit-${idx}`)}-${idx}`} className="staff-log-entry">
              <div className="staff-log-meta">
                <span className="staff-log-label">{str(entry.action, "catalog_event")}</span>
                <span>{when(tsMs(entry.createdAt))}</span>
              </div>
              <div className="staff-log-message">
                <code>{str(entry.actorUid, "-")}</code>
                {entry.metadata ? <pre>{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="staff-subtitle">Operations feed</div>
      {opsSnapshot ? (
        <div className="staff-actions-row">
          <div className="pill">Quotes: {num(opsSnapshot.quotes, 0)}</div>
          <div className="pill">Reservations: {num(opsSnapshot.reservations, 0)}</div>
          <div className="pill">Orders: {num(opsSnapshot.orders, 0)}</div>
          <div className="pill">Audit: {num(opsSnapshot.auditEvents, 0)}</div>
          <div className="pill">Risk denials: {num(opsSnapshot.riskDeniedEvents, 0)}</div>
        </div>
      ) : null}

      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-subtitle">Recent quotes</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {opsQuotes.slice(0, 8).map((row) => (
                  <tr key={str(row.id)}>
                    <td><code>{str(row.id)}</code></td>
                    <td>{str(row.serviceTitle, str(row.serviceId, "-"))}</td>
                    <td>{str(row.status, "-")}</td>
                    <td>
                      {((num(row.subtotalCents, 0) || 0) / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: str(row.currency, "USD"),
                      })}
                    </td>
                  </tr>
                ))}
                {opsQuotes.length === 0 ? (
                  <tr><td colSpan={4}>No quotes yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Recent reservations</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Reservation</th>
                  <th>Quote</th>
                  <th>Status</th>
                  <th>Review</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {opsReservations.slice(0, 8).map((row) => (
                  <tr key={str(row.id)}>
                    <td><code>{str(row.id)}</code></td>
                    <td><code>{str(row.quoteId, "-")}</code></td>
                    <td>{str(row.status, "-")}</td>
                    <td>{row.requiresManualReview === true ? "Required" : "Auto"}</td>
                    <td>
                      {str(row.status) === "pending_review" ? (
                        <div className="staff-actions-row">
                          <button
                            className="btn btn-secondary"
                            disabled={Boolean(busy) || disabled}
                            onClick={() => void run("approveReservation", () => reviewReservation(str(row.id), "approve"))}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-secondary"
                            disabled={Boolean(busy) || disabled}
                            onClick={() => void run("rejectReservation", () => reviewReservation(str(row.id), "reject"))}
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="staff-mini">-</span>
                      )}
                    </td>
                  </tr>
                ))}
                {opsReservations.length === 0 ? (
                  <tr><td colSpan={5}>No reservations yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="staff-column">
          <div className="staff-subtitle">Recent orders</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Payment</th>
                  <th>Fulfillment</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {opsOrders.slice(0, 8).map((row) => (
                  <tr key={str(row.id)}>
                    <td><code>{str(row.id)}</code></td>
                    <td>{str(row.paymentStatus, "-")}</td>
                    <td>{str(row.fulfillmentStatus, "-")}</td>
                    <td>{when(tsMs(row.updatedAt))}</td>
                    <td>
                      <div className="staff-actions-row">
                        <select
                          value={orderNextStatus[str(row.id)] ?? ""}
                          onChange={(event) =>
                            setOrderNextStatus((prev) => ({
                              ...prev,
                              [str(row.id)]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Set status…</option>
                          <option value="queued">queued</option>
                          <option value="scheduled">scheduled</option>
                          <option value="loaded">loaded</option>
                          <option value="firing">firing</option>
                          <option value="cooling">cooling</option>
                          <option value="ready">ready</option>
                          <option value="picked_up">picked_up</option>
                          <option value="shipped">shipped</option>
                          <option value="exception">exception</option>
                        </select>
                        <button
                          className="btn btn-secondary"
                          disabled={Boolean(busy) || disabled || !(orderNextStatus[str(row.id)] ?? "").trim()}
                          onClick={() =>
                            void run(`updateFulfillment:${str(row.id)}`, () =>
                              updateOrderFulfillment(str(row.id))
                            )
                          }
                        >
                          Apply
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {opsOrders.length === 0 ? (
                  <tr><td colSpan={5}>No orders yet.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
