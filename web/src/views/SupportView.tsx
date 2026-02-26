import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import "./SupportView.css";

export type SupportRequestCategory =
  | "Account"
  | "Pieces"
  | "Kiln"
  | "Workshops"
  | "Membership"
  | "Billing"
  | "Studio"
  | "Other";

type SupportCategory = "All" | SupportRequestCategory;

export type SupportRequestInput = {
  subject: string;
  body: string;
  category: SupportRequestCategory;
};

type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: SupportRequestCategory;
  tags: string[];
  rank: number;
};

type Props = {
  user: User;
  supportEmail: string;
  onSubmit: (input: SupportRequestInput) => Promise<boolean>;
  status: string;
  isBusy: boolean;
};

const SUPPORT_FILTERS: SupportCategory[] = [
  "All",
  "Account",
  "Pieces",
  "Kiln",
  "Workshops",
  "Membership",
  "Billing",
  "Studio",
  "Other",
];

const SUPPORT_FORM_CATEGORIES: SupportRequestCategory[] = [
  "Account",
  "Pieces",
  "Kiln",
  "Workshops",
  "Membership",
  "Billing",
  "Studio",
  "Other",
];

const QUICK_ANSWER_COUNT = 5;
const FALLBACK_FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "fallback-pickup",
    question: "How do pickup and drop-off work?",
    answer:
      "Use your portal timeline for status updates. When your pieces are marked ready, you can pick up during normal studio hours.",
    category: "Pieces",
    tags: ["pickup", "dropoff", "timeline", "ready"],
    rank: 1,
  },
  {
    id: "fallback-kiln",
    question: "How can I check kiln timing?",
    answer:
      "Open Kiln Schedule and your piece timeline in the portal for the latest estimate. Timing can shift based on queue and load changes.",
    category: "Kiln",
    tags: ["kiln", "schedule", "timeline", "queue"],
    rank: 2,
  },
  {
    id: "fallback-membership",
    question: "Can I change my membership plan?",
    answer:
      "Yes. Open Membership in the portal to review your current tier and available options, then submit a change request.",
    category: "Membership",
    tags: ["membership", "plan", "tier", "change"],
    rank: 3,
  },
  {
    id: "fallback-billing",
    question: "Where can I find billing receipts?",
    answer:
      "Go to Billing in the portal for recent charges and invoice details. If you need a specific receipt, submit a support request.",
    category: "Billing",
    tags: ["billing", "receipt", "invoice", "payment"],
    rank: 4,
  },
  {
    id: "fallback-support",
    question: "When should I submit a support request?",
    answer:
      "Use support requests for non-urgent studio questions. For urgent issues, email support directly so we can respond faster.",
    category: "Studio",
    tags: ["support", "urgent", "email", "help"],
    rank: 5,
  },
  {
    id: "fallback-continuity",
    question: "How do I keep a copy of my reservation history?",
    answer:
      "Open Support and request a continuity export if you need a full JSON/CSV archive. Your portal history remains visible in My Pieces and reservation timelines while your account stays active.",
    category: "Account",
    tags: ["continuity", "export", "history", "backup", "json", "csv"],
    rank: 6,
  },
];

const SEARCH_SUGGESTIONS = [
  "pickup",
  "kiln schedule",
  "membership change",
  "billing receipt",
  "workshop waitlist",
  "studio storage",
  "continuity export",
];

const SEARCH_SYNONYMS: Record<string, string[]> = {
  pickup: ["ready", "collection", "collect", "retrieval"],
  ready: ["pickup", "collection"],
  kiln: ["firing", "schedule", "batch"],
  firing: ["kiln", "schedule", "batch"],
  schedule: ["calendar", "timeline"],
  billing: ["payment", "invoice", "receipt"],
  receipt: ["invoice", "billing"],
  membership: ["plan", "tier"],
  workshop: ["workshops", "class", "lesson"],
  workshops: ["workshop", "class", "lesson"],
  waitlist: ["wait list", "full"],
  storage: ["shelf", "shelving", "pickup"],
  continuity: ["export", "backup", "history", "records"],
  export: ["continuity", "backup", "json", "csv"],
  account: ["email", "profile", "signin", "sign-in"],
  urgent: ["emergency", "safety", "same-day"],
};

type ImportMetaEnvShape = {
  VITE_FUNCTIONS_BASE_URL?: string;
};

const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

function resolveFunctionsBaseUrl(input?: string): string {
  const raw = (input ?? ENV.VITE_FUNCTIONS_BASE_URL ?? DEFAULT_FUNCTIONS_BASE_URL).trim();
  return raw.replace(/\/+$/, "");
}

function normalizeCategory(value: unknown): SupportRequestCategory {
  if (typeof value === "string") {
    if (value === "Classes") return "Workshops";
    const match = SUPPORT_FORM_CATEGORIES.find((item) => item === value);
    if (match) return match;
  }
  return "Other";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => tag.toLowerCase());
}

function normalizeFaqEntry(id: string, data: Record<string, unknown>): FaqEntry | null {
  if (data.isActive === false) return null;

  const question = typeof data.question === "string" ? data.question.trim() : "";
  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  if (!question || !answer) return null;

  const rank = typeof data.rank === "number" && Number.isFinite(data.rank) ? data.rank : 999;
  const tags = normalizeTags(data.tags ?? data.keywords ?? []);

  return {
    id,
    question,
    answer,
    category: normalizeCategory(data.category),
    tags,
    rank,
  };
}

function buildSearchTokens(value: string) {
  const raw = value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

  if (raw.length === 0) return [];

  const expanded = raw.flatMap((token) => [token, ...(SEARCH_SYNONYMS[token] ?? [])]);
  return Array.from(new Set(expanded));
}

function normalizeFaqApiEntries(input: unknown): FaqEntry[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id =
        typeof record.id === "string" && record.id.trim().length
          ? record.id.trim()
          : `faq_${index + 1}`;
      return normalizeFaqEntry(id, record);
    })
    .filter((entry): entry is FaqEntry => Boolean(entry));
}

export default function SupportView({ user, supportEmail, onSubmit, status, isBusy }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SupportCategory>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topic, setTopic] = useState<SupportRequestCategory>("Account");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [faqEntries, setFaqEntries] = useState<FaqEntry[]>([]);
  const [faqLoading, setFaqLoading] = useState(true);
  const [faqError, setFaqError] = useState("");
  const [faqNotice, setFaqNotice] = useState("");

  useEffect(() => {
    const load = async () => {
      setFaqLoading(true);
      setFaqError("");
      setFaqNotice("");
      try {
        const idToken = await user.getIdToken();
        if (!idToken || !idToken.trim().length) {
          throw new Error("ID token unavailable.");
        }

        const resp = await fetch(`${resolveFunctionsBaseUrl()}/listSupportFaq`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: "{}",
        });

        const payload = (await resp.json().catch(() => null)) as
          | { ok?: boolean; entries?: unknown; message?: string }
          | null;

        if (!resp.ok || payload?.ok !== true) {
          throw new Error(String(payload?.message ?? `HTTP ${resp.status}`));
        }

        const rows = normalizeFaqApiEntries(payload.entries);
        if (rows.length > 0) {
          setFaqEntries(rows);
        } else {
          setFaqEntries(FALLBACK_FAQ_ENTRIES);
          setFaqNotice("Live FAQ is still being published. Showing quick-start answers for now.");
        }
      } catch {
        setFaqEntries(FALLBACK_FAQ_ENTRIES);
        setFaqNotice("Live FAQ is temporarily unavailable. Showing quick-start answers.");
      } finally {
        setFaqLoading(false);
      }
    };
    void load();
  }, [user]);

  const searchTokens = useMemo(() => buildSearchTokens(search), [search]);

  const filteredFaqs = useMemo(() => {
    return faqEntries.filter((entry) => {
      const matchesCategory = filter === "All" || entry.category === filter;
      if (!matchesCategory) return false;
      if (searchTokens.length === 0) return true;
      const haystack = `${entry.question} ${entry.answer} ${entry.tags.join(" ")}`.toLowerCase();
      return searchTokens.some((token) => haystack.includes(token));
    });
  }, [faqEntries, filter, searchTokens]);

  const quickAnswers = useMemo(() => {
    return [...faqEntries].sort((a, b) => a.rank - b.rank).slice(0, QUICK_ANSWER_COUNT);
  }, [faqEntries]);

  const quickAnswerIds = useMemo(() => new Set(quickAnswers.map((entry) => entry.id)), [quickAnswers]);

  const showQuickAnswers = searchTokens.length === 0 && filter === "All" && quickAnswers.length > 0;
  const listFaqs = showQuickAnswers
    ? filteredFaqs.filter((entry) => !quickAnswerIds.has(entry.id))
    : filteredFaqs;

  const resultsLabel = searchTokens.length
    ? `Search results for "${search.trim()}"`
    : filter === "All"
      ? "Browse all answers"
      : `${filter} answers`;

  async function handleSubmit() {
    if (isBusy) return;
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();

    if (!trimmedSubject || !trimmedBody) {
      setFormStatus("Add a subject and your question so we can help.");
      return;
    }

    setFormStatus("");
    const ok = await onSubmit({
      subject: trimmedSubject,
      body: trimmedBody,
      category: topic,
    });

    if (ok) {
      setSubject("");
      setBody("");
      setTopic("Account");
    }
  }

  const renderFaqItem = (entry: FaqEntry) => {
    const isOpen = expandedId === entry.id;
    return (
      <button
        key={entry.id}
        type="button"
        className={`faq-item ${isOpen ? "active" : ""}`}
        onClick={() => setExpandedId(isOpen ? null : entry.id)}
        aria-expanded={isOpen}
      >
        <div className="faq-top">
          <div className="faq-question">{entry.question}</div>
          <span className="pill">{entry.category}</span>
        </div>
        {isOpen ? <div className="faq-answer">{entry.answer}</div> : null}
      </button>
    );
  };

  return (
    <div className="support-view">
      <div className="page-header">
        <h1>Support</h1>
        <p className="page-subtitle">
          Quick answers plus a non-urgent way to send a question to the studio.
        </p>
      </div>

      <div className="support-layout">
        <section className="card card-3d support-faq">
          <div className="faq-header">
            <div>
              <div className="card-title">Knowledge base</div>
              <p className="faq-subtitle">Start with the top questions or search by topic.</p>
            </div>
            <div className="faq-meta">
              <span>
                {filteredFaqs.length} answer{filteredFaqs.length === 1 ? "" : "s"}
              </span>
              <span>{filter === "All" ? "All topics" : `${filter} only`}</span>
            </div>
          </div>

          <div className="faq-search">
            <input
              id="support-faq-search"
              type="search"
              placeholder="Search the FAQ"
              aria-label="Search frequently asked questions"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpandedId(null);
              }}
            />
            <div className="search-suggestions">
              <span>Try:</span>
              {SEARCH_SUGGESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setSearch(item);
                    setFilter("All");
                    setExpandedId(null);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="filter-chips">
              {SUPPORT_FILTERS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`chip ${filter === item ? "active" : ""}`}
                  aria-pressed={filter === item}
                  onClick={() => {
                    setFilter(item);
                    setExpandedId(null);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {faqError ? (
            <div className="alert inline-alert" role="alert" aria-live="assertive">
              {faqError}
            </div>
          ) : null}
          {faqNotice ? (
            <div className="notice inline-alert" role="status" aria-live="polite">
              {faqNotice}
            </div>
          ) : null}
          {faqLoading ? (
            <div className="notice inline-alert" role="status" aria-live="polite">
              Loading answers...
            </div>
          ) : null}

          {showQuickAnswers ? (
            <div className="faq-featured">
              <div className="faq-section-title">Top answers</div>
              <div className="faq-list">{quickAnswers.map(renderFaqItem)}</div>
            </div>
          ) : null}

          <div className="faq-results">
            <div className="faq-section-title">{resultsLabel}</div>
            {listFaqs.length === 0 ? (
              <div className="empty-state">
                {faqEntries.length === 0 && !faqLoading
                  ? "No FAQ entries published yet. Send a question and we will help."
                  : "No answers matched that search yet. Try another keyword or send a question on the right."}
              </div>
            ) : (
              <div className="faq-list">{listFaqs.map(renderFaqItem)}</div>
            )}
          </div>
        </section>

        <aside className="support-side">
          <section className="card card-3d">
            <div className="card-title">Ask the studio</div>
            <p className="support-copy">
              Send a non-urgent question and we will follow up. We typically respond within 1-2
              business days.
            </p>
            <div className="support-identity">
              Sending as {user.displayName || user.email || "Member"}
            </div>

            <form
              className="support-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
            >
              <label>
                Topic
                <select
                  value={topic}
                  onChange={(event) => setTopic(event.target.value as SupportRequestCategory)}
                >
                  {SUPPORT_FORM_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Subject
                <input
                  type="text"
                  placeholder="Kiln schedule change, billing question"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                Question
                <textarea
                  placeholder="Share details, dates, or piece names so we can help faster."
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>

              {formStatus ? (
                <div className="alert inline-alert" role="alert" aria-live="assertive">
                  {formStatus}
                </div>
              ) : null}
              {status ? (
                <div className="notice inline-alert" role="status" aria-live="polite">
                  {status}
                </div>
              ) : null}

              <button className="btn btn-primary" type="submit" disabled={isBusy}>
                {isBusy ? "Sending..." : "Send question"}
              </button>
            </form>

            <div className="support-tips">
              <div className="support-tips-title">Helpful details to include</div>
              <ul>
                <li>Piece name(s), clay body, or kiln batch if known.</li>
                <li>Dates or deadlines you are trying to hit.</li>
                <li>The best way to reach you for follow-up.</li>
              </ul>
            </div>

            <div className="support-footer">Urgent issue? Email {supportEmail}.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
