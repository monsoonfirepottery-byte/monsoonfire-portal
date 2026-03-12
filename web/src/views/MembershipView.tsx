import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { createFunctionsClient } from "../api/functionsClient";
import type {
  MembershipChangePlanResponse,
  MembershipPlanCatalogEntry,
  MembershipPlanKey,
  MembershipSummaryResponse,
} from "../api/portalContracts";
import {
  V1_MEMBERSHIPS_CHANGE_PLAN_FN,
  V1_MEMBERSHIPS_SUMMARY_FN,
} from "../api/portalContracts";
import { resolveFunctionsBaseUrl } from "../utils/functionsBaseUrl";
import { formatDateTime } from "../utils/format";
import { checkoutErrorMessage, requestErrorMessage } from "../utils/userFacingErrors";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./MembershipView.css";

type ApiV1Envelope<TData> = {
  ok: boolean;
  requestId?: string;
  code?: string;
  message?: string;
  data?: TData;
};

type MembershipSummaryData = MembershipSummaryResponse;

type Tier = {
  key: MembershipPlanKey;
  label: string;
  stage: string;
  summary: string;
  focus: string;
  milestones: string[];
};

type FeatureClip = {
  title: string;
  summary: string;
  details: string;
};

const TIERS: Tier[] = [
  {
    key: "a_la_carte",
    label: "A la carte",
    stage: "Home studio starter",
    summary:
      "Flexible access when you're still finding your rhythm and experimenting with your voice.",
    focus: "Try things, learn tools, and keep the pressure low.",
    milestones: [
      "Studio orientation + safety briefing",
      "Agreement on studio etiquette",
    ],
  },
  {
    key: "apprentice",
    label: "Apprentice",
    stage: "Consistent maker",
    summary:
      "A steady bridge for artists ready for predictable firings, storage, and support.",
    focus: "Build routines and small production runs with less friction.",
    milestones: [
      "Two successful firings with staff review",
      "Kiln loading basics sign-off",
      "Stewardship habit check-in",
    ],
  },
  {
    key: "journeyman",
    label: "Journeyman",
    stage: "Production momentum",
    summary:
      "More credits and priority help when you need a firing partner you can trust.",
    focus: "Scale output without juggling last-minute kiln logistics.",
    milestones: [
      "Reliable firing history over multiple cycles",
      "Shelf management + labeling confirmed",
      "Production cadence review with staff",
    ],
  },
  {
    key: "master",
    label: "Master",
    stage: "Established studio practice",
    summary:
      "Maximum capacity for makers running full bodies of work and multiple drops.",
    focus: "Keep quality high while volume grows.",
    milestones: [
      "Advanced scheduling coordination",
      "Large-batch handling plan",
      "Studio stewardship leadership",
    ],
  },
];

const PERKS = [
  {
    label: "Monthly firing credits",
    values: ["0", "25", "55", "100"],
  },
  {
    label: "Firing discount",
    values: ["0%", "15%", "25%", "35%"],
  },
  {
    label: "Recycled clay allowance",
    values: ["0 lbs", "5 lbs", "10 lbs", "25 lbs"],
  },
  {
    label: "Storage space",
    values: ["Community shelf", "1 shelf", "2 shelves", "3 shelves"],
  },
  {
    label: "Store discount",
    values: ["0%", "5%", "15%", "25%"],
  },
  {
    label: "Monthly day passes",
    values: ["0", "4", "8", "15"],
  },
];

const FEATURE_CLIPS: FeatureClip[] = [
  {
    title: "Lending library",
    summary: "Borrow specialty tools, molds, and reference books on demand.",
    details:
      "The library is built for experiments: trim tools, texture plates, throwing aids, glaze guides, and more. Borrow what you need, return it when you're done.",
  },
  {
    title: "Tool checkout",
    summary: "Extra tools for those moments you need just one more setup.",
    details:
      "Short-term checkout helps you avoid buying duplicates. Great for testing forms, handles, or surface ideas without a full gear investment.",
  },
  {
    title: "Glaze lab & glaze library",
    summary: "Expand your surface options without reinventing the wheel.",
    details:
      "Access shared glazes, test tiles, and studio recipes. We keep notes so you can dial in color and texture with confidence.",
  },
  {
    title: "Reclaim station",
    summary: "Keep your clay loop efficient and less wasteful.",
    details:
      "Reclaim keeps projects moving even when batches don't go as planned. Bring your reclaim and we keep it circulating.",
  },
  {
    title: "Studio storage",
    summary: "Make room for drying, batching, and larger runs.",
    details:
      "Storage is the first pinch point for home studios. Memberships unlock steady shelf space and clear labeling.",
  },
  {
    title: "Kiln consultations",
    summary: "Plan firings with a partner instead of guessing solo.",
    details:
      "Discuss clay bodies, glaze schedules, and stacking strategy with staff before you fire. We help you avoid avoidable losses.",
  },
  {
    title: "Community events",
    summary: "Find peers who understand the grind and the joy.",
    details:
      "Open studio nights, critiques, and seasonal showcases. The goal is support, not pressure.",
  },
  {
    title: "Theatre room",
    summary: "A quiet place to plan, sketch, or reset between work blocks.",
    details:
      "Use it for low-light sketches, small group planning, or stepping away when your hands need a break.",
  },
  {
    title: "Snack & beverage station",
    summary: "Keep your energy steady without leaving the studio.",
    details:
      "Coffee, tea, and simple snacks so your creative momentum doesn't stall mid-session.",
  },
  {
    title: "Gym access",
    summary: "Care for your body while your hands do the work.",
    details:
      "Light strength and mobility equipment to support the physicality of long studio sessions.",
  },
  {
    title: "Discord server",
    summary: "Stay connected between studio days.",
    details:
      "Share kiln updates, ask quick questions, and get encouragement from other makers in the community.",
  },
];

const TIER_ALIASES: Record<string, MembershipPlanKey> = {
  studio: "a_la_carte",
  studiomember: "a_la_carte",
  premium: "apprentice",
  founding: "master",
  alacarte: "a_la_carte",
};

const normalizeTier = (value: string | undefined | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z]/g, "");

function resolveTierKey(value: string | MembershipPlanKey | undefined | null): MembershipPlanKey | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed in TIER_ALIASES) {
    return TIER_ALIASES[trimmed as keyof typeof TIER_ALIASES];
  }
  const direct = TIERS.find(
    (tier) =>
      tier.key === trimmed ||
      normalizeTier(tier.key) === normalizeTier(trimmed) ||
      normalizeTier(tier.label) === normalizeTier(trimmed)
  );
  if (direct) return direct.key;
  return TIER_ALIASES[normalizeTier(trimmed)] ?? null;
}

function getTierIndex(keyOrLabel: string | MembershipPlanKey | undefined | null): number {
  const key = resolveTierKey(keyOrLabel) ?? TIERS[0]?.key ?? "a_la_carte";
  return TIERS.findIndex((tier) => tier.key === key);
}

function parseMaybeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function planCatalogEntryByKey(
  plans: MembershipPlanCatalogEntry[] | undefined,
  key: MembershipPlanKey | undefined | null
): MembershipPlanCatalogEntry | null {
  if (!plans || !key) return null;
  return plans.find((plan) => plan.key === key) ?? null;
}

export default function MembershipView({ user }: { user: User }) {
  const [summary, setSummary] = useState<MembershipSummaryData | null>(null);
  const [profileError, setProfileError] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [selectedTierIndex, setSelectedTierIndex] = useState(0);
  const [journeyOpen, setJourneyOpen] = useState(false);

  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: resolveFunctionsBaseUrl(),
        getIdToken: () => user.getIdToken(),
      }),
    [user]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("intent") !== "membership") return;
    const status = params.get("status");
    const planKey = resolveTierKey(params.get("plan"));
    const planLabel = planKey ? TIERS.find((tier) => tier.key === planKey)?.label : null;
    if (status === "success") {
      setSaveStatus(
        `Checkout complete${planLabel ? ` for ${planLabel}` : ""}. We're syncing your membership now.`
      );
      return;
    }
    if (status === "cancel") {
      setSaveStatus(
        `Checkout canceled${planLabel ? ` for ${planLabel}` : ""}. You can reopen checkout any time.`
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setProfileError("");
      try {
        const envelope = await client.postJson<ApiV1Envelope<MembershipSummaryData>>(
          V1_MEMBERSHIPS_SUMMARY_FN,
          {}
        );
        if (cancelled) return;
        if (!envelope.ok || !envelope.data) {
          throw new Error(envelope.message || "Unable to load membership summary.");
        }
        setSummary(envelope.data);
      } catch (error: unknown) {
        if (cancelled) return;
        setProfileError(`Membership failed: ${requestErrorMessage(error, { includeSupportCode: false })}`);
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const membership = summary?.membership ?? null;
  const membershipPlanKey = resolveTierKey(membership?.planKey ?? membership?.label) ?? "a_la_carte";
  const membershipTierLabel =
    TIERS.find((tier) => tier.key === membershipPlanKey)?.label ?? membership?.label ?? "A la carte";
  const membershipSince =
    parseMaybeDate(membership?.since) ??
    (user.metadata.creationTime ? new Date(user.metadata.creationTime) : null);
  const membershipExpires = parseMaybeDate(membership?.renewalAt);

  const currentTierIndex = useMemo(() => getTierIndex(membershipPlanKey), [membershipPlanKey]);
  const currentTier = currentTierIndex >= 0 ? TIERS[currentTierIndex] : null;
  const selectedTier =
    selectedTierIndex >= 0 && selectedTierIndex < TIERS.length ? TIERS[selectedTierIndex] : null;
  const hasSelectionChange =
    currentTierIndex >= 0 && selectedTier != null && selectedTier.key !== membershipPlanKey;
  const canMoveDown = selectedTierIndex > 0;
  const canMoveUp = selectedTierIndex < TIERS.length - 1;
  const selectedPlanCatalog = planCatalogEntryByKey(summary?.availablePlans, selectedTier?.key ?? null);
  const selectedTierChanges = useMemo(() => {
    if (!selectedTier || currentTierIndex < 0 || !hasSelectionChange) {
      return {
        visibleLines: [] as string[],
        hiddenCount: 0,
      };
    }

    const allChanges = PERKS.map((perk) => {
      const fromValue = perk.values[currentTierIndex] ?? "-";
      const toValue = perk.values[selectedTierIndex] ?? "-";
      if (fromValue === toValue) return null;
      return `${perk.label}: ${fromValue} -> ${toValue}`;
    }).filter((line): line is string => Boolean(line));

    return {
      visibleLines: allChanges.slice(0, 4),
      hiddenCount: Math.max(allChanges.length - 4, 0),
    };
  }, [currentTierIndex, hasSelectionChange, selectedTier, selectedTierIndex]);

  useEffect(() => {
    if (currentTierIndex >= 0) {
      setSelectedTierIndex(currentTierIndex);
    }
  }, [currentTierIndex]);

  const handleShiftTierSelection = (direction: "down" | "up") => {
    setSaveStatus("");
    setSelectedTierIndex((prev) => {
      if (direction === "down") return Math.max(prev - 1, 0);
      return Math.min(prev + 1, TIERS.length - 1);
    });
  };

  const handleSaveTier = async () => {
    if (!selectedTier || saveBusy || !hasSelectionChange) return;
    if (!selectedPlanCatalog?.checkoutEnabled) {
      setSaveStatus("This membership tier is not ready for checkout yet.");
      return;
    }

    setSaveBusy(true);
    setSaveStatus(`Opening secure checkout for ${selectedTier.label}...`);

    try {
      const envelope = await client.postJson<ApiV1Envelope<MembershipChangePlanResponse>>(
        V1_MEMBERSHIPS_CHANGE_PLAN_FN,
        {
          planKey: selectedTier.key,
        }
      );
      const data = envelope.data;
      if (!envelope.ok || !data?.checkoutUrl) {
        throw new Error(envelope.message || "Membership checkout link is unavailable.");
      }
      window.location.assign(data.checkoutUrl);
    } catch (error: unknown) {
      setSaveStatus(`Checkout failed: ${checkoutErrorMessage(error)}`);
      setSaveBusy(false);
    }
  };

  return (
    <div className="page membership-page">
      <div className="page-header">
        <div>
          <h1>Memberships</h1>
        </div>
      </div>

      <section className="card card-3d membership-journey">
        <div className="journey-head">
          <div>
            <div className="card-title">Membership level</div>
            <p className="membership-copy">
              Choose a tier, review the changes, and open secure checkout when you're ready.
            </p>
          </div>
          <button className="btn btn-ghost journey-link" onClick={() => setJourneyOpen(true)}>
            View full journey
          </button>
        </div>

        <div className="journey-now">
          <div className="journey-card current">
            <div className="journey-card-top">
              <span className="journey-label">Current tier</span>
              <span className="pill">Current</span>
            </div>
            <div className="journey-card-title">{membershipTierLabel}</div>
            <div className="journey-card-meta">
              <span>Member since</span>
              <strong>{membershipSince ? formatDateTime(membershipSince) : "-"}</strong>
            </div>
            <div className="journey-card-meta">
              <span>Renewal</span>
              <strong>{membershipExpires ? formatDateTime(membershipExpires) : "Auto-renews"}</strong>
            </div>
            {currentTier ? (
              <div className="journey-card-copy">{currentTier.summary}</div>
            ) : (
              <div className="journey-card-copy">
                We are still syncing your membership tier details.
              </div>
            )}
            {membership?.pendingPlanLabel ? (
              <div className="notice inline-alert">
                Pending checkout: {membership.pendingPlanLabel}
              </div>
            ) : null}
            {profileError ? <div className="alert inline-alert">{profileError}</div> : null}
            <div className="membership-status-actions">
              <div className="membership-target">
                <span className="summary-label">Selected tier</span>
                <span className="summary-value">
                  {selectedTier?.label ?? membershipTierLabel}
                </span>
                {hasSelectionChange ? (
                  <div className="membership-target-list">
                    {selectedTierChanges.visibleLines.length > 0 ? (
                      selectedTierChanges.visibleLines.map((line) => (
                        <div key={line} className="membership-target-item">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="membership-target-item">No perk changes for this tier move.</div>
                    )}
                    {selectedTierChanges.hiddenCount > 0 ? (
                      <div className="membership-target-more">
                        +{selectedTierChanges.hiddenCount} more changes
                      </div>
                    ) : null}
                    {selectedPlanCatalog && !selectedPlanCatalog.checkoutEnabled ? (
                      <div className="membership-target-item">
                        Checkout is not configured for this plan yet.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="membership-target-item">
                    Select a different tier to preview feature changes.
                  </div>
                )}
              </div>
              {saveStatus ? <div className="notice inline-alert">{saveStatus}</div> : null}
              {hasSelectionChange ? (
                <button
                  className="btn btn-primary"
                  onClick={toVoidHandler(handleSaveTier)}
                  disabled={saveBusy || !selectedTier || !selectedPlanCatalog?.checkoutEnabled}
                >
                  {saveBusy ? "Opening checkout..." : "Change membership in checkout"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="journey-arrow" role="group" aria-label="Membership tier selector">
            {canMoveDown ? (
              <button
                type="button"
                className="journey-arrow-btn"
                onClick={() => handleShiftTierSelection("down")}
                aria-label="Move down one membership tier"
                title="Move down one tier"
              >
                <span aria-hidden="true">&larr;</span>
              </button>
            ) : null}
            {canMoveDown && canMoveUp ? (
              <span className="journey-arrow-symbol" aria-hidden="true">
                <span aria-hidden="true">&harr;</span>
              </span>
            ) : null}
            {canMoveUp ? (
              <button
                type="button"
                className="journey-arrow-btn"
                onClick={() => handleShiftTierSelection("up")}
                aria-label="Move up one membership tier"
                title="Move up one tier"
              >
                <span aria-hidden="true">&rarr;</span>
              </button>
            ) : null}
          </div>

          <div className="journey-card next">
            <div className="journey-card-top">
              <span className="journey-label">Selected level</span>
              {selectedTier ? <span className="journey-tier">{selectedTier.label}</span> : <span>-</span>}
            </div>
            {selectedTier ? (
              <>
                <div className="journey-card-title">{selectedTier.stage}</div>
                <div className="journey-card-copy">{selectedTier.summary}</div>
                <div className="journey-milestones">
                  <div className="journey-label">Milestones</div>
                  <ul>
                    {selectedTier.milestones.map((milestone) => (
                      <li key={milestone}>{milestone}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="journey-card-copy">
                We're still syncing available membership levels.
              </div>
            )}
          </div>
        </div>
      </section>

      {journeyOpen ? (
        <div className="journey-modal" role="dialog" aria-modal="true">
          <div className="journey-modal-card">
            <div className="journey-modal-head">
              <div>
                <div className="card-title">Full membership journey</div>
                <p className="membership-copy">
                  These steps are here whenever you're ready. Each tier is about capability and care,
                  not just cost.
                </p>
              </div>
              <button className="btn btn-ghost" onClick={() => setJourneyOpen(false)}>
                Close
              </button>
            </div>
            <div className="journey-modal-grid">
              {TIERS.map((tier) => (
                <div key={tier.key} className="journey-modal-tier">
                  <div className="journey-modal-title">{tier.label}</div>
                  <div className="journey-modal-stage">{tier.stage}</div>
                  <p className="journey-modal-copy">{tier.summary}</p>
                  <div className="journey-modal-milestones">
                    <div className="journey-label">Milestones</div>
                    <ul>
                      {tier.milestones.map((milestone) => (
                        <li key={milestone}>{milestone}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <section className="card card-3d membership-table-card">
        <div className="card-title">Plan comparison</div>
        <div className="membership-table">
          <div className="membership-row membership-header">
            <div className="membership-cell heading">Perk</div>
            {TIERS.map((tier) => (
              <div
                key={tier.key}
                className={`membership-cell heading ${
                  tier.key === membershipPlanKey ? "current" : ""
                }`}
              >
                <span>{tier.label}</span>
                {tier.key === membershipPlanKey ? (
                  <span className="membership-you-are-here" aria-label="You are here">
                    You are here
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          {PERKS.map((perk) => (
            <div key={perk.label} className="membership-row">
              <div className="membership-cell label">{perk.label}</div>
              {perk.values.map((value, index) => (
                <div
                  key={`${perk.label}-${TIERS[index]?.key}`}
                  className={`membership-cell ${
                    TIERS[index]?.key === membershipPlanKey ? "current" : ""
                  }`}
                >
                  {value}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card card-3d membership-features">
        <div className="card-title">Studio features (drill down)</div>
        <p className="membership-copy">
          Open any feature to learn more. Start with what you need today, and come back when you're
          ready for the next layer.
        </p>
        <div className="feature-grid">
          {FEATURE_CLIPS.map((feature) => (
            <details key={feature.title} className="feature-clip">
              <summary>
                <span>{feature.title}</span>
                <em>{feature.summary}</em>
              </summary>
              <p>{feature.details}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
