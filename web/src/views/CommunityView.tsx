import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "firebase/auth";
import { createFunctionsClient } from "../api/functionsClient";
import "./CommunityView.css";

type ValueChip = {
  title: string;
  detail: string;
  icon: ReactNode;
};

type CommunityEvent = {
  title: string;
  detail: string;
  outcome: string;
};

type VideoLink = {
  title: string;
  reason: string;
  url: string;
  favorite?: boolean;
};

type MemberQuote = {
  quote: string;
  author: string;
};

type WorkflowProof = {
  title: string;
  valueStatement: string;
  testimonial: string;
  example: string;
  impact: string;
};

const COMMUNITY_VALUES: ValueChip[] = [
  {
    title: "Find your people",
    detail: "Studio can be solitary; this is where help and motivation show up.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="16" cy="11" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M3.5 19a4.5 4.5 0 0 1 9 0M12.5 19c.3-1.8 1.9-3 3.7-3 1.8 0 3.3 1.2 3.8 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Learn without pressure",
    detail: "No class, no grades — just quick demos and real tips.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 6h16v12H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M8 10h8M8 14h5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Stay motivated between firings",
    detail: "Keep momentum while the kilns do their slow work.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 4c2.4 2.8 3.6 4.5 3.6 6.4a3.6 3.6 0 0 1-7.2 0C8.4 8.5 9.6 6.8 12 4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const WORKFLOW_PROOFS: WorkflowProof[] = [
  {
    title: "Pricing clarity in one huddle",
    valueStatement: "Turn pricing guesswork into margin-aware pricing you can stand behind.",
    testimonial:
      "“I finally stopped underpricing mugs once someone helped me map glaze loss + firing cost in one sitting.”",
    example:
      "A member adjusted pricing tiers after a 15-minute review, then sold through the next market run without discounting.",
    impact: "Impact: sales confidence + healthier margin",
  },
  {
    title: "Batch flow that ships",
    valueStatement: "Replace scattered solo work with a repeatable batching rhythm.",
    testimonial:
      "“I used to finish random pieces. Now I run in batches and actually get full collections out the door.”",
    example:
      "Weekly accountability rounds moved a maker from sporadic output to consistent batch releases.",
    impact: "Impact: higher output + more completed inventory",
  },
  {
    title: "Fewer firing losses",
    valueStatement: "Reduce preventable defects with shared troubleshooting and process checks.",
    testimonial:
      "“One loading tip from the group saved a whole glaze run I probably would’ve ruined.”",
    example:
      "A shelf-loading adjustment reduced warping and pinholing issues across repeat forms.",
    impact: "Impact: better quality + less rework",
  },
  {
    title: "From stuck to sellable",
    valueStatement: "Get unstuck quickly by bringing one concrete bottleneck to the room.",
    testimonial:
      "“I came in blocked on handles, left with a sequence I could repeat, and finished my preorder set.”",
    example:
      "Skill-swap demos converted a recurring form issue into a repeatable method used across product lines.",
    impact: "Impact: faster execution + stronger confidence",
  },
];

const COMMUNITY_EVENTS: CommunityEvent[] = [
  {
    title: "Shop Nights",
    detail: "Low-key studio hangs after hours with a little gameplay mixed in.",
    outcome: "What you’ll get: motivation and a reason to finish the piece.",
  },
  {
    title: "Watch Nights",
    detail: "Pottery docs and artist talks with quick “try this next session” takeaways.",
    outcome: "What you’ll get: workflow ideas and a new glazing move.",
  },
  {
    title: "Clay Challenges",
    detail: "Timed prompts that make muscle memory show up fast.",
    outcome: "What you’ll get: centering reps and faster throwing.",
  },
  {
    title: "Make & Mend",
    detail: "Fix, patch, reclaim, and play with surfaces together.",
    outcome: "What you’ll get: repair tricks and less wasted clay.",
  },
  {
    title: "Skill Swaps",
    detail: "Short member demos on glazing, trimming, and workflow hacks.",
    outcome: "What you’ll get: troubleshooting and better consistency.",
  },
  {
    title: "Office Hours",
    detail: "Bring one workflow bottleneck and get direct staff feedback.",
    outcome: "What you’ll get: faster fixes on pricing, batching, or kiln planning.",
  },
];

const MEMBER_QUOTES: MemberQuote[] = [
  {
    quote: "Came for kiln space, stayed for the “why is my mug cracking?” answers.",
    author: "Riley · Member",
  },
  {
    quote: "I mostly listen. Still leave with better trimming every week.",
    author: "Jules · Member",
  },
  {
    quote: "Somebody finally showed me handles that don’t look scared.",
    author: "Ari · Member",
  },
];

const SUGGESTED_VIDEOS: VideoLink[] = [
  {
    title: "Centering essentials",
    reason: "Great for consistent walls and faster starts.",
    url: "https://www.youtube.com/results?search_query=pottery+centering+technique",
    favorite: true,
  },
  {
    title: "Pulling consistent walls",
    reason: "Smooths out wobbles and helps with even thickness.",
    url: "https://www.youtube.com/results?search_query=pottery+pulling+walls+tutorial",
  },
  {
    title: "Trimming clean foot rings",
    reason: "Sharper bases and less chipping in bisque.",
    url: "https://www.youtube.com/results?search_query=pottery+trimming+foot+ring",
  },
  {
    title: "Glaze application basics",
    reason: "Reliable coverage without drips or bare spots.",
    url: "https://www.youtube.com/results?search_query=glaze+application+pottery+basics",
  },
];

type Props = {
  user: User;
  onOpenLendingLibrary: () => void;
  onOpenWorkshops: () => void;
};

type ReportCategory = "broken_link" | "incorrect_info" | "spam" | "safety" | "harassment_hate" | "copyright" | "other";
type ReportSeverity = "low" | "medium" | "high";
type ReportTargetType = "youtube_video" | "blog_post" | "studio_update" | "event";

type ReportTarget = {
  targetType: ReportTargetType;
  targetRef: { id: string; url?: string | null; videoId?: string | null; slug?: string | null };
  targetSnapshot: { title: string; url?: string | null; source?: string | null; author?: string | null; publishedAtMs?: number | null };
};

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const FUNCTIONS_BASE_URL = ENV.VITE_FUNCTIONS_BASE_URL ? String(ENV.VITE_FUNCTIONS_BASE_URL) : DEFAULT_FUNCTIONS_BASE_URL;
const HIDDEN_CARDS_KEY = "mf_community_hidden_cards_v1";

const REPORT_CATEGORIES: Array<{ value: ReportCategory; label: string }> = [
  { value: "broken_link", label: "Broken link" },
  { value: "incorrect_info", label: "Incorrect information" },
  { value: "spam", label: "Spam" },
  { value: "safety", label: "Safety concern" },
  { value: "harassment_hate", label: "Harassment / hate" },
  { value: "copyright", label: "Copyright issue" },
  { value: "other", label: "Other" },
];

export default function CommunityView({ user, onOpenLendingLibrary, onOpenWorkshops }: Props) {
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportCategory, setReportCategory] = useState<ReportCategory>("broken_link");
  const [reportSeverity, setReportSeverity] = useState<ReportSeverity>("low");
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [hiddenCards, setHiddenCards] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(HIDDEN_CARDS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  });

  const functionsClient = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: FUNCTIONS_BASE_URL,
        getIdToken: async () => {
          const token = await user.getIdToken();
          return token;
        },
        getAdminToken: () => "",
      }),
    [user]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % MEMBER_QUOTES.length);
    }, 7000);
    return () => window.clearInterval(interval);
  }, []);

  const activeQuote = MEMBER_QUOTES[quoteIndex];

  const isHidden = (cardKey: string) => hiddenCards.includes(cardKey);
  const persistHidden = (next: string[]) => {
    setHiddenCards(next);
    try {
      window.localStorage.setItem(HIDDEN_CARDS_KEY, JSON.stringify(next));
    } catch {
      // ignore local storage failures
    }
  };

  const hideCard = (cardKey: string) => {
    if (isHidden(cardKey)) return;
    persistHidden([...hiddenCards, cardKey]);
    setOpenMenuKey(null);
  };

  const openReport = (target: ReportTarget) => {
    setReportTarget(target);
    setReportCategory("broken_link");
    setReportSeverity("low");
    setReportNote("");
    setReportStatus("");
    setOpenMenuKey(null);
  };

  const submitReport = async () => {
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    setReportStatus("");
    try {
      const finalSeverity: ReportSeverity =
        reportCategory === "safety" ? "high" : reportSeverity;
      const resp = await functionsClient.postJson<{ ok: boolean; reportId?: string; message?: string }>(
        "createReport",
        {
          ...reportTarget,
          category: reportCategory,
          severity: finalSeverity,
          note: reportNote.trim() || null,
        }
      );
      if (!resp.ok) {
        setReportStatus(resp.message ?? "Could not submit report.");
        return;
      }
      setReportStatus(`Report submitted. Reference: ${resp.reportId ?? "pending"}`);
      setTimeout(() => {
        setReportTarget(null);
        setReportStatus("");
      }, 1200);
    } catch (error: unknown) {
      setReportStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setReportBusy(false);
    }
  };

  const reportMenu = (cardKey: string, target: ReportTarget) => (
    <div className="community-card-menu-wrap">
      <button
        type="button"
        className="community-card-menu-btn"
        onClick={() => setOpenMenuKey((prev) => (prev === cardKey ? null : cardKey))}
        aria-label="Open card actions"
      >
        ⋯
      </button>
      {openMenuKey === cardKey ? (
        <div className="community-card-menu">
          <button type="button" onClick={() => openReport(target)}>Report</button>
          <button type="button" onClick={() => hideCard(cardKey)}>Not interested / Hide this card</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="page community-page">
      <div className="page-header">
        <div>
          <h1>Community</h1>
        </div>
      </div>

      <div className="community-layout">
        <div className="community-column">
          <section className="card card-3d community-hero">
            <h2 className="card-title">Why community?</h2>
            <p className="community-copy">
              You can absolutely work solo. Community just makes the hard parts easier: decisions,
              motivation, and the quiet “is this normal?” questions.
            </p>
            <div className="community-values">
              {COMMUNITY_VALUES.map((value) => (
                <div className="community-value" key={value.title}>
                  <div className="community-value-icon" aria-hidden="true">
                    {value.icon}
                  </div>
                  <div>
                    <div className="community-value-title">{value.title}</div>
                    <div className="community-value-detail">{value.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card card-3d community-friction">
            <h2 className="card-title">Workflow-first ways to plug in</h2>
            <p className="community-copy">
              This is not a social club. It is a working community built to help ceramic artists
              produce consistently, sell confidently, and make income on their own terms.
            </p>
            <div className="community-proof-grid">
              {WORKFLOW_PROOFS.map((proof, index) => {
                const cardKey = `proof:${proof.title}`;
                if (isHidden(cardKey)) return null;
                return (
                <details className="community-proof" key={proof.title}>
                  <summary>
                    <span className="community-proof-title">{proof.title}</span>
                    <span className="community-proof-summary-right">
                      <span className="community-proof-hint">Open proof</span>
                      {reportMenu(cardKey, {
                        targetType: "blog_post",
                        targetRef: { id: `workflow-proof-${index + 1}`, slug: `workflow-proof-${index + 1}` },
                        targetSnapshot: { title: proof.title, source: "Monsoon Fire", author: "Studio staff" },
                      })}
                    </span>
                  </summary>
                  <div className="community-proof-body">
                    <p className="community-proof-value">{proof.valueStatement}</p>
                    <p className="community-proof-testimonial">{proof.testimonial}</p>
                    <p className="community-proof-example">{proof.example}</p>
                    <div className="community-proof-impact">{proof.impact}</div>
                  </div>
                </details>
              )})}
            </div>
          </section>

          <section className="card card-3d community-main">
            <h2 className="card-title">Community events & gatherings</h2>
            <p className="community-copy">
              Low-pressure meetups with real payoffs. Come to learn, finish, and keep the momentum
              going between firings.
            </p>
            <div className="community-event-chips">
              <button className="community-event-chip" onClick={onOpenWorkshops}>
                <span className="community-event-chip-title">Workshops</span>
                <span className="community-event-chip-detail">
                  Browse upcoming sessions and reserve your spot.
                </span>
                <span className="community-event-chip-outcome">Open workshops</span>
              </button>
            </div>
            <div className="community-events">
              {COMMUNITY_EVENTS.map((event, index) => {
                const cardKey = `event:${event.title}`;
                if (isHidden(cardKey)) return null;
                return (
                <article className="community-event" key={event.title}>
                  <div className="community-card-head">
                  <h3 className="community-event-title">{event.title}</h3>
                    {reportMenu(cardKey, {
                      targetType: "event",
                      targetRef: { id: `community-event-${index + 1}` },
                      targetSnapshot: { title: event.title, source: "Monsoon Fire", author: "Studio staff" },
                    })}
                  </div>
                  <p className="community-event-detail">{event.detail}</p>
                  <div className="community-event-outcome">{event.outcome}</div>
                </article>
              )})}
            </div>
          </section>

          <section className="card card-3d community-library">
            <h2 className="card-title">Lending library</h2>
            <p className="community-copy">
              Borrow books, films, and studio references for short-term inspiration. Staff approvals
              keep the checkout flow smooth.
            </p>
            <button className="btn btn-primary" onClick={onOpenLendingLibrary}>
              Browse lending library
            </button>
          </section>
        </div>

        <aside className="community-sidebar">
          <section className="card card-3d community-quote" key={activeQuote.quote}>
            <div className="community-card-head">
            <h2 className="card-title">Member note</h2>
              {reportMenu("studio-update:member-note", {
                targetType: "studio_update",
                targetRef: { id: "member-note-rotation" },
                targetSnapshot: { title: "Member note", source: "Monsoon Fire", author: "Studio updates" },
              })}
            </div>
            <p className="community-quote-text">“{activeQuote.quote}”</p>
            <div className="community-quote-author">{activeQuote.author}</div>
          </section>

          <section className="card card-3d community-videos">
            <h2 className="card-title">Suggested videos</h2>
            <p className="community-copy">
              Picked for what we’re doing this month. Swap these links anytime.
            </p>
            <div className="video-list">
              {SUGGESTED_VIDEOS.map((video, index) => {
                const cardKey = `video:${video.title}`;
                if (isHidden(cardKey)) return null;
                return (
                <article className="video-row" key={video.title}>
                  <div>
                    <div className="video-title">
                      {video.title}
                      {video.favorite && index === 0 ? (
                        <span className="video-badge">Studio favorite</span>
                      ) : null}
                    </div>
                    <div className="video-skill">{video.reason}</div>
                  </div>
                  <div className="video-actions">
                    <a
                      className="video-link"
                      href={video.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open video: ${video.title}`}
                    >
                      Open
                    </a>
                    {reportMenu(cardKey, {
                      targetType: "youtube_video",
                      targetRef: { id: `video-${index + 1}`, url: video.url, videoId: `video-${index + 1}` },
                      targetSnapshot: { title: video.title, url: video.url, source: "YouTube", author: "External creator" },
                    })}
                  </div>
                </article>
              )})}
            </div>
          </section>
        </aside>
      </div>

      {reportTarget ? (
        <div className="community-report-modal-backdrop" role="dialog" aria-modal="true" aria-label="Report content">
          <div className="community-report-modal card card-3d">
            <div className="community-card-head">
              <h2 className="card-title">Report this content</h2>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setReportTarget(null)}>
                Close
              </button>
            </div>
            <div className="community-copy">
              {reportTarget.targetSnapshot.title} · {reportTarget.targetType}
            </div>
            <label className="staff-field">
              Category
              <select
                value={reportCategory}
                onChange={(event) => {
                  const next = event.target.value as ReportCategory;
                  setReportCategory(next);
                  if (next === "safety") setReportSeverity("high");
                }}
              >
                {REPORT_CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="staff-field">
              Severity
              <select value={reportSeverity} onChange={(event) => setReportSeverity(event.target.value as ReportSeverity)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="staff-field">
              Note (optional)
              <textarea
                value={reportNote}
                maxLength={1200}
                onChange={(event) => setReportNote(event.target.value)}
                placeholder="Add context for staff triage (optional)."
              />
            </label>
            <div className="staff-actions-row">
              <button type="button" className="btn btn-primary" onClick={() => void submitReport()} disabled={reportBusy}>
                {reportBusy ? "Submitting..." : "Submit report"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setReportTarget(null)} disabled={reportBusy}>
                Cancel
              </button>
            </div>
            {reportStatus ? <div className="staff-note">{reportStatus}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
