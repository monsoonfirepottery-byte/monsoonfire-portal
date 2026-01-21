import React, { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import "./SupportView.css";

export type SupportRequestCategory =
  | "Account"
  | "Pieces"
  | "Kiln"
  | "Classes"
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
  "Classes",
  "Membership",
  "Billing",
  "Studio",
  "Other",
];

const SUPPORT_FORM_CATEGORIES: SupportRequestCategory[] = [
  "Account",
  "Pieces",
  "Kiln",
  "Classes",
  "Membership",
  "Billing",
  "Studio",
  "Other",
];

const FAQ_ENTRIES: FaqEntry[] = [
  {
    id: "faq-sign-in",
    question: "I cannot sign in with Google. What should I do?",
    answer:
      "Confirm you are using the Google account tied to your studio membership. Try signing out and back in, and check for blocked pop-ups. If it still fails, send us a support request.",
    category: "Account",
    tags: ["signin", "google", "auth"],
  },
  {
    id: "faq-track-pieces",
    question: "Where do I track my pieces?",
    answer:
      "Open My Pieces to see active work and archived pieces. Select any piece to view its timeline updates.",
    category: "Pieces",
    tags: ["pieces", "timeline", "status"],
  },
  {
    id: "faq-continue-journey",
    question: "How do I continue a journey after a piece is closed?",
    answer:
      "When you have no active pieces, use Continue Journey on an archived piece to reopen the workflow. If you do not see the button, send us a note and we can help.",
    category: "Pieces",
    tags: ["continue", "archive"],
  },
  {
    id: "faq-ready-pickup",
    question: "How will I know when a piece is ready for pickup?",
    answer:
      "We update the piece status and timeline when it is ready. Check My Pieces for the latest update, and watch for announcements or direct messages.",
    category: "Pieces",
    tags: ["pickup", "ready"],
  },
  {
    id: "faq-kiln-reservations",
    question: "Can I reserve kiln time from the portal?",
    answer:
      "The Kiln Schedule view is currently a preview. Reservation workflows are in progress. Use this form to request a booking or change.",
    category: "Kiln",
    tags: ["kiln", "schedule"],
  },
  {
    id: "faq-classes",
    question: "How do I book a class or join a waitlist?",
    answer:
      "Classes are listed in the Classes tab, and full sessions show waitlist status. If you need help enrolling, send us the class name and preferred date.",
    category: "Classes",
    tags: ["classes", "waitlist"],
  },
  {
    id: "faq-membership",
    question: "Where can I update my membership tier?",
    answer:
      "Membership changes are being streamlined. Send a request and we will handle it for you until self-service is live.",
    category: "Membership",
    tags: ["membership", "plan"],
  },
  {
    id: "faq-billing",
    question: "I need help with billing or a receipt. What should I do?",
    answer:
      "Billing tools are still rolling out. Submit a request with the date and amount, and we will follow up.",
    category: "Billing",
    tags: ["billing", "receipt"],
  },
  {
    id: "faq-notifications",
    question: "Where do I find studio announcements?",
    answer:
      "Go to Messages to view announcements and direct messages. Unread items show a badge in the navigation and the top bar.",
    category: "Studio",
    tags: ["announcements", "messages"],
  },
  {
    id: "faq-report-issue",
    question: "Something looks wrong in my piece timeline. How do I report it?",
    answer:
      "Send a support request with the piece name and what looks off. We will review and correct the record.",
    category: "Pieces",
    tags: ["timeline", "issue"],
  },
  {
    id: "faq-urgent",
    question: "What counts as urgent support?",
    answer:
      "Anything time-sensitive such as same-day pickup or safety issues should go to the studio directly. Use the email below for urgent matters.",
    category: "Studio",
    tags: ["urgent", "contact"],
  },
];

export default function SupportView({ user, supportEmail, onSubmit, status, isBusy }: Props) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<SupportCategory>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [topic, setTopic] = useState<SupportRequestCategory>("Account");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [formStatus, setFormStatus] = useState("");

  const filteredFaqs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return FAQ_ENTRIES.filter((entry) => {
      const matchesCategory = filter === "All" || entry.category === filter;
      if (!matchesCategory) return false;
      if (!term) return true;
      const haystack = `${entry.question} ${entry.answer} ${entry.tags.join(" ")}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [filter, search]);

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
          <div className="card-title">Knowledge base</div>
          <div className="faq-search">
            <input
              type="search"
              placeholder="Search the FAQ"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="filter-chips">
              {SUPPORT_FILTERS.map((item) => (
                <button
                  key={item}
                  className={`chip ${filter === item ? "active" : ""}`}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {filteredFaqs.length === 0 ? (
            <div className="empty-state">No answers matched that search yet.</div>
          ) : (
            <div className="faq-list">
              {filteredFaqs.map((entry) => {
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
              })}
            </div>
          )}
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

              {formStatus ? <div className="alert inline-alert">{formStatus}</div> : null}
              {status ? <div className="notice inline-alert">{status}</div> : null}

              <button className="btn btn-primary" type="submit" disabled={isBusy}>
                {isBusy ? "Sending..." : "Send question"}
              </button>
            </form>

            <div className="support-footer">Urgent issue? Email {supportEmail}.</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
