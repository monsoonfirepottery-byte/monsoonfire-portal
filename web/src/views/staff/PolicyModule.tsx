import { useEffect, useMemo, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";

type PolicyRule = {
  id: string;
  title: string;
  description: string;
  severityHint?: "low" | "medium" | "high" | null;
};

type PolicyVersion = {
  id: string;
  version: string;
  title: string;
  summary: string;
  status: string;
  rules: PolicyRule[];
  updatedAtMs: number;
};

type Props = {
  client: FunctionsClient;
  active: boolean;
  disabled: boolean;
};

type CurrentPolicyResponse = {
  ok: boolean;
  policy?: Record<string, unknown> | null;
};

type ListPoliciesResponse = {
  ok: boolean;
  activeVersion?: string | null;
  policies?: Array<Record<string, unknown>>;
};

type BasicResponse = { ok: boolean; message?: string; activeVersion?: string };

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function toMs(v: unknown): number {
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

function normalizeRules(v: unknown): PolicyRule[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        id: str(row.id).trim(),
        title: str(row.title).trim(),
        description: str(row.description).trim(),
        severityHint: (str(row.severityHint) as "low" | "medium" | "high" | "") || null,
      };
    })
    .filter((rule) => rule.id && rule.title && rule.description);
}

function normalizePolicy(row: Record<string, unknown>): PolicyVersion {
  return {
    id: str(row.id),
    version: str(row.version || row.id),
    title: str(row.title),
    summary: str(row.summary),
    status: str(row.status, "draft"),
    rules: normalizeRules(row.rules),
    updatedAtMs: toMs(row.updatedAt),
  };
}

function parseRulesFromText(input: string): PolicyRule[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id = "", title = "", description = "", severityHint = ""] = line.split("|").map((part) => part.trim());
      const normalizedSeverity = ["low", "medium", "high"].includes(severityHint) ? (severityHint as "low" | "medium" | "high") : null;
      return { id, title, description, severityHint: normalizedSeverity };
    })
    .filter((rule) => rule.id && rule.title && rule.description);
}

function serializeRulesToText(rules: PolicyRule[]): string {
  return rules
    .map((rule) => `${rule.id} | ${rule.title} | ${rule.description} | ${rule.severityHint ?? ""}`)
    .join("\n");
}

export default function PolicyModule({ client, active, disabled }: Props) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [activeVersion, setActiveVersion] = useState("");
  const [policies, setPolicies] = useState<PolicyVersion[]>([]);
  const [currentPolicy, setCurrentPolicy] = useState<PolicyVersion | null>(null);

  const [versionDraft, setVersionDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [rulesDraft, setRulesDraft] = useState("R1.respectful_conduct | Respectful conduct | Harassment or hate speech is not allowed. | high");

  const selectedVersion = useMemo(() => {
    if (!versionDraft) return null;
    return policies.find((policy) => policy.version === versionDraft || policy.id === versionDraft) ?? null;
  }, [policies, versionDraft]);

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

  const loadAll = async () => {
    const [currentResp, listResp] = await Promise.all([
      client.postJson<CurrentPolicyResponse>("getModerationPolicyCurrent", {}),
      client.postJson<ListPoliciesResponse>("listModerationPolicies", { includeArchived: false, limit: 40 }),
    ]);

    const normalizedPolicies = Array.isArray(listResp.policies)
      ? listResp.policies.map((row) => normalizePolicy(row))
      : [];

    setPolicies(normalizedPolicies);
    setActiveVersion(str(listResp.activeVersion));

    const normalizedCurrent = currentResp.policy
      ? normalizePolicy(currentResp.policy)
      : null;
    setCurrentPolicy(normalizedCurrent);

    if (!versionDraft && normalizedPolicies.length > 0) {
      const nextVersion = str(listResp.activeVersion) || normalizedPolicies[0].version;
      setVersionDraft(nextVersion);
      const selected = normalizedPolicies.find((policy) => policy.version === nextVersion) ?? normalizedPolicies[0];
      setTitleDraft(selected.title);
      setSummaryDraft(selected.summary);
      setRulesDraft(serializeRulesToText(selected.rules));
    }
  };

  useEffect(() => {
    if (!active || disabled) return;
    void run("loadPolicies", loadAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, disabled]);

  useEffect(() => {
    if (!selectedVersion) return;
    setTitleDraft(selectedVersion.title);
    setSummaryDraft(selectedVersion.summary);
    setRulesDraft(serializeRulesToText(selectedVersion.rules));
  }, [selectedVersion]);

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Governance policy</div>
        <button className="btn btn-secondary" disabled={Boolean(busy) || disabled} onClick={() => void run("refreshPolicies", loadAll)}>
          Refresh policy
        </button>
      </div>

      {disabled ? (
        <div className="staff-note">
          Governance policy module requires function auth. Enable auth emulator (`VITE_USE_AUTH_EMULATOR=true`) or point Functions to production.
        </div>
      ) : null}

      <div className="staff-note">
        Active Code of Conduct version: <strong>{activeVersion || "none published"}</strong>
      </div>

      {currentPolicy ? (
        <div className="staff-note">
          <strong>{currentPolicy.title}</strong><br />
          <span>{currentPolicy.summary}</span><br />
          <span>Rules: {currentPolicy.rules.length} · Last updated: {when(currentPolicy.updatedAtMs)}</span>
        </div>
      ) : (
        <div className="staff-note">No published policy yet. Draft and publish one before taking moderation actions.</div>
      )}

      <div className="staff-actions-row">
        <select value={versionDraft} onChange={(event) => setVersionDraft(event.target.value)}>
          <option value="">New version draft</option>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.version}>
              {policy.version} · {policy.status}
            </option>
          ))}
        </select>
        <input
          placeholder="Version id (ex: coc-2026-02)"
          value={versionDraft}
          onChange={(event) => setVersionDraft(event.target.value)}
        />
      </div>

      <label className="staff-field">
        Policy title
        <input value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} placeholder="Community Code of Conduct" />
      </label>

      <label className="staff-field">
        Summary
        <textarea value={summaryDraft} onChange={(event) => setSummaryDraft(event.target.value)} placeholder="Short policy summary" />
      </label>

      <label className="staff-field">
        Rules (`id | title | description | severityHint`)
        <textarea
          value={rulesDraft}
          onChange={(event) => setRulesDraft(event.target.value)}
          placeholder="R1.respectful_conduct | Respectful conduct | Harassment or hate speech is not allowed. | high"
        />
      </label>

      <div className="staff-actions-row">
        <button
          className="btn btn-primary"
          disabled={Boolean(busy) || disabled || !versionDraft.trim() || !titleDraft.trim() || parseRulesFromText(rulesDraft).length === 0}
          onClick={() =>
            void run("upsertPolicy", async () => {
              await client.postJson<BasicResponse>("staffUpsertModerationPolicy", {
                version: versionDraft.trim(),
                title: titleDraft.trim(),
                summary: summaryDraft.trim() || null,
                status: "draft",
                rules: parseRulesFromText(rulesDraft),
              });
              await loadAll();
              setStatus(`Saved draft policy ${versionDraft.trim()}.`);
            })
          }
        >
          Save draft
        </button>

        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled || !versionDraft.trim()}
          onClick={() =>
            void run("publishPolicy", async () => {
              await client.postJson<BasicResponse>("staffPublishModerationPolicy", {
                version: versionDraft.trim(),
              });
              await loadAll();
              setStatus(`Published policy ${versionDraft.trim()}.`);
            })
          }
        >
          Publish version
        </button>
      </div>

      {status ? <div className="staff-note">{status}</div> : null}
      {error ? <div className="staff-note staff-note-error">{error}</div> : null}
    </section>
  );
}
