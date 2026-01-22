import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  createFunctionsClient,
  type LastRequest,
} from "../api/functionsClient";
import type { CreateEventCheckoutSessionResponse } from "../api/portalContracts";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import "./BillingView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
      ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
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
  kind: "events" | "materials";
  title: string;
  subtitle?: string;
  totalCents: number;
  createdAt?: Date | null;
  status?: string;
  link?: string | null;
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
  const [eventTitles, setEventTitles] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState("");
  const [payBusyId, setPayBusyId] = useState("");
  const [receiptFilter, setReceiptFilter] = useState<"all" | "events" | "materials">("all");
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl,
        getIdToken: async () => await user.getIdToken(),
        onLastRequest: setLastReq,
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
        id: docSnap.id,
        ...(docSnap.data() as EventSignupDoc),
      }));
      setCheckIns(rows.filter((row) => row.paymentStatus !== "paid"));
    } catch (err: any) {
      setCheckInsError(err?.message || String(err));
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
        id: docSnap.id,
        ...(docSnap.data() as EventChargeDoc),
      }));
      setCharges(rows);
    } catch (err: any) {
      setChargesError(err?.message || String(err));
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
        id: docSnap.id,
        ...(docSnap.data() as MaterialsOrderDoc),
      }));
      setMaterials(rows);
    } catch (err: any) {
      setMaterialsError(err?.message || String(err));
    } finally {
      setMaterialsLoading(false);
    }
  }, [user]);

  const refreshBilling = useCallback(() => {
    loadCheckIns();
    loadCharges();
    loadMaterials();
    setStatusMessage("Billing data refreshed.");
  }, [loadCheckIns, loadCharges, loadMaterials]);

  useEffect(() => {
    loadCheckIns();
  }, [loadCheckIns]);

  useEffect(() => {
    loadCharges();
  }, [loadCharges]);

  useEffect(() => {
    loadMaterials();
  }, [loadMaterials]);

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
    (async () => {
      const updates: Record<string, string> = {};
      await Promise.all(
        missingEventIds.map(async (eventId) => {
          try {
            const snap = await getDoc(doc(db, "events", eventId));
            if (snap.exists()) {
              const title = (snap.data() as Record<string, any>).title || eventId;
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

    const materialReceipts = materials
      .filter((order) => {
        const status = (order.status || "").toLowerCase();
        return status === "paid" || status === "picked_up";
      })
      .map((order) => ({
        id: order.id,
        kind: "materials" as const,
        title: `Materials order ${order.id}`,
        subtitle:
          (order.items ?? [])
            .map((item) => `${item.name ?? "Item"} (${item.quantity ?? 0})`)
            .join(", ") || "Supplies",
        totalCents: order.totalCents ?? 0,
        createdAt: toDate(order.createdAt),
        status: order.status ?? "paid",
        link: order.checkoutUrl ?? null,
      }));

    return [...eventReceipts, ...materialReceipts].sort((a, b) => {
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
    { key: "materials", label: "Materials" },
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
    } catch (err: any) {
      setStatusMessage(err?.message || String(err));
    } finally {
      setPayBusyId("");
    }
  };

  return (
    <div className="page billing-page">
      <div className="page-header">
        <div>
          <h1>Billing</h1>
          <p className="page-subtitle">
            We only charge you after check-in. Pay for attendance or orders at your own pace.
          </p>
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
          <div className="summary-note">Includes events + materials receipts.</div>
        </article>
        <article className="billing-summary-card">
          <div className="summary-label">Pending materials</div>
          <div className="summary-value">{pendingMaterialsCount}</div>
          <div className="summary-note">Checkout or confirm pickup to close the order.</div>
        </article>
        <button
          className="btn btn-ghost billing-refresh"
          onClick={refreshBilling}
          disabled={checkInsLoading || chargesLoading || materialsLoading}
        >
          Refresh billing data
        </button>
      </section>

      {statusMessage ? (
        <div className="billing-status inline-alert">{statusMessage}</div>
      ) : null}

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
                      onClick={() => handleCheckout(signup)}
                      disabled={!!payBusyId}
                    >
                      {payBusyId === signup.id ? "Preparing checkout..." : "Pay now"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card billing-section">
        <div className="card-title">Materials orders</div>
        {materialsLoading ? (
          <div className="billing-empty">Loading orders...</div>
        ) : materialsError ? (
          <div className="billing-empty">{materialsError}</div>
        ) : materials.length === 0 ? (
          <div className="billing-empty">No materials orders yet.</div>
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
                      View receipt
                    </a>
                  ) : null}
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
                    View receipt
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
          to 3 hours before the event. Orders are paid via hosted Stripe Checkout—look for the receipt link
          on this page.
        </p>
        <p className="billing-copy">
          Questions? Visit the Support tab or email{" "}
          <a href="mailto:support@monsoonfire.com">support@monsoonfire.com</a>.
        </p>
      </section>

      <TroubleshootingPanel lastReq={lastReq} curl={client.getLastCurl()} onStatus={setStatusMessage} />
    </div>
  );
}
