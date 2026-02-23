import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  createFunctionsClient,
  type FunctionsClient,
  type LastRequest,
} from "../api/functionsClient";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./IntegrationsView.css";

type IntegrationTokenRecord = {
  tokenId: string;
  label: string | null;
  scopes: string[];
  createdAt?: { toDate?: () => Date } | null;
  updatedAt?: { toDate?: () => Date } | null;
  lastUsedAt?: { toDate?: () => Date } | null;
  revokedAt?: { toDate?: () => Date } | null;
};

type CreateIntegrationTokenResponse = {
  ok: true;
  tokenId: string;
  token: string;
  record: IntegrationTokenRecord;
};

type ListIntegrationTokensResponse = {
  ok: true;
  tokens: IntegrationTokenRecord[];
};

type RevokeIntegrationTokenResponse = {
  ok: true;
};

type EventsFeedEvent = {
  id: string;
  type: string;
  at: string | null;
  cursor: number;
  payload: Record<string, unknown> | null;
};

type EventsFeedResponse = {
  ok: boolean;
  requestId?: string;
  code?: string;
  message?: string;
  data?: {
    events?: Array<Record<string, unknown>>;
    nextCursor?: number;
  };
};

type ScopeOption = { key: string; label: string; description: string };

const SCOPE_OPTIONS: ScopeOption[] = [
  { key: "batches:read", label: "Batches (read)", description: "Read your kiln rental batches and high-level status." },
  { key: "timeline:read", label: "Timeline (read)", description: "Read batch timeline events." },
  { key: "firings:read", label: "Firings (read)", description: "Read the studio firing schedule." },
  { key: "pieces:read", label: "Pieces (read)", description: "Read your pieces (future)." },
  { key: "reservations:read", label: "Reservations (read)", description: "Read your check-ins / reservations (future)." },
  { key: "events:read", label: "Events (read)", description: "Read integration events feed (cursor-based)." },
  { key: "requests:read", label: "Requests (read)", description: "Read your request intake queue (future)." },
  { key: "requests:write", label: "Requests (write)", description: "Create request intake items (future)." },
];

function formatDate(value: { toDate?: () => Date } | null | undefined): string {
  const d = value?.toDate?.();
  if (!d) return "—";
  try {
    return d.toLocaleString();
  } catch {
    return d.toISOString();
  }
}

function redactToken(token: string): string {
  if (!token) return "";
  if (token.length < 16) return token;
  return `${token.slice(0, 10)}…${token.slice(-6)}`;
}

function hasScope(scopes: string[], key: string): boolean {
  return scopes.includes(key);
}

function sanitizeLastRequest(request: LastRequest | null) {
  if (!request) return null;
  return {
    ...request,
    payload: (request as { payloadRedacted?: unknown }).payloadRedacted ?? request.payload,
  };
}

export default function IntegrationsView({
  user,
  functionsBaseUrl,
  onBack,
}: {
  user: User;
  functionsBaseUrl: string;
  onBack: () => void;
}) {
  const [lastRequest, setLastRequest] = useState<LastRequest | null>(null);
  const client: FunctionsClient = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: functionsBaseUrl,
        getIdToken: async () => await user.getIdToken(),
        onLastRequest: setLastRequest,
      }),
    [functionsBaseUrl, user]
  );

  const [tokens, setTokens] = useState<IntegrationTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [label, setLabel] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["batches:read", "timeline:read", "firings:read", "events:read"]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdTokenId, setCreatedTokenId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [eventsFeedToken, setEventsFeedToken] = useState("");
  const [eventsFeedCursor, setEventsFeedCursor] = useState("0");
  const [eventsFeedLimit, setEventsFeedLimit] = useState("10");
  const [eventsFeedBusy, setEventsFeedBusy] = useState(false);
  const [eventsFeedError, setEventsFeedError] = useState("");
  const [eventsFeedRows, setEventsFeedRows] = useState<EventsFeedEvent[]>([]);
  const [eventsFeedNextCursor, setEventsFeedNextCursor] = useState<number | null>(null);

  const refresh = async () => {
    setLoadError("");
    setLoading(true);
    try {
      const resp = await client.postJson<ListIntegrationTokensResponse>("listIntegrationTokens", {});
      setTokens(resp.tokens ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg || "Failed to load tokens.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [functionsBaseUrl, user?.uid]);

  const toggleScope = (key: string) => {
    setSelectedScopes((prev) =>
      prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]
    );
  };

  const handleCreate = async () => {
    if (createBusy) return;
    setCreateError("");
    setCopyStatus("");
    setCreatedToken(null);
    setCreatedTokenId(null);

    if (selectedScopes.length < 1) {
      setCreateError("Select at least one scope.");
      return;
    }

    setCreateBusy(true);
    try {
      const resp = await client.postJson<CreateIntegrationTokenResponse>("createIntegrationToken", {
        label: label.trim() || null,
        scopes: selectedScopes,
      });
      setCreatedToken(resp.token);
      setCreatedTokenId(resp.tokenId);
      setLabel("");
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCreateError(msg || "Failed to create token.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!createdToken) return;
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Copy failed. Select and copy manually.");
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (revokeBusy) return;
    const ok = window.confirm("Revoke this token? Any agent using it will immediately lose access.");
    if (!ok) return;

    setRevokeError("");
    setRevokeBusy(tokenId);
    try {
      await client.postJson<RevokeIntegrationTokenResponse>("revokeIntegrationToken", { tokenId });
      void refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRevokeError(msg || "Failed to revoke token.");
    } finally {
      setRevokeBusy(null);
    }
  };

  const handleFetchEventsFeed = async () => {
    if (eventsFeedBusy) return;
    const token = eventsFeedToken.trim();
    if (!token) {
      setEventsFeedError("Enter a PAT token to fetch the events feed.");
      return;
    }
    const cursorNum = Math.max(Number(eventsFeedCursor) || 0, 0);
    const limitNum = Math.min(Math.max(Number(eventsFeedLimit) || 10, 1), 100);
    const url = `${functionsBaseUrl.replace(/\/+$/, "")}/apiV1/v1/events.feed`;

    setEventsFeedBusy(true);
    setEventsFeedError("");
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          uid: user.uid,
          cursor: cursorNum,
          limit: limitNum,
        }),
      });
      const body = (await resp.json()) as EventsFeedResponse;
      if (!resp.ok || body.ok !== true) {
        throw new Error(body.message || body.code || `Events feed failed (${resp.status})`);
      }
      const rawRows = Array.isArray(body.data?.events) ? body.data?.events : [];
      const rows: EventsFeedEvent[] = rawRows.map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        type: typeof row.type === "string" ? row.type : "event",
        at: typeof row.at === "string" ? row.at : null,
        cursor: typeof row.cursor === "number" ? row.cursor : 0,
        payload: row.payload && typeof row.payload === "object" ? (row.payload as Record<string, unknown>) : null,
      }));
      setEventsFeedRows(rows);
      setEventsFeedNextCursor(typeof body.data?.nextCursor === "number" ? body.data.nextCursor : null);
      setEventsFeedCursor(String(cursorNum));
    } catch (err: unknown) {
      setEventsFeedRows([]);
      setEventsFeedNextCursor(null);
      setEventsFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setEventsFeedBusy(false);
    }
  };

  const useNextCursor = () => {
    if (eventsFeedNextCursor == null) return;
    setEventsFeedCursor(String(eventsFeedNextCursor));
  };

  const curlEventsFeed = useMemo(() => {
    const url = `${functionsBaseUrl.replace(/\/+$/, "")}/apiV1/v1/events.feed`;
    const payload = JSON.stringify({ uid: user.uid, cursor: 0, limit: 100 });
    return `curl -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer <PAT>' -d '${payload}' '${url}'`;
  }, [functionsBaseUrl, user.uid]);

  const curlBatchesList = useMemo(() => {
    const url = `${functionsBaseUrl.replace(/\/+$/, "")}/apiV1/v1/batches.list`;
    const payload = JSON.stringify({ ownerUid: user.uid, limit: 50, includeClosed: true });
    return `curl -X POST -H 'Content-Type: application/json' -H 'Authorization: Bearer <PAT>' -d '${payload}' '${url}'`;
  }, [functionsBaseUrl, user.uid]);

  return (
    <div className="page integrations-page">
      <div className="page-header integrations-header">
        <div>
          <h1>Integrations</h1>
          <p className="page-subtitle">
            Create integration tokens for agents and automations. Tokens are scoped and revocable.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={onBack}>
            Back to profile
          </button>
        </div>
      </div>

      <section className="card card-3d integrations-card">
        <div className="card-title">Create integration token</div>
        <p className="integration-copy">
          Tokens are shown once. Store it safely. If you lose it, revoke and create a new one.
        </p>

        <label className="integration-field">
          Label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: My assistant, Zapier, etc." />
        </label>

        <div className="integration-scopes">
          <div className="summary-label">Scopes</div>
          <div className="scope-grid">
            {SCOPE_OPTIONS.map((opt) => (
              <label key={opt.key} className={`scope-item ${hasScope(selectedScopes, opt.key) ? "active" : ""}`}>
                <input
                  type="checkbox"
                  checked={hasScope(selectedScopes, opt.key)}
                  onChange={() => toggleScope(opt.key)}
                />
                <div>
                  <div className="scope-title">{opt.label}</div>
                  <div className="scope-desc">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {createError ? (
          <div className="alert" role="alert" aria-live="assertive">
            {createError}
          </div>
        ) : null}
        <div className="integration-actions">
          <button className="btn btn-primary" onClick={toVoidHandler(handleCreate)} disabled={createBusy}>
            {createBusy ? "Creating..." : "Create token"}
          </button>
        </div>

        {createdToken ? (
          <div className="token-reveal">
            <div className="token-meta">
              <strong>Token created</strong>
              <span className="subtle">
                tokenId: {createdTokenId ?? "—"} (store token value now)
              </span>
            </div>
            <div className="token-row">
              <code className="token-value" title="Integration token">
                {createdToken}
              </code>
              <button className="btn" onClick={toVoidHandler(handleCopy)}>
                Copy
              </button>
              <button className="btn" onClick={() => setCreatedToken(null)}>
                Hide
              </button>
            </div>
            {copyStatus ? (
              <div className="notice" role="status" aria-live="polite">
                {copyStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="card card-3d integrations-card">
        <div className="card-title">Your tokens</div>
        {loading ? (
          <div className="status-line" role="status" aria-live="polite">
            Loading…
          </div>
        ) : null}
        {loadError ? (
          <div className="alert" role="alert" aria-live="assertive">
            {loadError}
          </div>
        ) : null}
        {revokeError ? (
          <div className="alert" role="alert" aria-live="assertive">
            {revokeError}
          </div>
        ) : null}

        {tokens.length === 0 && !loading ? (
          <div className="empty-state">No integration tokens yet.</div>
        ) : (
          <div className="token-table">
            {tokens.map((t) => (
              <div key={t.tokenId} className={`token-row-item ${t.revokedAt ? "revoked" : ""}`}>
                <div className="token-main">
                  <div className="token-title">
                    <strong>{t.label || "Untitled token"}</strong>
                    {t.revokedAt ? <span className="chip subtle">Revoked</span> : <span className="chip">Active</span>}
                  </div>
                  <div className="token-subtle">
                    id: <code>{redactToken(t.tokenId)}</code>
                    {"  "}created: {formatDate(t.createdAt)}
                    {"  "}last used: {formatDate(t.lastUsedAt)}
                  </div>
                  <div className="token-scopes-line">
                    {(t.scopes ?? []).length ? (t.scopes ?? []).map((s) => (
                      <span key={s} className="chip subtle">
                        {s}
                      </span>
                    )) : (
                      <span className="chip subtle">No scopes</span>
                    )}
                  </div>
                </div>
                <div className="token-actions">
                  <button
                    className="btn"
                    disabled={Boolean(t.revokedAt) || revokeBusy === t.tokenId}
                    onClick={() => void handleRevoke(t.tokenId)}
                  >
                    {revokeBusy === t.tokenId ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card card-3d integrations-card">
        <div className="card-title">Agent examples (curl)</div>
        <p className="integration-copy">
          Use the integration token value as the bearer token (it starts with <code>mf_pat_v1.</code>).
          The examples below are redacted.
        </p>
        <div className="curl-block">
          <div className="summary-label">Events feed</div>
          <pre><code>{curlEventsFeed}</code></pre>
        </div>
        <div className="curl-block">
          <div className="summary-label">Batches list</div>
          <pre><code>{curlBatchesList}</code></pre>
        </div>
      </section>

      <section className="card card-3d integrations-card">
        <div className="card-title">Events feed smoke test</div>
        <p className="integration-copy">
          Paste a PAT with <code>events:read</code> and fetch recent feed rows. Token is only held in memory.
        </p>
        <label className="integration-field">
          PAT token (mf_pat_v1...)
          <input
            value={eventsFeedToken}
            onChange={(e) => setEventsFeedToken(e.target.value)}
            placeholder="Paste token for one-time smoke test"
            type="password"
            autoComplete="off"
          />
        </label>
        <div className="integration-actions">
          <label className="integration-field">
            Cursor
            <input value={eventsFeedCursor} onChange={(e) => setEventsFeedCursor(e.target.value)} />
          </label>
          <label className="integration-field">
            Limit (1-100)
            <input value={eventsFeedLimit} onChange={(e) => setEventsFeedLimit(e.target.value)} />
          </label>
          <button className="btn" onClick={toVoidHandler(handleFetchEventsFeed)} disabled={eventsFeedBusy}>
            {eventsFeedBusy ? "Fetching…" : "Fetch events"}
          </button>
          <button className="btn" onClick={useNextCursor} disabled={eventsFeedNextCursor == null}>
            Use next cursor
          </button>
        </div>
        {eventsFeedError ? (
          <div className="alert" role="alert" aria-live="assertive">
            {eventsFeedError}
          </div>
        ) : null}
        {eventsFeedRows.length === 0 ? (
          <div className="empty-state">No events loaded yet.</div>
        ) : (
          <div className="token-table">
            {eventsFeedRows.map((row) => (
              <div key={`${row.id}-${row.cursor}`} className="token-row-item">
                <div className="token-main">
                  <div className="token-title">
                    <strong>{row.type}</strong>
                    <span className="chip subtle">cursor {row.cursor}</span>
                  </div>
                  <div className="token-subtle">
                    id: <code>{row.id || "-"}</code> · at: {row.at || "—"}
                  </div>
                  {row.payload ? (
                    <pre className="debug-pre"><code>{JSON.stringify(row.payload, null, 2)}</code></pre>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="token-subtle" role="status" aria-live="polite">
          nextCursor: <code>{eventsFeedNextCursor == null ? "—" : String(eventsFeedNextCursor)}</code>
        </div>
      </section>

      {lastRequest ? (
        <section className="card card-3d integrations-card">
          <div className="card-title">Troubleshooting (last request)</div>
          <div className="token-subtle">
            {lastRequest.fn} · {lastRequest.status ?? "—"} · {lastRequest.ok ? "ok" : "error"} · requestId{" "}
            <code>{lastRequest.requestId}</code>
          </div>
          <pre className="debug-pre">
            <code>{JSON.stringify(sanitizeLastRequest(lastRequest), null, 2)}</code>
          </pre>
        </section>
      ) : null}
    </div>
  );
}
