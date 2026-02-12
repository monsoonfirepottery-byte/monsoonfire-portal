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
  cooldownUntilMs: number;
  cooldownReason: string | null;
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

type DeniedAction =
  | "agent_quote_denied_risk_limit"
  | "agent_pay_denied_risk_limit"
  | "agent_pay_denied_velocity";

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
type AgentAccount = {
  id: string;
  status: "active" | "on_hold";
  independentEnabled: boolean;
  prepayRequired: boolean;
  prepaidBalanceCents: number;
  dailySpendCapCents: number;
  spendDayKey: string;
  spentTodayCents: number;
  spentByCategoryCents: Record<string, number>;
};

type AgentRequestStatus = "new" | "triaged" | "accepted" | "in_progress" | "ready" | "fulfilled" | "rejected" | "cancelled";
type AgentRequestKind = "firing" | "pickup" | "delivery" | "shipping" | "commission" | "x1c_print" | "other";

type AgentRequest = {
  id: string;
  createdByUid: string;
  createdByMode: "firebase" | "pat";
  createdByTokenId: string | null;
  status: AgentRequestStatus;
  kind: AgentRequestKind;
  title: string;
  summary: string | null;
  notes: string | null;
  logisticsMode: string | null;
  linkedBatchId: string | null;
  updatedAtMs: number;
  createdAtMs: number;
  assignedToUid: string | null;
  triagedAtMs: number;
  internalNotes: string | null;
  constraints: Record<string, unknown>;
  metadata: Record<string, unknown>;
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
    lastControlReason?: string | null;
    updatedByUid?: string | null;
    updatedAtMs?: number;
  };
};
type ExportDeniedEventsCsvResponse = {
  ok: boolean;
  rowCount?: number;
  filename?: string;
  csv?: string;
};
type ApiV1Envelope<TData> = {
  ok: boolean;
  requestId?: string;
  message?: string;
  code?: string;
  data?: TData;
};
type AgentRequestsListStaffResponse = ApiV1Envelope<{
  requests?: Array<Record<string, unknown>>;
}>;
type AgentRequestStatusUpdateResponse = ApiV1Envelope<{
  agentRequestId?: string;
  status?: AgentRequestStatus;
}>;
type AgentRequestLinkBatchResponse = ApiV1Envelope<{
  agentRequestId?: string;
  linkedBatchId?: string;
}>;
type AgentAccountGetResponse = ApiV1Envelope<{
  account?: Record<string, unknown>;
}>;
type AgentAccountUpdateResponse = ApiV1Envelope<{
  account?: Record<string, unknown>;
}>;

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
    cooldownUntilMs: tsMs(row.cooldownUntil),
    cooldownReason: typeof row.cooldownReason === "string" ? row.cooldownReason : null,
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

function toAgentRequest(row: Record<string, unknown>): AgentRequest {
  const rawStatus = str(row.status, "new");
  const rawKind = str(row.kind, "other");
  const logistics = row.logistics && typeof row.logistics === "object" ? (row.logistics as Record<string, unknown>) : {};
  const staff = row.staff && typeof row.staff === "object" ? (row.staff as Record<string, unknown>) : {};
  return {
    id: str(row.id),
    createdByUid: str(row.createdByUid),
    createdByMode: str(row.createdByMode, "firebase") === "pat" ? "pat" : "firebase",
    createdByTokenId: typeof row.createdByTokenId === "string" ? row.createdByTokenId : null,
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
    title: str(row.title),
    summary: typeof row.summary === "string" ? row.summary : null,
    notes: typeof row.notes === "string" ? row.notes : null,
    logisticsMode: typeof logistics.mode === "string" ? logistics.mode : null,
    linkedBatchId: typeof row.linkedBatchId === "string" ? row.linkedBatchId : null,
    updatedAtMs: tsMs(row.updatedAt),
    createdAtMs: tsMs(row.createdAt),
    assignedToUid: typeof staff.assignedToUid === "string" ? staff.assignedToUid : null,
    triagedAtMs: tsMs(staff.triagedAt),
    internalNotes: typeof staff.internalNotes === "string" ? staff.internalNotes : null,
    constraints: row.constraints && typeof row.constraints === "object" ? (row.constraints as Record<string, unknown>) : {},
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {},
  };
}

function toAgentAccount(row: Record<string, unknown> | null, clientId: string): AgentAccount {
  const spentByCategoryRaw =
    row?.spentByCategoryCents && typeof row.spentByCategoryCents === "object"
      ? (row.spentByCategoryCents as Record<string, unknown>)
      : {};
  const spentByCategoryCents: Record<string, number> = {};
  for (const [key, value] of Object.entries(spentByCategoryRaw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      spentByCategoryCents[key] = Math.max(0, Math.trunc(value));
    }
  }
  return {
    id: clientId,
    status: row?.status === "on_hold" ? "on_hold" : "active",
    independentEnabled: row?.independentEnabled === true,
    prepayRequired: row?.prepayRequired !== false,
    prepaidBalanceCents: num(row?.prepaidBalanceCents, 0),
    dailySpendCapCents: num(row?.dailySpendCapCents, 200_000),
    spendDayKey: str(row?.spendDayKey, ""),
    spentTodayCents: num(row?.spentTodayCents, 0),
    spentByCategoryCents,
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
  const [statusReasonDraft, setStatusReasonDraft] = useState("");
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
  const [deniedClientFilter, setDeniedClientFilter] = useState("all");
  const [deniedActionFilter, setDeniedActionFilter] = useState<"all" | DeniedAction>("all");
  const [deniedFromDate, setDeniedFromDate] = useState("");
  const [deniedToDate, setDeniedToDate] = useState("");
  const [auditSourceFilter, setAuditSourceFilter] = useState<"all" | "client" | "security">("all");
  const [auditOutcomeFilter, setAuditOutcomeFilter] = useState<"all" | "ok" | "deny" | "error">("all");
  const [orderNextStatus, setOrderNextStatus] = useState<Record<string, string>>({});
  const [agentApiEnabled, setAgentApiEnabled] = useState(true);
  const [agentPaymentsEnabled, setAgentPaymentsEnabled] = useState(true);
  const [agentControlsReason, setAgentControlsReason] = useState("");
  const [agentControlsMeta, setAgentControlsMeta] = useState<{
    lastControlReason: string;
    updatedByUid: string;
    updatedAtMs: number;
  }>({
    lastControlReason: "",
    updatedByUid: "",
    updatedAtMs: 0,
  });
  const [agentRequests, setAgentRequests] = useState<AgentRequest[]>([]);
  const [agentRequestSearch, setAgentRequestSearch] = useState("");
  const [agentRequestStatusFilter, setAgentRequestStatusFilter] = useState<"all" | AgentRequestStatus>("all");
  const [agentRequestKindFilter, setAgentRequestKindFilter] = useState<"all" | AgentRequestKind>("all");
  const [selectedAgentRequestId, setSelectedAgentRequestId] = useState("");
  const [agentRequestNextStatus, setAgentRequestNextStatus] = useState<AgentRequestStatus>("triaged");
  const [agentRequestReasonDraft, setAgentRequestReasonDraft] = useState("");
  const [agentRequestReasonCodeDraft, setAgentRequestReasonCodeDraft] = useState("");
  const [agentRequestBatchDraft, setAgentRequestBatchDraft] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<AgentAccount | null>(null);
  const [accountStatusDraft, setAccountStatusDraft] = useState<"active" | "on_hold">("active");
  const [accountIndependentDraft, setAccountIndependentDraft] = useState(false);
  const [accountPrepayDraft, setAccountPrepayDraft] = useState(true);
  const [accountDailyCapDraft, setAccountDailyCapDraft] = useState("200000");
  const [accountBalanceDeltaDraft, setAccountBalanceDeltaDraft] = useState("0");
  const [accountReasonDraft, setAccountReasonDraft] = useState("");

  const selected = useMemo(() => clients.find((row) => row.id === selectedId) ?? null, [clients, selectedId]);
  const selectedAgentRequest = useMemo(
    () => agentRequests.find((row) => row.id === selectedAgentRequestId) ?? null,
    [agentRequests, selectedAgentRequestId]
  );
  const deniedEvents = useMemo(() => {
    const deniedSet = new Set<string>([
      "agent_quote_denied_risk_limit",
      "agent_pay_denied_risk_limit",
      "agent_pay_denied_velocity",
    ]);
    return audit.filter((entry) => deniedSet.has(entry.action));
  }, [audit]);
  const filteredDeniedEvents = useMemo(() => {
    const fromMs = deniedFromDate ? Date.parse(`${deniedFromDate}T00:00:00.000Z`) : 0;
    const toMs = deniedToDate ? Date.parse(`${deniedToDate}T23:59:59.999Z`) : 0;
    const hasFrom = Number.isFinite(fromMs) && fromMs > 0;
    const hasTo = Number.isFinite(toMs) && toMs > 0;

    return deniedEvents.filter((entry) => {
      const clientId =
        typeof entry.metadata?.agentClientId === "string"
          ? entry.metadata.agentClientId
          : "";
      const matchesClient =
        deniedClientFilter === "all" ? true : clientId === deniedClientFilter;
      const matchesAction =
        deniedActionFilter === "all" ? true : entry.action === deniedActionFilter;
      const matchesFrom = !hasFrom || entry.createdAtMs >= fromMs;
      const matchesTo = !hasTo || entry.createdAtMs <= toMs;
      return matchesClient && matchesAction && matchesFrom && matchesTo;
    });
  }, [deniedEvents, deniedClientFilter, deniedActionFilter, deniedFromDate, deniedToDate]);
  const filteredAudit = useMemo(() => {
    return audit.filter((entry) => {
      const source = str(entry.metadata?.source, "client");
      if (auditSourceFilter !== "all" && source !== auditSourceFilter) return false;
      if (auditOutcomeFilter !== "all") {
        const outcome = str(entry.metadata?.outcome, "");
        if (outcome !== auditOutcomeFilter) return false;
      }
      return true;
    });
  }, [audit, auditSourceFilter, auditOutcomeFilter]);
  const auditKpis = useMemo(() => {
    let security = 0;
    let denied = 0;
    let errored = 0;
    for (const entry of audit) {
      const source = str(entry.metadata?.source, "client");
      if (source === "security") security += 1;
      const outcome = str(entry.metadata?.outcome, "");
      if (outcome === "deny") denied += 1;
      if (outcome === "error") errored += 1;
    }
    return {
      total: audit.length,
      security,
      denied,
      errored,
    };
  }, [audit]);
  const filteredAgentRequests = useMemo(() => {
    const search = agentRequestSearch.trim().toLowerCase();
    return agentRequests
      .filter((row) => (agentRequestStatusFilter === "all" ? true : row.status === agentRequestStatusFilter))
      .filter((row) => (agentRequestKindFilter === "all" ? true : row.kind === agentRequestKindFilter))
      .filter((row) => {
        if (!search) return true;
        const haystack = `${row.id} ${row.title} ${row.summary ?? ""} ${row.createdByUid} ${row.kind} ${row.status}`.toLowerCase();
        return haystack.includes(search);
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [agentRequestKindFilter, agentRequestSearch, agentRequestStatusFilter, agentRequests]);
  const agentRequestKpis = useMemo(() => {
    const counts = {
      total: agentRequests.length,
      new: 0,
      triaged: 0,
      inProgress: 0,
      fulfilled: 0,
      blocked: 0,
    };
    for (const row of agentRequests) {
      if (row.status === "new") counts.new += 1;
      if (row.status === "triaged") counts.triaged += 1;
      if (row.status === "in_progress" || row.status === "accepted" || row.status === "ready") counts.inProgress += 1;
      if (row.status === "fulfilled") counts.fulfilled += 1;
      if (row.status === "rejected" || row.status === "cancelled") counts.blocked += 1;
    }
    return counts;
  }, [agentRequests]);

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
    const [clientsResp, logsResp, catalogResp, opsResp, opsConfigResp, requestsResp] = await Promise.all([
      client.postJson<ListClientsResponse>("staffListAgentClients", { includeRevoked: true, limit: 200 }),
      client.postJson<ListLogsResponse>("staffListAgentClientAuditLogs", { limit: 80 }),
      client.postJson<CatalogResponse>("staffGetAgentServiceCatalog", {}),
      client.postJson<OpsResponse>("staffListAgentOperations", { limit: 60 }),
      client.postJson<AgentOpsConfigResponse>("staffGetAgentOpsConfig", {}),
      client.postJson<AgentRequestsListStaffResponse>("apiV1/v1/agent.requests.listStaff", {
        status: "all",
        kind: "all",
        limit: 240,
      }),
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
    setAgentControlsMeta({
      lastControlReason: str(opsConfigResp.config?.lastControlReason, ""),
      updatedByUid: str(opsConfigResp.config?.updatedByUid, ""),
      updatedAtMs: num(opsConfigResp.config?.updatedAtMs, 0),
    });
    const requestRows = Array.isArray(requestsResp.data?.requests)
      ? requestsResp.data.requests
          .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
          .map((row) => toAgentRequest(row))
      : [];
    requestRows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    setAgentRequests(requestRows);

    if (!selectedId && rows.length > 0) setSelectedId(rows[0].id);
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(rows[0]?.id ?? "");
    }
    if (!selectedAgentRequestId && requestRows.length > 0) {
      setSelectedAgentRequestId(requestRows[0].id);
    }
    if (selectedAgentRequestId && !requestRows.some((row) => row.id === selectedAgentRequestId)) {
      setSelectedAgentRequestId(requestRows[0]?.id ?? "");
    }
  }, [client, selectedAgentRequestId, selectedId]);

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
  useEffect(() => {
    if (!selectedAgentRequest) return;
    setAgentRequestNextStatus(selectedAgentRequest.status === "new" ? "triaged" : selectedAgentRequest.status);
    setAgentRequestBatchDraft(selectedAgentRequest.linkedBatchId ?? "");
    setAgentRequestReasonDraft(selectedAgentRequest.internalNotes ?? "");
    setAgentRequestReasonCodeDraft("");
  }, [selectedAgentRequest]);
  useEffect(() => {
    if (!selectedAccount) return;
    setAccountStatusDraft(selectedAccount.status);
    setAccountIndependentDraft(selectedAccount.independentEnabled);
    setAccountPrepayDraft(selectedAccount.prepayRequired);
    setAccountDailyCapDraft(String(selectedAccount.dailySpendCapCents));
    setAccountBalanceDeltaDraft("0");
  }, [selectedAccount]);

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
    if (!window.confirm(`Rotate API key for ${selected.name}? Existing key access will stop immediately.`)) {
      return;
    }
    const resp = await client.postJson<UpsertClientResponse>("staffRotateAgentClientKey", {
      clientId: selected.id,
      reason: statusReasonDraft.trim() || "staff-initiated-rotation",
    });
    setLatestKey(resp.apiKey ?? "");
    await load();
    setStatusReasonDraft("");
    setStatus(resp.warning ?? "Agent key rotated.");
  };

  const setClientStatus = async (nextStatus: "active" | "suspended" | "revoked") => {
    if (!selected) return;
    if (nextStatus === "suspended" || nextStatus === "revoked") {
      const confirmed = window.confirm(
        `${nextStatus === "revoked" ? "Revoke" : "Suspend"} ${selected.name}? This is a high-impact action.`
      );
      if (!confirmed) return;
    }
    await client.postJson("staffUpdateAgentClientStatus", {
      clientId: selected.id,
      status: nextStatus,
      reason: statusReasonDraft.trim() || "staff-status-change",
    });
    await load();
    setStatusReasonDraft("");
    setStatus(`Client status set to ${nextStatus}.`);
  };

  const clearCooldown = async () => {
    if (!selected) return;
    await client.postJson("staffClearAgentClientCooldown", {
      clientId: selected.id,
      reason: "manual_staff_override",
    });
    await load();
    setStatus("Client cooldown cleared.");
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
    const reason = agentControlsReason.trim();
    if ((!agentApiEnabled || !agentPaymentsEnabled) && !reason) {
      throw new Error("Reason is required when disabling agent API or payments.");
    }
    await client.postJson("staffUpdateAgentOpsConfig", {
      enabled: agentApiEnabled,
      allowPayments: agentPaymentsEnabled,
      reason: reason || null,
    });
    await load();
    setAgentControlsReason("");
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

  const exportDeniedEvents = async () => {
    const payload = filteredDeniedEvents.map((entry) => ({
      id: entry.id,
      at: entry.createdAtMs ? new Date(entry.createdAtMs).toISOString() : null,
      action: entry.action,
      actorUid: entry.actorUid,
      clientId:
        typeof entry.metadata?.agentClientId === "string"
          ? entry.metadata.agentClientId
          : null,
      metadata: entry.metadata ?? null,
    }));
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus(`Copied ${payload.length} denied events JSON.`);
  };

  const downloadDeniedEventsCsv = async () => {
    const fromIso = deniedFromDate ? new Date(`${deniedFromDate}T00:00:00.000Z`).toISOString() : undefined;
    const toIso = deniedToDate ? new Date(`${deniedToDate}T23:59:59.999Z`).toISOString() : undefined;
    const payload: {
      clientId?: string;
      action: "all" | DeniedAction;
      fromIso?: string;
      toIso?: string;
      limit: number;
    } = {
      action: deniedActionFilter,
      limit: 500,
    };
    if (deniedClientFilter !== "all") payload.clientId = deniedClientFilter;
    if (fromIso) payload.fromIso = fromIso;
    if (toIso) payload.toIso = toIso;
    const resp = await client.postJson<ExportDeniedEventsCsvResponse>("staffExportAgentDeniedEventsCsv", {
      ...payload,
    });
    const csv = typeof resp.csv === "string" ? resp.csv : "";
    if (!csv) throw new Error("CSV export returned empty content.");
    const filename = (resp.filename && resp.filename.trim()) || "agent-denied-events.csv";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
    setStatus(`Downloaded CSV (${num(resp.rowCount, 0)} rows).`);
  };
  const refreshAgentRequests = async () => {
    const resp = await client.postJson<AgentRequestsListStaffResponse>("apiV1/v1/agent.requests.listStaff", {
      status: "all",
      kind: "all",
      limit: 240,
    });
    const requestRows = Array.isArray(resp.data?.requests)
      ? resp.data.requests
          .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
          .map((row) => toAgentRequest(row))
      : [];
    requestRows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    setAgentRequests(requestRows);
    if (!selectedAgentRequestId && requestRows.length > 0) setSelectedAgentRequestId(requestRows[0].id);
    if (selectedAgentRequestId && !requestRows.some((row) => row.id === selectedAgentRequestId)) {
      setSelectedAgentRequestId(requestRows[0]?.id ?? "");
    }
  };
  const refreshSelectedAgentAccount = async () => {
    if (!selected) {
      setSelectedAccount(null);
      return;
    }
    const resp = await client.postJson<AgentAccountGetResponse>("apiV1/v1/agent.account.get", {
      agentClientId: selected.id,
    });
    const accountRow =
      resp.data?.account && typeof resp.data.account === "object"
        ? (resp.data.account as Record<string, unknown>)
        : null;
    setSelectedAccount(toAgentAccount(accountRow, selected.id));
  };

  const updateAgentRequestStatus = async () => {
    if (!selectedAgentRequest) throw new Error("Select a request first.");
    const resp = await client.postJson<AgentRequestStatusUpdateResponse>("apiV1/v1/agent.requests.updateStatus", {
      requestId: selectedAgentRequest.id,
      status: agentRequestNextStatus,
      reason: agentRequestReasonDraft.trim() || null,
      reasonCode: agentRequestReasonCodeDraft.trim() || null,
    });
    if (!resp.ok) throw new Error(resp.message ?? "Failed to update request status.");
    await refreshAgentRequests();
    setStatus(`Request ${selectedAgentRequest.id} moved to ${agentRequestNextStatus}.`);
  };

  const linkAgentRequestBatch = async () => {
    if (!selectedAgentRequest) throw new Error("Select a request first.");
    if (!agentRequestBatchDraft.trim()) throw new Error("Enter a batch id first.");
    const resp = await client.postJson<AgentRequestLinkBatchResponse>("apiV1/v1/agent.requests.linkBatch", {
      requestId: selectedAgentRequest.id,
      batchId: agentRequestBatchDraft.trim(),
    });
    if (!resp.ok) throw new Error(resp.message ?? "Failed to link batch.");
    await refreshAgentRequests();
    setStatus(`Linked request ${selectedAgentRequest.id} to batch ${agentRequestBatchDraft.trim()}.`);
  };
  const saveSelectedAgentAccount = async () => {
    if (!selected) throw new Error("Select a client first.");
    const delta = Number(accountBalanceDeltaDraft) || 0;
    const dailyCap = Math.max(0, Number(accountDailyCapDraft) || 0);
    const resp = await client.postJson<AgentAccountUpdateResponse>("apiV1/v1/agent.account.update", {
      agentClientId: selected.id,
      status: accountStatusDraft,
      independentEnabled: accountIndependentDraft,
      prepayRequired: accountPrepayDraft,
      dailySpendCapCents: dailyCap,
      prepaidBalanceDeltaCents: delta,
      reason: accountReasonDraft.trim() || null,
    });
    if (!resp.ok) throw new Error(resp.message ?? "Failed to update agent account.");
    await refreshSelectedAgentAccount();
    setAccountBalanceDeltaDraft("0");
    setStatus(`Updated independent account controls for ${selected.name}.`);
  };
  useEffect(() => {
    if (!active || disabled || !selected) return;
    void run("loadSelectedAgentAccount", refreshSelectedAgentAccount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled, selected?.id]);

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
      </div>
      <div className="staff-actions-row">
        <label className="staff-field" style={{ flex: 1 }}>
          <span>Controls change reason (required when disabling)</span>
          <input
            value={agentControlsReason}
            onChange={(event) => setAgentControlsReason(event.target.value)}
            placeholder="Why this control change is needed"
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
      {agentControlsMeta.updatedAtMs > 0 ? (
        <div className="staff-note">
          Last control update: {when(agentControlsMeta.updatedAtMs)}
          {agentControlsMeta.updatedByUid ? ` by ${agentControlsMeta.updatedByUid}` : ""}
          {agentControlsMeta.lastControlReason ? ` · reason: ${agentControlsMeta.lastControlReason}` : ""}
        </div>
      ) : null}
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
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(row.id);
                        }
                      }}
                      tabIndex={0}
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
                <br />
                <span>
                  Cooldown: {selected.cooldownUntilMs ? when(selected.cooldownUntilMs) : "none"}
                  {selected.cooldownReason ? ` (${selected.cooldownReason})` : ""}
                </span>
              </div>
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 1 }}>
                  Admin reason (saved to audit)
                  <input
                    value={statusReasonDraft}
                    onChange={(event) => setStatusReasonDraft(event.target.value)}
                    placeholder="Optional: abuse investigation #, incident note, or rotation reason"
                  />
                </label>
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
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy) || disabled || !selected.cooldownUntilMs}
                  onClick={() => void run("clearCooldown", clearCooldown)}
                >
                  Clear cooldown
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

              <div className="staff-subtitle">Independent account controls</div>
              {selectedAccount ? (
                <>
                  <div className="staff-actions-row">
                    <div className="pill">Balance: ${(selectedAccount.prepaidBalanceCents / 100).toFixed(2)}</div>
                    <div className="pill">Spent today: ${(selectedAccount.spentTodayCents / 100).toFixed(2)}</div>
                    <div className="pill">Spend day: {selectedAccount.spendDayKey || "-"}</div>
                  </div>
                  <div className="staff-actions-row">
                    <label className="staff-field" style={{ flex: 1 }}>
                      Account status
                      <select value={accountStatusDraft} onChange={(event) => setAccountStatusDraft(event.target.value as "active" | "on_hold")}>
                        <option value="active">active</option>
                        <option value="on_hold">on_hold</option>
                      </select>
                    </label>
                    <label className="staff-field" style={{ flex: 1 }}>
                      Independent mode enabled
                      <input type="checkbox" checked={accountIndependentDraft} onChange={(event) => setAccountIndependentDraft(event.target.checked)} />
                    </label>
                    <label className="staff-field" style={{ flex: 1 }}>
                      Prepay required
                      <input type="checkbox" checked={accountPrepayDraft} onChange={(event) => setAccountPrepayDraft(event.target.checked)} />
                    </label>
                  </div>
                  <div className="staff-actions-row">
                    <label className="staff-field" style={{ flex: 1 }}>
                      Daily spend cap (cents)
                      <input value={accountDailyCapDraft} onChange={(event) => setAccountDailyCapDraft(event.target.value)} />
                    </label>
                    <label className="staff-field" style={{ flex: 1 }}>
                      Balance delta cents (+/-)
                      <input value={accountBalanceDeltaDraft} onChange={(event) => setAccountBalanceDeltaDraft(event.target.value)} />
                    </label>
                    <label className="staff-field" style={{ flex: 2 }}>
                      Reason
                      <input value={accountReasonDraft} onChange={(event) => setAccountReasonDraft(event.target.value)} placeholder="Hold account pending fraud review" />
                    </label>
                    <button className="btn btn-secondary" disabled={Boolean(busy) || disabled} onClick={() => void run("saveSelectedAgentAccount", saveSelectedAgentAccount)}>
                      Save account
                    </button>
                  </div>
                </>
              ) : (
                <div className="staff-note">Account controls unavailable until a client is selected.</div>
              )}
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

      <div className="staff-subtitle">Agent request intake queue</div>
      <div className="staff-note">
        Structured requests from agents and users are triaged here. Link accepted requests to a portal batch for fulfillment tracking.
      </div>
      <div className="staff-actions-row">
        <div className="pill">Total: {agentRequestKpis.total}</div>
        <div className="pill">New: {agentRequestKpis.new}</div>
        <div className="pill">Triaged: {agentRequestKpis.triaged}</div>
        <div className="pill">Active: {agentRequestKpis.inProgress}</div>
        <div className="pill">Fulfilled: {agentRequestKpis.fulfilled}</div>
        <div className="pill">Rejected/Cancelled: {agentRequestKpis.blocked}</div>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field" style={{ flex: 2 }}>
          Search
          <input
            value={agentRequestSearch}
            onChange={(event) => setAgentRequestSearch(event.target.value)}
            placeholder="id, title, uid, kind"
          />
        </label>
        <label className="staff-field">
          Status
          <select
            value={agentRequestStatusFilter}
            onChange={(event) => setAgentRequestStatusFilter(event.target.value as "all" | AgentRequestStatus)}
          >
            <option value="all">All</option>
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
        <label className="staff-field">
          Kind
          <select
            value={agentRequestKindFilter}
            onChange={(event) => setAgentRequestKindFilter(event.target.value as "all" | AgentRequestKind)}
          >
            <option value="all">All</option>
            <option value="firing">firing</option>
            <option value="pickup">pickup</option>
            <option value="delivery">delivery</option>
            <option value="shipping">shipping</option>
            <option value="commission">commission</option>
            <option value="x1c_print">x1c_print</option>
            <option value="other">other</option>
          </select>
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled}
          onClick={() => void run("refreshAgentRequestsOnly", refreshAgentRequests)}
        >
          Refresh requests
        </button>
      </div>
      <div className="staff-module-grid">
        <div className="staff-column">
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Kind</th>
                  <th>Requester</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgentRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No requests match current filters.</td>
                  </tr>
                ) : (
                  filteredAgentRequests.map((row) => (
                    <tr
                      key={row.id}
                      className={`staff-click-row ${selectedAgentRequestId === row.id ? "active" : ""}`}
                      onClick={() => setSelectedAgentRequestId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedAgentRequestId(row.id);
                        }
                      }}
                      tabIndex={0}
                    >
                      <td>
                        <div>{row.title || "(untitled request)"}</div>
                        <div className="staff-mini">
                          <code>{row.id}</code>
                        </div>
                      </td>
                      <td><span className="pill">{row.status}</span></td>
                      <td>{row.kind}</td>
                      <td>
                        <code>{row.createdByUid || "-"}</code>
                        <div className="staff-mini">{row.createdByMode}</div>
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
          <div className="staff-subtitle">Request detail</div>
          {selectedAgentRequest ? (
            <>
              <div className="staff-note">
                <strong>{selectedAgentRequest.title}</strong><br />
                <span>{selectedAgentRequest.summary || "No summary"}</span><br />
                <span>Kind: {selectedAgentRequest.kind} · Status: {selectedAgentRequest.status}</span><br />
                <span>Requester: <code>{selectedAgentRequest.createdByUid || "-"}</code> ({selectedAgentRequest.createdByMode})</span><br />
                <span>Created: {when(selectedAgentRequest.createdAtMs)} · Updated: {when(selectedAgentRequest.updatedAtMs)}</span><br />
                <span>Assigned: <code>{selectedAgentRequest.assignedToUid || "-"}</code> · Triaged: {when(selectedAgentRequest.triagedAtMs)}</span><br />
                <span>Linked batch: <code>{selectedAgentRequest.linkedBatchId || "-"}</code></span>
              </div>
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 1 }}>
                  Next status
                  <select
                    value={agentRequestNextStatus}
                    onChange={(event) => setAgentRequestNextStatus(event.target.value as AgentRequestStatus)}
                  >
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
                <label className="staff-field" style={{ flex: 2 }}>
                  Reason / internal note
                  <input
                    value={agentRequestReasonDraft}
                    onChange={(event) => setAgentRequestReasonDraft(event.target.value)}
                    placeholder="Queued for next bisque cycle"
                  />
                </label>
                <label className="staff-field" style={{ flex: 1 }}>
                  Reason code
                  <select
                    value={agentRequestReasonCodeDraft}
                    onChange={(event) => setAgentRequestReasonCodeDraft(event.target.value)}
                  >
                    <option value="">(optional)</option>
                    <option value="rights_verified">rights_verified</option>
                    <option value="licensed_use_verified">licensed_use_verified</option>
                    <option value="staff_discretion_low_risk">staff_discretion_low_risk</option>
                    <option value="prohibited_content">prohibited_content</option>
                    <option value="copyright_risk_unresolved">copyright_risk_unresolved</option>
                    <option value="illegal_request">illegal_request</option>
                    <option value="insufficient_rights_attestation">insufficient_rights_attestation</option>
                  </select>
                </label>
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy) || disabled}
                  onClick={() => void run("updateAgentRequestStatus", updateAgentRequestStatus)}
                >
                  Update status
                </button>
              </div>
              <div className="staff-actions-row">
                <label className="staff-field" style={{ flex: 2 }}>
                  Link batch ID
                  <input
                    value={agentRequestBatchDraft}
                    onChange={(event) => setAgentRequestBatchDraft(event.target.value)}
                    placeholder="batch_123"
                  />
                </label>
                <button
                  className="btn btn-secondary"
                  disabled={Boolean(busy) || disabled || !agentRequestBatchDraft.trim()}
                  onClick={() => void run("linkAgentRequestBatch", linkAgentRequestBatch)}
                >
                  Link batch
                </button>
              </div>
              <details className="staff-troubleshooting">
                <summary>Request payload details</summary>
                <pre>{JSON.stringify({ constraints: selectedAgentRequest.constraints, metadata: selectedAgentRequest.metadata, notes: selectedAgentRequest.notes, logisticsMode: selectedAgentRequest.logisticsMode }, null, 2)}</pre>
              </details>
            </>
          ) : (
            <div className="staff-note">Select a request to inspect and triage.</div>
          )}
        </div>
      </div>

      <div className="staff-subtitle">Audit log</div>
      <div className="staff-actions-row">
        <div className="pill">Total: {auditKpis.total}</div>
        <div className="pill">Security: {auditKpis.security}</div>
        <div className="pill">Denied: {auditKpis.denied}</div>
        <div className="pill">Errored: {auditKpis.errored}</div>
      </div>
      <div className="staff-actions-row">
        <label className="staff-field">
          Source
          <select value={auditSourceFilter} onChange={(event) => setAuditSourceFilter(event.target.value as "all" | "client" | "security")}>
            <option value="all">All sources</option>
            <option value="client">Client audit</option>
            <option value="security">Security audit</option>
          </select>
        </label>
        <label className="staff-field">
          Outcome
          <select value={auditOutcomeFilter} onChange={(event) => setAuditOutcomeFilter(event.target.value as "all" | "ok" | "deny" | "error")}>
            <option value="all">All outcomes</option>
            <option value="ok">ok</option>
            <option value="deny">deny</option>
            <option value="error">error</option>
          </select>
        </label>
      </div>
      <div className="staff-log-list">
        {filteredAudit.length === 0 ? (
          <div className="staff-note">No agent client audit events yet.</div>
        ) : (
          filteredAudit.slice(0, 40).map((entry) => (
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

      <div className="staff-subtitle">Denied events</div>
      <div className="staff-actions-row">
        <label className="staff-field" style={{ flex: 1 }}>
          Client filter
          <select
            value={deniedClientFilter}
            onChange={(event) => setDeniedClientFilter(event.target.value)}
          >
            <option value="all">All clients</option>
            {clients.map((clientRow) => (
              <option key={clientRow.id} value={clientRow.id}>
                {clientRow.name} ({clientRow.id})
              </option>
            ))}
          </select>
        </label>
        <label className="staff-field" style={{ flex: 1 }}>
          Action filter
          <select
            value={deniedActionFilter}
            onChange={(event) =>
              setDeniedActionFilter(
                event.target.value as "all" | DeniedAction
              )
            }
          >
            <option value="all">All denied actions</option>
            <option value="agent_quote_denied_risk_limit">quote denied - risk limit</option>
            <option value="agent_pay_denied_risk_limit">pay denied - risk limit</option>
            <option value="agent_pay_denied_velocity">pay denied - velocity</option>
          </select>
        </label>
        <label className="staff-field">
          From
          <input
            type="date"
            value={deniedFromDate}
            onChange={(event) => setDeniedFromDate(event.target.value)}
          />
        </label>
        <label className="staff-field">
          To
          <input
            type="date"
            value={deniedToDate}
            onChange={(event) => setDeniedToDate(event.target.value)}
          />
        </label>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || filteredDeniedEvents.length === 0 || Boolean(deniedFromDate && deniedToDate && deniedFromDate > deniedToDate)}
          onClick={() => void exportDeniedEvents()}
        >
          Copy JSON export
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || Boolean(deniedFromDate && deniedToDate && deniedFromDate > deniedToDate)}
          onClick={() => void run("downloadDeniedCsv", downloadDeniedEventsCsv)}
        >
          Download CSV
        </button>
      </div>
      {deniedFromDate && deniedToDate && deniedFromDate > deniedToDate ? (
        <div className="staff-note staff-note-error">Date range is invalid. Set "From" to a date before "To".</div>
      ) : null}
      <div className="staff-table-wrap">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Client</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {filteredDeniedEvents.slice(0, 50).map((entry) => (
              <tr key={entry.id}>
                <td>{when(entry.createdAtMs)}</td>
                <td>{entry.action}</td>
                <td>
                  <code>
                    {typeof entry.metadata?.agentClientId === "string"
                      ? entry.metadata.agentClientId
                      : "-"}
                  </code>
                </td>
                <td>
                  <code>{entry.actorUid || "-"}</code>
                </td>
              </tr>
            ))}
            {filteredDeniedEvents.length === 0 ? (
              <tr>
                <td colSpan={4}>No denied events for current filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
