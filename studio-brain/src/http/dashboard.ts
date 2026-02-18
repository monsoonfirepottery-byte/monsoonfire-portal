import type { EventStore, StateStore } from "../stores/interfaces";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function renderDashboard(
  stateStore: StateStore,
  eventStore: EventStore,
  options?: { staleThresholdMinutes?: number }
): Promise<string> {
  const [snapshot, events] = await Promise.all([stateStore.getLatestStudioState(), eventStore.listRecent(20)]);
  const staleThresholdMinutes = options?.staleThresholdMinutes ?? 240;

  if (!snapshot) {
    return `<!doctype html><html><body><h1>Studio OS v3 Dashboard</h1><p>No snapshots yet.</p><p>Local brain is running, but cloud-derived snapshot data has not been generated yet.</p></body></html>`;
  }

  const rows = [
    ["Batches active", snapshot.counts.batchesActive],
    ["Batches closed", snapshot.counts.batchesClosed],
    ["Reservations open", snapshot.counts.reservationsOpen],
    ["Firings scheduled", snapshot.counts.firingsScheduled],
    ["Reports open", snapshot.counts.reportsOpen],
    ["Agent requests pending", snapshot.ops.agentRequestsPending],
    ["High severity reports", snapshot.ops.highSeverityReports],
    ["Pending orders", snapshot.finance.pendingOrders],
    ["Unsettled payments", snapshot.finance.unsettledPayments],
  ]
    .map(([label, value]) => `<tr><th align="left">${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join("\n");

  const diagnosticsRows = [
    ["Completeness", snapshot.diagnostics?.completeness ?? "full"],
    ["Firestore read ms", snapshot.diagnostics?.durationsMs?.firestoreRead ?? "n/a"],
    ["Stripe read ms", snapshot.diagnostics?.durationsMs?.stripeRead ?? "n/a"],
    ["Warnings", snapshot.diagnostics?.warnings.length ?? 0],
    ["Batches scanned", snapshot.diagnostics?.sourceSample?.batchesScanned ?? "n/a"],
    ["Reservations scanned", snapshot.diagnostics?.sourceSample?.reservationsScanned ?? "n/a"],
    ["Firings scanned", snapshot.diagnostics?.sourceSample?.firingsScanned ?? "n/a"],
    ["Reports scanned", snapshot.diagnostics?.sourceSample?.reportsScanned ?? "n/a"],
  ]
    .map(([label, value]) => `<tr><th align="left">${esc(label)}</th><td>${esc(value)}</td></tr>`)
    .join("\n");

  const eventRows = events.length
    ? events
    .map((evt) => `<tr><td>${esc(evt.at)}</td><td>${esc(evt.action)}</td><td>${esc(evt.approvalState)}</td><td>${esc(evt.rationale)}</td></tr>`)
    .join("\n")
    : `<tr><td colspan="4">No events captured yet.</td></tr>`;

  const warnings = snapshot.diagnostics?.warnings ?? [];
  const warningRows = warnings.length
    ? warnings.map((warning) => `<li>${esc(warning)}</li>`).join("\n")
    : "<li>None</li>";

  const generatedMs = Date.parse(snapshot.generatedAt);
  const ageMinutes = Number.isFinite(generatedMs) ? Math.floor((Date.now() - generatedMs) / 60_000) : null;
  const isStale = ageMinutes !== null ? ageMinutes > staleThresholdMinutes : true;
  const stalenessMessage =
    ageMinutes === null
      ? `Unknown snapshot age (threshold ${staleThresholdMinutes}m)`
      : `${ageMinutes} minutes old (threshold ${staleThresholdMinutes}m)`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Studio OS v3 Dashboard</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color: #111; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
      th, td { border-bottom: 1px solid #ddd; padding: 8px; }
      .meta { color: #555; margin-bottom: 12px; }
      .pill { display: inline-block; padding: 4px 8px; border-radius: 999px; background: #f0f0f0; margin-right: 8px; }
    </style>
  </head>
  <body>
    <h1>Studio OS v3 Dashboard</h1>
    <div class="meta">Snapshot date: ${esc(snapshot.snapshotDate)} · Generated: ${esc(snapshot.generatedAt)}</div>
    <div>
      <span class="pill">Cloud authoritative</span>
      <span class="pill">Local orchestration only</span>
      <span class="pill">Writes require approval</span>
      <span class="pill">Derived from cloud</span>
    </div>
    <div class="meta"><strong>Snapshot freshness:</strong> ${esc(stalenessMessage)}${isStale ? " · STALE" : ""}</div>
    <h2>StudioState</h2>
    <table>${rows}</table>
    <h2>Diagnostics</h2>
    <table>${diagnosticsRows}</table>
    <h3>Warnings</h3>
    <ul>${warningRows}</ul>
    <h2>Recent Audit Events</h2>
    <table>
      <thead><tr><th>At</th><th>Action</th><th>Approval</th><th>Rationale</th></tr></thead>
      <tbody>${eventRows}</tbody>
    </table>
  </body>
</html>`;
}
