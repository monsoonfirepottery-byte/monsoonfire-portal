import type { FunctionsClient } from "../../api/functionsClient";

type CommerceRun = (key: string, fn: () => Promise<void>) => Promise<void>;

type CommerceOrderRecord = {
  id: string;
  status: string;
  totalCents: number;
  currency: string;
  updatedAt: string;
  createdAt: string;
  checkoutUrl: string | null;
  pickupNotes: string | null;
  itemCount: number;
};

type UnpaidCheckInRecord = {
  signupId: string;
  eventId: string;
  eventTitle: string;
  amountCents: number | null;
  currency: string | null;
  paymentStatus: string | null;
  checkInMethod: string | null;
  createdAt: string | null;
  checkedInAt: string | null;
};

type ReceiptRecord = {
  id: string;
  type: string;
  title: string;
  amountCents: number;
  currency: string;
  createdAt: string | null;
  paidAt: string | null;
};

type CommerceKpis = {
  ordersTotal: number;
  pendingOrders: number;
  pendingAmount: number;
  unpaidCheckIns: number;
  receiptsTotal: number;
};

type CommerceSummary = {
  receiptsAmountCents: number;
} | null;

type Props = {
  client: FunctionsClient;
  run: CommerceRun;
  busy: string;
  hasFunctionsAuthMismatch: boolean;
  setStatus: (next: string) => void;
  loadCommerce: () => Promise<void>;
  commerceSearch: string;
  setCommerceSearch: (next: string) => void;
  commerceStatusFilter: string;
  setCommerceStatusFilter: (next: string) => void;
  commerceStatusOptions: string[];
  commerceKpis: CommerceKpis;
  unpaidCheckIns: UnpaidCheckInRecord[];
  filteredOrders: CommerceOrderRecord[];
  summary: CommerceSummary;
  receipts: ReceiptRecord[];
  copy: (next: string) => Promise<void>;
};

function dollars(cents: number): string {
  return `$${(Math.max(cents, 0) / 100).toFixed(2)}`;
}

export default function CommerceModule({
  client,
  hasFunctionsAuthMismatch,
  run,
  setStatus,
  busy,
  loadCommerce,
  commerceSearch,
  setCommerceSearch,
  commerceStatusFilter,
  setCommerceStatusFilter,
  commerceStatusOptions,
  commerceKpis,
  unpaidCheckIns,
  filteredOrders,
  summary,
  receipts,
  copy,
}: Props) {
  return (
    <section className="card staff-console-card">
      <div className="card-title">Store & billing</div>
      {hasFunctionsAuthMismatch ? (
        <div className="staff-note">
          Billing summary comes from Cloud Functions. Enable auth emulator (`VITE_USE_AUTH_EMULATOR=true`) or use production Functions
          URL.
        </div>
      ) : (
        <>
          <div className="staff-kpi-grid">
            <div className="staff-kpi"><span>Order queue</span><strong>{commerceKpis.ordersTotal}</strong></div>
            <div className="staff-kpi"><span>Pending orders</span><strong>{commerceKpis.pendingOrders}</strong></div>
            <div className="staff-kpi"><span>Pending value</span><strong>{dollars(commerceKpis.pendingAmount)}</strong></div>
            <div className="staff-kpi"><span>Unpaid check-ins</span><strong>{commerceKpis.unpaidCheckIns}</strong></div>
            <div className="staff-kpi"><span>Receipts</span><strong>{commerceKpis.receiptsTotal}</strong></div>
            <div className="staff-kpi"><span>Receipts total</span><strong>{dollars(summary?.receiptsAmountCents ?? 0)}</strong></div>
          </div>
          <div className="staff-actions-row">
            <button
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={() =>
                void run("seedMaterialsCatalog", async () => {
                  await client.postJson("seedMaterialsCatalog", {
                    force: true,
                    acknowledge: "ALLOW_NON_DEV_SAMPLE_SEEDING",
                    reason: "staff_console_commerce_seed",
                  });
                  await loadCommerce();
                  setStatus("seedMaterialsCatalog completed");
                })
              }
            >
              Seed materials catalog
            </button>
            <input
              className="staff-member-search"
              placeholder="Search orders by id, status, notes"
              value={commerceSearch}
              onChange={(event) => setCommerceSearch(event.target.value)}
            />
            <select
              className="staff-member-role-filter"
              value={commerceStatusFilter}
              onChange={(event) => setCommerceStatusFilter(event.target.value)}
            >
              <option value="all">All order statuses</option>
              {commerceStatusOptions.map((statusName) => (
                <option key={statusName} value={statusName}>
                  {statusName}
                </option>
              ))}
            </select>
          </div>
          <div className="staff-subtitle">Unpaid check-ins</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Event</th><th>Signup</th><th>Amount</th><th>Status</th><th>Checked in</th></tr></thead>
              <tbody>
                {unpaidCheckIns.length === 0 ? (
                  <tr><td colSpan={5}>No unpaid check-ins.</td></tr>
                ) : (
                  unpaidCheckIns.slice(0, 40).map((entry) => (
                    <tr key={entry.signupId}>
                      <td>{entry.eventTitle}<div className="staff-mini"><code>{entry.eventId || "-"}</code></div></td>
                      <td><code>{entry.signupId}</code></td>
                      <td>{entry.amountCents !== null ? dollars(entry.amountCents) : "-"}</td>
                      <td>{entry.paymentStatus || "pending"}</td>
                      <td>{entry.checkedInAt || entry.createdAt || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="staff-subtitle">Material orders</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Items</th><th>Updated</th><th>Action</th></tr></thead>
              <tbody>
                {filteredOrders.length === 0 ? (
                  <tr><td colSpan={6}>No orders match current filters.</td></tr>
                ) : (
                  filteredOrders.map((o) => (
                    <tr key={o.id}>
                      <td><code>{o.id}</code></td>
                      <td><span className="pill">{o.status}</span></td>
                      <td>{dollars(o.totalCents)}</td>
                      <td>{o.itemCount}</td>
                      <td>{o.updatedAt}</td>
                      <td>
                        {o.checkoutUrl ? (
                          <button
                            className="btn btn-ghost btn-small"
                            onClick={() => void copy(o.checkoutUrl ?? "")}
                          >
                            Copy checkout link
                          </button>
                        ) : (
                          <span className="staff-mini">-</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="staff-subtitle">Recent receipts</div>
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead><tr><th>Receipt</th><th>Type</th><th>Amount</th><th>Paid</th></tr></thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr><td colSpan={4}>No receipts yet.</td></tr>
                ) : (
                  receipts.slice(0, 40).map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.title}<div className="staff-mini"><code>{entry.id}</code></div></td>
                      <td>{entry.type}</td>
                      <td>{dollars(entry.amountCents)}</td>
                      <td>{entry.paidAt || entry.createdAt || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
