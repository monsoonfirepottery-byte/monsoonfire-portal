import { z } from "zod";
import { createHash } from "crypto";

// A staff ticket is an intake record, not an instruction to fire or bill.
// Completed firings must be tied to a portal firing or a documented studio
// record, and require an explicit duplicate/payment review.
export const staffCreateFiringTicketSchema = z.object({
  clientRequestId: z.string().uuid(),
  ownerUid: z.string().trim().min(1).max(128).refine((value) => !value.includes("/"), "Invalid client ID."),
  reservationId: z.string().trim().min(1).max(160).refine((value) => !value.includes("/"), "Invalid reservation ID.").optional(),
  heatId: z.enum(["low", "mid", "high", "custom"]),
  spaceId: z.enum(["half", "double", "triple", "large"]),
  firingType: z.enum(["bisque", "glaze", "other"]),
  stage: z.enum(["new_dropoff", "already_unloaded"]),
  firingId: z.string().trim().min(1).max(160).refine((value) => !value.includes("/"), "Invalid firing ID.").nullable(),
  manualFiring: z.object({
    date: z.iso.date(),
    kiln: z.string().trim().min(1).max(120),
    evidence: z.string().trim().min(4).max(500),
  }).strict().nullable().optional().default(null),
  reviewedExistingTicketsAndPayments: z.boolean(),
  privateRequested: z.boolean().optional(),
  rushRequested: z.boolean().optional(),
  communitySharingAllowed: z.boolean().optional(),
  note: z.string().trim().max(2000).default(""),
}).strict().superRefine((value, context) => {
  if (value.stage === "already_unloaded" && Boolean(value.firingId) === Boolean(value.manualFiring)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["firingId"], message: "Select a completed firing or document the studio record." });
  }
  if (value.stage === "new_dropoff" && (value.firingId || value.manualFiring)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["firingId"], message: "A new drop-off cannot be linked to a completed firing." });
  }
  if (!value.reviewedExistingTicketsAndPayments) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewedExistingTicketsAndPayments"], message: "Review existing tickets and payments first." });
  }
});

export type StaffCreateFiringTicketInput = z.infer<typeof staffCreateFiringTicketSchema>;

export function manualFiringKey(firing: NonNullable<StaffCreateFiringTicketInput["manualFiring"]>): string {
  return createHash("sha256").update(JSON.stringify([firing.date, firing.kiln.trim().toLowerCase().replace(/\s+/g, " ")])).digest("hex");
}

export function staffTicketInitialState(stage: StaffCreateFiringTicketInput["stage"]) {
  return stage === "already_unloaded"
    ? { status: "awaiting_pickup_review", billingStatus: "hold_for_review" }
    : { status: "in_studio", billingStatus: "unbilled" };
}

export function firingTicketLockId(firingId: string, identityType: "uid" | "email", identity: string): string {
  return createHash("sha256").update(JSON.stringify([firingId, identityType, identity])).digest("hex");
}

export function hasExistingFiringTicket(
  tickets: Array<{ ownerUid?: unknown; email?: unknown; firingId?: unknown; status?: unknown; deletedAt?: unknown }>,
  identity: { ownerUid: string; email: string | null; firingId: string },
): boolean {
  const email = identity.email?.trim().toLowerCase() || "";
  return tickets.some((ticket) => {
    if (ticket.status === "deleted" || ticket.deletedAt || ticket.firingId !== identity.firingId) return false;
    const sameOwner = ticket.ownerUid === identity.ownerUid;
    const sameEmail = email && typeof ticket.email === "string" && ticket.email.trim().toLowerCase() === email;
    return Boolean(sameOwner || sameEmail);
  });
}
