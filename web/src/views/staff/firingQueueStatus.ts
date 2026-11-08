import { requiresPickupReview } from "./pickupReviewQueue";

type TicketState = {
  status: string;
  billingStatus: string;
  noticeStatus: string;
  stripeReceiptPrint?: { status?: string } | null;
  workSlipPrint?: { status?: string } | null;
};

const settled: Record<string, string> = {
  paid: "paid", no_charge: "no charge", refunded: "refunded",
  partially_refunded: "partially refunded", void: "invoice canceled",
};

const billingProblems: Record<string, string> = {
  payment_failed: "Payment failed", refund_failed: "Refund needs review",
  billing_preparing: "Preparing invoice", adjustment_pending: "Billing update pending",
  reconciliation_required: "Billing needs recovery", hold_for_review: "Held for review",
};

const printProblem = new Set(["failed", "needs_review"]);
const printPending = new Set(["queued", "submitting", "accepted"]);

export function firingQueueStatus(ticket: TicketState): {
  group: "work" | "pickup" | "history";
  tone: "issue" | "review" | "incoming" | "due" | "ready" | "done";
  label: string;
  priority: number;
} {
  const problem = (Object.hasOwn(billingProblems, ticket.billingStatus) ? billingProblems[ticket.billingStatus] : undefined) ??
    (ticket.noticeStatus === "failed" ? "Pickup notice failed" : undefined) ??
    (printProblem.has(ticket.stripeReceiptPrint?.status ?? "") ? "Receipt needs review" : undefined) ??
    (printProblem.has(ticket.workSlipPrint?.status ?? "") ? "Work slip needs review" : undefined);
  if (problem) return { group: "work", tone: "issue", label: problem, priority: 0 };
  if (requiresPickupReview(ticket)) return { group: "work", tone: "review", label: "Pickup review", priority: 1 };
  const billing = Object.hasOwn(settled, ticket.billingStatus) ? settled[ticket.billingStatus] : undefined;
  if (ticket.status === "picked_up" && billing &&
    ticket.noticeStatus !== "queued" && !printPending.has(ticket.stripeReceiptPrint?.status ?? "") &&
    !printPending.has(ticket.workSlipPrint?.status ?? "")) {
    return { group: "history", tone: "done", label: `Picked up · ${billing}`, priority: 6 };
  }
  if (ticket.status === "ready_for_pickup") {
    if (ticket.billingStatus === "invoice_open") return { group: "pickup", tone: "due", label: "Ready · payment due", priority: 4 };
    if (billing) return { group: "pickup", tone: "ready", label: `Ready · ${billing}`, priority: 5 };
  }
  if (ticket.status === "expected_dropoff" && ticket.billingStatus === "unbilled") {
    return { group: "work", tone: "incoming", label: "Expected drop-off", priority: 2 };
  }
  return {
    group: "work", tone: "review",
    label: ticket.status === "picked_up" && billing ? "Pickup follow-up pending" : "Check ticket status",
    priority: 3,
  };
}
