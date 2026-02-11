import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { formatDateTime } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./MembershipView.css";

type ProfileDoc = {
  displayName?: string | null;
  membershipTier?: string;
  membershipSince?: { toDate?: () => Date } | null;
  membershipExpiresAt?: { toDate?: () => Date } | null;
};

type Tier = {
  key: string;
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
    key: "a-la-carte",
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
      "Kiln loading basics sign‑off",
      "Stewardship habit check‑in",
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
      "Large‑batch handling plan",
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
      "Coffee, tea, and simple snacks so your creative momentum doesn’t stall mid-session.",
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

const normalizeTier = (value: string | undefined | null) =>
  (value ?? "").toLowerCase().replace(/[^a-z]/g, "");

const TIER_ALIASES: Record<string, string> = {
  studio: "A la carte",
  studiomember: "A la carte",
  premium: "Apprentice",
  founding: "Master",
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTierLabel(value: string | undefined | null): string | null {
  const normalized = normalizeTier(value);
  if (!normalized) return null;

  const direct = TIERS.find(
    (tier) =>
      normalizeTier(tier.label) === normalized || normalizeTier(tier.key) === normalized
  );
  if (direct) return direct.label;

  const alias = TIER_ALIASES[normalized];
  if (!alias) return null;

  const aliasNormalized = normalizeTier(alias);
  const aliasTier = TIERS.find((tier) => normalizeTier(tier.label) === aliasNormalized);
  return aliasTier ? aliasTier.label : alias;
}

function getTierIndex(label: string): number {
  const resolved = resolveTierLabel(label) ?? TIERS[0]?.label ?? label;
  const normalized = normalizeTier(resolved);
  return TIERS.findIndex((tier) => normalizeTier(tier.label) === normalized);
}

export default function MembershipView({ user }: { user: User }) {
  const [profileDoc, setProfileDoc] = useState<ProfileDoc | null>(null);
  const [profileError, setProfileError] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [selectedTierIndex, setSelectedTierIndex] = useState(0);
  const [journeyOpen, setJourneyOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      if (!user) return;
      setProfileError("");
      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);
        if (cancelled) return;
        setProfileDoc((snap.data() as ProfileDoc | undefined) ?? null);
      } catch (error: unknown) {
        if (cancelled) return;
        setProfileError(`Membership failed: ${getErrorMessage(error) || "Unable to load profile."}`);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const membershipTierRaw = profileDoc?.membershipTier ?? "Studio Member";
  const membershipTierLabel = resolveTierLabel(membershipTierRaw) ?? membershipTierRaw;
  const membershipSince =
    profileDoc?.membershipSince?.toDate?.() ??
    (user.metadata.creationTime ? new Date(user.metadata.creationTime) : null);
  const membershipExpires = profileDoc?.membershipExpiresAt?.toDate?.() ?? null;

  const currentTierIndex = useMemo(() => getTierIndex(membershipTierLabel), [membershipTierLabel]);
  const currentTier = currentTierIndex >= 0 ? TIERS[currentTierIndex] : null;
  const selectedTier =
    selectedTierIndex >= 0 && selectedTierIndex < TIERS.length ? TIERS[selectedTierIndex] : null;
  const hasSelectionChange = currentTierIndex >= 0 && selectedTierIndex !== currentTierIndex;
  const canMoveDown = selectedTierIndex > 0;
  const canMoveUp = selectedTierIndex < TIERS.length - 1;
  const selectedTierChanges = useMemo(() => {
    if (!selectedTier || currentTierIndex < 0) {
      return {
        visibleLines: [] as string[],
        hiddenCount: 0,
      };
    }

    if (!hasSelectionChange) {
      return {
        visibleLines: [] as string[],
        hiddenCount: 0,
      };
    }

    const allChanges = PERKS.map((perk) => {
      const fromValue = perk.values[currentTierIndex] ?? "—";
      const toValue = perk.values[selectedTierIndex] ?? "—";
      if (fromValue === toValue) return null;
      return `${perk.label}: ${fromValue} → ${toValue}`;
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
    if (!user || saveBusy || !selectedTier || !hasSelectionChange) return;
    setSaveBusy(true);
    setSaveStatus("Saving membership level...");

    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          membershipTier: selectedTier.label,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setProfileDoc((prev) => ({
        ...(prev ?? {}),
        membershipTier: selectedTier.label,
      }));
      setSaveStatus(`Membership updated to ${selectedTier.label}.`);
    } catch (error: unknown) {
      setSaveStatus(`Update failed: ${getErrorMessage(error)}`);
    } finally {
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
              Use the arrows to move between tiers, then save when you are ready.
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
              <strong>{membershipSince ? formatDateTime(membershipSince) : "—"}</strong>
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
            {profileError ? <div className="alert inline-alert">{profileError}</div> : null}
            <div className="membership-status-actions">
              <div className="membership-target">
                <span className="summary-label">Upgraded Features</span>
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
                  disabled={saveBusy || !selectedTier}
                >
                  {saveBusy ? "Saving..." : "Save membership level"}
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
                ←
              </button>
            ) : null}
            {canMoveDown && canMoveUp ? (
              <span className="journey-arrow-symbol" aria-hidden="true">
                ↔
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
                →
              </button>
            ) : null}
          </div>

          <div className="journey-card next">
            <div className="journey-card-top">
              <span className="journey-label">Selected level</span>
              {selectedTier ? <span className="journey-tier">{selectedTier.label}</span> : <span>—</span>}
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
                  normalizeTier(tier.label) === normalizeTier(membershipTierLabel) ? "current" : ""
                }`}
              >
                <span>{tier.label}</span>
                {normalizeTier(tier.label) === normalizeTier(membershipTierLabel) ? (
                  <span className="membership-you-are-here" aria-label="You are here">
                    👉 You are here
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
                    normalizeTier(TIERS[index]?.label) === normalizeTier(membershipTierLabel) ? "current" : ""
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
