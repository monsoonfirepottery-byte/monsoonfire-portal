import { createHash } from "node:crypto";

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { z } from "zod";
import { newFiringPricingVersion } from "./firingPricing";

import {
  applyCors,
  db,
  enforceRateLimit,
  makeIdempotencyId,
  nowTs,
  parseBody,
  type RequestLike,
  type ResponseLike,
  type Timestamp,
} from "./shared";

const REGION = "us-central1";
const SUPPORT_EMAIL = "support@monsoonfire.com";
const MAIL_COLLECTION = "mail";
const SUPPORT_REQUESTS_COLLECTION = "supportRequests";
const FIRING_TICKETS_COLLECTION = "firingTickets";
const PAGE_PATH = "/firing-services/pathfinder/";
const POLICIES_URL = "https://monsoonfire.com/policies/";
const TERMS_URL = "https://monsoonfire.com/terms/";
const PRIVACY_URL = "https://monsoonfire.com/privacy/";
export const LEGAL_DOCUMENT_VERSION = "2026-07-18";
const LEGACY_MODEL_VERSION = 1;
const CURRENT_MODEL_VERSION = 2;
const RANGE_ONLY_MODEL_VERSION = 3;
const UNAMBIGUOUS_BASE32 = "0123456789BCDEFGHJKMNPQRSTUVWXYZ";
const STAFF_BOUNDARY = "We’ll confirm fit, studio access, loading, and timing before anything is scheduled.";
const ESTIMATE_BILLING_NOTE = "This is an estimate. You pay after the firing for the space your work used. If something goes wrong because of us, there’s no firing charge. If the issue comes from the clay, glaze, or construction, the firing is still charged.";

const intentSchema = z.enum([
  "This is my first firing",
  "I know the clay and firing range",
  "I’m planning a dropoff",
  "Is my work ready?",
  "I have something unusual",
  "Drop off work",
  "Pick up finished work",
  "Is my unfired work ready to bring in?",
  "I’m not sure what firing I need",
]);

const workSchema = z.enum([
  "Stoneware mugs",
  "Earthenware pieces",
  "Large or unusual work",
  "Work needs identification",
  "Unfired work readiness check",
  "Stoneware / mid- or high-fire clay",
  "Earthenware / low-fire clay",
  "Mixed, large, or unusual work",
  "Finished work pickup",
]);

const heatSchema = z.enum([
  "Low fire",
  "Mid fire",
  "High fire",
  "Cone 10 electric oxidation",
  "Special / custom firing",
  "High / custom fire",
  "I’m not sure",
  "Not applicable",
]);

const routeNameSchema = z.enum([
  "Low fire",
  "Mid fire",
  "High fire",
  "Custom firing",
  "Fit check",
  "Ready check",
  "Pickup",
]);

const priceLabelSchema = z.enum(["Example price", "Estimated price", "Maximum estimate", "Price"]);
const priceSchema = z.enum([
  "$15 half shelf — example",
  "$25 half shelf — example",
  "$20 half shelf — example",
  "$35 half shelf — example",
  "$15 estimated",
  "$25 estimated",
  "$30 estimated",
  "$45 estimated",
  "$50 estimated",
  "$75 estimated",
  "Up to $60 — four-half-shelf cap",
  "Up to $100 — four-half-shelf cap",
  "Up to $65 — whole kiln",
  "$20 estimated",
  "$35 estimated",
  "$40 estimated",
  "$60 estimated",
  "$70 estimated",
  "$105 estimated",
  "$90 estimated",
  "$135 estimated",
  "Up to $80 — per-client base cap",
  "Up to $120 — per-client base cap",
  "Up to $160 - per-client base cap",
  "No estimate yet",
  "No new estimate",
]);

const spaceSchema = z.enum([
  "One half shelf",
  "Two half shelves",
  "Three half shelves",
  "Four or more half shelves / whole kiln",
  "Space needs studio check",
]);

export const firingPathfinderArtifactSchema = z.object({
  id: z.string().min(8).max(100).regex(/^MF-[A-Z0-9-]+$/),
  intent: intentSchema,
  work: workSchema.nullable(),
  heat: heatSchema,
  space: spaceSchema.nullable().optional(),
  estimateNote: z.string().min(1).max(600).nullable().optional(),
  routeName: routeNameSchema,
  priceLabel: priceLabelSchema,
  price: priceSchema,
  inputs: z.array(z.string().min(1).max(140).trim()).min(1).max(6),
  nextAction: z.string().min(1).max(500).trim(),
  staffBoundary: z.string().min(1).max(500).trim(),
}).strict();

export type FiringPathfinderArtifact = z.infer<typeof firingPathfinderArtifactSchema>;

const standardIntentIdSchema = z.enum(["new", "known", "dropoff"]);
const flexibleWorkIdSchema = z.enum(["stoneware", "large"]);
const knownHeatIdSchema = z.enum(["low", "mid", "high", "custom", "unknown"]);
const spaceIdSchema = z.enum(["half", "double", "triple", "large", "unknown"]);

const firingPathfinderSelectionV1Schema = z.union([
  z.object({
    modelVersion: z.literal(LEGACY_MODEL_VERSION),
    intentId: z.literal("pickup"),
    workId: z.null(),
    heatId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(LEGACY_MODEL_VERSION),
    intentId: z.literal("unusual"),
    workId: z.literal("large"),
    heatId: z.literal("unknown"),
  }).strict(),
  z.object({
    modelVersion: z.literal(LEGACY_MODEL_VERSION),
    intentId: standardIntentIdSchema,
    workId: z.literal("unknown"),
    heatId: z.literal("unknown"),
  }).strict(),
  z.object({
    modelVersion: z.literal(LEGACY_MODEL_VERSION),
    intentId: standardIntentIdSchema,
    workId: z.literal("earthenware"),
    heatId: z.literal("low"),
  }).strict(),
  z.object({
    modelVersion: z.literal(LEGACY_MODEL_VERSION),
    intentId: standardIntentIdSchema,
    workId: flexibleWorkIdSchema,
    heatId: knownHeatIdSchema,
  }).strict(),
]);

const firingPathfinderSelectionV2Schema = z.union([
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("dropoff"),
    workId: z.literal("earthenware"),
    heatId: z.literal("low"),
  }).strict(),
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("dropoff"),
    workId: z.enum(["stoneware", "large", "unknown"]),
    heatId: knownHeatIdSchema,
  }).strict(),
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("collection"),
    workId: z.null(),
    heatId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("readiness"),
    workId: z.null(),
    heatId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("unusual"),
    workId: z.literal("large"),
    heatId: z.literal("unknown"),
  }).strict(),
  z.object({
    modelVersion: z.literal(CURRENT_MODEL_VERSION),
    intentId: z.literal("question"),
    workId: z.literal("unknown"),
    heatId: z.literal("unknown"),
  }).strict(),
]);

const firingPathfinderSelectionV3Schema = z.union([
  z.object({
    modelVersion: z.literal(RANGE_ONLY_MODEL_VERSION),
    intentId: z.literal("dropoff"),
    workId: z.null(),
    heatId: knownHeatIdSchema,
    spaceId: spaceIdSchema,
  }).strict(),
  z.object({
    modelVersion: z.literal(RANGE_ONLY_MODEL_VERSION),
    intentId: z.literal("collection"),
    workId: z.null(),
    heatId: z.null(),
    spaceId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(RANGE_ONLY_MODEL_VERSION),
    intentId: z.literal("readiness"),
    workId: z.null(),
    heatId: z.null(),
    spaceId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(RANGE_ONLY_MODEL_VERSION),
    intentId: z.literal("unusual"),
    workId: z.literal("large"),
    heatId: z.literal("unknown"),
    spaceId: z.null(),
  }).strict(),
  z.object({
    modelVersion: z.literal(RANGE_ONLY_MODEL_VERSION),
    intentId: z.literal("question"),
    workId: z.literal("unknown"),
    heatId: z.literal("unknown"),
    spaceId: z.null(),
  }).strict(),
]);

export const firingPathfinderSelectionSchema = z.union([
  firingPathfinderSelectionV1Schema,
  firingPathfinderSelectionV2Schema,
  firingPathfinderSelectionV3Schema,
]);

type FiringPathfinderSelectionV1 = z.infer<typeof firingPathfinderSelectionV1Schema>;
type FiringPathfinderSelectionV2 = z.infer<typeof firingPathfinderSelectionV2Schema>;
type FiringPathfinderSelectionV3 = z.infer<typeof firingPathfinderSelectionV3Schema>;
export type FiringPathfinderSelection = z.infer<typeof firingPathfinderSelectionSchema>;

const emailSchema = z.string().email().max(200);
const deliveryModeSchema = z.enum(["print", "email", "both"]);
const legalAcceptanceSchema = z.object({
  termsAccepted: z.literal(true),
  policiesAcknowledged: z.literal(true),
  termsVersion: z.literal(LEGAL_DOCUMENT_VERSION),
  privacyNoticeVersion: z.literal(LEGAL_DOCUMENT_VERSION),
  studioPoliciesVersion: z.literal(LEGAL_DOCUMENT_VERSION),
}).strict();

export const firingPathfinderSubmissionSchema = z.object({
  clientRequestId: z.string().min(19).max(83).regex(/^fp_[A-Za-z0-9_-]{16,80}$/),
  name: z.string().min(2).max(120).trim(),
  email: z.string().max(200).trim().toLowerCase().optional().default(""),
  note: z.string().max(800).trim().optional().default(""),
  consentToContact: z.boolean().optional().default(false),
  deliveryMode: deliveryModeSchema.optional().default("email"),
  website: z.string().max(0).optional().default(""),
  legalAcceptance: legalAcceptanceSchema,
  pagePath: z.literal(PAGE_PATH),
  selection: firingPathfinderSelectionSchema,
  addOnRequests: z.object({ private: z.boolean(), rush: z.boolean(), communitySharing: z.boolean() }).strict().optional(),
}).strict().superRefine((submission, context) => {
  const hasValidEmail = emailSchema.safeParse(submission.email).success;
  if (submission.email && !hasValidEmail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "Enter a valid email address",
    });
  }
  if (submission.deliveryMode !== "print" && !hasValidEmail) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["email"],
      message: "Email is required when sending this request to the studio",
    });
  }
  if (submission.deliveryMode !== "print" && submission.consentToContact !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["consentToContact"],
      message: "Permission to reply is required when emailing this request",
    });
  }
});

export type FiringPathfinderSubmissionRequest = z.infer<typeof firingPathfinderSubmissionSchema>;
export type FiringPathfinderSubmission = FiringPathfinderSubmissionRequest & {
  artifact: FiringPathfinderArtifact;
};

const legacyIntentLabels = {
  new: "This is my first firing",
  known: "I know the clay and firing range",
  dropoff: "I’m planning a dropoff",
} as const;

const legacyWorkLabels = {
  stoneware: "Stoneware mugs",
  earthenware: "Earthenware pieces",
  large: "Large or unusual work",
  unknown: "Work needs identification",
} as const;

const currentWorkLabels = {
  stoneware: "Stoneware / mid- or high-fire clay",
  earthenware: "Earthenware / low-fire clay",
  large: "Mixed, large, or unusual work",
  unknown: "Work needs identification",
} as const;

const heatLabels = {
  low: "Low fire",
  mid: "Mid fire",
  high: "High fire",
  custom: "Special / custom firing",
  unknown: "I’m not sure",
} as const;

const routeDetails = {
  low: {
    routeName: "Low fire",
    priceLabel: "Example price",
    price: "$20 half shelf — example",
    inputs: [
      "Clay and glaze labels or notes",
      "Tallest and widest measurements",
      "Anything fragile or needing special care",
      "Timing needs, if any",
    ],
  },
  mid: {
    routeName: "Mid fire",
    priceLabel: "Example price",
    price: "$35 half shelf — example",
    inputs: [
      "Clay and glaze labels or notes",
      "Glazed or bare surfaces",
      "Tallest and widest measurements",
      "Shape or special-handling notes",
    ],
  },
  high: {
    routeName: "High fire",
    priceLabel: "Price",
    price: "No estimate yet",
    inputs: [
      "Clay and glaze labels or notes",
      "Glazed or bare surfaces",
      "Tallest and widest measurements",
      "Shape or special-handling notes",
    ],
  },
  custom: {
    routeName: "Custom firing",
    priceLabel: "Price",
    price: "No estimate yet",
    inputs: [
      "How many pieces",
      "Shelf space or height needed",
      "Any deadline",
      "Anything needing special care",
    ],
  },
} as const;

const fitCheckInputs = [
  "Firing range, if known",
  "Tallest and widest measurements",
  "Notes about the surface, shape, or handling",
];

const spaceLabels = {
  half: "One half shelf",
  double: "Two half shelves",
  triple: "Three half shelves",
  large: "Four or more half shelves / whole kiln",
  unknown: "Space needs studio check",
} as const;

const spaceInputs = {
  half: "Any piece close to 10 inches tall",
  double: "Tallest piece, especially anything over 10 inches",
  triple: "How the load spans three half-shelf areas",
  large: "Tallest and widest load measurements",
  unknown: "Tallest and widest load measurements",
} as const;

type RangeOnlyDropoffSelection = Extract<FiringPathfinderSelectionV3, { intentId: "dropoff" }>;

function rangeOnlyPrice(selection: RangeOnlyDropoffSelection): {
  priceLabel: "Estimated price" | "Maximum estimate" | "Price";
  price: FiringPathfinderArtifact["price"];
} {
  if (selection.heatId === "unknown" || selection.heatId === "custom" || selection.spaceId === "unknown") {
    return { priceLabel: "Price", price: "No estimate yet" };
  }
  if (selection.heatId === "high") {
    if (selection.spaceId === "large") return { priceLabel: "Maximum estimate", price: "Up to $160 - per-client base cap" };
    return { priceLabel: "Estimated price", price: selection.spaceId === "triple" ? "$135 estimated" : selection.spaceId === "double" ? "$90 estimated" : "$45 estimated" };
  }
  if (selection.spaceId === "large") {
    return { priceLabel: "Maximum estimate", price: selection.heatId === "low" ? "Up to $80 — per-client base cap" : "Up to $120 — per-client base cap" };
  }
  if (selection.heatId === "low") {
    return { priceLabel: "Estimated price", price: selection.spaceId === "triple" ? "$60 estimated" : selection.spaceId === "double" ? "$40 estimated" : "$20 estimated" };
  }
  return { priceLabel: "Estimated price", price: selection.spaceId === "triple" ? "$105 estimated" : selection.spaceId === "double" ? "$70 estimated" : "$35 estimated" };
}

function buildLegacyFiringPathfinderArtifact(
  selection: FiringPathfinderSelectionV1,
): FiringPathfinderArtifact {
  if (selection.intentId === "pickup") {
    return {
      id: "MF-PICKUP-STATUS-READY",
      intent: "Is my work ready?",
      work: "Unfired work readiness check",
      heat: "Not applicable",
      routeName: "Ready check",
      priceLabel: "Price",
      price: "No new estimate",
      inputs: [
        "Firing range, if known",
        "Tallest and widest measurements",
        "How you plan to pad and carry it",
        "Anything thin, attached, or fragile",
      ],
      nextAction: "Pack each piece so it cannot touch another piece or the sides of the container. If it can travel safely, bring it in; the studio will hold it until it is ready for the kiln.",
      staffBoundary: STAFF_BOUNDARY,
    };
  }

  if (selection.intentId === "unusual") {
    return {
      id: "MF-UNUSUAL-LARGE-UNKNOWN",
      intent: "I have something unusual",
      work: "Large or unusual work",
      heat: "I’m not sure",
      routeName: "Fit check",
      priceLabel: "Price",
      price: "No estimate yet",
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you plan the firing safely.",
      staffBoundary: STAFF_BOUNDARY,
    };
  }

  const id = `MF-${selection.intentId.toUpperCase()}-${selection.workId.toUpperCase()}-${selection.heatId.toUpperCase()}`;
  const base = {
    id,
    intent: legacyIntentLabels[selection.intentId],
    work: legacyWorkLabels[selection.workId],
    heat: heatLabels[selection.heatId],
    staffBoundary: STAFF_BOUNDARY,
  };

  if (selection.workId === "unknown" || selection.heatId === "unknown") {
    return {
      ...base,
      routeName: "Fit check",
      priceLabel: "Price",
      price: "No estimate yet",
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you choose a safe next step.",
    };
  }

  const details = routeDetails[selection.heatId];
  return {
    ...base,
    routeName: details.routeName,
    priceLabel: details.priceLabel,
    price: details.price,
    inputs: [...details.inputs],
    nextAction: "Email this ticket to the studio. We’ll confirm fit, loading, and timing with you.",
  };
}

function buildCurrentFiringPathfinderArtifact(
  selection: FiringPathfinderSelectionV2,
): FiringPathfinderArtifact {
  if (selection.intentId === "collection") {
    return {
      id: "MF-COLLECTION-STATUS-READY",
      intent: "Pick up finished work",
      work: "Finished work pickup",
      heat: "Not applicable",
      routeName: "Pickup",
      priceLabel: "Price",
      price: "No new estimate",
      inputs: ["Name or nickname used at dropoff", "Ticket reference, if handy", "Anything that helps identify the work"],
      nextAction: "Use the private address, access, and pickup timing from the ready note. Standard pickup is self-serve; pad the work for the trip home.",
      staffBoundary: "If the ready note is missing, reply to this email and the studio will resend the private access details.",
    };
  }

  if (selection.intentId === "readiness") {
    return {
      id: "MF-READINESS-STATUS-READY",
      intent: "Is my unfired work ready to bring in?",
      work: "Unfired work readiness check",
      heat: "Not applicable",
      routeName: "Ready check",
      priceLabel: "Price",
      price: "No new estimate",
      inputs: [
        "Firing range, if known",
        "Tallest and widest measurements",
        "How you plan to pad and carry it",
        "Anything thin, attached, or fragile",
      ],
      nextAction: "Pack each piece so it cannot touch another piece or the sides of the container. If it can travel safely, bring it in; the studio will hold it until it is ready for the kiln.",
      staffBoundary: STAFF_BOUNDARY,
    };
  }

  if (selection.intentId === "unusual") {
    return {
      id: "MF-UNUSUAL-LARGE-UNKNOWN",
      intent: "I have something unusual",
      work: "Mixed, large, or unusual work",
      heat: "I’m not sure",
      routeName: "Fit check",
      priceLabel: "Price",
      price: "No estimate yet",
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you plan the firing safely.",
      staffBoundary: STAFF_BOUNDARY,
    };
  }

  if (selection.intentId === "question") {
    return {
      id: "MF-QUESTION-UNKNOWN-UNKNOWN",
      intent: "I’m not sure what firing I need",
      work: "Work needs identification",
      heat: "I’m not sure",
      routeName: "Fit check",
      priceLabel: "Price",
      price: "No estimate yet",
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you choose a safe next step.",
      staffBoundary: STAFF_BOUNDARY,
    };
  }

  const id = `MF-DROPOFF-${selection.workId.toUpperCase()}-${selection.heatId.toUpperCase()}`;
  const base = {
    id,
    intent: "Drop off work" as const,
    work: currentWorkLabels[selection.workId],
    heat: heatLabels[selection.heatId],
    staffBoundary: STAFF_BOUNDARY,
  };

  if (selection.workId === "unknown" || selection.heatId === "unknown") {
    return {
      ...base,
      routeName: "Fit check",
      priceLabel: "Price",
      price: "No estimate yet",
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you choose a safe next step.",
    };
  }

  const details = routeDetails[selection.heatId];
  return {
    ...base,
    routeName: details.routeName,
    priceLabel: details.priceLabel,
    price: details.price,
    inputs: [...details.inputs],
    nextAction: "Email this ticket to the studio. We’ll confirm fit, loading, and timing with you.",
  };
}

function buildRangeOnlyFiringPathfinderArtifact(
  selection: FiringPathfinderSelectionV3,
): FiringPathfinderArtifact {
  if (selection.intentId !== "dropoff") {
    const currentSelection = { ...selection, modelVersion: CURRENT_MODEL_VERSION } as FiringPathfinderSelectionV2;
    return {
      ...buildCurrentFiringPathfinderArtifact(currentSelection),
      space: null,
      estimateNote: null,
    };
  }

  const price = rangeOnlyPrice(selection);
  const base = {
    id: `MF-DROPOFF-${selection.heatId.toUpperCase()}`,
    intent: "Drop off work" as const,
    work: null,
    heat: selection.heatId === "high" ? "Cone 10 electric oxidation" as const : heatLabels[selection.heatId],
    space: spaceLabels[selection.spaceId],
    estimateNote: ESTIMATE_BILLING_NOTE,
    staffBoundary: selection.heatId === "high" ? "Shared cone 10 runs require scheduling confirmation. Private firing is $180 even for partial loads. Rush is $20 only if fulfilled." : STAFF_BOUNDARY,
  };

  if (selection.heatId === "unknown" || selection.spaceId === "unknown") {
    return {
      ...base,
      routeName: "Fit check",
      ...price,
      inputs: [...fitCheckInputs],
      nextAction: "Email these details to the studio and we’ll help you choose a safe next step.",
    };
  }

  const details = routeDetails[selection.heatId];
  return {
    ...base,
    routeName: details.routeName,
    ...price,
    inputs: [...details.inputs, spaceInputs[selection.spaceId]],
    nextAction: "Choose whether to print this ticket, email it to the studio, or do both. We’ll confirm fit, loading, and timing with you.",
  };
}

export function buildCanonicalFiringPathfinderArtifact(
  selection: FiringPathfinderSelection,
): FiringPathfinderArtifact {
  if (selection.modelVersion === LEGACY_MODEL_VERSION) {
    return buildLegacyFiringPathfinderArtifact(selection);
  }
  if (selection.modelVersion === CURRENT_MODEL_VERSION) {
    return buildCurrentFiringPathfinderArtifact(selection);
  }
  return buildRangeOnlyFiringPathfinderArtifact(selection);
}

export function materializeFiringPathfinderSubmission(
  submission: FiringPathfinderSubmissionRequest,
): FiringPathfinderSubmission {
  return {
    ...submission,
    artifact: buildCanonicalFiringPathfinderArtifact(submission.selection),
  };
}

export function makeFiringPathfinderPayloadHash(
  submission: FiringPathfinderSubmission,
): string {
  const versionedSelection = {
    modelVersion: submission.selection.modelVersion,
    intentId: submission.selection.intentId,
    workId: submission.selection.workId,
    heatId: submission.selection.heatId,
    ...("spaceId" in submission.selection ? { spaceId: submission.selection.spaceId } : {}),
  };
  const canonicalPayload = {
    clientRequestId: submission.clientRequestId,
    selection: versionedSelection,
    name: submission.name,
    email: submission.email,
    note: submission.note,
    consentToContact: submission.consentToContact,
    deliveryMode: submission.deliveryMode,
    legalAcceptance: submission.legalAcceptance,
    pagePath: submission.pagePath,
    ...(submission.addOnRequests ? { addOnRequests: submission.addOnRequests } : {}),
  };
  return createHash("sha256").update(JSON.stringify(canonicalPayload), "utf8").digest("hex");
}

function makeLegacyFiringPathfinderPayloadHash(
  submission: FiringPathfinderSubmission,
): string {
  const canonicalPayload = {
    modelVersion: submission.selection.modelVersion,
    intentId: submission.selection.intentId,
    workId: submission.selection.workId,
    heatId: submission.selection.heatId,
    name: submission.name,
    email: submission.email,
    note: submission.note,
    consentToContact: submission.consentToContact,
    pagePath: submission.pagePath,
  };
  return createHash("sha256").update(JSON.stringify(canonicalPayload), "utf8").digest("hex");
}

function validDatedRequestStamp(clientRequestId: string): string | null {
  const match = /^fp_(\d{8})_[A-Za-z0-9_-]+$/.exec(clientRequestId);
  if (!match) return null;
  const stamp = match[1];
  const isoDate = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoDate) return null;
  return stamp;
}

function compactBase32Code(hash: string): string {
  const bits = Number.parseInt(hash.slice(0, 5), 16);
  return [15, 10, 5, 0]
    .map((shift) => UNAMBIGUOUS_BASE32[(bits >>> shift) & 31])
    .join("");
}

export function makeFiringTicketId(clientRequestId: string): string {
  const hash = createHash("sha256")
    .update(`firing-ticket:${clientRequestId}`, "utf8")
    .digest("hex");
  const datedStamp = validDatedRequestStamp(clientRequestId);
  if (datedStamp) {
    return `MF-${datedStamp.slice(4, 8)}-${compactBase32Code(hash)}`;
  }
  const legacyHash = hash.slice(0, 12).toUpperCase();
  return `MF-${legacyHash.slice(0, 4)}-${legacyHash.slice(4, 8)}-${legacyHash.slice(8, 12)}`;
}

export class FiringPathfinderIdempotencyConflictError extends Error {
  constructor() {
    super("This request was already used for different details.");
    this.name = "FiringPathfinderIdempotencyConflictError";
  }
}

export function assertFiringPathfinderIdempotencyMatch(
  existingPayloadHash: unknown,
  currentPayloadHash: string,
): void {
  if (typeof existingPayloadHash !== "string" || existingPayloadHash !== currentPayloadHash) {
    throw new FiringPathfinderIdempotencyConflictError();
  }
}

type SubmissionDocuments = {
  ticket: Record<string, unknown>;
  supportRequest: Record<string, unknown> | null;
  mail: Record<string, unknown> | null;
  artistMail: Record<string, unknown> | null;
};

type PersistResult = {
  ticketId: string;
  supportRequestId: string | null;
  emailQueueId: string | null;
  emailQueued: boolean;
  duplicate: boolean;
};

type HandlerDependencies = {
  rateLimit: typeof enforceRateLimit;
  persist: (submission: FiringPathfinderSubmission) => Promise<PersistResult>;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function readHeader(req: RequestLike, name: string): string {
  const headers = req.headers ?? {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name.toLowerCase()) continue;
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value) && value.length > 0) return String(value[0]).trim();
  }
  return "";
}

function requestIdFromRequest(req: RequestLike): string {
  return readHeader(req, "x-request-id").slice(0, 128) ||
    `fp_req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function summaryRows(submission: FiringPathfinderSubmission): Array<[string, string]> {
  const artifact = submission.artifact;
  const rows: Array<[string, string]> = [["You’re here to", artifact.intent]];
  if (artifact.work) rows.push(["Your work", artifact.work]);
  if (artifact.heat !== "Not applicable") rows.push(["Firing range", artifact.heat]);
  if (artifact.space) rows.push(["Estimated space", artifact.space]);
  if (isDropoffSubmission(submission) && artifact.routeName === "Fit check") {
    rows.push(["Studio review", artifact.routeName]);
  }
  if (isDropoffSubmission(submission)) rows.push([artifact.priceLabel, artifact.price]);
  if (isDropoffSubmission(submission) && submission.addOnRequests) {
    if (submission.addOnRequests.private) rows.push(["Private firing request", artifact.heat === "Cone 10 electric oxidation" ? "$180 total, including partial loads" : "+$20"]);
    if (submission.addOnRequests.rush) rows.push(["Fire tonight request", "+$20 only if fulfilled"]);
    if (submission.addOnRequests.communitySharing) rows.push(["Community space", "Unused space may be donated"]);
  }
  return rows;
}

function isDropoffSubmission(submission: FiringPathfinderSubmission): boolean {
  return submission.selection.intentId === "dropoff";
}

function isPickupSubmission(submission: FiringPathfinderSubmission): boolean {
  return submission.selection.intentId === "collection";
}

function pickupReminderText(submission: FiringPathfinderSubmission): string[] {
  if (!isPickupSubmission(submission)) return [];
  return [
    "Your pickup reminder",
    "- Your ready notice is the go-ahead: the firing is finished, the work has cooled, and it is set aside for you.",
    "- Use the private address, access instructions, and pickup timing in that ready note.",
    "- Standard pickup is self-serve; you do not need to find anyone when you arrive.",
    "- Pad the pieces and keep them stable for the trip home.",
    "- If the private details are missing, reply to this email. The studio has the same request and can resend them.",
    "",
  ];
}

function pickupReminderHtml(submission: FiringPathfinderSubmission): string {
  if (!isPickupSubmission(submission)) return "";
  return `<div style="margin:22px 0 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;">
    <p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Your pickup reminder</p>
    <p style="margin:0 0 10px;color:#271d17;font:600 17px/1.45 Georgia,serif;">Your work is waiting for you.</p>
    <ul style="margin:0;padding-left:20px;color:#271d17;font:14px/1.55 Arial,sans-serif;">
      <li style="margin:0 0 7px;">Your ready notice is the go-ahead: the firing is finished, the work has cooled, and it is set aside for you.</li>
      <li style="margin:0 0 7px;">Use the private address, access instructions, and pickup timing in that ready note.</li>
      <li style="margin:0 0 7px;">Standard pickup is self-serve; you do not need to find anyone when you arrive.</li>
      <li style="margin:0 0 7px;">Pad the pieces and keep them stable for the trip home.</li>
      <li>If the private details are missing, reply to this email. The studio has the same request and can resend them.</li>
    </ul>
  </div>`;
}

function dropoffHandoffText(submission: FiringPathfinderSubmission): string[] {
  if (!isDropoffSubmission(submission) || submission.deliveryMode === "print") return [];
  const lines = [
    "Dropoff handoff:",
    "A dropoff is expected. Add this emailed ticket to the firing intake tray.",
  ];
  if (submission.deliveryMode === "both") {
    lines.push(
      "The artist also plans to leave a matching printed copy with the work; do not make another printed copy.",
    );
  }
  lines.push(submission.artifact.estimateNote || ESTIMATE_BILLING_NOTE);
  return [...lines, ""];
}

function dropoffHandoffHtml(submission: FiringPathfinderSubmission): string {
  if (!isDropoffSubmission(submission) || submission.deliveryMode === "print") return "";
  const printedCopy = submission.deliveryMode === "both"
    ? "<p style=\"margin:8px 0 0;color:#695a4e;font:13px/1.45 Arial,sans-serif;\">The artist also plans to leave a matching printed copy with the work; do not make another printed copy.</p>"
    : "";
  return `<div style="margin:22px 0 0;padding:16px 18px;background:#fff4df;border:1px solid #dfc18e;">
    <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Dropoff handoff</p>
    <p style="margin:0;color:#271d17;font:15px/1.5 Georgia,serif;">A dropoff is expected. Add this emailed ticket to the firing intake tray.</p>
    ${printedCopy}
    <p style="margin:8px 0 0;color:#695a4e;font:13px/1.45 Arial,sans-serif;">${escapeHtml(submission.artifact.estimateNote || ESTIMATE_BILLING_NOTE)}</p>
  </div>`;
}

export function formatFiringPathfinderEmailText(
  submission: FiringPathfinderSubmission,
  ticketId: string,
  createdAtIso: string,
): string {
  const lines = summaryRows(submission).map(([label, value]) => `${label}: ${value}`);
  const noteLines = submission.note ? ["Artist note:", submission.note, ""] : [];
  const isDropoff = isDropoffSubmission(submission);
  const isPickup = isPickupSubmission(submission);
  const heading = isDropoff
    ? `Monsoon Fire firing ticket ${ticketId}`
    : isPickup ? `Monsoon Fire pickup-details request ${ticketId}` : `Monsoon Fire studio question ${ticketId}`;
  const boundary = isDropoff
    ? "This is a planning request, not a confirmed firing, final quote, appointment, or booking."
    : isPickup
      ? "The artist already received a ready notice and is asking for the pickup details again."
      : "This is a studio question, not a firing booking or billable event.";
  return [
    heading,
    "",
    `Artist: ${submission.name}`,
    `Email: ${submission.email}`,
    "",
    ...lines,
    "",
    isDropoff ? "Details to have handy:" : "Details from the artist:",
    ...submission.artifact.inputs.map((input) => `- ${input}`),
    "",
    ...noteLines,
    ...dropoffHandoffText(submission),
    `Next action: ${submission.artifact.nextAction}`,
    submission.artifact.staffBoundary,
    "",
    boundary,
    `Ticket: ${ticketId}`,
    `Submitted: ${createdAtIso}`,
    `Source: https://monsoonfire.com${PAGE_PATH}`,
  ].join("\n");
}

export function formatFiringPathfinderEmailHtml(
  submission: FiringPathfinderSubmission,
  ticketId: string,
  createdAtIso: string,
): string {
  const rows = summaryRows(submission).map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #dfd0bd;color:#695a4e;font:600 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dfd0bd;color:#271d17;font:600 15px Georgia,serif;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");
  const inputs = submission.artifact.inputs
    .map((input) => `<li style="margin:0 0 8px;">${escapeHtml(input)}</li>`)
    .join("");
  const note = submission.note
    ? `<div style="margin:22px 0 0;padding:16px 18px;border-left:4px solid #c45f3b;background:#fffaf4;">
        <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Artist note</p>
        <p style="margin:0;color:#271d17;font:15px/1.55 Georgia,serif;white-space:pre-wrap;">${escapeHtml(submission.note)}</p>
      </div>`
    : "";
  const isDropoff = isDropoffSubmission(submission);
  const isPickup = isPickupSubmission(submission);
  const heading = isDropoff
    ? `New firing ticket ${escapeHtml(ticketId)}`
    : isPickup ? `Pickup details requested ${escapeHtml(ticketId)}` : `Studio question ${escapeHtml(ticketId)}`;
  const boundary = isDropoff
    ? "This is a planning request, not a confirmed firing, final quote, appointment, or booking."
    : isPickup
      ? "The artist already received a ready notice and is asking for the pickup details again."
      : "This is a studio question, not a firing booking or billable event.";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#15110e;color:#271d17;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border-collapse:collapse;background:#f8f0e5;">
          <tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;">
            <p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p>
            <h1 style="margin:0;color:#f5ede2;font:600 28px/1.1 Georgia,serif;">${heading}</h1>
          </td></tr>
          <tr><td style="padding:26px 28px;">
            <p style="margin:0 0 5px;color:#695a4e;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Artist</p>
            <p style="margin:0 0 4px;color:#271d17;font:600 18px Georgia,serif;">${escapeHtml(submission.name)}</p>
            <p style="margin:0 0 24px;font:14px Arial,sans-serif;"><a href="mailto:${escapeHtml(submission.email)}" style="color:#8c3f29;">${escapeHtml(submission.email)}</a></p>

            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dfd0bd;background:#efe2cf;">${rows}
            </table>

            <h2 style="margin:24px 0 10px;color:#271d17;font:600 19px Georgia,serif;">${isDropoff ? "Details to have handy" : "Details from the artist"}</h2>
            <ul style="margin:0;padding-left:22px;color:#271d17;font:14px/1.5 Arial,sans-serif;">${inputs}</ul>
            ${note}
            ${dropoffHandoffHtml(submission)}

            <div style="margin:22px 0 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;">
              <p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Next step</p>
              <p style="margin:0 0 8px;color:#271d17;font:15px/1.5 Georgia,serif;">${escapeHtml(submission.artifact.nextAction)}</p>
              <p style="margin:0;color:#695a4e;font:13px/1.45 Arial,sans-serif;">${escapeHtml(submission.artifact.staffBoundary)}</p>
            </div>

            <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#8c3f29;font:700 13px/1.45 Arial,sans-serif;">${escapeHtml(boundary)}</p>
            <p style="margin:12px 0 0;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(ticketId)}<br>Submitted: ${escapeHtml(createdAtIso)}<br>Source: monsoonfire.com${PAGE_PATH}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function formatFiringPathfinderArtistEmailText(
  submission: FiringPathfinderSubmission,
  ticketId: string,
  createdAtIso: string,
): string {
  const lines = summaryRows(submission).map(([label, value]) => `${label}: ${value}`);
  const isDropoff = isDropoffSubmission(submission);
  const isPickup = isPickupSubmission(submission);
  const noteLines = submission.note ? ["Your note:", submission.note, ""] : [];
  const dropoffPacket = isDropoff ? [
    "What happens now",
    "- The studio has the same ticket and is expecting your dropoff.",
    "- This automatic email records your ticket. The studio confirms the private address and gate instructions separately. Wait for those details before traveling; if they have not arrived, check spam or reply to this email. Once you have them, the outdoor rack is available 24/7 and standard dropoff does not require a conversation.",
    "- Leave your name, email, requested firing, and material details with the work. A paper ticket is optional.",
    "- Standard firing is usually 3–7 days from drop-off, with extra time for drying or special schedules. A ticket does not reserve a firing date.",
    "- We’ll email again when the work is ready to pick up.",
    "",
    "Kiln blessings: the short risk version",
    "Firing is heat plus chemistry. Cracks, warping, glaze movement, and reactions between materials can happen even when everyone did everything right.",
    submission.artifact.estimateNote || ESTIMATE_BILLING_NOTE,
    "Responsibility is based on the cause and available evidence. Studio fault means no charge or an appropriate refund; other remedies are reviewed case by case.",
    "",
    "Getting the work here safely",
    "- If the work can make the trip safely, bring it. We can hold it until it is ready for the kiln.",
    "- Pad pieces so they cannot touch each other or the sides of the container.",
    "- Support handles, thin attachments, and other fragile edges.",
    "- For glazed work, wipe glaze off the bottom and foot wherever it touches the kiln shelf; leave that contact surface as bare clay.",
    "",
    "Studio policies, in human terms",
    "- This is a private home studio with no walk-in studio hours. Standard dropoff and pickup use the instructed outdoor rack 24/7; visits and lessons are arranged separately.",
    "- Studio staff loads and unloads the kiln and makes the final fit and compatibility calls.",
    "- Tell us about mystery materials, repairs, inclusions, unusual clay, or anything else that may behave strangely in heat.",
    "- The standard storage grace period is 19 days and 6 hours after the ready notice; current extensions, daily storage fees, and unclaimed-work safeguards are in the full policies.",
    `Full policies: ${POLICIES_URL}`,
    `Terms (${submission.legalAcceptance.termsVersion}): ${TERMS_URL}`,
    `Privacy notice (${submission.legalAcceptance.privacyNoticeVersion}): ${PRIVACY_URL}`,
    "",
  ] : [];
  const pickupPacket = pickupReminderText(submission);
  const title = isDropoff
    ? `Your Monsoon Fire ticket ${ticketId}`
    : isPickup ? `Your Monsoon Fire pickup reminder ${ticketId}` : `Your Monsoon Fire studio question ${ticketId}`;
  const intro = isDropoff
    ? "Your dropoff ticket is ready. Keep this email for the reference and the practical details below."
    : isPickup
      ? "Your work is waiting for you. Here is the practical pickup reminder, and the studio has the same note if private details need to be resent."
      : "The studio has your question and will reply by email.";

  return [
    title,
    "",
    `Hi ${submission.name},`,
    "",
    intro,
    "",
    ...lines,
    "",
    ...noteLines,
    ...dropoffPacket,
    ...pickupPacket,
    `Next step: ${submission.artifact.nextAction}`,
    submission.artifact.staffBoundary,
    "",
    `Ticket: ${ticketId}`,
    `Submitted: ${createdAtIso}`,
    "Questions? Reply to this email.",
  ].join("\n");
}

export function formatFiringPathfinderArtistEmailHtml(
  submission: FiringPathfinderSubmission,
  ticketId: string,
  createdAtIso: string,
): string {
  const isDropoff = isDropoffSubmission(submission);
  const isPickup = isPickupSubmission(submission);
  const rows = summaryRows(submission).map(([label, value]) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #dfd0bd;color:#695a4e;font:600 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #dfd0bd;color:#271d17;font:600 15px Georgia,serif;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`).join("");
  const note = submission.note
    ? `<div style="margin:22px 0 0;padding:16px 18px;border-left:4px solid #c45f3b;background:#fffaf4;">
        <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Your note</p>
        <p style="margin:0;color:#271d17;font:15px/1.55 Georgia,serif;white-space:pre-wrap;">${escapeHtml(submission.note)}</p>
      </div>`
    : "";
  const dropoffPacket = isDropoff ? `
    <div style="margin:22px 0 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;">
      <p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">What happens now</p>
      <ul style="margin:0;padding-left:20px;color:#271d17;font:14px/1.55 Arial,sans-serif;">
        <li style="margin:0 0 7px;">The studio has the same ticket and is expecting your dropoff.</li>
        <li style="margin:0 0 7px;">This automatic email records your ticket. The studio confirms the private address and gate instructions separately. Wait for those details before traveling; if they have not arrived, check spam or reply to this email. Once you have them, the outdoor rack is available 24/7 and standard dropoff does not require a conversation.</li>
        <li style="margin:0 0 7px;">Leave your name, email, requested firing, and material details with the work. A paper ticket is optional.</li>
        <li style="margin:0 0 7px;">Standard firing is usually 3–7 days from drop-off, with extra time for drying or special schedules. A ticket does not reserve a firing date.</li>
        <li>We’ll email again when the work is ready to pick up.</li>
      </ul>
    </div>
    <div style="margin:18px 0 0;padding:16px 18px;background:#fff4df;border:1px solid #dfc18e;">
      <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Kiln blessings: the short risk version</p>
      <p style="margin:0 0 8px;color:#271d17;font:15px/1.5 Georgia,serif;">Firing is heat plus chemistry. Cracks, warping, glaze movement, and reactions between materials can happen even when everyone did everything right.</p>
      <p style="margin:0 0 8px;color:#695a4e;font:13px/1.5 Arial,sans-serif;">${escapeHtml(submission.artifact.estimateNote || ESTIMATE_BILLING_NOTE)}</p>
      <p style="margin:0;color:#695a4e;font:13px/1.5 Arial,sans-serif;">Responsibility is based on the cause and available evidence. Studio fault means no charge or an appropriate refund; other remedies are reviewed case by case.</p>
    </div>
    <div style="margin:18px 0 0;padding:16px 18px;border:1px solid #dfd0bd;background:#fffaf4;">
      <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Getting the work here safely</p>
      <ul style="margin:0;padding-left:20px;color:#271d17;font:14px/1.55 Arial,sans-serif;">
        <li style="margin:0 0 7px;">If the work can make the trip safely, bring it. We can hold it until it is ready for the kiln.</li>
        <li style="margin:0 0 7px;">Pad pieces so they cannot touch each other or the sides of the container.</li>
        <li style="margin:0 0 7px;">Support handles, thin attachments, and other fragile edges.</li>
        <li>For glazed work, wipe glaze off the bottom and foot wherever it touches the kiln shelf; leave that contact surface as bare clay.</li>
      </ul>
    </div>
    <div style="margin:18px 0 0;padding:16px 18px;border:1px solid #dfd0bd;background:#efe2cf;">
      <p style="margin:0 0 7px;color:#8c3f29;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Studio policies, in human terms</p>
      <ul style="margin:0;padding-left:20px;color:#271d17;font:14px/1.55 Arial,sans-serif;">
        <li style="margin:0 0 7px;">This is a private home studio with no walk-in studio hours. Standard dropoff and pickup use the instructed outdoor rack 24/7; visits and lessons are arranged separately.</li>
        <li style="margin:0 0 7px;">Studio staff loads and unloads the kiln and makes the final fit and compatibility calls.</li>
        <li style="margin:0 0 7px;">Tell us about mystery materials, repairs, inclusions, unusual clay, or anything else that may behave strangely in heat.</li>
        <li>The standard storage grace period is 19 days and 6 hours after the ready notice; current extensions, daily storage fees, and unclaimed-work safeguards are in the full policies.</li>
      </ul>
      <p style="margin:12px 0 0;font:700 13px Arial,sans-serif;"><a href="${POLICIES_URL}" style="color:#8c3f29;">Read the full studio policies</a></p>
      <p style="margin:8px 0 0;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Accepted versions: <a href="${TERMS_URL}" style="color:#8c3f29;">Terms ${escapeHtml(submission.legalAcceptance.termsVersion)}</a> · <a href="${PRIVACY_URL}" style="color:#8c3f29;">Privacy ${escapeHtml(submission.legalAcceptance.privacyNoticeVersion)}</a></p>
    </div>` : "";
  const pickupPacket = pickupReminderHtml(submission);
  const heading = isDropoff ? "Your dropoff ticket" : isPickup ? "Your pickup reminder" : "Your studio question";
  const intro = isDropoff
    ? "your dropoff ticket is ready. Keep this email for the reference and practical details below."
    : isPickup
      ? "your work is waiting for you. The practical pickup reminder is below, and the studio has the same note if private details need to be resent."
      : "the studio has your question and will reply by email.";

  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#15110e;color:#271d17;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#15110e;">
      <tr><td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:680px;border-collapse:collapse;background:#f8f0e5;">
          <tr><td style="padding:24px 28px;background:#211a16;border-bottom:5px solid #c45f3b;">
            <p style="margin:0 0 6px;color:#dfb56b;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;">Monsoon Fire · Firing care</p>
            <h1 style="margin:0;color:#f5ede2;font:600 28px/1.1 Georgia,serif;">${heading} ${escapeHtml(ticketId)}</h1>
          </td></tr>
          <tr><td style="padding:26px 28px;">
            <p style="margin:0 0 16px;color:#271d17;font:17px/1.55 Georgia,serif;">Hi ${escapeHtml(submission.name)}, ${intro}</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dfd0bd;background:#efe2cf;">${rows}</table>
            ${note}
            ${dropoffPacket}
            ${pickupPacket}
            <div style="margin:22px 0 0;padding:16px 18px;background:#e8eadb;border:1px solid #c6cdaa;">
              <p style="margin:0 0 7px;color:#4f5e32;font:700 12px Arial,sans-serif;text-transform:uppercase;letter-spacing:.08em;">Next step</p>
              <p style="margin:0 0 8px;color:#271d17;font:15px/1.5 Georgia,serif;">${escapeHtml(submission.artifact.nextAction)}</p>
              <p style="margin:0;color:#695a4e;font:13px/1.45 Arial,sans-serif;">${escapeHtml(submission.artifact.staffBoundary)}</p>
            </div>
            <p style="margin:22px 0 0;padding-top:16px;border-top:1px solid #dfd0bd;color:#695a4e;font:12px/1.5 Arial,sans-serif;">Ticket: ${escapeHtml(ticketId)}<br>Submitted: ${escapeHtml(createdAtIso)}<br>Questions? Reply to this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function buildFiringPathfinderSubmissionDocuments(
  submission: FiringPathfinderSubmission,
  ticketId: string,
  supportRequestId: string | null,
  emailQueueId: string | null,
  createdAt: Timestamp,
  createdAtIso: string,
  payloadHash = makeFiringPathfinderPayloadHash(submission),
): SubmissionDocuments {
  const emailQueued = submission.deliveryMode !== "print";
  if (emailQueued && (!supportRequestId || !emailQueueId)) {
    throw new Error("Email delivery requires support and mail document IDs");
  }
  const artistEmailQueueId = emailQueueId ? `${emailQueueId}-artist` : null;
  const text = emailQueued
    ? formatFiringPathfinderEmailText(submission, ticketId, createdAtIso)
    : null;
  const html = emailQueued
    ? formatFiringPathfinderEmailHtml(submission, ticketId, createdAtIso)
    : null;
  const artistText = emailQueued
    ? formatFiringPathfinderArtistEmailText(submission, ticketId, createdAtIso)
    : null;
  const artistHtml = emailQueued
    ? formatFiringPathfinderArtistEmailHtml(submission, ticketId, createdAtIso)
    : null;
  const subjectName = submission.name.replace(/[\r\n]+/g, " ").trim();
  const subjectDetails = submission.artifact.work || [
    submission.artifact.heat === "Not applicable" ? null : submission.artifact.heat,
    submission.artifact.space,
  ].filter(Boolean).join(" · ");
  const isDropoff = isDropoffSubmission(submission);
  const isPickup = isPickupSubmission(submission);
  const subject = isDropoff
    ? `Firing ticket ${ticketId} from ${subjectName}${subjectDetails ? `: ${subjectDetails}` : ""}`
    : isPickup
      ? `Pickup details ${ticketId} for ${subjectName}`
      : `Studio question ${ticketId} from ${subjectName}${subjectDetails ? `: ${subjectDetails}` : ""}`;
  const artistSubject = isDropoff
    ? `Your Monsoon Fire ticket ${ticketId}`
    : isPickup ? `Your Monsoon Fire pickup reminder ${ticketId}` : `Your Monsoon Fire studio question ${ticketId}`;
  const spaceId = "spaceId" in submission.selection ? submission.selection.spaceId : null;
  const estimateNote = isDropoff
    ? submission.artifact.estimateNote || ESTIMATE_BILLING_NOTE
    : null;

  const ticket = {
    ticketId,
    uid: "anonymous-firing-pathfinder",
    ownerUid: null,
    status: isDropoff
      ? submission.deliveryMode === "print" ? "issued" : "expected_dropoff"
      : isPickup ? "pickup_details_requested" : "support_requested",
    billingStatus: isDropoff ? "unbilled" : "not_applicable",
    billingVersion: 0,
    noticeStatus: isDropoff ? "not_queued" : "not_applicable",
    source: "firing-pathfinder",
    channel: "website",
    pagePath: submission.pagePath,
    displayName: submission.name,
    email: submission.email || null,
    consentToContact: submission.consentToContact,
    legalAcceptance: {
      ...submission.legalAcceptance,
      acceptedAt: createdAt,
    },
    artistNote: submission.note || null,
    deliveryMode: submission.deliveryMode,
    selection: submission.selection,
    ...(isDropoff ? { pricingVersion: newFiringPricingVersion(), addOnRequests: submission.addOnRequests ?? { private: false, rush: false, communitySharing: false } } : {}),
    spaceId,
    estimatedSpace: submission.artifact.space ?? null,
    estimateNote,
    artifact: submission.artifact,
    clientRequestId: submission.clientRequestId,
    payloadHash,
    supportRequestId,
    emailQueueId,
    artistEmailQueueId,
    createdAt,
    updatedAt: createdAt,
  };

  if (!emailQueued) {
    return { ticket, supportRequest: null, mail: null, artistMail: null };
  }

  const resolvedSupportRequestId = supportRequestId as string;
  const resolvedEmailQueueId = emailQueueId as string;
  return {
    ticket,
    supportRequest: {
      uid: "anonymous-firing-pathfinder",
      ticketId,
      subject,
      body: text as string,
      category: isDropoff ? "Firing services" : isPickup ? "Pickup" : "Studio question",
      status: "new",
      urgency: "non-urgent",
      channel: "website",
      source: "firing-pathfinder",
      pagePath: submission.pagePath,
      displayName: submission.name,
      email: submission.email,
      consentToContact: submission.consentToContact,
      legalAcceptance: {
        ...submission.legalAcceptance,
        acceptedAt: createdAt,
      },
      artistNote: submission.note || null,
      deliveryMode: submission.deliveryMode,
      selection: submission.selection,
      spaceId,
      estimatedSpace: submission.artifact.space ?? null,
      estimateNote,
      artifact: submission.artifact,
      clientRequestId: submission.clientRequestId,
      payloadHash,
      emailQueueId: resolvedEmailQueueId,
      artistEmailQueueId,
      emailQueuedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    },
    mail: {
      to: SUPPORT_EMAIL,
      replyTo: submission.email,
      message: {
        subject,
        text: text as string,
        html: html as string,
      },
      source: "firing-pathfinder",
      ticketId,
      deliveryMode: submission.deliveryMode,
      spaceId,
      supportRequestId: resolvedSupportRequestId,
      clientRequestId: submission.clientRequestId,
      payloadHash,
      createdAt,
    },
    artistMail: {
      to: submission.email,
      replyTo: SUPPORT_EMAIL,
      message: {
        subject: artistSubject,
        text: artistText as string,
        html: artistHtml as string,
      },
      source: "firing-pathfinder-artist-confirmation",
      ticketId,
      deliveryMode: submission.deliveryMode,
      spaceId,
      supportRequestId: resolvedSupportRequestId,
      clientRequestId: submission.clientRequestId,
      payloadHash,
      createdAt,
    },
  };
}

async function persistFiringPathfinderSubmission(
  submission: FiringPathfinderSubmission,
): Promise<PersistResult> {
  const ticketId = makeFiringTicketId(submission.clientRequestId);
  const emailQueued = submission.deliveryMode !== "print";
  const legacySupportRequestId = makeIdempotencyId("pathfinder", "anonymous", submission.clientRequestId);
  const supportRequestId = emailQueued ? legacySupportRequestId : null;
  const emailQueueId = supportRequestId ? `${supportRequestId}-email` : null;
  const artistEmailQueueId = emailQueueId ? `${emailQueueId}-artist` : null;
  const ticketRef = db.collection(FIRING_TICKETS_COLLECTION).doc(ticketId);
  const legacySupportRequestRef = db.collection(SUPPORT_REQUESTS_COLLECTION).doc(legacySupportRequestId);
  const supportRequestRef = emailQueued ? legacySupportRequestRef : null;
  const mailRef = emailQueueId ? db.collection(MAIL_COLLECTION).doc(emailQueueId) : null;
  const artistMailRef = artistEmailQueueId ? db.collection(MAIL_COLLECTION).doc(artistEmailQueueId) : null;
  const payloadHash = makeFiringPathfinderPayloadHash(submission);
  let duplicate = false;

  await db.runTransaction(async (transaction) => {
    const existingTicket = await transaction.get(ticketRef);
    if (existingTicket.exists) {
      assertFiringPathfinderIdempotencyMatch(existingTicket.data()?.payloadHash, payloadHash);
      duplicate = true;
      return;
    }

    const existingSupport = await transaction.get(legacySupportRequestRef);
    if (existingSupport.exists) {
      const storedHash = existingSupport.data()?.payloadHash;
      const legacyCompatible = submission.deliveryMode === "email" &&
        submission.selection.modelVersion <= CURRENT_MODEL_VERSION &&
        storedHash === makeLegacyFiringPathfinderPayloadHash(submission);
      if (storedHash !== payloadHash && !legacyCompatible) {
        throw new FiringPathfinderIdempotencyConflictError();
      }
    }

    const createdAt = nowTs();
    const documents = buildFiringPathfinderSubmissionDocuments(
      submission,
      ticketId,
      supportRequestId,
      emailQueueId,
      createdAt,
      new Date().toISOString(),
      payloadHash,
    );
    transaction.create(ticketRef, documents.ticket);

    if (!emailQueued || !supportRequestRef || !mailRef || !artistMailRef ||
      !documents.supportRequest || !documents.mail || !documents.artistMail) {
      return;
    }

    if (existingSupport.exists) {
      transaction.update(supportRequestRef, {
        ticketId,
        deliveryMode: submission.deliveryMode,
        spaceId: "spaceId" in submission.selection ? submission.selection.spaceId : null,
        estimatedSpace: submission.artifact.space ?? null,
        updatedAt: createdAt,
      });
      transaction.update(mailRef, {
        ticketId,
        deliveryMode: submission.deliveryMode,
        spaceId: "spaceId" in submission.selection ? submission.selection.spaceId : null,
      });
      transaction.create(artistMailRef, documents.artistMail);
      duplicate = true;
      return;
    }

    transaction.create(supportRequestRef, documents.supportRequest);
    transaction.create(mailRef, documents.mail);
    transaction.create(artistMailRef, documents.artistMail);
  });

  return { ticketId, supportRequestId, emailQueueId, emailQueued, duplicate };
}

export async function handleFiringPathfinderRequest(
  req: RequestLike,
  res: ResponseLike,
  dependencies: HandlerDependencies = {
    rateLimit: enforceRateLimit,
    persist: persistFiringPathfinderSubmission,
  },
): Promise<void> {
  if (applyCors(req, res)) return;
  const requestId = requestIdFromRequest(req);

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Use POST", requestId });
    return;
  }

  const parsed = parseBody(firingPathfinderSubmissionSchema, req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, code: "INVALID_ARGUMENT", message: parsed.message, requestId });
    return;
  }

  let rate: Awaited<ReturnType<typeof enforceRateLimit>>;
  try {
    rate = await dependencies.rateLimit({
      req,
      key: "firingPathfinderRequest:submit",
      max: 12,
      windowMs: 60 * 60 * 1000,
    });
  } catch (error: unknown) {
    logger.error("Firing pathfinder rate limit failed closed", { requestId, error: String(error) });
    res.status(503).json({ ok: false, code: "UNAVAILABLE", message: "Please try again in a moment.", requestId });
    return;
  }

  if (!rate.ok) {
    res.set("Retry-After", String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))));
    const retryMinutes = Math.max(1, Math.ceil(rate.retryAfterMs / 60_000));
    const minuteLabel = retryMinutes === 1 ? "minute" : "minutes";
    res.status(429).json({
      ok: false,
      code: "RATE_LIMITED",
      message: `Too many requests from this connection. Try again in about ${retryMinutes} ${minuteLabel}. Your answers are still here.`,
      requestId,
    });
    return;
  }

  try {
    const submission = materializeFiringPathfinderSubmission(parsed.data);
    const result = await dependencies.persist(submission);
    res.status(200).json({
      ok: true,
      data: {
        ticketId: result.ticketId,
        ...(result.supportRequestId ? { supportRequestId: result.supportRequestId } : {}),
        emailQueued: result.emailQueued,
        duplicate: result.duplicate,
      },
      requestId,
    });
  } catch (error: unknown) {
    if (error instanceof FiringPathfinderIdempotencyConflictError) {
      res.status(409).json({
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
        message: "This request belongs to an earlier plan. Start a new plan to send different details.",
        requestId,
      });
      return;
    }
    logger.error("Firing pathfinder submission failed", { requestId, error: String(error) });
    res.status(500).json({
      ok: false,
      code: "SUBMISSION_FAILED",
      message: "We couldn’t send your request. Your answers are still here.",
      requestId,
    });
  }
}

export const firingPathfinderRequest = onRequest(
  { region: REGION, timeoutSeconds: 30 },
  async (req, res) => {
    await handleFiringPathfinderRequest(req, res);
  },
);
