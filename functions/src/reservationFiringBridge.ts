/** Extract only the pricing requests saved with a portal check-in. */
export function reservationFiringRequests(reservation: Record<string, unknown>, ownerUid: string) {
  if (reservation.ownerUid !== ownerUid) throw new Error("RESERVATION_OWNER_MISMATCH");
  const mode = String(reservation.intakeMode ?? "").trim().toUpperCase();
  if (mode !== "SHELF_PURCHASE" && mode !== "WHOLE_KILN") throw new Error("RESERVATION_NOT_BILLABLE");
  if (["cancelled", "deleted"].includes(String(reservation.status ?? "").toLowerCase())) throw new Error("RESERVATION_NOT_ACTIVE");
  const addOns = reservation.addOns && typeof reservation.addOns === "object" ? reservation.addOns as Record<string, unknown> : {};
  const otherRequestedServices = [
    ["useStudioGlazes", "Studio glaze access"],
    ["staffGlazePrepRequested", "Staff glaze preparation"],
    ["waxResistAssistRequested", "Wax-resist assistance"],
    ["glazeSanityCheckRequested", "Glaze check"],
    ["selfLoadedKilnRequested", "Self-loaded kiln"],
    ["placementPreferenceRequested", "Placement preference"],
    ["prepaidStorageRequested", "Prepaid storage"],
    ["pickupDeliveryRequested", "Pickup delivery"],
    ["returnDeliveryRequested", "Return delivery"],
  ].filter(([key]) => addOns[key] === true && !(key === "waxResistAssistRequested" && addOns.staffGlazePrepRequested === true)).map(([, label]) => label);
  return {
    firingRange: ["low", "mid", "high", "custom"].includes(String(reservation.firingRange)) ? String(reservation.firingRange) : null,
    pricingVersion: typeof reservation.pricingVersion === "number" ? reservation.pricingVersion : null,
    private: addOns.privateRequested === true,
    rush: addOns.rushRequested === true,
    communitySharing: addOns.communityShelfFillInAllowed === true,
    otherRequestedServices,
  };
}
