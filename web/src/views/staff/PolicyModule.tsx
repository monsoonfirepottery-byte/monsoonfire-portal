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

type CommunitySafetyConfig = {
  enabled: boolean;
  publishKillSwitch: boolean;
  autoFlagEnabled: boolean;
  highSeverityThreshold: number;
  mediumSeverityThreshold: number;
  blockedTerms: string[];
  blockedUrlHosts: string[];
};

type SafetyTrigger = {
  type: string;
  field: string;
  value: string;
  scoreDelta: number;
};

type SafetyRisk = {
  score: number;
  severity: "low" | "medium" | "high";
  flagged: boolean;
  triggers: SafetyTrigger[];
  inspectedUrlCount: number;
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
type GetCommunitySafetyConfigResponse = {
  ok: boolean;
  config?: Record<string, unknown>;
};
type ScanCommunityDraftResponse = {
  ok: boolean;
  risk?: SafetyRisk;
};

type SafetyPreset = {
  id: string;
  label: string;
  description: string;
  config: Pick<
    CommunitySafetyConfig,
    "enabled" | "publishKillSwitch" | "autoFlagEnabled" | "mediumSeverityThreshold" | "highSeverityThreshold"
  >;
  blockedTerms: string[];
  blockedUrlHosts: string[];
};

const SAFETY_PRESETS: SafetyPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "General studio operations with proactive scanning and moderate thresholds.",
    config: {
      enabled: true,
      publishKillSwitch: false,
      autoFlagEnabled: true,
      mediumSeverityThreshold: 35,
      highSeverityThreshold: 70,
    },
    blockedTerms: ["scam", "counterfeit", "violent threat", "hate group", "doxx"],
    blockedUrlHosts: ["tinyurl.com", "bit.ly", "t.co"],
  },
  {
    id: "strict",
    label: "Strict",
    description: "High-alert moderation for abuse spikes and active incidents.",
    config: {
      enabled: true,
      publishKillSwitch: false,
      autoFlagEnabled: true,
      mediumSeverityThreshold: 25,
      highSeverityThreshold: 55,
    },
    blockedTerms: ["scam", "counterfeit", "violent threat", "hate group", "doxx", "harass", "attack", "swat", "exploit"],
    blockedUrlHosts: ["tinyurl.com", "bit.ly", "t.co", "shorturl.at", "cutt.ly"],
  },
  {
    id: "review-only",
    label: "Review-Only",
    description: "Keep scanner on, but disable auto-flagging for manual moderation windows.",
    config: {
      enabled: true,
      publishKillSwitch: false,
      autoFlagEnabled: false,
      mediumSeverityThreshold: 35,
      highSeverityThreshold: 70,
    },
    blockedTerms: ["scam", "counterfeit", "violent threat", "hate group", "doxx"],
    blockedUrlHosts: ["tinyurl.com", "bit.ly", "t.co"],
  },
];

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

function parseMultiline(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizePresetList(list: string[]): string[] {
  return list.map((entry) => entry.trim()).filter(Boolean);
}

function toBoolean(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function normalizeSafetyConfig(row: Record<string, unknown> | undefined): CommunitySafetyConfig {
  const blockedTerms = Array.isArray(row?.blockedTerms)
    ? row?.blockedTerms.map((entry) => str(entry).trim()).filter(Boolean)
    : [];
  const blockedUrlHosts = Array.isArray(row?.blockedUrlHosts)
    ? row?.blockedUrlHosts.map((entry) => str(entry).trim()).filter(Boolean)
    : [];

  return {
    enabled: toBoolean(row?.enabled, true),
    publishKillSwitch: toBoolean(row?.publishKillSwitch, false),
    autoFlagEnabled: toBoolean(row?.autoFlagEnabled, true),
    highSeverityThreshold: Number.isFinite(row?.highSeverityThreshold as number)
      ? Number(row?.highSeverityThreshold)
      : 70,
    mediumSeverityThreshold: Number.isFinite(row?.mediumSeverityThreshold as number)
      ? Number(row?.mediumSeverityThreshold)
      : 35,
    blockedTerms,
    blockedUrlHosts,
  };
}

export default function PolicyModule({ client, active, disabled }: Props) {
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [activeVersion, setActiveVersion] = useState("");
  const [policies, setPolicies] = useState<PolicyVersion[]>([]);
  const [currentPolicy, setCurrentPolicy] = useState<PolicyVersion | null>(null);
  const [safetyConfig, setSafetyConfig] = useState<CommunitySafetyConfig>({
    enabled: true,
    publishKillSwitch: false,
    autoFlagEnabled: true,
    highSeverityThreshold: 70,
    mediumSeverityThreshold: 35,
    blockedTerms: [],
    blockedUrlHosts: [],
  });

  const [versionDraft, setVersionDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [rulesDraft, setRulesDraft] = useState("R1.respectful_conduct | Respectful conduct | Harassment or hate speech is not allowed. | high");
  const [blockedTermsDraft, setBlockedTermsDraft] = useState("");
  const [blockedHostsDraft, setBlockedHostsDraft] = useState("");
  const [scanTitle, setScanTitle] = useState("");
  const [scanSummary, setScanSummary] = useState("");
  const [scanDescription, setScanDescription] = useState("");
  const [scanUrls, setScanUrls] = useState("");
  const [scanResult, setScanResult] = useState<SafetyRisk | null>(null);

  const selectedVersion = useMemo(() => {
    if (!versionDraft) return null;
    return policies.find((policy) => policy.version === versionDraft || policy.id === versionDraft) ?? null;
  }, [policies, versionDraft]);

  const safetyPosture = useMemo(() => {
    if (safetyConfig.publishKillSwitch) {
      return {
        level: "emergency",
        message: "Publish kill switch is active. New community publishing should remain paused.",
      };
    }
    if (!safetyConfig.enabled) {
      return {
        level: "critical",
        message: "Safety scanner is disabled. Community publishing is running without proactive scanning.",
      };
    }
    if (!safetyConfig.autoFlagEnabled) {
      return {
        level: "warning",
        message: "Auto-flagging is disabled. High-risk drafts will not be auto-routed for review.",
      };
    }
    return {
      level: "healthy",
      message: "Safety controls are active and auto-flagging is enabled.",
    };
  }, [safetyConfig]);

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
    const [currentResp, listResp, safetyResp] = await Promise.all([
      client.postJson<CurrentPolicyResponse>("getModerationPolicyCurrent", {}),
      client.postJson<ListPoliciesResponse>("listModerationPolicies", { includeArchived: false, limit: 40 }),
      client.postJson<GetCommunitySafetyConfigResponse>("staffGetCommunitySafetyConfig", {}),
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
    const normalizedSafety = normalizeSafetyConfig(
      (safetyResp.config ?? {}) as Record<string, unknown>
    );
    setSafetyConfig(normalizedSafety);
    setBlockedTermsDraft(normalizedSafety.blockedTerms.join("\n"));
    setBlockedHostsDraft(normalizedSafety.blockedUrlHosts.join("\n"));

    if (!versionDraft && normalizedPolicies.length > 0) {
      const nextVersion = str(listResp.activeVersion) || normalizedPolicies[0].version;
      setVersionDraft(nextVersion);
      const selected = normalizedPolicies.find((policy) => policy.version === nextVersion) ?? normalizedPolicies[0];
      setTitleDraft(selected.title);
      setSummaryDraft(selected.summary);
      setRulesDraft(serializeRulesToText(selected.rules));
    }
  };

  const persistSafetyPatch = async (patch: Partial<CommunitySafetyConfig>, successMessage: string) => {
    await client.postJson<BasicResponse>("staffUpdateCommunitySafetyConfig", patch);
    await loadAll();
    setStatus(successMessage);
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

      <hr />
      <div className="card-title">Proactive moderation safety controls</div>
      <div className="staff-note">
        These controls apply to community publishing flows and staff draft scans.
      </div>
      <div className={`staff-note ${safetyPosture.level === "healthy" ? "" : "staff-note-error"}`}>
        Safety posture: <strong>{safetyPosture.level}</strong> · {safetyPosture.message}
      </div>
      <div className="staff-actions-row">
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled || safetyConfig.publishKillSwitch}
          onClick={() =>
            void run("engageKillSwitch", async () => {
              await persistSafetyPatch(
                {
                  publishKillSwitch: true,
                },
                "Emergency publish kill switch enabled."
              );
            })
          }
        >
          Engage emergency kill switch
        </button>
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled}
          onClick={() =>
            void run("restoreSafetyDefaults", async () => {
              await persistSafetyPatch(
                {
                  enabled: true,
                  autoFlagEnabled: true,
                  publishKillSwitch: false,
                },
                "Safety controls restored to normal operations."
              );
            })
          }
        >
          Restore normal safety defaults
        </button>
      </div>
      <div className="staff-subtitle">Safety presets</div>
      <div className="staff-actions-row">
        {SAFETY_PRESETS.map((preset) => (
          <div key={preset.id} className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={Boolean(busy) || disabled}
              onClick={() => {
                setSafetyConfig((prev) => ({
                  ...prev,
                  ...preset.config,
                }));
                setBlockedTermsDraft(normalizePresetList(preset.blockedTerms).join("\n"));
                setBlockedHostsDraft(normalizePresetList(preset.blockedUrlHosts).join("\n"));
                setStatus(`Loaded "${preset.label}" preset. Save safety controls to apply.`);
              }}
            >
              Load {preset.label}
            </button>
            <button
              className="btn btn-ghost"
              disabled={Boolean(busy) || disabled}
              onClick={() =>
                void run(`applyPreset-${preset.id}`, async () => {
                  await persistSafetyPatch(
                    {
                      ...preset.config,
                      blockedTerms: normalizePresetList(preset.blockedTerms),
                      blockedUrlHosts: normalizePresetList(preset.blockedUrlHosts),
                    },
                    `Applied "${preset.label}" preset.`
                  );
                })
              }
            >
              Apply now
            </button>
          </div>
        ))}
      </div>
      <div className="staff-note">
        {SAFETY_PRESETS.map((preset) => `${preset.label}: ${preset.description}`).join(" | ")}
      </div>
      <div className="staff-actions-row">
        <label className="staff-inline-check">
          <input
            type="checkbox"
            checked={safetyConfig.enabled}
            onChange={(event) =>
              setSafetyConfig((prev) => ({ ...prev, enabled: event.target.checked }))
            }
          />
          Safety scanner enabled
        </label>
        <label className="staff-inline-check">
          <input
            type="checkbox"
            checked={safetyConfig.autoFlagEnabled}
            onChange={(event) =>
              setSafetyConfig((prev) => ({ ...prev, autoFlagEnabled: event.target.checked }))
            }
          />
          Auto-flag high severity drafts
        </label>
        <label className="staff-inline-check">
          <input
            type="checkbox"
            checked={safetyConfig.publishKillSwitch}
            onChange={(event) =>
              setSafetyConfig((prev) => ({ ...prev, publishKillSwitch: event.target.checked }))
            }
          />
          Publish kill switch
        </label>
      </div>

      <div className="staff-actions-row">
        <label className="staff-field">
          Medium threshold
          <input
            type="number"
            min={1}
            max={99}
            value={safetyConfig.mediumSeverityThreshold}
            onChange={(event) =>
              setSafetyConfig((prev) => ({
                ...prev,
                mediumSeverityThreshold: Number(event.target.value || prev.mediumSeverityThreshold),
              }))
            }
          />
        </label>
        <label className="staff-field">
          High threshold
          <input
            type="number"
            min={2}
            max={100}
            value={safetyConfig.highSeverityThreshold}
            onChange={(event) =>
              setSafetyConfig((prev) => ({
                ...prev,
                highSeverityThreshold: Number(event.target.value || prev.highSeverityThreshold),
              }))
            }
          />
        </label>
      </div>

      <label className="staff-field">
        Blocked terms (one per line)
        <textarea
          value={blockedTermsDraft}
          onChange={(event) => setBlockedTermsDraft(event.target.value)}
          placeholder="scam&#10;counterfeit&#10;violent threat"
        />
      </label>
      <label className="staff-field">
        Blocked URL hosts (one per line)
        <textarea
          value={blockedHostsDraft}
          onChange={(event) => setBlockedHostsDraft(event.target.value)}
          placeholder="tinyurl.com&#10;bit.ly"
        />
      </label>
      <div className="staff-actions-row">
        <button
          className="btn btn-primary"
          disabled={Boolean(busy) || disabled}
          onClick={() =>
            void run("saveSafetyConfig", async () => {
              await persistSafetyPatch(
                {
                  enabled: safetyConfig.enabled,
                  publishKillSwitch: safetyConfig.publishKillSwitch,
                  autoFlagEnabled: safetyConfig.autoFlagEnabled,
                  highSeverityThreshold: safetyConfig.highSeverityThreshold,
                  mediumSeverityThreshold: safetyConfig.mediumSeverityThreshold,
                  blockedTerms: parseMultiline(blockedTermsDraft),
                  blockedUrlHosts: parseMultiline(blockedHostsDraft),
                },
                "Community safety controls saved."
              );
            })
          }
        >
          Save safety controls
        </button>
      </div>

      <hr />
      <div className="card-title">Draft risk scan</div>
      <div className="staff-note">
        Run a pre-publish scan for event/community copy before publishing.
      </div>
      <label className="staff-field">
        Scan title
        <input value={scanTitle} onChange={(event) => setScanTitle(event.target.value)} placeholder="Draft title" />
      </label>
      <label className="staff-field">
        Scan summary
        <textarea value={scanSummary} onChange={(event) => setScanSummary(event.target.value)} placeholder="Draft summary" />
      </label>
      <label className="staff-field">
        Scan description
        <textarea value={scanDescription} onChange={(event) => setScanDescription(event.target.value)} placeholder="Draft description" />
      </label>
      <label className="staff-field">
        Scan URLs (one per line)
        <textarea value={scanUrls} onChange={(event) => setScanUrls(event.target.value)} placeholder="https://..." />
      </label>
      <div className="staff-actions-row">
        <button
          className="btn btn-secondary"
          disabled={Boolean(busy) || disabled}
          onClick={() =>
            void run("scanDraft", async () => {
              const resp = await client.postJson<ScanCommunityDraftResponse>("staffScanCommunityDraft", {
                title: scanTitle.trim() || null,
                summary: scanSummary.trim() || null,
                description: scanDescription.trim() || null,
                urls: parseMultiline(scanUrls),
              });
              setScanResult(resp.risk ?? null);
              setStatus("Draft scan completed.");
            })
          }
        >
          Run draft scan
        </button>
      </div>
      {scanResult ? (
        <div className="staff-note">
          <strong>Risk: {scanResult.severity.toUpperCase()}</strong> · score {scanResult.score} · triggers {scanResult.triggers.length}<br />
          {scanResult.triggers.length ? (
            <span>
              {scanResult.triggers
                .map((trigger) => `${trigger.type}:${trigger.value} (+${trigger.scoreDelta})`)
                .join(" | ")}
            </span>
          ) : (
            <span>No triggers detected.</span>
          )}
        </div>
      ) : null}

      {status ? (
        <div className="staff-note" role="status" aria-live="polite">
          {status}
        </div>
      ) : null}
      {error ? (
        <div className="staff-note staff-note-error" role="alert" aria-live="assertive">
          {error}
        </div>
      ) : null}
    </section>
  );
}
