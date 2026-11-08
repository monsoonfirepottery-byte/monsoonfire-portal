import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";
import { humanTicketName, humanTicketReference } from "../../utils/ticketIdentity";
import { missingArtistContactFields } from "./staffContactValidation";
import { sortFiringTickets, type TicketSortKey } from "./staffTicketSorting";
import { requiresPickupReview } from "./pickupReviewQueue";
import { firingQueueStatus } from "./firingQueueStatus";

type BillingOutcome =
  | "normal_billable"
  | "maker_risk_billable"
  | "studio_fault_no_charge"
  | "hold_for_review";
type BillingUnit = "half_shelf" | "whole_kiln" | "custom";
type AdjustmentAction = "void_invoice" | "credit_open_invoice" | "refund_paid_invoice";
type FieldIssueTarget =
  | "artist-contact"
  | "artist-name"
  | "artist-email"
  | "final-charge"
  | "override-reason"
  | "adjustment-confirmation"
  | "adjustment-amount"
  | "adjustment-reason";

type FieldIssue = { target: FieldIssueTarget; message: string };

export type FiringTicket = {
  ticketId: string;
  displayName: string;
  email: string | null;
  status: string;
  billingStatus: string;
  noticeStatus: string;
  billingVersion: number;
  heatId: string;
  heatLabel: string;
  estimatedSpace: string | null;
  estimatedPrice: string | null;
  requestedSpaceId: string | null;
  reservationId?: string | null;
  pricingVersion?: number | null;
  addOnRequests?: { private?: boolean; rush?: boolean; communitySharing?: boolean } | null;
  otherRequestedServices?: string[];
  firingType?: string | null;
  firingId?: string | null;
  manualFiring?: { date?: string; kiln?: string; evidence?: string } | null;
  privateStaffNote?: string | null;
  artistNote: string | null;
  artistVisibleFiringNote: string | null;
  finalChargeCents: number | null;
  currency: string;
  stripeMode: "test" | "live" | null;
  stripeInvoiceId: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
  actualSpace?: { billingUnit?: string; quantity?: number } | null;
  stripeReceiptPrint?: {
    status?: string;
    cupsJobId?: string;
    lastError?: string;
    completedAt?: string;
    attempts?: number;
    reprintCount?: number;
  } | null;
  workSlipPrint?: {
    status?: string;
    cupsJobId?: string;
    lastError?: string;
    reprintCount?: number;
  } | null;
  receiptMailStatus?: string;
  invoiceMailStatus?: string;
  deletedAt?: string | null;
  billingOperationId?: string | null;
  activeAdjustmentOperationId?: string | null;
  canResumeBilling?: boolean;
  hasPaymentLink: boolean;
  hasInvoiceLink?: boolean;
  refundedAmountCents: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type FiringBillingRuntime = {
  stripeMode: "test" | "live";
  invoicesEnabled: boolean;
  firingBillingEnabled: boolean;
  liveWritesEnabled: boolean;
  daysUntilDue: number;
  pickupInstructionsVersion: string;
};

export type QueueResponse = {
  ok: boolean;
  data: { tickets: FiringTicket[]; runtime: FiringBillingRuntime };
};

type Props = {
  client: FunctionsClient;
  isStaff: boolean;
  view?: "today" | "tickets" | "money";
  searchQuery?: string;
  onTicketsChanged?: (tickets: FiringTicket[], runtime: FiringBillingRuntime | null) => void;
  initialTicketId?: string;
  onOpenCheckins?: () => void;
  onOpenFirings?: () => void;
};

const RECOVERY_STATUSES = new Set([
  "billing_preparing",
  "adjustment_pending",
  "reconciliation_required",
]);
const PAYMENT_OPEN_STATUSES = new Set(["invoice_open", "payment_failed"]);
const REFUNDABLE_STATUSES = new Set(["paid", "partially_refunded", "refund_failed"]);

function formatMoney(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function humanStudioStage(value: string): string {
  const labels: Record<string, string> = {
    expected_dropoff: "Expected for drop-off",
    awaiting_pickup_review: "Ready for pickup review",
    ready_for_pickup: "Ready for pickup",
    picked_up: "Picked up",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function humanNoticeStatus(value: string): string {
  const labels: Record<string, string> = {
    not_queued: "Not sent yet",
    queued: "Preparing to send",
    sent: "Sent",
    failed: "Needs resend",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function normalizedArtistName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function recentArtistMatches(tickets: FiringTicket[], displayName: string): FiringTicket[] {
  const query = normalizedArtistName(displayName);
  if (query.length < 2) return [];
  const queryWords = query.split(" ");
  const seenEmails = new Set<string>();

  return tickets
    .filter((ticket) => {
      const candidate = normalizedArtistName(ticket.displayName);
      return Boolean(ticket.email) && (
        candidate.includes(query) ||
        query.includes(candidate) ||
        queryWords.every((word) => candidate.split(" ").some((candidateWord) => candidateWord.startsWith(word)))
      );
    })
    .sort((left, right) => (right.updatedAt ?? right.createdAt ?? "").localeCompare(left.updatedAt ?? left.createdAt ?? ""))
    .filter((ticket) => {
      const emailKey = ticket.email?.trim().toLocaleLowerCase();
      if (!emailKey || seenEmails.has(emailKey)) return false;
      seenEmails.add(emailKey);
      return true;
    })
    .slice(0, 3);
}

function needsPickupReview(ticket: FiringTicket): boolean {
  return RECOVERY_STATUSES.has(ticket.billingStatus) || requiresPickupReview(ticket);
}

function needsOwnerAttention(ticket: FiringTicket): boolean {
  const receiptStatus = ticket.stripeReceiptPrint?.status ?? "";
  return ticket.status !== "picked_up" ||
    needsPickupReview(ticket) ||
    ticket.noticeStatus === "failed" ||
    ticket.billingStatus === "payment_failed" ||
    ticket.billingStatus === "refund_failed" ||
    RECOVERY_STATUSES.has(ticket.billingStatus) ||
    ["needs_review", "failed", "submitting", "accepted"].includes(receiptStatus);
}

function isOpenFiringTicket(ticket: FiringTicket): boolean {
  return ticket.billingStatus === "unbilled" && ticket.status !== "awaiting_pickup_review";
}

function isBillingOrPickupTicket(ticket: FiringTicket): boolean {
  return !isOpenFiringTicket(ticket) && !needsPickupReview(ticket);
}

function ticketSeverity(ticket: FiringTicket): number {
  return firingQueueStatus(ticket).priority;
}

function workSlipPrintStatus(ticket: FiringTicket): string {
  const print = ticket.workSlipPrint;
  const job = print?.cupsJobId ? ` · ${print.cupsJobId}` : "";
  switch (print?.status) {
    case "queued":
      return "Queued for the studio thermal printer.";
    case "submitting":
    case "accepted":
      return `Printing at the studio${job}.`;
    case "printed":
      return `Printed${job}.`;
    case "needs_review":
    case "failed":
      return `Needs your attention${print.lastError ? ` · ${print.lastError}` : ""}.`;
    default:
      return "Not queued yet.";
  }
}

function initialSpace(ticket: FiringTicket): { unit: BillingUnit; quantity: number } {
  if (ticket.heatId === "custom" || ticket.requestedSpaceId === "large") {
    return { unit: ticket.heatId === "custom" ? "custom" : "whole_kiln", quantity: 1 };
  }
  if (ticket.requestedSpaceId === "triple") return { unit: "half_shelf", quantity: 3 };
  if (ticket.requestedSpaceId === "double") return { unit: "half_shelf", quantity: 2 };
  return { unit: "half_shelf", quantity: 1 };
}

function standardRate(ticket: FiringTicket, unit: BillingUnit, quantity: number, privateFulfilled = false, rushFulfilled = false) {
  if (ticket.pricingVersion === 2) {
    if (unit === "custom" || !["low", "mid"].includes(ticket.heatId)) return { rateKey: null, cents: null };
    const cap = ticket.heatId === "low" ? 8000 : 12000;
    const base = unit === "whole_kiln" ? cap : Math.min(quantity * (ticket.heatId === "low" ? 2000 : 3500), cap);
    return { rateKey: `${ticket.heatId}_shared_v2`, cents: base + (privateFulfilled ? 2000 : 0) + (rushFulfilled ? 2000 : 0) };
  }
  if (unit === "whole_kiln") return { rateKey: "whole_kiln", cents: 6_500 };
  if (unit === "custom" || ticket.heatId === "custom") {
    return { rateKey: "custom_whole_kiln", cents: 6_500 };
  }
  if (quantity < 1 || quantity > 3) return { rateKey: null, cents: null };
  if (ticket.heatId === "low") return { rateKey: "low_half_shelf", cents: quantity * 1_500 };
  if (ticket.heatId === "mid" || ticket.heatId === "high") {
    return { rateKey: "mid_half_shelf", cents: Math.min(quantity * 2_500, 6_500) };
  }
  return { rateKey: null, cents: null };
}

function createUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const suffix = Math.random().toString(16).slice(2).padEnd(12, "0").slice(0, 12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function requestIdFor(key: string): string {
  const storageKey = `mf:firing-billing-request:${key}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (existing) return existing;
    const created = createUuid();
    window.sessionStorage.setItem(storageKey, created);
    return created;
  } catch {
    return createUuid();
  }
}

function clearRequestId(key: string): void {
  try {
    window.sessionStorage.removeItem(`mf:firing-billing-request:${key}`);
  } catch {
    // The server-side operation id still protects this request.
  }
}

function dollarsToCents(value: string): number | null {
  if (!value.trim()) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export default function FiringPickupBillingModule({
  client,
  isStaff,
  view = "today",
  searchQuery = "",
  onTicketsChanged,
  initialTicketId,
  onOpenCheckins,
  onOpenFirings,
}: Props) {
  const [tickets, setTickets] = useState<FiringTicket[]>([]);
  const [runtime, setRuntime] = useState<FiringBillingRuntime | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const initialTicketRef = useRef(initialTicketId);
  const finalizing = useRef(false);
  const [missingInitialTicket, setMissingInitialTicket] = useState(false);
  const [filter, setFilter] = useState<"attention" | "open" | "review" | "ready" | "all" | "work" | "pickup" | "history">(
    initialTicketId ? "all" : view === "tickets" ? "work" : view === "money" ? "ready" : "attention",
  );
  const [ticketSearch, setTicketSearch] = useState("");
  const ticketListRef = useRef<HTMLElement>(null);
  const [sortBy, setSortBy] = useState<TicketSortKey>("severity");
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldIssue, setFieldIssue] = useState<FieldIssue | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailEditedByStaff, setEmailEditedByStaff] = useState(false);
  const [outcome, setOutcome] = useState<BillingOutcome>("normal_billable");
  const [billingUnit, setBillingUnit] = useState<BillingUnit>("half_shelf");
  const [quantity, setQuantity] = useState(1);
  const [privateFulfilled, setPrivateFulfilled] = useState(false);
  const [rushFulfilled, setRushFulfilled] = useState(false);
  const [customBaseCharge, setCustomBaseCharge] = useState("");
  const [finalCharge, setFinalCharge] = useState("0.00");
  const [pricingTicketId, setPricingTicketId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [artistVisibleNote, setArtistVisibleNote] = useState("");
  const [privateStaffNote, setPrivateStaffNote] = useState("");

  const [adjustmentAction, setAdjustmentAction] = useState<AdjustmentAction>("void_invoice");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0.00");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentArtistNote, setAdjustmentArtistNote] = useState("");
  const [adjustmentPrivateNote, setAdjustmentPrivateNote] = useState("");
  const [confirmedAdjustment, setConfirmedAdjustment] = useState(false);

  const showFieldIssue = useCallback((target: FieldIssueTarget, message: string) => {
    setFieldIssue({ target, message });
    requestAnimationFrame(() => {
      const focusTarget = target === "artist-contact" ? "artist-name" : target;
      document.getElementById(`firing-field-${focusTarget}`)?.focus();
    });
  }, []);

  const clearFieldIssue = useCallback((target: FieldIssueTarget) => {
    setFieldIssue((current) => current?.target === target ||
      (current?.target === "artist-contact" && (target === "artist-name" || target === "artist-email"))
      ? null
      : current);
  }, []);

  const load = useCallback(async () => {
    if (!isStaff) return;
    setLoading(true);
    setError("");
    try {
      const response = await client.postJson<QueueResponse>("staffListFiringPickupReviews", {});
      if (!Array.isArray(response.data?.tickets)) throw new Error("The ticket queue couldn’t be loaded. Try Refresh.");
      const nextTickets = response.data.tickets;
      setTickets(nextTickets);
      setHasLoaded(true);
      const nextRuntime = response.data?.runtime ?? null;
      setRuntime(nextRuntime);
      onTicketsChanged?.(nextTickets, nextRuntime);
      const requestedTicket = initialTicketRef.current;
      initialTicketRef.current = undefined;
      if (requestedTicket) {
        const exists = nextTickets.some((ticket) => ticket.ticketId === requestedTicket);
        setMissingInitialTicket(!exists);
        setSelectedTicketId(exists ? requestedTicket : "");
        return;
      }
      setSelectedTicketId((current) => {
        if (current && nextTickets.some((ticket) => ticket.ticketId === current)) return current;
        return nextTickets.find(needsOwnerAttention)?.ticketId ??
          nextTickets.find(needsPickupReview)?.ticketId ??
          nextTickets.find(isOpenFiringTicket)?.ticketId ??
          nextTickets[0]?.ticketId ?? "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [client, isStaff, onTicketsChanged]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => tickets.find((ticket) => ticket.ticketId === selectedTicketId) ?? null,
    [selectedTicketId, tickets],
  );

  const queueWorkSlip = useCallback(async (ticket: FiringTicket) => {
    if (busy) return;
    const action = ticket.workSlipPrint?.status === "printed" ? "reprint" : "original";
    const requestKey = `work-slip-${action}:${ticket.ticketId}:${ticket.workSlipPrint?.cupsJobId ?? "none"}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy(`work-slip-${action}`);
    setError("");
    setStatus("");
    try {
      await client.postJson(
        "staffQueueFiringWorkSlipPrint",
        { ticketId: ticket.ticketId, clientRequestId, action },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(action === "reprint"
        ? `Queued another work slip for ${humanTicketReference(ticket.ticketId)}.`
        : `Queued the work slip for ${humanTicketReference(ticket.ticketId)}.`);
      await load();
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : String(printError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load]);

  useEffect(() => {
    if (!selected) return;
    const space = initialSpace(selected);
    const rate = standardRate(selected, space.unit, space.quantity);
    setDisplayName(selected.displayName === "Artist" ? "" : selected.displayName);
    setEmail(selected.email ?? "");
    setEmailEditedByStaff(false);
    setOutcome(selected.billingStatus === "hold_for_review" ? "hold_for_review" : "normal_billable");
    setBillingUnit(space.unit);
    setQuantity(space.quantity);
    setPrivateFulfilled(false);
    setRushFulfilled(false);
    setCustomBaseCharge("");
    setFinalCharge(((rate.cents ?? 0) / 100).toFixed(2));
    setOverrideReason("");
    setArtistVisibleNote(selected.artistVisibleFiringNote ?? "");
    setPrivateStaffNote("");
    const refundable = Math.max((selected.finalChargeCents ?? 0) - selected.refundedAmountCents, 0);
    setAdjustmentAction(PAYMENT_OPEN_STATUSES.has(selected.billingStatus) ? "void_invoice" : "refund_paid_invoice");
    setAdjustmentAmount((refundable / 100).toFixed(2));
    setAdjustmentReason("");
    setAdjustmentArtistNote("");
    setAdjustmentPrivateNote("");
    setConfirmedAdjustment(false);
    setFieldIssue(null);
    setPricingTicketId(selected.ticketId);
  }, [selected]);

  const artistMatches = useMemo(
    () => email.trim() || emailEditedByStaff ? [] : recentArtistMatches(tickets, displayName),
    [displayName, email, emailEditedByStaff, tickets],
  );

  useEffect(() => {
    if (view === "tickets") setFilter(initialTicketId ? "all" : "work");
    if (view === "money") setFilter("ready");
    if (view === "today") setFilter("attention");
  }, [initialTicketId, view]);

  const queueCounts = useMemo(() => {
    const counts = { work: 0, pickup: 0, history: 0, all: tickets.length };
    for (const ticket of tickets) counts[firingQueueStatus(ticket).group] += 1;
    return counts;
  }, [tickets]);

  const visibleTickets = useMemo(() => {
    const scoped = filter === "all"
      ? tickets
      : filter === "work" || filter === "pickup" || filter === "history"
        ? tickets.filter((ticket) => firingQueueStatus(ticket).group === filter)
      : filter === "attention"
        ? tickets.filter(needsOwnerAttention)
      : filter === "open"
        ? tickets.filter(isOpenFiringTicket)
        : filter === "review"
          ? tickets.filter(needsPickupReview)
          : tickets.filter(isBillingOrPickupTicket);
    const query = (searchQuery || ticketSearch).trim().toLowerCase();
    const searched = !query ? scoped : scoped.filter((ticket) => [
      ticket.ticketId,
      ticket.displayName,
      ticket.email ?? "",
      ticket.heatLabel,
      ticket.status,
      ticket.billingStatus,
      ticket.noticeStatus,
    ].some((value) => value.toLowerCase().includes(query)));
    return sortFiringTickets(searched, sortBy, ticketSeverity);
  }, [filter, searchQuery, ticketSearch, sortBy, tickets]);

  useEffect(() => {
    setSelectedTicketId((current) => {
      if (current && visibleTickets.some((ticket) => ticket.ticketId === current)) return current;
      if (missingInitialTicket) return "";
      return visibleTickets[0]?.ticketId ?? "";
    });
  }, [missingInitialTicket, visibleTickets]);

  const selectedTicketIndex = visibleTickets.findIndex((ticket) => ticket.ticketId === selectedTicketId);
  useEffect(() => {
    const list = ticketListRef.current;
    if (!list) return;
    const revealSelected = () => {
      const item = list.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (item) list.scrollTop = Math.max(0, item.offsetTop - list.offsetTop - 45);
    };
    revealSelected();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selectedTicketId]);
  const moveSelection = useCallback((offset: number) => {
    if (visibleTickets.length === 0) return;
    const currentIndex = selectedTicketIndex >= 0 ? selectedTicketIndex : 0;
    const nextIndex = Math.max(0, Math.min(visibleTickets.length - 1, currentIndex + offset));
    setSelectedTicketId(visibleTickets[nextIndex].ticketId);
  }, [selectedTicketIndex, visibleTickets]);

  const derivedRate = useMemo(
    () => {
      if (!selected) return { rateKey: null, cents: null };
      if (selected.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom")) {
        const base = dollarsToCents(customBaseCharge);
        return base === null ? { rateKey: null, cents: null } : { rateKey: "custom_quote_v2", cents: base + (privateFulfilled ? 2000 : 0) + (rushFulfilled ? 2000 : 0) };
      }
      return standardRate(selected, billingUnit, quantity, privateFulfilled, rushFulfilled);
    },
    [billingUnit, quantity, selected, privateFulfilled, rushFulfilled, customBaseCharge],
  );

  useEffect(() => {
    if (!selected || pricingTicketId !== selected.ticketId) return;
    if (outcome === "studio_fault_no_charge" || outcome === "hold_for_review") {
      setFinalCharge("0.00");
      return;
    }
    if (derivedRate.cents !== null) setFinalCharge((derivedRate.cents / 100).toFixed(2));
  }, [billingUnit, derivedRate.cents, outcome, pricingTicketId, quantity, selected]);

  const writesReady = Boolean(
    runtime?.invoicesEnabled && runtime.firingBillingEnabled &&
    (runtime.stripeMode === "test" || runtime.liveWritesEnabled),
  );
  const billableOutcome = outcome === "normal_billable" || outcome === "maker_risk_billable";
  const billableActionLocked = billableOutcome && !writesReady;

  const prepareReview = useCallback(async () => {
    if (!selected || busy) return;
    const requestKey = `unloaded:${selected.ticketId}:v${selected.billingVersion}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("prepare");
    setError("");
    setStatus("");
    try {
      await client.postJson("staffPrepareFiringPickupReview", {
        ticketId: selected.ticketId,
        expectedVersion: selected.billingVersion,
        clientRequestId,
        action: "confirm_unloaded",
        batchId: null,
        confirmedUnloaded: true,
      }, { headers: { "Idempotency-Key": clientRequestId } });
      clearRequestId(requestKey);
      setStatus(`${humanTicketReference(selected.ticketId)} is ready to review. Nothing was billed or emailed.`);
      setFilter("review");
      await load();
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : String(prepareError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const finalize = useCallback(async () => {
    if (!selected || busy || finalizing.current) return;
    const isHold = outcome === "hold_for_review";
    const isBillable = outcome === "normal_billable" || outcome === "maker_risk_billable";
    const finalChargeCents = dollarsToCents(finalCharge);
    if (finalChargeCents === null || finalChargeCents > 1_000_000) {
      showFieldIssue("final-charge", "Enter a valid final firing charge up to $10,000.");
      return;
    }
    if (isBillable && !writesReady) {
      setError("Payments are not available right now. Check Settings before marking this work ready.");
      return;
    }
    if (!isHold) {
      const missingContactFields = missingArtistContactFields(displayName, email);
      if (missingContactFields.length > 0) {
        const target = missingContactFields.length === 2 ? "artist-contact" : missingContactFields[0];
        showFieldIssue(target, target === "artist-contact"
          ? "Add a name and email so we know where to send the pickup note."
          : target === "artist-name"
            ? "Add a name or nickname for this ticket."
            : "Add the artist email to send the pickup note.");
        return;
      }
    }
    const standardMatches = derivedRate.cents === finalChargeCents && derivedRate.rateKey !== null;
    if (isBillable && selected.otherRequestedServices?.length && !overrideReason.trim()) {
      showFieldIssue("override-reason", "Record how the other requested services were handled before billing.");
      return;
    }
    if (isBillable && selected.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom") && dollarsToCents(customBaseCharge) === null) {
      showFieldIssue("final-charge", "Enter the custom firing quote before add-ons.");
      return;
    }
    if (isBillable && !standardMatches && !overrideReason.trim()) {
      showFieldIssue("override-reason", "Add a short note about this price adjustment.");
      return;
    }
    const requestKey = `finalize:${selected.ticketId}:v${selected.billingVersion}`;
    const clientRequestId = requestIdFor(requestKey);
    finalizing.current = true;
    setBusy("finalize");
    setError("");
    setStatus("");
    try {
      await client.postJson("staffFinalizeFiringPickup", {
        ticketId: selected.ticketId,
        expectedVersion: selected.billingVersion,
        clientRequestId,
        outcome,
        actualSpace: { billingUnit, quantity: billingUnit === "half_shelf" ? quantity : 1 },
        rateKey: derivedRate.rateKey,
        finalChargeCents,
        ...(selected.pricingVersion === 2 ? { privateFulfilled, rushFulfilled } : {}),
        ...(selected.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom") && dollarsToCents(customBaseCharge) !== null ? { customBaseChargeCents: dollarsToCents(customBaseCharge) } : {}),
        currency: "usd",
        overrideReason: overrideReason.trim() || null,
        artistVisibleFiringNote: artistVisibleNote.trim() || null,
        privateStaffNote: privateStaffNote.trim() || null,
        artistContact: isHold ? null : { displayName: displayName.trim(), email: email.trim() },
        confirmedReady: !isHold,
      }, { headers: { "Idempotency-Key": clientRequestId } });
      clearRequestId(requestKey);
      setStatus(isHold
        ? `Held ${humanTicketReference(selected.ticketId)} for another look. No invoice or email was created.`
        : `Marked ${humanTicketReference(selected.ticketId)} ready and queued the pickup email.`);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      finalizing.current = false;
      setBusy("");
    }
  }, [artistVisibleNote, billingUnit, busy, client, customBaseCharge, derivedRate.cents, derivedRate.rateKey, displayName, email, finalCharge, load, outcome, overrideReason, privateStaffNote, privateFulfilled, rushFulfilled, quantity, selected, showFieldIssue, writesReady]);

  const resume = useCallback(async () => {
    if (!selected || busy) return;
    const operationId = selected.activeAdjustmentOperationId ?? selected.billingOperationId;
    if (!operationId) {
      setError("No recoverable billing operation is attached to this ticket.");
      return;
    }
    setBusy("resume");
    setError("");
    setStatus("");
    try {
      await client.postJson("staffResumeFiringBillingOperation", { ticketId: selected.ticketId, operationId });
      setStatus(`Recovered the saved billing operation for ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const resend = useCallback(async () => {
    if (!selected || busy) return;
    const requestKey = `resend:${selected.ticketId}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("resend");
    setError("");
    try {
      await client.postJson(
        "staffResendFiringPickupNotice",
        { ticketId: selected.ticketId, clientRequestId },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(`Queued another pickup email for ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : String(resendError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const queuePaymentReceipt = useCallback(async (action: "retry" | "reprint") => {
    if (!selected || busy) return;
    const requestKey = `receipt-${action}:${selected.ticketId}:${selected.stripeReceiptPrint?.cupsJobId ?? "none"}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy(`receipt-${action}`);
    setError("");
    setStatus("");
    try {
      await client.postJson(
        "staffQueueFiringReceiptPrint",
        { ticketId: selected.ticketId, clientRequestId, action },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(action === "reprint"
        ? `Queued another payment receipt for ${humanTicketReference(selected.ticketId)}.`
        : `Queued a deliberate receipt retry for ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : String(receiptError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const emailPaidInvoice = useCallback(async () => {
    if (!selected || busy) return;
    const requestKey = `paid-receipt-email:${selected.ticketId}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("receipt-email");
    setError("");
    setStatus("");
    try {
      await client.postJson(
        "staffResendFiringPaidReceipt",
        { ticketId: selected.ticketId, clientRequestId },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(`Queued the paid Stripe invoice for ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (receiptError) {
      setError(receiptError instanceof Error ? receiptError.message : String(receiptError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const resendInvoice = useCallback(async () => {
    if (!selected || busy) return;
    const requestKey = `invoice-resend:${selected.ticketId}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("invoice-resend");
    setError("");
    setStatus("");
    try {
      await client.postJson(
        "staffResendFiringInvoice",
        { ticketId: selected.ticketId, clientRequestId },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(`Queued the firing invoice for ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (invoiceError) {
      setError(invoiceError instanceof Error ? invoiceError.message : String(invoiceError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const deleteTicket = useCallback(async () => {
    if (!selected || busy) return;
    if (typeof window !== "undefined" && !window.confirm(`Delete ${humanTicketReference(selected.ticketId)}? Tickets with invoices or payment history cannot be deleted.`)) return;
    const requestKey = `delete-ticket:${selected.ticketId}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("delete-ticket");
    setError("");
    setStatus("");
    try {
      await client.postJson(
        "staffDeleteFiringTicket",
        { ticketId: selected.ticketId, clientRequestId },
        { headers: { "Idempotency-Key": clientRequestId } },
      );
      clearRequestId(requestKey);
      setStatus(`Deleted ${humanTicketReference(selected.ticketId)}.`);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const markPickedUp = useCallback(async () => {
    if (!selected || busy) return;
    const requestKey = `picked-up:${selected.ticketId}:v${selected.billingVersion}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("picked-up");
    setError("");
    setStatus("");
    try {
      await client.postJson("staffMarkFiringPickedUp", {
        ticketId: selected.ticketId,
        expectedVersion: selected.billingVersion,
        clientRequestId,
        confirmedPickedUp: true,
      }, { headers: { "Idempotency-Key": clientRequestId } });
      clearRequestId(requestKey);
      setStatus(`Marked ${humanTicketReference(selected.ticketId)} picked up. Its billing status was left unchanged.`);
      await load();
    } catch (pickupError) {
      setError(pickupError instanceof Error ? pickupError.message : String(pickupError));
    } finally {
      setBusy("");
    }
  }, [busy, client, load, selected]);

  const adjust = useCallback(async () => {
    if (!selected || busy) return;
    if (!writesReady) {
      setError("Payments are not available right now. Check Settings before making this billing change.");
      return;
    }
    if (!confirmedAdjustment) {
      showFieldIssue("adjustment-confirmation", "Check this after you review the ticket and amount.");
      return;
    }
    const amountCents = adjustmentAction === "void_invoice" ? 0 : dollarsToCents(adjustmentAmount);
    if (amountCents === null || (adjustmentAction !== "void_invoice" && amountCents <= 0)) {
      showFieldIssue("adjustment-amount", "Enter a positive credit or refund amount.");
      return;
    }
    if (adjustmentReason.trim().length < 4) {
      showFieldIssue("adjustment-reason", "Add a short note for this billing change.");
      return;
    }
    const requestKey = `adjust:${selected.ticketId}:v${selected.billingVersion}:${adjustmentAction}`;
    const clientRequestId = requestIdFor(requestKey);
    setBusy("adjust");
    setError("");
    setStatus("");
    try {
      await client.postJson("staffAdjustFiringBilling", {
        ticketId: selected.ticketId,
        expectedVersion: selected.billingVersion,
        clientRequestId,
        action: adjustmentAction,
        amountCents,
        reason: adjustmentReason.trim(),
        artistVisibleNote: adjustmentArtistNote.trim() || null,
        privateStaffNote: adjustmentPrivateNote.trim() || null,
      }, { headers: { "Idempotency-Key": clientRequestId } });
      clearRequestId(requestKey);
      setStatus(`Saved the billing correction for ${humanTicketReference(selected.ticketId)} and queued the artist update.`);
      await load();
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : String(adjustError));
    } finally {
      setBusy("");
    }
  }, [adjustmentAction, adjustmentAmount, adjustmentArtistNote, adjustmentPrivateNote, adjustmentReason, busy, client, confirmedAdjustment, load, selected, showFieldIssue, writesReady]);

  if (!isStaff) {
    return <section className="card staff-console-card"><div className="staff-note staff-note-error">Staff claim required.</div></section>;
  }

  const canPrepareReview = selected ? isOpenFiringTicket(selected) : false;
  const canFinalize = selected &&
    ["unbilled", "hold_for_review"].includes(selected.billingStatus) &&
    selected.status === "awaiting_pickup_review";
  const readyAction = canFinalize ? (
    <button className="btn btn-primary" type="button" disabled={Boolean(busy) || billableActionLocked} onClick={() => void finalize()}>
      {busy === "finalize"
        ? "Saving…"
        : outcome === "hold_for_review"
          ? "Save hold · send nothing"
          : billableActionLocked
            ? "Live billing locked · use Settings"
            : runtime?.stripeMode === "live" && outcome !== "studio_fault_no_charge"
              ? "Mark ready & create LIVE invoice"
              : "Mark ready & send pickup email"}
    </button>
  ) : null;
  const canAdjustOpen = selected ? PAYMENT_OPEN_STATUSES.has(selected.billingStatus) : false;
  const canRefund = selected ? REFUNDABLE_STATUSES.has(selected.billingStatus) : false;
  const canMarkPickedUp = selected?.status === "ready_for_pickup";
  const hasFieldIssue = (...targets: FieldIssueTarget[]) => Boolean(fieldIssue && targets.includes(fieldIssue.target));
  const showWorkflow = view === "tickets" && onOpenCheckins && onOpenFirings;

  return (
    <section className={`card staff-console-card firing-billing-module firing-billing-view-${view}`} aria-label="Firing tickets">
      {showWorkflow ? (
        <section className="firing-workflow" aria-label="Follow the ware">
          <h2>Follow the ware</h2>
          <ol className="firing-workflow-stages">
            <li><button type="button" className="firing-workflow-stage" onClick={onOpenCheckins}>
              <span className="firing-workflow-art" data-stage="intake" aria-hidden="true" />
              <span className="firing-workflow-copy"><strong>Incoming ware</strong><span>Plan a drop-off in Pathfinder</span></span>
            </button></li>
            <li><button type="button" className="firing-workflow-stage" onClick={onOpenFirings}>
              <span className="firing-workflow-art" data-stage="kiln" aria-hidden="true" />
              <span className="firing-workflow-copy"><strong>Firing lanes</strong><span>Open kiln schedule</span></span>
            </button></li>
            <li><button type="button" className="firing-workflow-stage" aria-pressed={filter === "review"} onClick={() => setFilter("review")}>
              <span className="firing-workflow-art" data-stage="unload" aria-hidden="true" />
              <span className="firing-workflow-copy"><strong>Unloading</strong><span>Review tickets after firing</span>{hasLoaded ? <small>{tickets.filter(needsPickupReview).length} to review</small> : null}</span>
            </button></li>
            <li><button type="button" className="firing-workflow-stage" aria-pressed={filter === "pickup"} onClick={() => setFilter("pickup")}>
              <span className="firing-workflow-art" data-stage="billing" aria-hidden="true" />
              <span className="firing-workflow-copy"><strong>Billing &amp; pickup</strong><span>View payment and pickup status</span>{hasLoaded ? <small>{queueCounts.pickup} awaiting pickup</small> : null}</span>
            </button></li>
          </ol>
        </section>
      ) : null}
      {runtime ? (
        <div className="staff-mini firing-payment-mode" role="status">
          <strong>{runtime.stripeMode === "test" ? "Test payments" : "Live payments"}</strong>
          {runtime.stripeMode === "test"
            ? " · Safe for rehearsal; no real payment can be collected."
            : runtime.liveWritesEnabled ? " · Payments enabled." : " · Payments paused. Check Payment settings."}
        </div>
      ) : null}
      {status ? <div className="staff-note" role="status" aria-live="polite">{status}</div> : null}
      {error ? <div className="staff-note staff-note-error" role="alert">{error}</div> : null}
      {missingInitialTicket && !selected ? <div className="staff-note" role="status">That ticket is no longer in this queue. Choose a ticket below or return to Today.</div> : null}

      <div className="staff-actions-row firing-billing-filters" role="group" aria-label="Filter firing tickets">
        <label className="staff-field firing-ticket-search">Find a ticket<input type="search" placeholder="Name, email, or ticket number" value={ticketSearch} onChange={(event) => setTicketSearch(event.target.value)} /></label>
        {view === "tickets" ? (
          ([["work", "Needs work"], ["pickup", "Awaiting pickup"], ["history", "History"], ["all", "All tickets"]] as const).map(([key, label]) => (
            <button key={key} className={`btn ${filter === key ? "btn-primary" : "btn-ghost"}`} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}{hasLoaded ? ` · ${queueCounts[key]}` : ""}
            </button>
          ))
        ) : <>
          {view === "today" ? <button className={`btn ${filter === "attention" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => setFilter("attention")}>Needs you</button> : null}
          <button className={`btn ${filter === "open" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => setFilter("open")}>Open tickets</button>
          <button className={`btn ${filter === "review" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => setFilter("review")}>Pickup review</button>
          <button className={`btn ${filter === "ready" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => setFilter("ready")}>Ready</button>
          <button className={`btn ${filter === "all" ? "btn-primary" : "btn-ghost"}`} type="button" onClick={() => setFilter("all")}>All</button>
        </>}
        <label className="firing-billing-sort">Sort by
          <select aria-label="Sort firing tickets" value={sortBy} onChange={(event) => setSortBy(event.target.value as TicketSortKey)}>
            <option value="severity">Needs attention</option>
            <option value="updated_desc">Recently updated</option>
            <option value="updated_asc">Oldest update</option>
            <option value="state">State</option>
            <option value="artist">Artist name</option>
            <option value="email">Email</option>
            <option value="heat">Firing range</option>
          </select>
        </label>
        {!loading ? <button className="btn btn-ghost firing-billing-refresh" type="button" disabled={Boolean(busy)} onClick={() => void load()}>Refresh</button> : null}
      </div>

      {loading ? (
        <div className="firing-ticket-loading" role="status" aria-live="polite">
          <svg className="firing-ticket-loading-art" viewBox="0 0 144 48" fill="none" aria-hidden="true">
            <rect x="3" y="7" width="30" height="34" rx="4" />
            <path d="M10 17h16M10 24h12M10 31h9M40 24h64" />
            <rect x="111" y="7" width="30" height="34" rx="4" />
            <path d="M118 17h16M118 24h16M118 31h10" />
            <circle className="firing-ticket-loading-packet" cx="43" cy="24" r="4" />
          </svg>
          <div className="firing-ticket-loading-copy"><strong>{hasLoaded ? "Refreshing firing tickets" : "Loading firing tickets"}</strong><span>Gathering the latest ticket information. This can take a moment.</span><div className="firing-ticket-loading-track" aria-hidden="true"><div className="firing-ticket-loading-fill" /></div></div>
        </div>
      ) : null}

      <div className="firing-billing-workspace" aria-busy={loading}>
        <nav className="firing-billing-ticket-list" aria-label="Firing tickets" ref={ticketListRef}>
          {hasLoaded ? <div className="firing-billing-list-header">
            <strong>{visibleTickets.length} {visibleTickets.length === 1 ? "ticket" : "tickets"}</strong>
            <span className="staff-mini">{selectedTicketIndex >= 0 ? `${selectedTicketIndex + 1} of ${visibleTickets.length}` : "No ticket selected"}</span>
          </div> : null}
          {hasLoaded && visibleTickets.length === 0 ? <div className="staff-note">{(searchQuery || ticketSearch).trim() ? "No tickets match that search." : filter === "work" ? "No tickets need work. Check Awaiting pickup or History." : "No tickets in this view."}</div> : null}
          {visibleTickets.map((ticket, ticketIndex) => {
            const queueStatus = firingQueueStatus(ticket);
            return (
              <button
                key={ticket.ticketId}
                type="button"
                className={`firing-billing-ticket ${ticket.ticketId === selectedTicketId ? "is-selected" : ""} ${busy && ticket.ticketId === selectedTicketId ? "is-transitioning" : ""}`}
                aria-pressed={ticket.ticketId === selectedTicketId}
                aria-keyshortcuts="ArrowUp ArrowDown"
                onClick={() => setSelectedTicketId(ticket.ticketId)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedTicketId(visibleTickets[Math.min(ticketIndex + 1, visibleTickets.length - 1)].ticketId);
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedTicketId(visibleTickets[Math.max(ticketIndex - 1, 0)].ticketId);
                  }
                }}
              >
                <span><strong>{humanTicketName(ticket.displayName)}</strong><small className="firing-billing-ticket-reference">{humanTicketReference(ticket.ticketId)}</small></span>
                <span className="firing-billing-ticket-state">
                  <span className="firing-ticket-tag" data-tone={queueStatus.tone}>{queueStatus.label}</span>
                  {ticket.heatLabel ? <span>{ticket.heatLabel}</span> : null}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="firing-billing-detail">
          {!selected ? (hasLoaded ? <div className="staff-note">Select a firing ticket to review it.</div> : null) : (
            <>
              <header className="firing-billing-summary">
                <div>
                  <div className="card-title">{humanTicketName(selected.displayName)}</div>
                  <div>{humanTicketReference(selected.ticketId)} · {selected.heatLabel} · {firingQueueStatus(selected).label}</div>
                  {selected.email ? <div className="staff-mini">{selected.email}</div> : null}
                  <div className="firing-ticket-amount">{selected.finalChargeCents === null ? "Not billed yet" : formatMoney(selected.finalChargeCents)}{selected.refundedAmountCents > 0 ? ` · ${formatMoney(selected.refundedAmountCents)} refunded` : ""}</div>
                  <div className="firing-billing-ticket-nav" aria-label="Ticket navigation">
                    <button className="btn btn-ghost" type="button" disabled={selectedTicketIndex <= 0} onClick={() => moveSelection(-1)}>Previous ticket</button>
                    <span className="staff-mini">{selectedTicketIndex >= 0 ? `Ticket ${selectedTicketIndex + 1} of ${visibleTickets.length}` : "Ticket not in this view"}</span>
                    <button className="btn btn-secondary" type="button" disabled={selectedTicketIndex < 0 || selectedTicketIndex >= visibleTickets.length - 1} onClick={() => moveSelection(1)}>Next ticket</button>
                  </div>
                </div>
                <div>
                  <div className="staff-mini">Ticket status: {humanStudioStage(selected.status)}<br />Pickup email: {humanNoticeStatus(selected.noticeStatus)}</div>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void queueWorkSlip(selected)}
                  >
                    {busy.startsWith("work-slip-")
                      ? "Queuing…"
                      : selected.workSlipPrint?.status === "printed"
                        ? "Reprint work slip"
                        : "Print work slip"}
                  </button>
                  <div className={`staff-mini ${["needs_review", "failed"].includes(selected.workSlipPrint?.status ?? "") ? "staff-note-error" : ""}`}>
                    Work slip: {workSlipPrintStatus(selected)}
                  </div>
                </div>
              </header>

              {selected.canResumeBilling ? (
                <div className="firing-billing-recovery">
                  <div className="staff-note staff-note-error">A previous billing update needs to finish before you make another change. Resume it to continue.</div>
                  <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void resume()}>{busy === "resume" ? "Continuing…" : "Continue saved billing update"}</button>
                </div>
              ) : null}

              {selected.billingStatus === "paid" ? (
                <div className={`firing-billing-recovery ${["needs_review", "failed"].includes(selected.stripeReceiptPrint?.status ?? "") ? "has-field-issue" : ""}`}>
                  <div className="staff-note">
                    <strong>Payment receipt:</strong>{" "}
                    {selected.stripeReceiptPrint?.status === "printed"
                      ? `Printed${selected.stripeReceiptPrint.cupsJobId ? ` · ${selected.stripeReceiptPrint.cupsJobId}` : ""}.`
                      : selected.stripeReceiptPrint?.status === "queued"
                        ? "Waiting for Studio Brain."
                        : selected.stripeReceiptPrint?.status === "submitting" || selected.stripeReceiptPrint?.status === "accepted"
                          ? `Printer is working${selected.stripeReceiptPrint.cupsJobId ? ` · ${selected.stripeReceiptPrint.cupsJobId}` : ""}.`
                          : selected.stripeReceiptPrint?.status === "needs_review" || selected.stripeReceiptPrint?.status === "failed"
                            ? `Needs your attention${selected.stripeReceiptPrint.lastError ? ` · ${selected.stripeReceiptPrint.lastError}` : ""}. Check beside the printer before retrying.`
                            : "Not queued yet."}
                  </div>
                  {selected.stripeReceiptPrint?.status === "printed" ? (
                    <button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void queuePaymentReceipt("reprint")}>{busy === "receipt-reprint" ? "Queuing…" : "Print another receipt"}</button>
                  ) : null}
                  {["needs_review", "failed", "submitting", "accepted"].includes(selected.stripeReceiptPrint?.status ?? "") ? (
                    <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void queuePaymentReceipt("retry")}>{busy === "receipt-retry" ? "Queuing…" : "I checked · retry receipt"}</button>
                  ) : null}
                  <button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void emailPaidInvoice()}>{busy === "receipt-email" ? "Queuing email…" : selected.receiptMailStatus === "sent" ? "Email paid invoice again" : "Email paid invoice"}</button>
                </div>
              ) : null}

              {selected.hasInvoiceLink && selected.billingStatus !== "paid" ? (
                <div className="firing-billing-recovery">
                  <div className="staff-note"><strong>Invoice email:</strong> {selected.invoiceMailStatus === "sent" ? "The current invoice was emailed." : selected.invoiceMailStatus === "queued" ? "The invoice email is queued." : "The current Stripe invoice is available."}</div>
                  <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void resendInvoice()}>{busy === "invoice-resend" ? "Sending…" : selected.invoiceMailStatus === "sent" ? "Resend invoice" : "Email invoice"}</button>
                </div>
              ) : null}

              {["partially_refunded", "refunded"].includes(selected.billingStatus) ? (
                <div className="staff-note"><strong>Refund record:</strong> Refunds stay digital in Stripe so the artist always sees the current amount. No automatic paper receipt is printed after a refund.</div>
              ) : null}

              {canPrepareReview ? (
                <div className="firing-billing-recovery">
                  <div className="staff-note"><strong>Work is out of the kiln.</strong> Open this ticket to choose the firing outcome and send its ready note.</div>
                  <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void prepareReview()}>{busy === "prepare" ? "Opening review…" : "Review this unloaded firing"}</button>
                </div>
              ) : null}

              {canFinalize ? (
                <div className="firing-billing-review-form">
                  <div className="staff-actions-row firing-billing-primary-action" role="group" aria-label="Pickup review actions">
                    {readyAction}
                  </div>
                  <fieldset className={hasFieldIssue("artist-contact") ? "has-field-issue" : ""}>
                    <legend>Artist contact</legend>
                    <div className="staff-module-grid">
                      <label className={`staff-field ${hasFieldIssue("artist-name") ? "has-field-issue" : ""}`}>Name or nickname<input id="firing-field-artist-name" value={displayName} onChange={(event) => { setDisplayName(event.target.value); clearFieldIssue("artist-name"); }} disabled={Boolean(busy)} aria-invalid={hasFieldIssue("artist-name")} aria-describedby={hasFieldIssue("artist-name") ? "firing-field-artist-name-hint" : undefined} />{hasFieldIssue("artist-name") ? <span id="firing-field-artist-name-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label>
                      <label className={`staff-field ${hasFieldIssue("artist-email") ? "has-field-issue" : ""}`}>Email<input id="firing-field-artist-email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailEditedByStaff(true); clearFieldIssue("artist-email"); }} disabled={Boolean(busy)} aria-invalid={hasFieldIssue("artist-email")} aria-describedby={hasFieldIssue("artist-email") ? "firing-field-artist-email-hint" : undefined} />{hasFieldIssue("artist-email") ? <span id="firing-field-artist-email-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label>
                    </div>
                    {artistMatches.length ? <div className="staff-note" role="group" aria-label="Recent artist matches"><strong>Recent artist matches</strong><span className="helper">Choose one only if it is the same person.</span><div className="staff-actions-row">{artistMatches.map((match) => <button className="btn btn-ghost" key={match.ticketId} type="button" disabled={Boolean(busy)} onClick={() => { setDisplayName(match.displayName); setEmail(match.email ?? ""); setEmailEditedByStaff(false); clearFieldIssue("artist-contact"); }}>Use {match.displayName} · {match.email}</button>)}</div></div> : null}
                    {hasFieldIssue("artist-contact") ? <p className="field-issue-hint">{fieldIssue?.message}</p> : null}
                  </fieldset>

                  <fieldset>
                    <legend>What happened in the firing?</legend>
                    <div className="firing-billing-choice-grid">
                      <label><input type="radio" name={`outcome-${selected.ticketId}`} checked={outcome === "normal_billable"} onChange={() => setOutcome("normal_billable")} /> Normal firing</label>
                      <label><input type="radio" name={`outcome-${selected.ticketId}`} checked={outcome === "maker_risk_billable"} onChange={() => setOutcome("maker_risk_billable")} /> Maker/material outcome · still billable</label>
                      <label><input type="radio" name={`outcome-${selected.ticketId}`} checked={outcome === "studio_fault_no_charge"} onChange={() => setOutcome("studio_fault_no_charge")} /> Studio mistake · no charge</label>
                      <label><input type="radio" name={`outcome-${selected.ticketId}`} checked={outcome === "hold_for_review"} onChange={() => setOutcome("hold_for_review")} /> Hold · send nothing yet</label>
                    </div>
                  </fieldset>

                  <fieldset disabled={Boolean(busy) || outcome === "hold_for_review" || outcome === "studio_fault_no_charge"}>
                    <legend>Actual kiln space used</legend>
                    <div className="staff-module-grid">
                      {selected?.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom") ? <label className="staff-field">Custom firing quote before add-ons<input inputMode="decimal" value={customBaseCharge} onChange={(event) => setCustomBaseCharge(event.target.value)} /></label> : null}
                      <label className="staff-field">Billing unit
                        <select value={billingUnit} onChange={(event) => { const next = event.target.value as BillingUnit; setBillingUnit(next); if (next !== "half_shelf") setQuantity(1); }}>
                          <option value="half_shelf">Half shelf</option><option value="whole_kiln">Whole kiln</option><option value="custom">Custom / unusual firing</option>
                        </select>
                      </label>
                      {billingUnit === "half_shelf" ? <label className="staff-field">Half shelves<select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}>{Array.from({ length: selected?.pricingVersion === 2 ? 20 : 3 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} half {index === 0 ? "shelf" : "shelves"}</option>)}</select></label> : null}
                      <label className={`staff-field ${hasFieldIssue("final-charge") ? "has-field-issue" : ""}`}>Final charge<span className="firing-billing-money-input"><span aria-hidden="true">$</span><input id="firing-field-final-charge" inputMode="decimal" value={finalCharge} onChange={(event) => { setFinalCharge(event.target.value); clearFieldIssue("final-charge"); }} aria-invalid={hasFieldIssue("final-charge")} aria-describedby={hasFieldIssue("final-charge") ? "firing-field-final-charge-hint" : undefined} /></span><span className="helper">Usual price: {formatMoney(derivedRate.cents)}. Change it when this firing needs a different price.</span>{hasFieldIssue("final-charge") ? <span id="firing-field-final-charge-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label>
                    </div>
                    {(selected?.addOnRequests?.private || selected?.addOnRequests?.rush) ? <div className="firing-billing-choice-grid">
                      {selected.addOnRequests?.private ? <label><input type="checkbox" checked={privateFulfilled} onChange={(event) => setPrivateFulfilled(event.target.checked)} /> Private firing fulfilled · $20</label> : null}
                      {selected.addOnRequests?.rush ? <label><input type="checkbox" checked={rushFulfilled} onChange={(event) => setRushFulfilled(event.target.checked)} /> Same-night rush fulfilled · $20</label> : null}
                    </div> : null}
                    {selected?.addOnRequests?.communitySharing ? <p>Client permits unused space to be donated to community work.</p> : null}
                    {selected?.otherRequestedServices?.length ? <p>Review other requested services before billing: {selected.otherRequestedServices.join(", ")}{selected.reservationId ? ` (check-in ${selected.reservationId})` : ""}. Include any applicable charges in the final amount and explain how they were handled.</p> : null}
                    {selected?.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom") ? <p>Enter the custom quote before add-ons; fulfilled services are added to the total.</p> : null}
                    {(Boolean(selected?.otherRequestedServices?.length) || (dollarsToCents(finalCharge) !== derivedRate.cents && !(selected?.pricingVersion === 2 && (selected.heatId === "custom" || billingUnit === "custom") && dollarsToCents(customBaseCharge) === null))) ? <label className={`staff-field ${hasFieldIssue("override-reason") ? "has-field-issue" : ""}`}>Price adjustment note <span className="helper">Record changes to the usual price and how other requested services were handled.</span><input id="firing-field-override-reason" value={overrideReason} onChange={(event) => { setOverrideReason(event.target.value); clearFieldIssue("override-reason"); }} placeholder="Example: extra shelf space" maxLength={500} aria-invalid={hasFieldIssue("override-reason")} aria-describedby={hasFieldIssue("override-reason") ? "firing-field-override-reason-hint" : undefined} />{hasFieldIssue("override-reason") ? <span id="firing-field-override-reason-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label> : null}
                  </fieldset>

                  <div className="staff-module-grid">
                    <label className="staff-field">Firing note for the artist <span className="helper">Optional · included in the pickup email.</span><textarea value={artistVisibleNote} onChange={(event) => setArtistVisibleNote(event.target.value)} rows={3} maxLength={1200} /></label>
                    <label className="staff-field">Private studio note <span className="helper">Optional · only the studio can see this.</span><textarea value={privateStaffNote} onChange={(event) => setPrivateStaffNote(event.target.value)} rows={3} maxLength={2000} /></label>
                  </div>
                </div>
              ) : null}

              {(canAdjustOpen || canRefund) && !selected.canResumeBilling ? (
                <details className="staff-troubleshooting firing-billing-adjustments">
                  <summary>Change this bill</summary>
                  <div className="staff-note">Use this only when a payment needs a correction. The artist gets one clear update.</div>
                  <div className="staff-module-grid">
                    <label className="staff-field">Action<select value={adjustmentAction} onChange={(event) => { setAdjustmentAction(event.target.value as AdjustmentAction); setConfirmedAdjustment(false); }}>{canAdjustOpen ? <option value="void_invoice">Cancel the open invoice</option> : null}{canAdjustOpen ? <option value="credit_open_invoice">Reduce the open invoice</option> : null}{canRefund ? <option value="refund_paid_invoice">Refund a paid invoice</option> : null}</select></label>
                    {adjustmentAction !== "void_invoice" ? <label className={`staff-field ${hasFieldIssue("adjustment-amount") ? "has-field-issue" : ""}`}>Amount<span className="firing-billing-money-input"><span aria-hidden="true">$</span><input id="firing-field-adjustment-amount" inputMode="decimal" value={adjustmentAmount} onChange={(event) => { setAdjustmentAmount(event.target.value); clearFieldIssue("adjustment-amount"); }} aria-invalid={hasFieldIssue("adjustment-amount")} aria-describedby={hasFieldIssue("adjustment-amount") ? "firing-field-adjustment-amount-hint" : undefined} /></span>{hasFieldIssue("adjustment-amount") ? <span id="firing-field-adjustment-amount-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label> : null}
                    <label className={`staff-field ${hasFieldIssue("adjustment-reason") ? "has-field-issue" : ""}`}>Adjustment note<input id="firing-field-adjustment-reason" value={adjustmentReason} onChange={(event) => { setAdjustmentReason(event.target.value); clearFieldIssue("adjustment-reason"); }} maxLength={500} aria-invalid={hasFieldIssue("adjustment-reason")} aria-describedby={hasFieldIssue("adjustment-reason") ? "firing-field-adjustment-reason-hint" : undefined} />{hasFieldIssue("adjustment-reason") ? <span id="firing-field-adjustment-reason-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label>
                  </div>
                  <div className="staff-module-grid">
                    <label className="staff-field">Note for the artist<textarea value={adjustmentArtistNote} onChange={(event) => setAdjustmentArtistNote(event.target.value)} rows={2} maxLength={1200} /></label>
                    <label className="staff-field">Private studio note<textarea value={adjustmentPrivateNote} onChange={(event) => setAdjustmentPrivateNote(event.target.value)} rows={2} maxLength={2000} /></label>
                  </div>
                  <label className={`firing-billing-confirm ${hasFieldIssue("adjustment-confirmation") ? "has-field-issue" : ""}`}><input id="firing-field-adjustment-confirmation" type="checkbox" checked={confirmedAdjustment} onChange={(event) => { setConfirmedAdjustment(event.target.checked); clearFieldIssue("adjustment-confirmation"); }} aria-invalid={hasFieldIssue("adjustment-confirmation")} aria-describedby={hasFieldIssue("adjustment-confirmation") ? "firing-field-adjustment-confirmation-hint" : undefined} />I checked the ticket and amount. Apply this change.{hasFieldIssue("adjustment-confirmation") ? <span id="firing-field-adjustment-confirmation-hint" className="field-issue-hint">{fieldIssue?.message}</span> : null}</label>
                  <button className="btn btn-secondary" type="button" disabled={Boolean(busy) || !confirmedAdjustment} onClick={() => void adjust()}>{busy === "adjust" ? "Applying change…" : "Apply change"}</button>
                </details>
              ) : null}

              {canMarkPickedUp ? (
                <div className="firing-billing-recovery">
                  {PAYMENT_OPEN_STATUSES.has(selected.billingStatus) ? <div className="staff-note staff-note-warn"><strong>Payment is still open.</strong> Pickup does not collect payment automatically.</div> : null}
                  <button className="btn btn-secondary" type="button" disabled={Boolean(busy)} onClick={() => void markPickedUp()}>{busy === "picked-up" ? "Marking picked up…" : "Mark work picked up"}</button>
                </div>
              ) : selected.status === "picked_up" ? (
                <div className="staff-note"><strong>Picked up.</strong> The work has left the studio. Billing can still be corrected independently if needed.</div>
              ) : null}

              {selected.status === "ready_for_pickup" && selected.noticeStatus && selected.noticeStatus !== "not_queued" ? <div className="staff-actions-row"><button className="btn btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void resend()}>{busy === "resend" ? "Sending…" : "Resend pickup details"}</button></div> : null}

              <div className="staff-actions-row firing-ticket-footer" role="group" aria-label="Ticket actions">
                <button className="btn btn-ghost" type="button" disabled={Boolean(busy) || Boolean(selected.stripeInvoiceId) || ["paid", "partially_refunded", "refunded", "picked_up"].includes(selected.billingStatus) || selected.status === "picked_up"} onClick={() => void deleteTicket()}>
                  {busy === "delete-ticket" ? "Deleting…" : "Delete ticket"}
                </button>
                {selected.stripeInvoiceId || ["paid", "partially_refunded", "refunded"].includes(selected.billingStatus) ? <span className="staff-mini">Invoices and payment history must be retained.</span> : null}
                {readyAction}
              </div>

              <details className="firing-billing-reference">
                <summary>Ticket details</summary>
                {selected.firingType || selected.firingId ? <div className="staff-note"><strong>Firing</strong><br />{selected.firingType || "Type not recorded"}{selected.firingId ? ` · ${selected.firingId}` : ""}</div> : null}
                {selected.manualFiring?.date ? <div className="staff-note"><strong>Studio firing record</strong><br />{selected.manualFiring.date} · {selected.manualFiring.kiln}<br />Verified by: {selected.manualFiring.evidence}</div> : null}
                {selected.privateStaffNote ? <div className="staff-note"><strong>Staff note</strong><br />{selected.privateStaffNote}</div> : null}
                <div className="staff-module-grid firing-billing-facts">
                  <div className="staff-note"><strong>Artist’s estimate</strong><br />{selected.estimatedSpace ?? "No estimate"} {selected.estimatedPrice ? `· ${selected.estimatedPrice}` : ""}</div>
                  <div className="staff-note"><strong>Final billing</strong><br />{formatMoney(selected.finalChargeCents)} {selected.refundedAmountCents > 0 ? `· ${formatMoney(selected.refundedAmountCents)} refunded` : ""}</div>
                </div>
                {selected.artistNote ? <div className="staff-note"><strong>Artist note</strong><br />{selected.artistNote}</div> : null}
              </details>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
