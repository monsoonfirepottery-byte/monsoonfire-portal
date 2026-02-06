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

  const [upgradeBusy, setUpgradeBusy] = useState(false);
  const [downgradeBusy, setDowngradeBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [upgradeStatus, setUpgradeStatus] = useState("");
  const [, setDowngradeStatus] = useState("");
  const [cancelStatus, setCancelStatus] = useState("");
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
  const nextTier =
    currentTierIndex >= 0 && currentTierIndex < TIERS.length - 1
      ? TIERS[currentTierIndex + 1]
      : null;
  const previousTier = currentTierIndex > 0 ? TIERS[currentTierIndex - 1] : null;

  const handleTierUpdate = async (
    type: "upgrade" | "downgrade",
    targetTier: string | null
  ) => {
    if (!user) return;

    if (type === "upgrade") {
      if (upgradeBusy) return;
      setUpgradeBusy(true);
      setUpgradeStatus("Updating membership...");
    } else if (type === "downgrade") {
      if (downgradeBusy) return;
      setDowngradeBusy(true);
      setDowngradeStatus("Updating membership...");
    }

    const resolvedTier = (targetTier ?? "").trim();
    if (!resolvedTier) {
      const message = type === "upgrade" ? "You're already at the highest tier." : "No lower tier available.";
      if (type === "upgrade") {
        setUpgradeStatus(message);
        setUpgradeBusy(false);
      } else {
        setDowngradeStatus(message);
        setDowngradeBusy(false);
      }
      return;
    }

    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          membershipTier: resolvedTier,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setProfileDoc((prev) => ({
        ...(prev ?? {}),
        membershipTier: resolvedTier,
      }));

      const successMessage = `Membership updated to ${resolvedTier}.`;
      if (type === "upgrade") {
        setUpgradeStatus(successMessage);
      } else {
        setDowngradeStatus(successMessage);
      }
    } catch (error: unknown) {
      const message = `Update failed: ${getErrorMessage(error)}`;
      if (type === "upgrade") {
        setUpgradeStatus(message);
      } else {
        setDowngradeStatus(message);
      }
    } finally {
      if (type === "upgrade") {
        setUpgradeBusy(false);
      } else if (type === "downgrade") {
        setDowngradeBusy(false);
      }
    }
  };

  const handleCancelRequest = async () => {
    if (!user || cancelBusy) return;
    setCancelBusy(true);
    setCancelStatus("Updating membership...");
    const targetTier = TIERS[0]?.label ?? "A la carte";

    try {
      const ref = doc(db, "profiles", user.uid);
      await setDoc(
        ref,
        {
          membershipTier: targetTier,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setProfileDoc((prev) => ({
        ...(prev ?? {}),
        membershipTier: targetTier,
      }));

      setCancelStatus(`Membership set to ${targetTier}.`);
    } catch (error: unknown) {
      setCancelStatus(`Update failed: ${getErrorMessage(error)}`);
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="page membership-page">
      <div className="page-header">
        <div>
          <h1>Membership, without pressure</h1>
          <p className="page-subtitle">
            If you're making at home, you know the frustration: just enough space and tools to begin,
            but not enough to execute the bigger ideas.
          </p>
        </div>
      </div>

      <section className="card card-3d membership-journey">
        <div className="journey-head">
          <div>
            <div className="card-title">Your journey right now</div>
            <p className="membership-copy">
              We built Monsoon Fire to hold that middle space. You don't need a sales pitch — you need
              a partner who understands how hard it is to grow a practice with inconsistent firings and
              no room to breathe.
            </p>
            <p className="membership-copy">
              As you move into production, firing partners become the bottleneck. Our memberships shift
              as your career changes, so the studio keeps serving you.
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
                <span className="summary-label">Next tier</span>
                <span className="summary-value">{nextTier?.label ?? "Highest tier"}</span>
              </div>
            {upgradeStatus ? <div className="notice inline-alert">{upgradeStatus}</div> : null}
              <button
                className="btn btn-primary"
               onClick={toVoidHandler(() => handleTierUpdate("upgrade", nextTier?.label ?? null))}
               disabled={upgradeBusy || !nextTier}
             >
              {upgradeBusy ? "Sending..." : nextTier ? "Request upgrade" : "Upgrade unavailable"}
            </button>
             <button
               className="btn btn-ghost"
               onClick={toVoidHandler(() => handleTierUpdate("downgrade", previousTier?.label ?? null))}
               disabled={downgradeBusy || !previousTier}
             >
              {downgradeBusy
                ? "Updating..."
                : previousTier
                ? `Downgrade to ${previousTier.label}`
                : "Downgrade unavailable"}
            </button>
               <button
                 className="btn btn-ghost"
                 onClick={toVoidHandler(handleCancelRequest)}
                 disabled={cancelBusy}
               >
                {cancelBusy ? "Updating..." : "Cancel membership"}
              </button>
            </div>
          </div>

          <div className="journey-arrow" aria-hidden="true">
            →
          </div>

          <div className="journey-card next">
            <div className="journey-card-top">
              <span className="journey-label">Next step</span>
              {nextTier ? <span className="journey-tier">{nextTier.label}</span> : <span>—</span>}
            </div>
            {nextTier ? (
              <>
                <div className="journey-card-title">{nextTier.stage}</div>
                <div className="journey-card-copy">{nextTier.summary}</div>
                <div className="journey-milestones">
                  <div className="journey-label">Milestones to unlock</div>
                  <ul>
                    {nextTier.milestones.map((milestone) => (
                      <li key={milestone}>{milestone}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="journey-card-copy">
                You're at the highest tier. If you want to make adjustments, we can help.
              </div>
            )}
          </div>
        </div>

        <div className="journey-actions">
          {cancelStatus ? <div className="notice inline-alert">{cancelStatus}</div> : null}
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
                {tier.label}
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

      <section className="card card-3d membership-help">
        <div className="card-title">Need help choosing?</div>
        <p className="membership-copy">
          If you're unsure which tier fits your season, send a note. We'll make a plan together.
        </p>
        <div className="membership-help-row">
          <div>
            <div className="summary-label">Support response time</div>
            <div className="summary-value">1–2 business days</div>
          </div>
          <div>
            <div className="summary-label">Email</div>
            <div className="summary-value">support@monsoonfire.com</div>
          </div>
        </div>
      </section>
    </div>
  );
}
