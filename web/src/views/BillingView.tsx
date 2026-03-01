import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { formatCents, formatDateTime } from "../utils/format";
import { checkoutErrorMessage } from "../utils/userFacingErrors";
import { createFunctionsClient } from "../api/functionsClient";
import type { CreateEventCheckoutSessionResponse } from "../api/portalContracts";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./BillingView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
      ? String(ENV.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isMissingIndexError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("requires an index") || message.includes("failed-precondition");
}

type FirestoreTimestamp = { toDate?: () => Date };

type EventSignupDoc = {
  id: string;
  eventId?: string | null;
  status?: string | null;
  paymentStatus?: string | null;
  displayName?: string | null;
  email?: string | null;
  checkedInAt?: FirestoreTimestamp | null;
};

type EventChargeDoc = {
  id: string;
  totalCents?: number | null;
  currency?: string | null;
  createdAt?: FirestoreTimestamp | null;
  lineItems?: Array<{ title?: string | null; priceCents?: number | null; quantity?: number | null }>;
  paymentStatus?: string | null;
  stripeCheckoutSessionId?: string | null;
};

type ApiV1Envelope<TData> = {
  ok: boolean;
  requestId?: string;
  code?: string;
  message?: string;
  data?: TData;
};

type AgentRequestsListMineResponse = ApiV1Envelope<{ requests?: Array<Record<string, unknown>> }>;

type AgentCheckoutResponse = {
  ok: boolean;
  message?: string;
  checkoutUrl?: string | null;
  sessionId?: string | null;
};

type MaterialsOrderDoc = {
  id: string;
  status?: string | null;
  totalCents?: number | null;
  currency?: string | null;
  createdAt?: FirestoreTimestamp | null;
  pickupNotes?: string | null;
  checkoutUrl?: string | null;
  items?: Array<{ name?: string | null; quantity?: number | null; unitPrice?: number | null }>;
};

type ReceiptItem = {
  id: string;
  kind: "events" | "store";
  title: string;
  subtitle?: string;
  totalCents: number;
  createdAt?: Date | null;
  status?: string;
  link?: string | null;
};

type PendingCommissionCheckout = {
  requestId: string;
  title: string;
  status: string;
  commissionOrderId: string;
  commissionPaymentStatus: string;
};

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (value && typeof value === "object") {
    const timestamp = value as FirestoreTimestamp;
    if (typeof timestamp.toDate === "function") {
      try {
        return timestamp.toDate() ?? null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;

type Props = {
  user: User;
};

export default function BillingView({ user }: Props) {
  const [checkIns, setCheckIns] = useState<EventSignupDoc[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(true);
  const [checkInsError, setCheckInsError] = useState("");
  const [charges, setCharges] = useState<EventChargeDoc[]>([]);
  const [chargesLoading, setChargesLoading] = useState(true);
  const [chargesError, setChargesError] = useState("");
  const [materials, setMaterials] = useState<MaterialsOrderDoc[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [materialsError, setMaterialsError] = useState("");
  const [pendingCommissionCheckouts, setPendingCommissionCheckouts] = useState<PendingCommissionCheckout[]>([]);
  const [commissionLoading, setCommissionLoading] = useState(true);
  const [commissionError, setCommissionError] = useState("");
  const [eventTitles, setEventTitles] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [payBusyId, setPayBusyId] = useState("");
  const [commissionPayBusyId, setCommissionPayBusyId] = useState("");
  const [receiptFilter, setReceiptFilter] = useState<"all" | "events" | "store">("all");

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl,
        getIdToken: async () => await user.getIdToken(),
      }),
    [baseUrl, user]
  );

  const loadCheckIns = useCallback(async () => {
    if (!user) return;
    setCheckInsLoading(true);
    setCheckInsError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "eventSignups"),
          where("uid", "==", user.uid),
          where("status", "==", "checked_in"),
          orderBy("checkedInAt", "desc"),
          limit(30)
        )
      );
      const rows: EventSignupDoc[] = snap.docs.map((docSnap) => ({
        ...(docSnap.data() as EventSignupDoc),
        id: docSnap.id,
      }));
      setCheckIns(rows.filter((row) => row.paymentStatus !== "paid"));
    } catch (error: unknown) {
      setCheckInsError(getErrorMessage(error));
    } finally {
      setCheckInsLoading(false);
    }
  }, [user]);

  const loadCharges = useCallback(async () => {
    if (!user) return;
    setChargesLoading(true);
    setChargesError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "eventCharges"),
          where("uid", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(30)
        )
      );
      const rows: EventChargeDoc[] = snap.docs.map((docSnap) => ({
        ...(docSnap.data() as EventChargeDoc),
        id: docSnap.id,
      }));
      setCharges(rows);
    } catch (error: unknown) {
      if (isMissingIndexError(error)) {
        try {
          const fallbackSnap = await getDocs(
            query(
              collection(db, "eventCharges"),
              where("uid", "==", user.uid),
              limit(120)
            )
          );
          const rows: EventChargeDoc[] = fallbackSnap.docs.map((docSnap) => ({
            ...(docSnap.data() as EventChargeDoc),
            id: docSnap.id,
          }));
          rows.sort((a, b) => {
            const aMs = toDate(a.createdAt)?.getTime() ?? 0;
            const bMs = toDate(b.createdAt)?.getTime() ?? 0;
            return bMs - aMs;
          });
          setCharges(rows.slice(0, 30));
          setStatusMessage("Loaded billing receipts with compatibility mode while indexes finish syncing.");
          setChargesError("");
          return;
        } catch (fallbackError: unknown) {
          setChargesError(getErrorMessage(fallbackError));
          return;
        }
      }
      setChargesError(getErrorMessage(error));
    } finally {
      setChargesLoading(false);
    }
  }, [user]);

  const loadMaterials = useCallback(async () => {
    if (!user) return;
    setMaterialsLoading(true);
    setMaterialsError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "materialsOrders"),
          where("uid", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(30)
        )
      );
      const rows: MaterialsOrderDoc[] = snap.docs.map((docSnap) => ({
        ...(docSnap.data() as MaterialsOrderDoc),
        id: docSnap.id,
      }));
      setMaterials(rows);
    } catch (error: unknown) {
      setMaterialsError(getErrorMessage(error));
    } finally {
      setMaterialsLoading(false);
    }
  }, [user]);

  const loadCommissionCheckouts = useCallback(async () => {
    if (!user) return;
    setCommissionLoading(true);
    setCommissionError("");
    try {
      const resp = await client.postJson<AgentRequestsListMineResponse>("apiV1/v1/agent.requests.listMine", {
        limit: 100,
        includeClosed: true,
      });
      if (!resp.ok) {
        setCommissionError(resp.message ?? "Could not load pending commission checkouts.");
        return;
      }
      const rows = Array.isArray(resp.data?.requests)
        ? resp.data.requests.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
        : [];
      const pending = rows
        .map((row): PendingCommissionCheckout | null => {
          const kind = str(row.kind).toLowerCase();
          if (kind !== "commission") return null;
          const commissionOrderId = str(row.commissionOrderId);
          if (!commissionOrderId) return null;
          const paymentStatus = str(row.commissionPaymentStatus, "checkout_pending").toLowerCase();
          if (paymentStatus === "paid") return null;
          return {
            requestId: str(row.id),
            title: str(row.title, "(untitled commission request)"),
            status: str(row.status, "new"),
            commissionOrderId,
            commissionPaymentStatus: paymentStatus,
          };
        })
        .filter((row): row is PendingCommissionCheckout => Boolean(row));
      setPendingCommissionCheckouts(pending);
    } catch (error: unknown) {
      setCommissionError(getErrorMessage(error));
    } finally {
      setCommissionLoading(false);
    }
  }, [client, user]);

  const refreshBilling = useCallback(() => {
    void loadCheckIns();
    void loadCharges();
    void loadMaterials();
    void loadCommissionCheckouts();
    setStatusMessage("Billing data refreshed.");
  }, [loadCheckIns, loadCharges, loadCommissionCheckouts, loadMaterials]);

  useEffect(() => {
    void loadCheckIns();
  }, [loadCheckIns]);

  useEffect(() => {
    void loadCharges();
  }, [loadCharges]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  useEffect(() => {
    void loadCommissionCheckouts();
  }, [loadCommissionCheckouts]);

  const uniqueEventIds = useMemo(() => {
    const ids = new Set<string>();
    checkIns.forEach((signup) => {
      if (signup.eventId) ids.add(signup.eventId);
    });
    return Array.from(ids);
  }, [checkIns]);

  const missingEventIds = useMemo(() => {
    return uniqueEventIds.filter((id) => !eventTitles[id]);
  }, [uniqueEventIds, eventTitles]);

  useEffect(() => {
    if (missingEventIds.length === 0) return;
    let active = true;
    void (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missingEventIds.map(async (eventId) => {
          try {
            const snap = await getDoc(doc(db, "events", eventId));
            if (snap.exists()) {
              const maybeTitle = (snap.data() as { title?: unknown }).title;
              const title = typeof maybeTitle === "string" && maybeTitle.trim() ? maybeTitle : eventId;
              updates[eventId] = title;
            }
          } catch {
            // ignore fetch errors
          }
        })
      );
      if (!active) return;
      setEventTitles((prev) => ({ ...prev, ...updates }));
    })();
    return () => {
      active = false;
    };
  }, [missingEventIds]);

  const pendingMaterialsCount = useMemo(() => {
    return materials.filter((order) => (order.status || "").toLowerCase() !== "paid").length;
  }, [materials]);

  const receipts = useMemo<ReceiptItem[]>(() => {
    const eventReceipts = charges
      .filter((charge) => (charge.paymentStatus || "").toLowerCase() === "paid")
      .map((charge) => ({
        id: charge.id,
        kind: "events" as const,
        title: `Event charge ${charge.id}`,
        subtitle:
          (charge.lineItems ?? [])
            .map((item) => item.title?.trim())
            .filter(Boolean)
            .join(", ") || "Event ticket",
        totalCents: charge.totalCents ?? 0,
        createdAt: toDate(charge.createdAt),
        status: "paid",
        link: charge.stripeCheckoutSessionId ? `https://stripe.com/checkout/${charge.stripeCheckoutSessionId}` : null,
      }));

    const storeReceipts = materials
      .filter((order) => {
        const status = (order.status || "").toLowerCase();
        return status === "paid" || status === "picked_up";
      })
      .map((order) => ({
        id: order.id,
        kind: "store" as const,
        title: `Store order ${order.id}`,
        subtitle:
          (order.items ?? [])
            .map((item) => `${item.name ?? "Item"} (${item.quantity ?? 0})`)
            .join(", ") || "Supplies",
        totalCents: order.totalCents ?? 0,
        createdAt: toDate(order.createdAt),
        status: order.status ?? "paid",
        link: order.checkoutUrl ?? null,
      }));

    return [...eventReceipts, ...storeReceipts].sort((a, b) => {
      const timeA = a.createdAt?.getTime() ?? 0;
      const timeB = b.createdAt?.getTime() ?? 0;
      return timeB - timeA;
    });
  }, [charges, materials]);

  const receiptsFiltered = useMemo(() => {
    if (receiptFilter === "all") return receipts;
    return receipts.filter((item) => item.kind === receiptFilter);
  }, [receiptFilter, receipts]);

  const paidLast30Days = useMemo(() => {
    const now = Date.now();
    return receipts
      .filter((item) => {
        if (!item.createdAt) return false;
        return now - item.createdAt.getTime() <= THIRTY_DAYS_MS;
      })
      .reduce((sum, item) => sum + item.totalCents, 0);
  }, [receipts]);

  const receiptFilters = [
    { key: "all", label: "All receipts" },
    { key: "events", label: "Events" },
    { key: "store", label: "Store" },
  ] as const;

  const handleCheckout = async (signup: EventSignupDoc) => {
    if (!signup.eventId) {
      setStatusMessage("Event ID missing.");
      return;
    }
    if (payBusyId) return;
    setPayBusyId(signup.id);
    setStatusMessage("");
    try {
      const resp = await client.postJson<CreateEventCheckoutSessionResponse>(
        "createEventCheckoutSession",
        {
          eventId: signup.eventId,
          signupId: signup.id,
        }
      );
      if (resp.checkoutUrl) {
        window.location.assign(resp.checkoutUrl);
        return;
      }
      setStatusMessage("Checkout session created, but no URL returned.");
    } catch (error: unknown) {
      setStatusMessage(checkoutErrorMessage(error));
    } finally {
      setPayBusyId("");
    }
  };

  const handleCheckoutHandlerError = (error: unknown) => {
    setStatusMessage(checkoutErrorMessage(error));
  };

  const handleCommissionCheckout = async (entry: PendingCommissionCheckout) => {
    if (!entry.commissionOrderId) {
      setStatusMessage("Commission order ID missing.");
      return;
    }
    if (commissionPayBusyId) return;
    setCommissionPayBusyId(entry.requestId);
    setStatusMessage("");
    try {
      const resp = await client.postJson<AgentCheckoutResponse>("createAgentCheckoutSession", {
        orderId: entry.commissionOrderId,
      });
      if (!resp.ok) {
        setStatusMessage(resp.message ?? "Unable to create commission checkout session.");
        return;
      }
      const checkoutUrl = typeof resp.checkoutUrl === "string" ? resp.checkoutUrl : "";
      if (!checkoutUrl) {
        setStatusMessage("Checkout session created, but no URL returned.");
        return;
      }
      window.location.assign(checkoutUrl);
    } catch (error: unknown) {
      setStatusMessage(checkoutErrorMessage(error));
    } finally {
      setCommissionPayBusyId("");
    }
  };

  return (
    <div className="page billing-page">
      <div className="page-header">
        <div>
          <h1>Billing</h1>
        </div>
      </div>

      <section className="billing-summary">
        <article className="billing-summary-card">
          <div className="summary-label">Unpaid check-ins</div>
          <div className="summary-value">{checkIns.length}</div>
          <div className="summary-note">You only pay after you attend (3-hour cutoff applies).</div>
        </article>
        <article className="billing-summary-card">
          <div className="summary-label">Paid in last 30 days</div>
          <div className="summary-value">{formatCents(paidLast30Days)}</div>
          <div className="summary-note">Includes events + store receipts.</div>
        </article>
        <article className="billing-summary-card">
          <div className="summary-label">Pending store orders</div>
          <div className="summary-value">{pendingMaterialsCount}</div>
          <div className="summary-note">Checkout or confirm pickup to close the order.</div>
        </article>
        <article className="billing-summary-card">
          <div className="summary-label">Pending commission checkouts</div>
          <div className="summary-value">{pendingCommissionCheckouts.length}</div>
          <div className="summary-note">Pay approved commission requests from Billing.</div>
        </article>
        <button
          className="btn btn-ghost billing-refresh"
          onClick={refreshBilling}
          disabled={checkInsLoading || chargesLoading || materialsLoading || commissionLoading}
        >
          Refresh billing overview
        </button>
      </section>

      {statusMessage ? (
        <div className="billing-status inline-alert">{statusMessage}</div>
      ) : null}
      {chargesError ? <div className="billing-status inline-alert">{chargesError}</div> : null}
      {commissionError ? <div className="billing-status inline-alert">{commissionError}</div> : null}

      <section className="card billing-section">
        <div className="card-title">Unpaid check-ins</div>
        {checkInsLoading ? (
          <div className="billing-empty">Loading check-ins...</div>
        ) : checkInsError ? (
          <div className="billing-empty">{checkInsError}</div>
        ) : checkIns.length === 0 ? (
          <div className="billing-empty">No unpaid check-ins right now.</div>
        ) : (
          <div className="billing-rows">
            {checkIns.map((signup) => {
              const eventName = signup.eventId ? eventTitles[signup.eventId] : "";
              return (
                <div className="billing-row" key={signup.id}>
                  <div>
                    <div className="billing-row-title">
                      {eventName || signup.eventId || "Event check-in"}
                    </div>
                    <div className="billing-row-meta">
                      Checked in{" "}
                      {signup.checkedInAt
                        ? formatDateTime(signup.checkedInAt)
                        : "recently"}
                    </div>
                  </div>
                  <div className="billing-row-actions">
                    <button
                      className="btn btn-primary"
                      onClick={toVoidHandler(
                        () => handleCheckout(signup),
                        handleCheckoutHandlerError,
                        "billing.checkout"
                      )}
                      disabled={!!payBusyId}
                    >
                      {payBusyId === signup.id ? "Preparing checkout..." : "Pay now (Stripe)"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card billing-section">
        <div className="card-title">Store orders</div>
        {materialsLoading ? (
          <div className="billing-empty">Loading orders...</div>
        ) : materialsError ? (
          <div className="billing-empty">{materialsError}</div>
        ) : materials.length === 0 ? (
          <div className="billing-empty">No store orders yet.</div>
        ) : (
          <div className="billing-materials">
            {materials.map((order) => (
              <div className="billing-material-row" key={order.id}>
                <div>
                  <div className="billing-row-title">Order {order.id}</div>
                  <div className="billing-row-meta">
                    Status: {order.status || "pending"} · {formatCents(order.totalCents ?? 0)}
                  </div>
                  {order.pickupNotes ? (
                    <div className="billing-row-meta">Pickup notes: {order.pickupNotes}</div>
                  ) : null}
                  {order.items && order.items.length ? (
                    <div className="billing-row-meta">
                      {order.items.map((item, index) => (
                        <span key={index}>
                          {item.name ?? "Item"} × {item.quantity ?? 0}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  {order.checkoutUrl ? (
                    <a
                      className="btn btn-ghost"
                      href={order.checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open receipt
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card billing-section">
        <div className="card-title">Commission payments</div>
        {commissionLoading ? (
          <div className="billing-empty">Loading commission payment actions...</div>
        ) : pendingCommissionCheckouts.length === 0 ? (
          <div className="billing-empty">No pending commission checkouts.</div>
        ) : (
          <div className="billing-materials">
            {pendingCommissionCheckouts.map((entry) => (
              <div className="billing-material-row" key={entry.requestId}>
                <div>
                  <div className="billing-row-title">{entry.title}</div>
                  <div className="billing-row-meta">
                    Request {entry.requestId} · Status: {entry.status} · Payment: {entry.commissionPaymentStatus}
                  </div>
                </div>
                <div>
                  <button
                    className="btn btn-primary"
                    disabled={Boolean(commissionPayBusyId)}
                    onClick={toVoidHandler(
                      () => handleCommissionCheckout(entry),
                      handleCheckoutHandlerError,
                      "billing.commissionCheckout"
                    )}
                  >
                    {commissionPayBusyId === entry.requestId ? "Preparing checkout..." : "Open commission checkout"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card billing-section">
        <div className="card-title">Receipts</div>
        <div className="receipt-tabs">
          {receiptFilters.map((filter) => (
            <button
              key={filter.key}
              className={`receipt-tab ${receiptFilter === filter.key ? "active" : ""}`}
              onClick={() => setReceiptFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        {receiptsFiltered.length === 0 ? (
          <div className="billing-empty">No receipts to show yet.</div>
        ) : (
          <div className="billing-receipts">
            {receiptsFiltered.map((item) => (
              <div className="receipt-row" key={`${item.kind}-${item.id}`}>
                <div>
                  <div className="receipt-title">{item.title}</div>
                  <div className="receipt-meta">{item.subtitle}</div>
                </div>
                <div className="receipt-date">{formatDateTime(item.createdAt)}</div>
                <div className="receipt-amount">{formatCents(item.totalCents)}</div>
                {item.link ? (
                  <a href={item.link} target="_blank" rel="noreferrer" className="receipt-link">
                    Open receipt
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card billing-section">
        <div className="card-title">Need help?</div>
        <p className="billing-copy">
          Billing is attendance-only: we only charge you after a staff or self check-in. Cancel anytime up
          to 3 hours before the event. Orders and approved commissions are paid via hosted Stripe Checkout;
          use the actions on this page.
        </p>
        <p className="billing-copy">
          Questions? Visit the Support tab or email{" "}
          <a href="mailto:support@monsoonfire.com">support@monsoonfire.com</a>.
        </p>
      </section>

    </div>
  );
}
