export function requiresPickupReview(ticket: { status: string; billingStatus: string }): boolean {
  return ticket.status === "awaiting_pickup_review" &&
    (ticket.billingStatus === "unbilled" || ticket.billingStatus === "hold_for_review");
}
