import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import { applyCors, db, requireAuthUid } from "./shared";

const REGION = "us-central1";
const FAQ_COLLECTION = "faqItems";

type SupportRequestCategory =
  | "Account"
  | "Pieces"
  | "Kiln"
  | "Workshops"
  | "Membership"
  | "Billing"
  | "Studio"
  | "Other";

type PolicySourceType = "canonical_summary" | "announcement_summary" | "operational_faq";

type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: SupportRequestCategory;
  tags: string[];
  rank: number;
  policySlug?: string | null;
  policyVersion?: string | null;
  sourceType?: PolicySourceType | null;
};

function normalizeCategory(value: unknown): SupportRequestCategory {
  if (typeof value === "string") {
    if (value === "Classes") return "Workshops";
    if (
      value === "Account" ||
      value === "Pieces" ||
      value === "Kiln" ||
      value === "Workshops" ||
      value === "Membership" ||
      value === "Billing" ||
      value === "Studio" ||
      value === "Other"
    ) {
      return value;
    }
  }
  return "Other";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function normalizePolicySlug(value: unknown): string | null {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!slug) return null;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function normalizePolicyVersion(value: unknown): string | null {
  const version = typeof value === "string" ? value.trim() : "";
  return version || null;
}

function normalizeSourceType(value: unknown): PolicySourceType | null {
  if (
    value === "canonical_summary" ||
    value === "announcement_summary" ||
    value === "operational_faq"
  ) {
    return value;
  }
  return null;
}

function normalizeFaqEntry(
  id: string,
  data: Record<string, unknown>
): FaqEntry | null {
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
    policySlug: normalizePolicySlug(data.policySlug),
    policyVersion: normalizePolicyVersion(data.policyVersion),
    sourceType: normalizeSourceType(data.sourceType),
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const listSupportFaq = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Use GET or POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, code: "UNAUTHENTICATED", message: auth.message });
      return;
    }

    try {
      const snap = await db.collection(FAQ_COLLECTION).orderBy("rank", "asc").get();
      const entries = snap.docs
        .map((docSnap) => normalizeFaqEntry(docSnap.id, docSnap.data() as Record<string, unknown>))
        .filter((entry): entry is FaqEntry => Boolean(entry));

      res.status(200).json({
        ok: true,
        entries,
      });
    } catch (error: unknown) {
      logger.error("listSupportFaq failed", {
        uid: auth.uid,
        errorMessage: messageFromError(error),
      });
      res.status(500).json({
        ok: false,
        code: "FAQ_LIST_FAILED",
        message: "Unable to load FAQ right now.",
      });
    }
  }
);
