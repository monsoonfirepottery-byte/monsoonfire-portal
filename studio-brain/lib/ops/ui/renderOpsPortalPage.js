"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderOpsPortalPage = renderOpsPortalPage;
exports.renderOpsPortalChoicePage = renderOpsPortalChoicePage;
function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}
function jsonScript(value) {
    return JSON.stringify(value)
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e")
        .replaceAll("&", "\\u0026");
}
function formatTimestamp(value) {
    if (!value)
        return "unknown";
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed))
        return value;
    return new Date(parsed).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function formatConfidence(value) {
    return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}
function parseTimestamp(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function minutesUntil(value) {
    const parsed = parseTimestamp(value);
    if (parsed === null)
        return null;
    return Math.round((parsed - Date.now()) / 60000);
}
function formatCountdown(minutes) {
    if (minutes === null)
        return "live";
    if (minutes <= 0)
        return `${Math.abs(minutes)}m late`;
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}
function countdownPercent(minutes, horizonMinutes) {
    if (minutes === null)
        return 52;
    const bounded = Math.max(0, Math.min(horizonMinutes, minutes));
    return Math.round((1 - bounded / horizonMinutes) * 100);
}
function freshnessPercent(freshnessSeconds, budgetSeconds) {
    if (freshnessSeconds === null || budgetSeconds <= 0)
        return 26;
    const bounded = Math.max(0, Math.min(budgetSeconds, freshnessSeconds));
    return Math.round((1 - bounded / budgetSeconds) * 100);
}
function statusTone(status) {
    if (status === "healthy" || status === "ready" || status === "verified" || status === "approved")
        return "good";
    if (status === "warning" || status === "degraded" || status === "proof_pending" || status === "pending")
        return "warn";
    if (status === "critical" || status === "blocked" || status === "rejected" || status === "canceled")
        return "danger";
    return "neutral";
}
function renderZone(zone) {
    return `
    <article class="ops-zone ops-tone-${esc(statusTone(zone.status))}">
      <div class="ops-zone__head">
        <div>
          <p class="ops-kicker">Studio twin zone</p>
          <h3>${esc(zone.label)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(statusTone(zone.status))}">${esc(zone.status)}</span>
      </div>
      <p class="ops-summary">${esc(zone.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Why we believe this</dt><dd>${esc(zone.evidence.summary)}</dd></div>
        <div><dt>Verification</dt><dd>${esc(zone.evidence.verificationClass)}</dd></div>
        <div><dt>Confidence</dt><dd>${esc(formatConfidence(zone.evidence.confidence))}</dd></div>
        <div><dt>Freshest signal</dt><dd>${esc(formatTimestamp(zone.evidence.freshestAt))}</dd></div>
      </dl>
      <div class="ops-zone__footer">
        <strong>Next:</strong> ${esc(zone.nextAction || "No explicit next action queued.")}
      </div>
    </article>
  `;
}
function renderTask(task) {
    const checklist = task.checklist.length
        ? task.checklist.map((item) => `<li><strong>${esc(item.label)}</strong>${item.detail ? ` · ${esc(item.detail)}` : ""}</li>`).join("")
        : "<li>No checklist has been generated yet.</li>";
    return `
    <article class="ops-task-card ops-tone-${esc(statusTone(task.status))}" data-task-id="${esc(task.id)}">
      <div class="ops-task-card__head">
        <div>
          <p class="ops-kicker">${esc(task.surface)} lane · ${esc(task.role)} · ${esc(task.zone)}</p>
          <h3>${esc(task.title)}</h3>
        </div>
        <div class="ops-task-card__badges">
          <span class="ops-pill ops-pill-${esc(statusTone(task.status))}">${esc(task.status)}</span>
          <span class="ops-pill">${esc(task.priority)}</span>
        </div>
      </div>
      <p class="ops-summary">${esc(task.whyNow)}</p>
      <dl class="ops-task-grid">
        <div><dt>Why now</dt><dd>${esc(task.whyNow)}</dd></div>
        <div><dt>Why you</dt><dd>${esc(task.whyYou)}</dd></div>
        <div><dt>Consequence if delayed</dt><dd>${esc(task.consequenceIfDelayed)}</dd></div>
        <div><dt>Freshness / confidence</dt><dd>${esc(formatTimestamp(task.freshestAt))} · ${esc(formatConfidence(task.confidence))}</dd></div>
        <div><dt>Evidence</dt><dd>${esc(task.evidenceSummary)}</dd></div>
        <div><dt>Tools</dt><dd>${esc(task.toolsNeeded.join(", ") || "Use standard station tools.")}</dd></div>
        <div><dt>Done definition</dt><dd>${esc(task.doneDefinition)}</dd></div>
        <div><dt>Proof path</dt><dd>${esc(task.preferredProofMode)}${task.proofModes.length > 1 ? ` (fallbacks: ${esc(task.proofModes.slice(1).join(", "))})` : ""}</dd></div>
        <div class="ops-span-2"><dt>If the signal path is missing</dt><dd>${esc(task.fallbackIfSignalMissing)}</dd></div>
      </dl>
      <div class="ops-subpanel">
        <h4>How to do it</h4>
        <ol>${task.instructions.map((line) => `<li>${esc(line)}</li>`).join("")}</ol>
      </div>
      <div class="ops-subpanel">
        <h4>Checklist</h4>
        <ul>${checklist}</ul>
      </div>
      <div class="ops-subpanel">
        <h4>Need help instead?</h4>
        <div class="ops-chip-row">
          ${task.blockerEscapeHatches.map((entry) => `<button type="button" class="ops-chip" data-task-escape="${esc(entry)}" data-task-id="${esc(task.id)}">${esc(entry)}</button>`).join("")}
        </div>
      </div>
      <div class="ops-actions">
        <button type="button" class="ops-button" data-task-claim="${esc(task.id)}">Claim</button>
        <button type="button" class="ops-button ops-button-secondary" data-task-proof="${esc(task.id)}" data-task-proof-mode="${esc(task.preferredProofMode)}">Proof</button>
        <button type="button" class="ops-button ops-button-secondary" data-task-complete="${esc(task.id)}">Complete</button>
      </div>
    </article>
  `;
}
function renderApproval(row) {
    return `
    <article class="ops-approval ops-tone-${esc(statusTone(row.status))}">
      <div class="ops-zone__head">
        <div>
          <p class="ops-kicker">Approval · ${esc(row.actionClass)} · ${esc(row.requiredRole)}</p>
          <h3>${esc(row.title)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(statusTone(row.status))}">${esc(row.status)}</span>
      </div>
      <p class="ops-summary">${esc(row.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Recommendation</dt><dd>${esc(row.recommendation)}</dd></div>
        <div><dt>Risk</dt><dd>${esc(row.riskSummary)}</dd></div>
        <div><dt>Reversibility</dt><dd>${esc(row.reversibility)}</dd></div>
        <div><dt>Freshness / confidence</dt><dd>${esc(formatTimestamp(row.freshestAt))} · ${esc(formatConfidence(row.confidence))}</dd></div>
      </dl>
      <p class="ops-meta"><strong>Rollback:</strong> ${esc(row.rollbackPlan || "No rollback plan provided yet.")}</p>
      <div class="ops-actions">
        <button type="button" class="ops-button" data-approval-resolve="${esc(row.id)}" data-approval-status="approved">Approve</button>
        <button type="button" class="ops-button ops-button-secondary" data-approval-resolve="${esc(row.id)}" data-approval-status="rejected">Reject</button>
      </div>
    </article>
  `;
}
function renderCase(row) {
    return `
    <article class="ops-case ops-tone-${esc(statusTone(row.status))}">
      <p class="ops-kicker">${esc(row.kind)} · ${esc(row.lane)} · ${esc(row.priority)}</p>
      <h3>${esc(row.title)}</h3>
      <p class="ops-summary">${esc(row.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Status</dt><dd>${esc(row.status)}</dd></div>
        <div><dt>Verification</dt><dd>${esc(row.verificationClass)}</dd></div>
        <div><dt>Freshest</dt><dd>${esc(formatTimestamp(row.freshestAt))}</dd></div>
        <div><dt>Confidence</dt><dd>${esc(formatConfidence(row.confidence))}</dd></div>
      </dl>
      <div class="ops-actions">
        <button type="button" class="ops-button ops-button-secondary" data-case-note="${esc(row.id)}">Add note</button>
      </div>
    </article>
  `;
}
function renderConversation(row) {
    return `
    <article class="ops-conversation">
      <p class="ops-kicker">${esc(row.roleMask)} · ${esc(row.senderIdentity)}</p>
      <h4>${esc(row.summary)}</h4>
      <p class="ops-meta">${row.unread ? "Unread" : "Read"} · last activity ${esc(formatTimestamp(row.latestMessageAt))}</p>
    </article>
  `;
}
function renderMemberCard(row, options = {}) {
    const actions = [
        options.canViewActivity
            ? `<button type="button" class="ops-button ops-button-secondary" data-member-activity="${esc(row.uid)}" data-member-name="${esc(row.displayName)}">Activity</button>`
            : "",
        options.canEditProfile
            ? `<button type="button" class="ops-button ops-button-secondary" data-member-profile="${esc(row.uid)}" data-member-display-name="${esc(row.displayName)}" data-member-kiln-preferences="${esc(row.kilnPreferences || "")}" data-member-staff-notes="${esc(row.staffNotes || "")}">Profile</button>`
            : "",
        options.canEditMembership
            ? `<button type="button" class="ops-button ops-button-secondary" data-member-membership="${esc(row.uid)}" data-member-membership-tier="${esc(row.membershipTier || "")}" data-member-name="${esc(row.displayName)}">Membership</button>`
            : "",
        options.canEditRole
            ? `<button type="button" class="ops-button ops-button-secondary" data-member-role="${esc(row.uid)}" data-member-roles="${esc(row.opsRoles.join(", "))}" data-member-name="${esc(row.displayName)}">Roles</button>`
            : "",
    ].filter(Boolean);
    return `
    <article class="ops-case ops-tone-neutral">
      <p class="ops-kicker">${esc(row.portalRole)} · ${esc(row.opsRoles.join(", ") || "no ops roles")}</p>
      <h3>${esc(row.displayName)}</h3>
      <p class="ops-summary">${esc(row.email || "No email on file.")}</p>
      <dl class="ops-meta-grid">
        <div><dt>Membership</dt><dd>${esc(row.membershipTier || "none")}</dd></div>
        <div><dt>Last seen</dt><dd>${esc(formatTimestamp(row.lastSeenAt))}</dd></div>
        <div class="ops-span-2"><dt>Capabilities</dt><dd>${esc(row.opsCapabilities.join(", ") || "No explicit ops capabilities.")}</dd></div>
        <div><dt>Updated</dt><dd>${esc(formatTimestamp(row.updatedAt))}</dd></div>
      </dl>
      ${actions.length ? `<div class="ops-actions">${actions.join("")}</div>` : ""}
    </article>
  `;
}
function renderReservationCard(row, options = {}) {
    return `
    <article class="ops-case ops-tone-${esc(statusTone(row.arrival.status === "arrived" ? "active" : row.degradeReason ? "warning" : "healthy"))}">
      <p class="ops-kicker">${esc(row.status)} · ${esc(row.firingType)} · ${esc(row.arrival.status)}</p>
      <h3>${esc(row.title)}</h3>
      <p class="ops-summary">${esc(row.arrival.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Due</dt><dd>${esc(formatTimestamp(row.dueAt))}</dd></div>
        <div><dt>Items</dt><dd>${esc(String(row.itemCount))}</dd></div>
        <div><dt>Verification</dt><dd>${esc(row.verificationClass)}</dd></div>
        <div class="ops-span-2"><dt>Prep</dt><dd>${esc(row.prep.summary)}</dd></div>
      </dl>
      ${options.canPrepareReservations ? `
        <div class="ops-actions">
          <button type="button" class="ops-button ops-button-secondary" data-reservation-prepare="${esc(row.reservationId)}" data-reservation-title="${esc(row.title)}">Stage prep task</button>
        </div>
      ` : ""}
    </article>
  `;
}
function renderEventCard(row) {
    return `
    <article class="ops-case ops-tone-${esc(statusTone(row.status === "published" ? "healthy" : row.status === "review_required" ? "warning" : "neutral"))}">
      <p class="ops-kicker">${esc(row.status)} · ${esc(row.location || "Location pending")}</p>
      <h3>${esc(row.title)}</h3>
      <p class="ops-summary">${esc(row.lastStatusReason || "Program tracking is stable.")}</p>
      <dl class="ops-meta-grid">
        <div><dt>Starts</dt><dd>${esc(formatTimestamp(row.startAt))}</dd></div>
        <div><dt>Seats</dt><dd>${esc(`${row.remainingCapacity ?? 0}/${row.capacity ?? 0}`)}</dd></div>
      </dl>
    </article>
  `;
}
function renderReportCard(row) {
    return `
    <article class="ops-case ops-tone-${esc(statusTone(row.severity === "high" ? "critical" : row.status === "open" ? "warning" : "healthy"))}">
      <p class="ops-kicker">${esc(row.severity)} severity · ${esc(row.status)}</p>
      <h3>${esc(row.summary)}</h3>
      <p class="ops-meta">Opened ${esc(formatTimestamp(row.createdAt))}</p>
    </article>
  `;
}
function renderLendingCard(model) {
    if (!model) {
        return '<div class="ops-empty">Lending data is unavailable right now.</div>';
    }
    return `
    <div class="ops-sequence-grid">
      ${renderSequenceStep(`Open requests: ${model.requests.length}`)}
      ${renderSequenceStep(`Active loans: ${model.loans.length}`)}
      ${renderSequenceStep(`Recommendations: ${model.recommendationCount}`)}
      ${renderSequenceStep(`Tag queue: ${model.tagSubmissionCount}`)}
      ${renderSequenceStep(`Cover review: ${model.coverReviewCount}`)}
    </div>
  `;
}
function renderExperiment(row, lane) {
    const status = "status" in row ? row.status : "open";
    const title = "title" in row ? row.title : "Untitled";
    const summary = "summary" in row ? row.summary : "";
    const body = lane === "ceo"
        ? esc(row.hypothesis || summary)
        : esc(row.problem || summary);
    return `
    <article class="ops-case ops-tone-${esc(statusTone(status))}">
      <p class="ops-kicker">${esc(lane)} strategy</p>
      <h3>${esc(title)}</h3>
      <p class="ops-summary">${body}</p>
      <p class="ops-meta">Status: ${esc(status)}</p>
    </article>
  `;
}
function renderWatchdogs(rows) {
    return rows
        .map((row) => `
      <article class="ops-watchdog ops-tone-${esc(statusTone(row.status))}">
        <h4>${esc(row.label)}</h4>
        <p>${esc(row.summary)}</p>
        <p class="ops-meta"><strong>Next:</strong> ${esc(row.recommendation)}</p>
      </article>`)
        .join("");
}
function renderModeTabs(surface, entries) {
    return `
    <nav class="ops-mode-nav" data-mode-nav="${esc(surface)}">
      ${entries.map((entry) => `
        <button type="button" class="ops-mode-tab" data-surface-mode-tab="${esc(surface)}" data-mode-tab="${esc(entry.id)}">
          <span>${esc(entry.label)}</span>
          ${entry.meta === undefined ? "" : `<strong>${esc(entry.meta)}</strong>`}
        </button>
      `).join("")}
    </nav>
  `;
}
function renderModePanel(surface, mode, body) {
    return `<div class="ops-mode-panel" data-surface-mode-panel="${esc(surface)}" data-mode="${esc(mode)}">${body}</div>`;
}
function renderStationContext(displayState) {
    if (!displayState?.station) {
        return `<div class="ops-empty">No active station heartbeat is visible for this surface right now.</div>`;
    }
    const station = displayState.station;
    return `
    <article class="ops-station-card">
      <p class="ops-kicker">Station heartbeat</p>
      <h3>${esc(station.stationId)}</h3>
      <dl class="ops-meta-grid">
        <div><dt>Room</dt><dd>${esc(station.roomId)}</dd></div>
        <div><dt>Mode</dt><dd>${esc(station.surfaceMode)}</dd></div>
        <div><dt>Actor</dt><dd>${esc(station.actorId || "unclaimed")}</dd></div>
        <div><dt>Last seen</dt><dd>${esc(formatTimestamp(station.lastSeenAt))}</dd></div>
        <div class="ops-span-2"><dt>Capabilities</dt><dd>${esc(station.capabilities.join(", ") || "No capabilities advertised.")}</dd></div>
      </dl>
    </article>
  `;
}
function renderHandsFocus(displayState, fallbackTask = null) {
    const task = displayState?.focusTask ?? fallbackTask;
    if (!task) {
        return `<div class="ops-empty">No focus task is currently pinned to this station.</div>`;
    }
    return renderTask(task);
}
function isActiveTask(task) {
    return task.status !== "verified" && task.status !== "canceled";
}
function renderMeter(value, tone, label) {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    return `
    <div class="ops-meter">
      <div class="ops-meter__track">
        <div class="ops-meter__fill ops-meter__fill-${esc(tone)}" style="width:${clamped}%"></div>
      </div>
      <span>${esc(label)}</span>
    </div>
  `;
}
function renderPulseZone(zone) {
    const tone = statusTone(zone.status);
    return `
    <article class="ops-pulse-card ops-tone-${esc(tone)}">
      <div class="ops-pulse-card__head">
        <div>
          <p class="ops-kicker">Studio system</p>
          <h3>${esc(zone.label)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(tone)}">${esc(zone.status)}</span>
      </div>
      <p class="ops-summary">${esc(zone.summary)}</p>
      ${renderMeter(zone.evidence.confidence * 100, tone, `${formatConfidence(zone.evidence.confidence)} confidence`)}
      <dl class="ops-inline-meta">
        <div><dt>Verification</dt><dd>${esc(zone.evidence.verificationClass)}</dd></div>
        <div><dt>Freshest</dt><dd>${esc(formatTimestamp(zone.evidence.freshestAt))}</dd></div>
      </dl>
      <p class="ops-pulse-card__next"><strong>Next:</strong> ${esc(zone.nextAction || "No explicit next action queued.")}</p>
    </article>
  `;
}
function renderSignalCard(input) {
    return `
    <article class="ops-signal-card ops-tone-${esc(input.tone)}">
      <div class="ops-signal-card__top">
        <div>
          <p class="ops-kicker">${esc(input.kicker)}</p>
          <strong>${esc(input.value)}</strong>
        </div>
        <span class="ops-signal-card__title">${esc(input.title)}</span>
      </div>
      ${renderMeter(input.meter, input.tone, input.meterLabel)}
      <p class="ops-summary">${esc(input.summary)}</p>
    </article>
  `;
}
function renderTaskSpotlight(task, label) {
    if (!task) {
        return `
      <article class="ops-spotlight-card">
        <p class="ops-kicker">${esc(label)}</p>
        <h3>No active task</h3>
        <p class="ops-summary">This lane is currently quiet.</p>
      </article>
    `;
    }
    const tone = statusTone(task.status);
    const countdownMinutes = task.dueAt ? minutesUntil(task.dueAt) : (task.etaMinutes ?? null);
    return `
    <article class="ops-spotlight-card ops-tone-${esc(tone)}" data-task-id="${esc(task.id)}">
      <div class="ops-zone__head">
        <div>
          <p class="ops-kicker">${esc(label)} · ${esc(task.role)} · ${esc(task.zone)}</p>
          <h3>${esc(task.title)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(tone)}">${esc(task.status)}</span>
      </div>
      <p class="ops-summary">${esc(task.whyNow)}</p>
      <div class="ops-spotlight-signal-row">
        <div class="ops-spotlight-orb" style="--countdown-color:${toneGaugeColor(tone)};--countdown-progress:${Math.round((countdownPercent(countdownMinutes, 180) / 100) * 360)}deg;">
          <div class="ops-spotlight-orb__ring"></div>
          <div class="ops-spotlight-orb__core">
            <strong>${esc(formatCountdown(countdownMinutes))}</strong>
            <span>${countdownMinutes !== null && countdownMinutes <= 0 ? "late" : "window"}</span>
          </div>
        </div>
        <div class="ops-relay ops-relay-compact">
          <div class="ops-relay__stage ops-relay__stage-done">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">manager</span>
          </div>
          <div class="ops-relay__stage ${task.status === "claimed" || task.status === "in_progress" ? "ops-relay__stage-active" : task.status === "proof_pending" || task.status === "verified" ? "ops-relay__stage-done" : "ops-relay__stage-queued"}">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">${esc(task.surface === "internet" ? "reply" : "hands")}</span>
          </div>
          <div class="ops-relay__stage ${task.status === "proof_pending" ? "ops-relay__stage-active" : task.status === "verified" ? "ops-relay__stage-done" : "ops-relay__stage-queued"}">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">verify</span>
          </div>
        </div>
      </div>
      ${renderMeter(task.confidence * 100, tone, `${formatConfidence(task.confidence)} confidence`)}
      <dl class="ops-inline-meta">
        <div><dt>Due</dt><dd>${esc(formatTimestamp(task.dueAt))}</dd></div>
        <div><dt>ETA</dt><dd>${esc(task.etaMinutes ? `${task.etaMinutes} min` : "unknown")}</dd></div>
      </dl>
      <p class="ops-meta"><strong>Why it matters:</strong> ${esc(task.consequenceIfDelayed)}</p>
      <div class="ops-actions">
        <button type="button" class="ops-button" data-task-claim="${esc(task.id)}">Claim</button>
        <button type="button" class="ops-button ops-button-secondary" data-task-proof="${esc(task.id)}" data-task-proof-mode="${esc(task.preferredProofMode)}">Proof</button>
      </div>
    </article>
  `;
}
function renderApprovalSpotlight(row) {
    if (!row) {
        return `
      <article class="ops-spotlight-card">
        <p class="ops-kicker">Owner gate</p>
        <h3>No pending approvals</h3>
        <p class="ops-summary">The manager is not currently blocked on explicit owner agency.</p>
      </article>
    `;
    }
    const tone = statusTone(row.status);
    return `
    <article class="ops-spotlight-card ops-tone-${esc(tone)}">
      <div class="ops-zone__head">
        <div>
          <p class="ops-kicker">Owner gate · ${esc(row.actionClass)}</p>
          <h3>${esc(row.title)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(tone)}">${esc(row.status)}</span>
      </div>
      <p class="ops-summary">${esc(row.summary)}</p>
      <div class="ops-spotlight-signal-row">
        <div class="ops-spotlight-orb" style="--countdown-color:${toneGaugeColor(tone)};--countdown-progress:${Math.round((countdownPercent(minutesUntil(row.freshestAt), 180) / 100) * 360)}deg;">
          <div class="ops-spotlight-orb__ring"></div>
          <div class="ops-spotlight-orb__core">
            <strong>${esc(formatCountdown(minutesUntil(row.freshestAt)))}</strong>
            <span>aging</span>
          </div>
        </div>
        <div class="ops-relay ops-relay-compact">
          <div class="ops-relay__stage ops-relay__stage-done">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">manager</span>
          </div>
          <div class="ops-relay__stage ${row.status === "pending" ? "ops-relay__stage-active" : "ops-relay__stage-done"}">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">owner</span>
          </div>
          <div class="ops-relay__stage ${row.status === "approved" || row.status === "executed" ? "ops-relay__stage-done" : "ops-relay__stage-queued"}">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">release</span>
          </div>
        </div>
      </div>
      ${renderMeter(row.confidence * 100, tone, `${formatConfidence(row.confidence)} confidence`)}
      <p class="ops-meta"><strong>Recommendation:</strong> ${esc(row.recommendation)}</p>
      <div class="ops-actions">
        <button type="button" class="ops-button" data-approval-resolve="${esc(row.id)}" data-approval-status="approved">Approve</button>
        <button type="button" class="ops-button ops-button-secondary" data-approval-resolve="${esc(row.id)}" data-approval-status="rejected">Reject</button>
      </div>
    </article>
  `;
}
function renderSequenceStep(entry, index = 0) {
    return `
    <article class="ops-sequence-step">
      <span class="ops-sequence-step__index">${index + 1}</span>
      <p>${esc(entry)}</p>
    </article>
  `;
}
function renderIncidentChip(input) {
    return `
    <article class="ops-incident-chip ops-tone-${esc(input.tone)}">
      <span class="ops-incident-chip__label">${esc(input.label)}</span>
      <p>${esc(input.text)}</p>
    </article>
  `;
}
function toneGaugeColor(tone) {
    if (tone === "good")
        return "var(--good)";
    if (tone === "warn")
        return "var(--warn)";
    if (tone === "danger")
        return "var(--danger)";
    return "var(--neutral)";
}
function renderCountdownOrb(input) {
    const percent = countdownPercent(input.minutes, input.horizonMinutes ?? 180);
    const progressAngle = `${Math.round((percent / 100) * 360)}deg`;
    return `
    <article class="ops-countdown-card ops-tone-${esc(input.tone)}" style="--countdown-color:${toneGaugeColor(input.tone)};--countdown-progress:${progressAngle};">
      <div class="ops-countdown-card__dial" aria-hidden="true">
        <div class="ops-countdown-card__ring"></div>
        <div class="ops-countdown-card__core">
          <strong>${esc(formatCountdown(input.minutes))}</strong>
          <span>${input.minutes !== null && input.minutes <= 0 ? "late" : "window"}</span>
        </div>
      </div>
      <div class="ops-countdown-card__copy">
        <p class="ops-kicker">${esc(input.label)}</p>
        <h3>${esc(input.title)}</h3>
        <p class="ops-summary">${esc(input.summary)}</p>
      </div>
    </article>
  `;
}
function renderGaugeCard(input) {
    const clamped = Math.max(0, Math.min(100, Math.round(input.percent)));
    const progressAngle = `${Math.round((clamped / 100) * 240)}deg`;
    const needleAngle = `${-120 + (clamped / 100) * 240}deg`;
    return `
    <article class="ops-gauge-card ops-tone-${esc(input.tone)}" style="--gauge-color:${toneGaugeColor(input.tone)};--gauge-progress:${progressAngle};--gauge-needle:${needleAngle};">
      <div class="ops-gauge-card__row">
        <div class="ops-gauge" aria-hidden="true">
          <div class="ops-gauge__ring"></div>
          <div class="ops-gauge__needle"></div>
          <div class="ops-gauge__hub"></div>
          <div class="ops-gauge__readout">${esc(input.value)}</div>
        </div>
        <div class="ops-gauge-card__copy">
          <p class="ops-kicker">${esc(input.label)}</p>
          <h3>${esc(input.title)}</h3>
          <p class="ops-summary">${esc(input.summary)}</p>
        </div>
      </div>
      ${renderMeter(clamped, input.tone, input.meterLabel)}
    </article>
  `;
}
function renderTickerItem(input) {
    return `
    <article class="ops-ticker-item ops-tone-${esc(input.tone)}">
      <span class="ops-ticker-item__label">${esc(input.label)}</span>
      <span class="ops-ticker-item__text">${esc(input.text)}</span>
    </article>
  `;
}
function renderFreshnessRibbon(source) {
    const tone = statusTone(source.status);
    const percent = freshnessPercent(source.freshnessSeconds, source.budgetSeconds);
    const freshnessLabel = source.freshnessSeconds === null
        ? "freshness unknown"
        : `${Math.max(0, Math.round((source.budgetSeconds - source.freshnessSeconds) / 60))}m until stale`;
    return `
    <article class="ops-source-ribbon ops-tone-${esc(tone)}">
      <div class="ops-source-ribbon__head">
        <span>${esc(source.label)}</span>
        <strong>${esc(freshnessLabel)}</strong>
      </div>
      <div class="ops-source-ribbon__track">
        <div class="ops-source-ribbon__fill ops-source-ribbon__fill-${esc(tone)}" style="width:${Math.max(8, percent)}%"></div>
      </div>
      <p class="ops-meta">${esc(source.reason || `Latest signal ${formatTimestamp(source.freshestAt)}`)}</p>
    </article>
  `;
}
function renderRelayCard(input) {
    return `
    <article class="ops-flow-card ops-tone-${esc(input.tone)}">
      <p class="ops-kicker">${esc(input.label)}</p>
      <h3>${esc(input.title)}</h3>
      <p class="ops-summary">${esc(input.summary)}</p>
      <div class="ops-relay">
        ${input.stages.map((stage) => `
          <div class="ops-relay__stage ops-relay__stage-${esc(stage.state)}">
            <span class="ops-relay__node"></span>
            <span class="ops-relay__label">${esc(stage.label)}</span>
          </div>
        `).join("")}
      </div>
    </article>
  `;
}
function renderTaskRelayCard(task, label) {
    if (!task) {
        return renderRelayCard({
            label,
            title: "No active relay",
            summary: "This lane is quiet, so no human handoff is flowing right now.",
            tone: "good",
            stages: [
                { label: "manager", state: "done" },
                { label: "waiting", state: "active" },
                { label: "verify", state: "queued" },
            ],
        });
    }
    const tone = statusTone(task.status);
    const claimState = task.status === "queued" || task.status === "proposed" ? "queued" : "done";
    const actionState = task.status === "claimed" || task.status === "in_progress" ? "active" : task.status === "proof_pending" || task.status === "verified" ? "done" : "queued";
    const verifyState = task.status === "proof_pending" ? "active" : task.status === "verified" ? "done" : "queued";
    return renderRelayCard({
        label,
        title: task.title,
        summary: task.claimedBy ? `Claimed by ${task.claimedBy}.` : task.whyNow,
        tone,
        stages: [
            { label: "manager", state: "done" },
            { label: task.surface === "internet" ? "reply" : "hands", state: actionState === "active" ? "active" : claimState },
            { label: "verify", state: verifyState },
        ],
    });
}
function renderApprovalRelayCard(row) {
    if (!row) {
        return renderRelayCard({
            label: "Owner gate",
            title: "Approval lane clear",
            summary: "Nothing is waiting on explicit owner agency right now.",
            tone: "good",
            stages: [
                { label: "manager", state: "done" },
                { label: "owner", state: "queued" },
                { label: "release", state: "queued" },
            ],
        });
    }
    const tone = statusTone(row.status);
    const ownerState = row.status === "pending" ? "active" : "done";
    const releaseState = row.status === "approved" || row.status === "executed" ? "done" : row.status === "rejected" ? "done" : "queued";
    return renderRelayCard({
        label: "Owner gate",
        title: row.title,
        summary: row.recommendation,
        tone,
        stages: [
            { label: "manager", state: "done" },
            { label: "owner", state: ownerState },
            { label: "release", state: releaseState },
        ],
    });
}
function renderMapZone(zone, index) {
    const tone = statusTone(zone.status);
    const sourceSignals = zone.evidence.sources.length
        ? zone.evidence.sources.slice(0, 4).map((source) => {
            const freshness = source.freshnessMs === null ? null : Math.round(source.freshnessMs / 1000);
            const freshnessTone = freshness === null ? "neutral" : freshness <= 300 ? "good" : freshness <= 1800 ? "warn" : "danger";
            return `
          <span class="ops-zone-ribbon__segment ops-zone-ribbon__segment-${esc(freshnessTone)}" title="${esc(source.label)} · ${esc(source.system)}"></span>
        `;
        }).join("")
        : `<span class="ops-zone-ribbon__segment ops-zone-ribbon__segment-${esc(tone)}"></span>`;
    return `
    <article class="ops-map-zone ops-map-zone-${index % 4} ops-tone-${esc(tone)}">
      <div class="ops-map-zone__head">
        <div>
          <p class="ops-kicker">Studio system</p>
          <h3>${esc(zone.label)}</h3>
        </div>
        <span class="ops-map-zone__sentinel ops-map-zone__sentinel-${esc(tone)}" title="${esc(zone.evidence.verificationClass)} · ${esc(formatConfidence(zone.evidence.confidence))}">
          <span class="ops-map-zone__status ops-map-zone__status-${esc(tone)}"></span>
        </span>
      </div>
      <p class="ops-summary">${esc(zone.summary)}</p>
      ${renderMeter(zone.evidence.confidence * 100, tone, `${formatConfidence(zone.evidence.confidence)} confidence`)}
      <div class="ops-zone-ribbon" aria-hidden="true">${sourceSignals}</div>
      <p class="ops-meta"><strong>${esc(zone.evidence.verificationClass)}</strong> · freshest ${esc(formatTimestamp(zone.evidence.freshestAt))}</p>
      <p class="ops-map-zone__next"><strong>Next:</strong> ${esc(zone.nextAction || "No explicit next action queued.")}</p>
    </article>
  `;
}
function renderTimelineEntry(input) {
    const minutes = minutesUntil(input.time);
    return `
    <article class="ops-timeline-entry ops-tone-${esc(input.tone)}">
      <div class="ops-timeline-entry__time">${esc(formatTimestamp(input.time))}</div>
      <div class="ops-timeline-entry__body">
        <div class="ops-timeline-entry__head">
          <p class="ops-kicker">${esc(input.lane)}</p>
          <span class="ops-timeline-entry__countdown ops-timeline-entry__countdown-${esc(input.tone)}">${esc(formatCountdown(minutes))}</span>
        </div>
        <h4>${esc(input.title)}</h4>
        <p>${esc(input.summary)}</p>
        <div class="ops-conveyor ops-conveyor-${esc(input.tone)}" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </div>
    </article>
  `;
}
function renderSurfaceShell(model, displayState) {
    const surfaceTabs = model.session?.allowedSurfaces?.length
        ? model.session.allowedSurfaces
        : ["manager", "owner", "hands", "internet", "ceo", "forge"];
    const sessionCapabilities = model.session?.opsCapabilities ?? [];
    const canEditMemberProfile = sessionCapabilities.includes("members:edit_profile");
    const canEditMembership = sessionCapabilities.includes("members:edit_membership");
    const canEditRole = sessionCapabilities.includes("members:edit_role");
    const canViewMembers = sessionCapabilities.includes("members:view");
    const canPrepareReservations = sessionCapabilities.includes("reservations:prepare");
    const canRequestOverrides = sessionCapabilities.includes("overrides:request");
    const activeManagerTasks = model.tasks.filter((entry) => (entry.surface === "manager" || entry.surface === "owner") && isActiveTask(entry));
    const managerTasks = activeManagerTasks.slice(0, 4);
    const activeHandsTasks = model.tasks.filter((entry) => entry.surface === "hands" && isActiveTask(entry));
    const handsTasks = model.tasks.filter((entry) => entry.surface === "hands").slice(0, 8);
    const activeInternetTasks = model.tasks.filter((entry) => entry.surface === "internet" && isActiveTask(entry));
    const internetTasks = model.tasks.filter((entry) => entry.surface === "internet").slice(0, 8);
    const handsCases = model.cases.filter((entry) => entry.lane === "hands" || entry.kind === "kiln_run" || entry.kind === "arrival").slice(0, 4);
    const internetCases = model.cases.filter((entry) => entry.lane === "internet" || entry.kind === "support_thread" || entry.kind === "event" || entry.kind === "complaint").slice(0, 4);
    const reservationBundles = model.reservations.slice(0, 8);
    const eventRows = model.events.slice(0, 8);
    const reportRows = model.reports.slice(0, 8);
    const memberRows = model.members.slice(0, 12);
    const memberCards = memberRows.map((row) => renderMemberCard(row, {
        canEditProfile: canEditMemberProfile,
        canEditMembership,
        canEditRole,
        canViewActivity: canViewMembers,
    })).join("");
    const reservationCards = reservationBundles.map((row) => renderReservationCard(row, {
        canPrepareReservations,
    })).join("");
    const overrideCards = model.overrides.map((entry) => renderCase({
        id: entry.id,
        kind: "general",
        title: entry.scope,
        summary: entry.reason,
        status: entry.status === "active" ? "active" : entry.status === "pending" ? "awaiting_approval" : "resolved",
        priority: "p2",
        lane: "manager",
        ownerRole: entry.requiredRole,
        verificationClass: "claimed",
        freshestAt: entry.createdAt,
        sources: [],
        confidence: 0.55,
        degradeReason: "Manual override in play.",
        dueAt: entry.expiresAt,
        linkedEntityKind: null,
        linkedEntityId: null,
        memoryScope: null,
        createdAt: entry.createdAt || model.generatedAt,
        updatedAt: entry.createdAt || model.generatedAt,
        metadata: {},
    })).join("");
    const ceoCards = model.ceo.map((entry) => renderExperiment(entry, "ceo")).join("");
    const forgeCards = model.forge.map((entry) => renderExperiment(entry, "forge")).join("");
    const pendingApprovals = model.approvals.filter((entry) => entry.status === "pending");
    const unreadConversations = model.conversations.filter((entry) => entry.unread).length;
    const fastestSource = [...model.truth.sources]
        .filter((entry) => entry.budgetSeconds > 0)
        .sort((left, right) => {
        const leftRemaining = (left.budgetSeconds - (left.freshnessSeconds ?? left.budgetSeconds));
        const rightRemaining = (right.budgetSeconds - (right.freshnessSeconds ?? right.budgetSeconds));
        return leftRemaining - rightRemaining;
    })[0] ?? null;
    const gaugeCards = [
        renderGaugeCard({
            label: "Studio risk",
            title: "Pressure",
            value: model.twin.currentRisk ? "82%" : "24%",
            summary: model.twin.currentRisk || "No issue is dominating the studio right now.",
            tone: statusTone(model.twin.currentRisk ? "critical" : "healthy"),
            percent: model.twin.currentRisk ? 82 : 24,
            meterLabel: model.twin.currentRisk ? "risk elevated" : "risk contained",
        }),
        renderGaugeCard({
            label: "Hands lane",
            title: "Load",
            value: `${activeHandsTasks.length}`,
            summary: activeHandsTasks[0]?.title || "No physical task is currently queued for human hands.",
            tone: statusTone(activeHandsTasks.length > 0 ? "warning" : "healthy"),
            percent: Math.min(100, Math.max(12, activeHandsTasks.length * 24)),
            meterLabel: `${activeHandsTasks.length} active task${activeHandsTasks.length === 1 ? "" : "s"}`,
        }),
        renderGaugeCard({
            label: "Internet lane",
            title: "Traffic",
            value: `${Math.max(activeInternetTasks.length, unreadConversations)}`,
            summary: activeInternetTasks[0]?.title
                || (unreadConversations > 0 ? `${unreadConversations} unread conversation${unreadConversations === 1 ? "" : "s"} need eyes.` : "No urgent internet thread is visible right now."),
            tone: statusTone(activeInternetTasks.length > 0 || unreadConversations > 0 ? "warning" : "healthy"),
            percent: Math.min(100, Math.max(10, Math.max(activeInternetTasks.length, unreadConversations) * 28)),
            meterLabel: `${activeInternetTasks.length} active thread task${activeInternetTasks.length === 1 ? "" : "s"}`,
        }),
        renderGaugeCard({
            label: "Owner gates",
            title: "Approval",
            value: `${pendingApprovals.length}`,
            summary: pendingApprovals[0]?.title || "No explicit owner approval is currently blocking the manager.",
            tone: statusTone(pendingApprovals.length > 0 ? "pending" : "approved"),
            percent: pendingApprovals.length > 0 ? Math.min(100, pendingApprovals.length * 36) : 8,
            meterLabel: pendingApprovals.length > 0 ? "human decision required" : "clear",
        }),
        renderGaugeCard({
            label: "Truth posture",
            title: "Readiness",
            value: model.truth.readiness,
            summary: model.truth.summary,
            tone: statusTone(model.truth.readiness),
            percent: model.truth.readiness === "ready" ? 92 : model.truth.readiness === "degraded" ? 56 : 22,
            meterLabel: `${model.truth.degradeModes.length} degrade mode${model.truth.degradeModes.length === 1 ? "" : "s"}`,
        }),
    ];
    const incidentItems = [
        model.twin.currentRisk
            ? renderIncidentChip({
                label: "Studio risk",
                text: model.twin.currentRisk,
                tone: statusTone("critical"),
            })
            : "",
        activeHandsTasks[0]
            ? renderIncidentChip({
                label: "Hands",
                text: activeHandsTasks[0].title,
                tone: statusTone(activeHandsTasks[0].status),
            })
            : "",
        activeInternetTasks[0]
            ? renderIncidentChip({
                label: "Internet",
                text: activeInternetTasks[0].title,
                tone: statusTone(activeInternetTasks[0].status),
            })
            : "",
        pendingApprovals[0]
            ? renderIncidentChip({
                label: "Approval",
                text: pendingApprovals[0].title,
                tone: statusTone(pendingApprovals[0].status),
            })
            : "",
        model.truth.watchdogs.find((entry) => entry.status !== "healthy")
            ? renderIncidentChip({
                label: "Watchdog",
                text: model.truth.watchdogs.find((entry) => entry.status !== "healthy")?.summary || "",
                tone: statusTone(model.truth.watchdogs.find((entry) => entry.status !== "healthy")?.status || "warning"),
            })
            : "",
    ].filter(Boolean);
    const tickerItems = [
        model.twin.currentRisk
            ? { label: "risk", text: model.twin.currentRisk, tone: statusTone("critical") }
            : { label: "studio", text: "No top-level incident is dominating the floor right now.", tone: statusTone("healthy") },
        activeHandsTasks[0]
            ? { label: "hands", text: activeHandsTasks[0].title, tone: statusTone(activeHandsTasks[0].status) }
            : { label: "hands", text: "No physical queue is currently active.", tone: statusTone("healthy") },
        activeInternetTasks[0]
            ? { label: "internet", text: activeInternetTasks[0].title, tone: statusTone(activeInternetTasks[0].status) }
            : { label: "internet", text: "No urgent internet thread is visible right now.", tone: statusTone("healthy") },
        pendingApprovals[0]
            ? { label: "approval", text: pendingApprovals[0].title, tone: statusTone(pendingApprovals[0].status) }
            : { label: "approval", text: "No explicit owner gate is blocking the manager.", tone: statusTone("approved") },
        model.truth.watchdogs.find((entry) => entry.status !== "healthy")
            ? {
                label: "watchdog",
                text: model.truth.watchdogs.find((entry) => entry.status !== "healthy")?.summary || "",
                tone: statusTone(model.truth.watchdogs.find((entry) => entry.status !== "healthy")?.status || "warning"),
            }
            : { label: "truth", text: model.truth.summary, tone: statusTone(model.truth.readiness) },
    ];
    const timelineEntries = [
        ...activeHandsTasks.slice(0, 3).map((entry) => ({
            time: entry.dueAt ?? entry.freshestAt,
            lane: "Hands",
            title: entry.title,
            summary: entry.whyNow,
            tone: statusTone(entry.status),
        })),
        ...activeInternetTasks.slice(0, 2).map((entry) => ({
            time: entry.dueAt ?? entry.freshestAt,
            lane: "Internet",
            title: entry.title,
            summary: entry.whyNow,
            tone: statusTone(entry.status),
        })),
        ...pendingApprovals.slice(0, 2).map((entry) => ({
            time: entry.freshestAt,
            lane: "Approval",
            title: entry.title,
            summary: entry.recommendation,
            tone: statusTone(entry.status),
        })),
    ]
        .sort((left, right) => String(left.time ?? "9999").localeCompare(String(right.time ?? "9999")))
        .slice(0, 6);
    const countdownItems = [
        renderCountdownOrb({
            label: "Hands window",
            title: activeHandsTasks[0]?.title || "No physical deadline",
            summary: activeHandsTasks[0]?.whyNow || "The hands lane is not carrying an urgent physical deadline right now.",
            minutes: activeHandsTasks[0]?.dueAt ? minutesUntil(activeHandsTasks[0].dueAt) : (activeHandsTasks[0]?.etaMinutes ?? null),
            tone: activeHandsTasks[0] ? statusTone(activeHandsTasks[0].status) : "good",
            horizonMinutes: 240,
        }),
        renderCountdownOrb({
            label: "Internet window",
            title: activeInternetTasks[0]?.title || "No reply clock",
            summary: activeInternetTasks[0]?.whyNow
                || (unreadConversations > 0 ? `${unreadConversations} unread conversation${unreadConversations === 1 ? "" : "s"} are visible.` : "The internet lane is not under immediate reply pressure."),
            minutes: activeInternetTasks[0]?.dueAt ? minutesUntil(activeInternetTasks[0].dueAt) : (activeInternetTasks[0]?.etaMinutes ?? null),
            tone: activeInternetTasks[0] ? statusTone(activeInternetTasks[0].status) : (unreadConversations > 0 ? "warn" : "good"),
            horizonMinutes: 180,
        }),
        renderCountdownOrb({
            label: "Truth window",
            title: fastestSource?.label || "No freshness budget",
            summary: fastestSource?.reason || "No source freshness budget is currently close to expiring.",
            minutes: fastestSource?.freshnessSeconds === null ? null : Math.round((fastestSource.budgetSeconds - fastestSource.freshnessSeconds) / 60),
            tone: fastestSource ? statusTone(fastestSource.status) : statusTone(model.truth.readiness),
            horizonMinutes: Math.max(60, Math.round((fastestSource?.budgetSeconds ?? 3600) / 60)),
        }),
    ];
    const relayItems = [
        renderTaskRelayCard(activeHandsTasks[0] ?? null, "Hands relay"),
        renderTaskRelayCard(activeInternetTasks[0] ?? null, "Internet relay"),
        renderApprovalRelayCard(pendingApprovals[0] ?? null),
    ];
    const handsNowCountdowns = [
        renderCountdownOrb({
            label: "Current window",
            title: activeHandsTasks[0]?.title || "No active physical window",
            summary: activeHandsTasks[0]?.whyNow || "No physical deadline is pressing right now.",
            minutes: activeHandsTasks[0]?.dueAt ? minutesUntil(activeHandsTasks[0].dueAt) : (activeHandsTasks[0]?.etaMinutes ?? null),
            tone: activeHandsTasks[0] ? statusTone(activeHandsTasks[0].status) : "good",
            horizonMinutes: 180,
        }),
        renderCountdownOrb({
            label: "Truth freshness",
            title: fastestSource?.label || "No live source budget",
            summary: fastestSource?.reason || "No source budget is near expiry.",
            minutes: fastestSource?.freshnessSeconds === null ? null : Math.round((fastestSource.budgetSeconds - fastestSource.freshnessSeconds) / 60),
            tone: fastestSource ? statusTone(fastestSource.status) : statusTone(model.truth.readiness),
            horizonMinutes: Math.max(60, Math.round((fastestSource?.budgetSeconds ?? 3600) / 60)),
        }),
    ];
    const internetDeskCountdowns = [
        renderCountdownOrb({
            label: "Reply window",
            title: activeInternetTasks[0]?.title || "No urgent reply clock",
            summary: activeInternetTasks[0]?.whyNow || "No urgent internet task is pressing the queue right now.",
            minutes: activeInternetTasks[0]?.dueAt ? minutesUntil(activeInternetTasks[0].dueAt) : (activeInternetTasks[0]?.etaMinutes ?? null),
            tone: activeInternetTasks[0] ? statusTone(activeInternetTasks[0].status) : "good",
            horizonMinutes: 180,
        }),
        renderCountdownOrb({
            label: "Unread pressure",
            title: unreadConversations > 0 ? `${unreadConversations} unread thread${unreadConversations === 1 ? "" : "s"}` : "Inbox is calm",
            summary: unreadConversations > 0 ? "Unread conversations are waiting on clarity or action." : "No unread conversation is currently visible.",
            minutes: unreadConversations > 0 ? unreadConversations * 12 : 0,
            tone: unreadConversations > 0 ? "warn" : "good",
            horizonMinutes: 120,
        }),
    ];
    return `
    <nav class="ops-surface-nav">
      ${surfaceTabs.map((surface) => `<button type="button" class="ops-surface-tab" data-surface-tab="${esc(surface)}">${esc(surface)}</button>`).join("")}
    </nav>

    <section class="ops-surface" data-surface="manager">
      <div class="ops-manager-canvas">
        ${renderModeTabs("manager", [
        { id: "overview", label: "Overview" },
        { id: "live", label: "Live" },
        { id: "truth", label: "Truth", meta: model.truth.sources.length },
        { id: "operations", label: "Operations", meta: managerTasks.length },
        { id: "commitments", label: "Commitments", meta: reservationBundles.length },
        { id: "trust", label: "Trust", meta: reportRows.length },
    ])}
        ${renderModePanel("manager", "overview", `
          <div class="ops-manager-canvas">
            <div class="ops-panel">
              <div class="ops-panel__head">
                <div>
                  <p class="ops-kicker">Studio manager</p>
                  <h2>${esc(model.twin.headline)}</h2>
                </div>
                <span class="ops-pill ops-pill-${esc(statusTone(model.truth.readiness))}">${esc(model.truth.readiness)}</span>
              </div>
              <p class="ops-summary">${esc(model.twin.narrative)}</p>
              <div class="ops-gauge-strip">${gaugeCards.join("")}</div>
              <div class="ops-ticker-shell">
                <div class="ops-ticker-track">
                  ${[...tickerItems, ...tickerItems].map(renderTickerItem).join("")}
                </div>
              </div>
              <div class="ops-incident-strip">${incidentItems.join("") || '<div class="ops-empty">No urgent incidents are firing right now.</div>'}</div>
            </div>
            <div class="ops-motion-grid">
              <div class="ops-panel ops-motion-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Critical windows</p>
                    <h2>Countdowns and SLA pressure</h2>
                  </div>
                </div>
                <div class="ops-countdown-grid">${countdownItems.join("")}</div>
              </div>
              <div class="ops-panel ops-motion-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Flow relays</p>
                    <h2>Who owns the next handoff</h2>
                  </div>
                </div>
                <div class="ops-relay-stack">${relayItems.join("")}</div>
              </div>
              <div class="ops-panel ops-motion-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Freshness field</p>
                    <h2>Which signals are still live</h2>
                  </div>
                </div>
                <div class="ops-ribbon-stack">
                  ${model.truth.sources.slice(0, 4).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}
                </div>
              </div>
            </div>
            <div class="ops-command-grid">
              ${renderTaskSpotlight(activeHandsTasks[0] ?? null, "Physical priority")}
              ${renderTaskSpotlight(activeInternetTasks[0] ?? null, "Member priority")}
              ${renderApprovalSpotlight(pendingApprovals[0] ?? null)}
            </div>
          </div>
        `)}
        ${renderModePanel("manager", "live", `
          <div class="ops-manager-canvas">
            <div class="ops-scan-grid">
              <div class="ops-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Studio map</p>
                    <h2>Where the pressure is living</h2>
                  </div>
                </div>
                <div class="ops-studio-map">${model.twin.zones.map(renderMapZone).join("")}</div>
              </div>
              <div class="ops-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Time lane</p>
                    <h2>What lands next</h2>
                  </div>
                </div>
                <div class="ops-timeline">${timelineEntries.map(renderTimelineEntry).join("") || '<div class="ops-empty">No scheduled events are visible right now.</div>'}</div>
              </div>
            </div>
          </div>
        `)}
        ${renderModePanel("manager", "operations", `
          <div class="ops-manager-canvas">
            <div class="ops-panel">
              <div class="ops-panel__head">
                <div>
                  <p class="ops-kicker">Operating sequence</p>
                  <h2>What the manager thinks should happen next</h2>
                </div>
              </div>
              <div class="ops-sequence-grid">
                ${model.twin.nextActions.length
        ? model.twin.nextActions.slice(0, 5).map(renderSequenceStep).join("")
        : '<div class="ops-empty">No next action has been surfaced yet.</div>'}
              </div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head">
                <div>
                  <p class="ops-kicker">Partner chat</p>
                  <h2>Studio Manager voice</h2>
                </div>
                <span class="ops-pill">memory-backed</span>
              </div>
              <p class="ops-meta">The manager voice should reduce surprise, explain its reasoning, and keep continuity across days.</p>
              <div class="ops-chat-feed" id="ops-chat-feed">
                <article class="ops-chat-message ops-chat-message-assistant">
                  <p>${esc(model.twin.headline)}</p>
                </article>
              </div>
              <form class="ops-chat-form" id="ops-chat-form" data-surface-chat="manager">
                <textarea name="text" rows="4" placeholder="Ask what matters next, why a task was assigned, or what the studio is uncertain about."></textarea>
                <div class="ops-actions">
                  <button type="submit" class="ops-button">Send to manager</button>
                </div>
              </form>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head">
                <div>
                  <p class="ops-kicker">Manager detail</p>
                  <h2>Detailed queue</h2>
                </div>
              </div>
              <div class="ops-scroll-stack">${managerTasks.map(renderTask).join("") || '<div class="ops-empty">No manager tasks are queued.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("manager", "truth", `
          <div class="ops-manager-canvas">
            <div class="ops-detail-grid">
              <div class="ops-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Case pulse</p>
                    <h2>Shared operational ledger</h2>
                  </div>
                </div>
                <div class="ops-scroll-stack">${model.cases.slice(0, 8).map(renderCase).join("") || '<div class="ops-empty">No cases in the ledger yet.</div>'}</div>
              </div>
              <div class="ops-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Truth posture</p>
                    <h2>Watchdogs and degraded paths</h2>
                  </div>
                </div>
                <dl class="ops-meta-grid">
                  <div><dt>Readiness</dt><dd>${esc(model.truth.readiness)}</dd></div>
                  <div><dt>Degrade modes</dt><dd>${esc(model.truth.degradeModes.join(", ") || "none")}</dd></div>
                  <div class="ops-span-2"><dt>Summary</dt><dd>${esc(model.truth.summary)}</dd></div>
                </dl>
                <div class="ops-truth-grid">${renderWatchdogs(model.truth.watchdogs)}</div>
              </div>
              <div class="ops-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Fresh sources</p>
                    <h2>Signal provenance</h2>
                  </div>
                </div>
                <div class="ops-ribbon-stack">${model.truth.sources.slice(0, 6).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
              </div>
            </div>
          </div>
        `)}
        ${renderModePanel("manager", "commitments", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Reservation bundles</p><h2>Arrivals, prep, and surprise prevention</h2></div></div>
              <div class="ops-scroll-stack">${reservationCards || '<div class="ops-empty">No reservation bundles are visible right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Program pressure</p><h2>Events landing soon</h2></div></div>
              <div class="ops-scroll-stack">${eventRows.map(renderEventCard).join("") || '<div class="ops-empty">No event pressure is visible right now.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("manager", "trust", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Trust and reports</p><h2>What could hurt people or confidence</h2></div></div>
              <div class="ops-scroll-stack">${reportRows.map(renderReportCard).join("") || '<div class="ops-empty">No open community reports are visible.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Override pressure</p><h2>Manual paths degrading autonomy</h2></div></div>
              <div class="ops-scroll-stack">${overrideCards || '<div class="ops-empty">No override receipts are currently open.</div>'}</div>
              ${canRequestOverrides ? `
                <form class="ops-compose-form" id="ops-override-form">
                  <input name="scope" placeholder="Override scope (for example: kiln-room-manual-verification)" />
                  <textarea name="reason" rows="3" placeholder="Why does the human need to step outside the normal path?"></textarea>
                  <input name="expiresAt" placeholder="Optional expiry ISO timestamp" />
                  <div class="ops-actions"><button type="submit" class="ops-button">Request override</button></div>
                </form>
              ` : ""}
            </div>
          </div>
        `)}
      </div>
    </section>

    <section class="ops-surface" data-surface="owner">
      <div class="ops-manager-canvas">
        ${renderModeTabs("owner", [
        { id: "brief", label: "Brief" },
        { id: "approvals", label: "Approvals", meta: pendingApprovals.length },
        { id: "finance", label: "Finance" },
        { id: "identity", label: "Identity", meta: memberRows.length },
    ])}
        ${renderModePanel("owner", "brief", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Owner briefing</p><h2>Quiet truth, approvals, and strategic risk</h2></div></div>
              <p class="ops-summary">${esc(model.truth.summary)}</p>
              <div class="ops-truth-grid">${renderWatchdogs(model.truth.watchdogs)}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Override posture</p><h2>Where humans had to step outside automation</h2></div></div>
              <div class="ops-scroll-stack">${overrideCards || '<div class="ops-empty">No overrides are currently recorded.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("owner", "approvals", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Approvals</p><h2>Actions that need explicit human agency</h2></div></div>
            <div class="ops-stack">${model.approvals.map(renderApproval).join("") || '<div class="ops-empty">No approvals are queued.</div>'}</div>
          </div>
        `)}
        ${renderModePanel("owner", "finance", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Finance posture</p><h2>Money-moving actions remain owner-gated</h2></div></div>
            <div class="ops-sequence-grid">
              ${renderSequenceStep("Finance visibility stays in the owner lane.")}
              ${renderSequenceStep("No direct money movement is automated here.")}
              ${renderSequenceStep(`Pending approvals: ${pendingApprovals.length}`)}
            </div>
          </div>
        `)}
        ${renderModePanel("owner", "identity", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Identity and member ops</p><h2>Role changes and protected access</h2></div></div>
            <div class="ops-scroll-stack">${memberCards || '<div class="ops-empty">No member rows are visible for this owner session.</div>'}</div>
          </div>
        `)}
      </div>
    </section>

    <section class="ops-surface" data-surface="hands">
      <div class="ops-manager-canvas">
        ${renderModeTabs("hands", [
        { id: "now", label: "Now" },
        { id: "queue", label: "Queue", meta: handsTasks.length },
        { id: "checkins", label: "Check-ins", meta: reservationBundles.length },
        { id: "production", label: "Production", meta: handsCases.length },
        { id: "firings", label: "Firings", meta: handsCases.filter((entry) => entry.kind === "kiln_run").length },
        { id: "lending", label: "Lending", meta: model.lending?.loans.length ?? 0 },
        { id: "lending-intake", label: "Lending intake", meta: model.lending?.requests.length ?? 0 },
    ])}
        ${renderModePanel("hands", "now", `
          <div class="ops-layout ops-layout-hands">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Hands lane</p><h2>One clear physical next step</h2></div></div>
              ${renderHandsFocus(displayState, activeHandsTasks[0] ?? null)}
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Live telemetry</p><h2>Window, handoff, and truth</h2></div></div>
              <div class="ops-countdown-grid ops-countdown-grid-dual">${handsNowCountdowns.join("")}</div>
              <div class="ops-relay-stack">${renderTaskRelayCard(activeHandsTasks[0] ?? null, "Hands relay")}</div>
              <div class="ops-ribbon-stack">${model.truth.sources.slice(0, 3).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("hands", "queue", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Queued work</p><h2>Task rail</h2></div></div>
            <div class="ops-scroll-stack">${handsTasks.map(renderTask).join("") || '<div class="ops-empty">No physical tasks are queued.</div>'}</div>
          </div>
        `)}
        ${renderModePanel("hands", "checkins", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Check-ins</p><h2>Reservation prep and day-of arrivals</h2></div></div>
              <div class="ops-scroll-stack">${reservationCards || '<div class="ops-empty">No reservation bundles are visible right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Station context</p><h2>What this station knows</h2></div></div>
              ${renderStationContext(displayState)}
              <div class="ops-truth-grid">${renderWatchdogs(model.truth.watchdogs)}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("hands", "production", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Production</p><h2>Kilns, arrivals, and physical commitments</h2></div></div>
            <div class="ops-scroll-stack">${handsCases.map(renderCase).join("") || '<div class="ops-empty">No hands-related cases are active right now.</div>'}</div>
          </div>
        `)}
        ${renderModePanel("hands", "firings", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Firings</p><h2>Kiln runs and maintenance posture</h2></div></div>
            <div class="ops-scroll-stack">${handsCases.filter((entry) => entry.kind === "kiln_run").map(renderCase).join("") || '<div class="ops-empty">No kiln cases are active right now.</div>'}</div>
          </div>
        `)}
        ${renderModePanel("hands", "lending", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Lending</p><h2>Borrowers, due windows, and returns</h2></div></div>
              ${renderLendingCard(model.lending)}
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Loans</p><h2>What is actively out</h2></div></div>
              <div class="ops-scroll-stack">${(model.lending?.loans ?? []).map((row) => renderCase({ id: row.id, kind: "general", title: row.title, summary: row.borrowerName || row.borrowerUid || "Borrower unknown", status: row.status === "overdue" ? "blocked" : "active", priority: row.status === "overdue" ? "p1" : "p2", lane: "hands", ownerRole: "library_ops", verificationClass: "observed", freshestAt: row.createdAt, sources: [], confidence: 0.68, degradeReason: null, dueAt: row.dueAt, linkedEntityKind: null, linkedEntityId: null, memoryScope: null, createdAt: row.createdAt || model.generatedAt, updatedAt: row.createdAt || model.generatedAt, metadata: {} })).join("") || '<div class="ops-empty">No active loans are visible.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("hands", "lending-intake", `
          <div class="ops-panel">
            <div class="ops-panel__head"><div><p class="ops-kicker">Lending intake</p><h2>Requests and review queues</h2></div></div>
            <div class="ops-scroll-stack">${(model.lending?.requests ?? []).map((row) => renderCase({ id: row.id, kind: "general", title: row.title, summary: row.requesterName || row.requesterUid || "Requester unknown", status: row.status === "open" ? "open" : "active", priority: row.status === "open" ? "p2" : "p3", lane: "hands", ownerRole: "library_ops", verificationClass: "observed", freshestAt: row.createdAt, sources: [], confidence: 0.66, degradeReason: null, dueAt: null, linkedEntityKind: null, linkedEntityId: null, memoryScope: null, createdAt: row.createdAt || model.generatedAt, updatedAt: row.createdAt || model.generatedAt, metadata: {} })).join("") || '<div class="ops-empty">No lending intake requests are visible.</div>'}</div>
          </div>
        `)}
      </div>
    </section>

    <section class="ops-surface" data-surface="internet">
      <div class="ops-manager-canvas">
        ${renderModeTabs("internet", [
        { id: "desk", label: "Desk" },
        { id: "member-ops", label: "Member ops", meta: memberRows.length },
        { id: "events", label: "Events", meta: eventRows.length },
        { id: "support", label: "Support", meta: model.conversations.length },
        { id: "reputation", label: "Reputation", meta: reportRows.length },
    ])}
        ${renderModePanel("internet", "desk", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Internet lane</p><h2>Support, events, reputation, and promises</h2></div></div>
              <div class="ops-scroll-stack">${internetTasks.map(renderTask).join("") || '<div class="ops-empty">No internet tasks are queued.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Reply pressure</p><h2>What needs eyes next</h2></div></div>
              <div class="ops-countdown-grid ops-countdown-grid-dual">${internetDeskCountdowns.join("")}</div>
              <div class="ops-relay-stack">
                ${renderTaskRelayCard(activeInternetTasks[0] ?? null, "Internet relay")}
                ${pendingApprovals[0] ? renderApprovalRelayCard(pendingApprovals[0]) : ""}
              </div>
            </div>
          </div>
        `)}
        ${renderModePanel("internet", "member-ops", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Member ops</p><h2>Profiles, memberships, and role context</h2></div></div>
              <div class="ops-scroll-stack">${memberCards || '<div class="ops-empty">No member rows are visible for this session.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Reservation bundles</p><h2>The member promises that need prep context</h2></div></div>
              <div class="ops-scroll-stack">${reservationCards || '<div class="ops-empty">No member arrival bundles are visible.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("internet", "events", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Events</p><h2>Programs, rosters, and review pressure</h2></div></div>
              <div class="ops-scroll-stack">${eventRows.map(renderEventCard).join("") || '<div class="ops-empty">No event work is visible right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Ask internet lane</p><h2>Draft and policy reasoning</h2></div></div>
              <form class="ops-chat-form" id="ops-internet-chat-form" data-surface-chat="internet">
                <textarea name="text" rows="5" placeholder="Ask the internet lane what reply is safe, or what needs approval."></textarea>
                <div class="ops-actions">
                  <button type="submit" class="ops-button">Ask internet lane</button>
                </div>
              </form>
            </div>
          </div>
        `)}
        ${renderModePanel("internet", "support", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Related cases</p><h2>Support, events, and reputation ledger</h2></div></div>
              <div class="ops-scroll-stack">${internetCases.map(renderCase).join("") || '<div class="ops-empty">No internet-related cases are active right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Conversations</p><h2>Explicit sender identity and thread memory</h2></div></div>
              <div class="ops-scroll-stack">${model.conversations.map(renderConversation).join("") || '<div class="ops-empty">No recent conversations.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("internet", "reputation", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Reputation</p><h2>Complaints, reports, and public trust</h2></div></div>
              <div class="ops-scroll-stack">${reportRows.map(renderReportCard).join("") || '<div class="ops-empty">No open reputation issues are visible.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Approvals and truth</p><h2>Guardrails on public action</h2></div></div>
              <div class="ops-stack">${pendingApprovals.slice(0, 3).map(renderApproval).join("") || '<div class="ops-empty">No approvals are queued.</div>'}</div>
            </div>
          </div>
        `)}
      </div>
    </section>

    <section class="ops-surface" data-surface="ceo">
      <div class="ops-manager-canvas">
        ${renderModeTabs("ceo", [
        { id: "portfolio", label: "Portfolio", meta: model.ceo.length },
        { id: "community", label: "Community", meta: eventRows.length },
        { id: "campaigns", label: "Campaigns", meta: reportRows.length },
    ])}
        ${renderModePanel("ceo", "portfolio", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">CEO mode</p><h2>Growth portfolio and safe experiments</h2></div></div>
              <p class="ops-summary">CEO mode is research-and-draft only for external impact. It keeps searching for safe ways to grow memberships, workshops, follow-up quality, and community leverage.</p>
              <div class="ops-stack">${ceoCards || '<div class="ops-empty">No growth experiments are active yet.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Growth telemetry</p><h2>Signals worth compounding</h2></div></div>
              <div class="ops-sequence-grid">
                ${renderSequenceStep(`Active experiments: ${model.ceo.length}`)}
                ${renderSequenceStep(`Upcoming programs: ${eventRows.length}`)}
                ${renderSequenceStep(`Reputation pressure points: ${reportRows.length}`)}
                ${renderSequenceStep(`Unread conversations: ${unreadConversations}`)}
              </div>
            </div>
          </div>
        `)}
        ${renderModePanel("ceo", "community", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Community presence</p><h2>Events, partnerships, and visible momentum</h2></div></div>
              <div class="ops-scroll-stack">${eventRows.map(renderEventCard).join("") || '<div class="ops-empty">No live community-facing events are visible right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Public trust</p><h2>Reputation and complaint pressure</h2></div></div>
              <div class="ops-scroll-stack">${reportRows.map(renderReportCard).join("") || '<div class="ops-empty">No trust threats are visible right now.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("ceo", "campaigns", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Campaign drafts</p><h2>Start a safe growth experiment</h2></div></div>
              <form class="ops-compose-form" id="ops-ceo-form">
                <input name="title" placeholder="New growth experiment title" />
                <textarea name="hypothesis" rows="3" placeholder="What should the studio try, and why would it matter?"></textarea>
                <div class="ops-actions"><button type="submit" class="ops-button">Create CEO experiment</button></div>
              </form>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Current thesis</p><h2>Why the studio should grow carefully</h2></div></div>
              <div class="ops-ribbon-stack">${model.truth.sources.slice(0, 4).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
            </div>
          </div>
        `)}
      </div>
    </section>

    <section class="ops-surface" data-surface="forge">
      <div class="ops-manager-canvas">
        ${renderModeTabs("forge", [
        { id: "lab", label: "Lab", meta: model.forge.length },
        { id: "policy-agent-ops", label: "Policy / agents", meta: pendingApprovals.length },
        { id: "telemetry", label: "Telemetry", meta: model.truth.sources.length },
        { id: "migration", label: "Migration", meta: reservationBundles.length + memberRows.length },
    ])}
        ${renderModePanel("forge", "lab", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Forge</p><h2>Internal toolsmithing and eval-backed self-improvement</h2></div></div>
              <p class="ops-summary">Forge can propose new primitives, adapters, eval bundles, and shadow runs, but nothing should go live without passing truth and rollback gates.</p>
              <div class="ops-stack">${forgeCards || '<div class="ops-empty">No improvement cases are tracked yet.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Open a lab case</p><h2>Capture a performance or trust gap</h2></div></div>
              <form class="ops-compose-form" id="ops-forge-form">
                <input name="title" placeholder="New improvement case title" />
                <textarea name="problem" rows="3" placeholder="What performance or trust gap should Forge solve?"></textarea>
                <div class="ops-actions"><button type="submit" class="ops-button">Create Forge case</button></div>
              </form>
            </div>
          </div>
        `)}
        ${renderModePanel("forge", "policy-agent-ops", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Approval policy</p><h2>Where agency boundaries are currently binding</h2></div></div>
              <div class="ops-stack">${pendingApprovals.map(renderApproval).join("") || '<div class="ops-empty">No approval gates are active right now.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Override receipts</p><h2>Manual fallbacks to learn from</h2></div></div>
              <div class="ops-scroll-stack">${overrideCards || '<div class="ops-empty">No override receipts are currently open.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("forge", "telemetry", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Telemetry ribbons</p><h2>Freshness, drift, and truth posture</h2></div></div>
              <div class="ops-ribbon-stack">${model.truth.sources.map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Watchdogs</p><h2>What would fail a clean autonomy claim</h2></div></div>
              <div class="ops-truth-grid">${renderWatchdogs(model.truth.watchdogs)}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("forge", "migration", `
          <div class="ops-layout">
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Migration posture</p><h2>Legacy parity surfaces now represented in /ops</h2></div></div>
              <div class="ops-sequence-grid">
                ${renderSequenceStep(`Member ops cards loaded: ${memberRows.length}`)}
                ${renderSequenceStep(`Reservation bundles loaded: ${reservationBundles.length}`)}
                ${renderSequenceStep(`Lending snapshot visible: ${model.lending ? "yes" : "no"}`)}
                ${renderSequenceStep(`Reports mirrored: ${reportRows.length}`)}
              </div>
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Cases touching migration</p><h2>Operational ledger that will replace the old board</h2></div></div>
              <div class="ops-scroll-stack">${model.cases.slice(0, 8).map(renderCase).join("") || '<div class="ops-empty">No migration-relevant cases are visible right now.</div>'}</div>
            </div>
          </div>
        `)}
      </div>
    </section>

  `;
}
function renderOpsPortalPage(model) {
    const initialJson = jsonScript(model);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Studio Brain Ops</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #061018;
        --ink: #eef5fb;
        --muted: #97acbd;
        --panel: rgba(9, 18, 29, 0.82);
        --line: rgba(126, 158, 184, 0.18);
        --shadow: 0 20px 50px rgba(0, 0, 0, 0.34);
        --good: #7be0b6;
        --good-bg: rgba(39, 117, 88, 0.18);
        --warn: #f2c66d;
        --warn-bg: rgba(142, 96, 24, 0.22);
        --danger: #ff8c7f;
        --danger-bg: rgba(132, 37, 25, 0.22);
        --neutral: #93a8ba;
        --neutral-bg: rgba(76, 97, 116, 0.18);
        --accent: #5aa9ff;
        --accent-2: #ef9d65;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Aptos", "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(90,169,255,0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(239,157,101,0.14), transparent 22%),
          linear-gradient(180deg, #08131d 0%, #09141f 48%, #071019 100%);
      }
      main { max-width: 1560px; margin: 0 auto; padding: 28px 24px 44px; }
      .ops-hero, .ops-panel, .ops-task-card, .ops-case, .ops-zone, .ops-watchdog, .ops-approval, .ops-conversation {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(8px);
      }
      .ops-hero {
        padding: 24px;
        display: grid;
        gap: 18px;
        margin-bottom: 18px;
      }
      .ops-hero h1 { margin: 0 0 6px; font-size: clamp(2rem, 2.8vw, 3.3rem); font-family: "Palatino Linotype", Georgia, serif; }
      .ops-hero p { margin: 0; color: var(--muted); }
      .ops-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .ops-kpi { padding: 16px; border-radius: 18px; border: 1px solid var(--line); background: rgba(255,255,255,0.62); }
      .ops-kpi span { display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .ops-kpi strong { display: block; margin-top: 10px; font-size: 1.55rem; }
      .ops-surface-nav { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
      .ops-surface-tab, .ops-button, .ops-chip {
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 10px 16px;
        background: rgba(38,77,125,0.10);
        color: var(--accent);
        cursor: pointer;
        font-weight: 700;
      }
      .ops-surface-tab.is-active, .ops-button { background: var(--accent); color: #f8f3ed; }
      .ops-button-secondary { background: rgba(123,75,40,0.12); color: var(--accent-2); border-color: rgba(123,75,40,0.16); }
      .ops-chip { background: rgba(255,255,255,0.72); color: var(--muted); border-color: var(--line); }
      .ops-surface { display: none; margin-bottom: 18px; }
      .ops-surface.is-active { display: block; }
      .ops-mode-nav {
        position: sticky;
        top: 12px;
        z-index: 6;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        padding: 10px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.78);
        box-shadow: 0 12px 28px rgba(62, 42, 22, 0.08);
        backdrop-filter: blur(10px);
      }
      .ops-mode-tab {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid rgba(49,39,31,0.12);
        background: rgba(255,255,255,0.74);
        color: var(--muted);
        cursor: pointer;
        font-weight: 700;
      }
      .ops-mode-tab strong {
        display: inline-flex;
        min-width: 24px;
        justify-content: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(38,77,125,0.10);
        color: var(--accent);
        font-size: 0.74rem;
      }
      .ops-mode-tab.is-active {
        background: var(--accent);
        color: #f8f3ed;
        border-color: rgba(38,77,125,0.25);
      }
      .ops-mode-tab.is-active strong {
        background: rgba(255,255,255,0.18);
        color: #f8f3ed;
      }
      .ops-mode-panel { display: none; }
      .ops-mode-panel.is-active { display: block; }
      .ops-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
      .ops-layout-hands { grid-template-columns: minmax(360px, 0.95fr) minmax(0, 1.05fr); }
      .ops-manager-canvas { display: grid; gap: 18px; }
      .ops-gauge-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
      .ops-motion-grid { display: grid; grid-template-columns: 1.1fr 1fr 0.95fr; gap: 18px; }
      .ops-motion-panel { min-height: 100%; }
      .ops-countdown-grid,
      .ops-relay-stack,
      .ops-ribbon-stack { display: grid; gap: 12px; }
      .ops-ticker-shell {
        position: relative;
        overflow: hidden;
        margin-top: 12px;
        border-radius: 18px;
        border: 1px solid rgba(49,39,31,0.12);
        background: linear-gradient(90deg, rgba(255,255,255,0.78), rgba(255,255,255,0.52));
      }
      .ops-ticker-shell::before,
      .ops-ticker-shell::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        width: 54px;
        pointer-events: none;
        z-index: 2;
      }
      .ops-ticker-shell::before {
        left: 0;
        background: linear-gradient(90deg, rgba(247,242,235,1), rgba(247,242,235,0));
      }
      .ops-ticker-shell::after {
        right: 0;
        background: linear-gradient(270deg, rgba(247,242,235,1), rgba(247,242,235,0));
      }
      .ops-ticker-track {
        display: flex;
        gap: 12px;
        width: max-content;
        padding: 12px;
        animation: ops-ticker-scroll 34s linear infinite;
      }
      .ops-ticker-shell:hover .ops-ticker-track { animation-play-state: paused; }
      .ops-ticker-item {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 320px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(255,255,255,0.76);
        border: 1px solid var(--line);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.6);
      }
      .ops-ticker-item__label {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(38,77,125,0.08);
        color: var(--muted);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .ops-ticker-item__text {
        font-size: 0.96rem;
        color: var(--ink);
        white-space: nowrap;
      }
      .ops-incident-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
      .ops-gauge-card,
      .ops-incident-chip,
      .ops-map-zone,
      .ops-spotlight-card,
      .ops-sequence-step {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.6);
      }
      .ops-gauge-card__row {
        display: grid;
        grid-template-columns: 128px minmax(0, 1fr);
        gap: 14px;
        align-items: center;
      }
      .ops-gauge-card__copy h3 {
        margin: 0 0 6px;
        font-size: 1.05rem;
      }
      .ops-gauge {
        position: relative;
        width: 128px;
        height: 128px;
        display: grid;
        place-items: center;
      }
      .ops-gauge__ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background:
          radial-gradient(circle at center, rgba(255,255,255,0.85) 0 50%, transparent 51%),
          conic-gradient(from -120deg, var(--gauge-color) 0deg var(--gauge-progress), rgba(49,39,31,0.08) var(--gauge-progress) 240deg, transparent 240deg 360deg);
        animation: ops-gauge-glow 2.8s ease-in-out infinite;
      }
      .ops-gauge__needle {
        position: absolute;
        bottom: 50%;
        left: 50%;
        width: 4px;
        height: 46px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(27,23,20,0.25), rgba(27,23,20,0.95));
        transform-origin: center bottom;
        transform: translateX(-50%) rotate(var(--gauge-needle));
        animation: ops-gauge-sweep 1.1s cubic-bezier(.2,.8,.2,1);
      }
      .ops-gauge__hub {
        position: absolute;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(27,23,20,0.92);
        box-shadow: 0 0 0 5px rgba(255,255,255,0.82);
      }
      .ops-gauge__readout {
        position: relative;
        margin-top: 48px;
        font-size: 1.45rem;
        font-weight: 700;
        font-family: "Palatino Linotype", Georgia, serif;
        text-transform: uppercase;
        color: var(--ink);
      }
      .ops-incident-chip {
        display: grid;
        align-content: start;
        gap: 8px;
        animation: ops-card-float 5.2s ease-in-out infinite;
      }
      .ops-incident-chip__label {
        display: inline-flex;
        width: fit-content;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.75);
        border: 1px solid var(--line);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .ops-incident-chip p { margin: 0; color: var(--ink); line-height: 1.4; }
      .ops-countdown-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .ops-countdown-grid-dual { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ops-countdown-card {
        display: grid;
        grid-template-columns: 104px minmax(0, 1fr);
        gap: 14px;
        align-items: center;
        padding: 14px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.6);
      }
      .ops-countdown-card__dial {
        position: relative;
        width: 104px;
        height: 104px;
        display: grid;
        place-items: center;
      }
      .ops-countdown-card__ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background:
          radial-gradient(circle at center, rgba(255,255,255,0.9) 0 56%, transparent 57%),
          conic-gradient(from -90deg, var(--countdown-color) 0deg var(--countdown-progress), rgba(49,39,31,0.08) var(--countdown-progress) 360deg);
        animation: ops-orbit-breathe 3.2s ease-in-out infinite;
      }
      .ops-countdown-card__ring::after {
        content: "";
        position: absolute;
        inset: 8px;
        border-radius: 50%;
        border: 1px dashed rgba(49,39,31,0.12);
        animation: ops-countdown-spin 12s linear infinite;
      }
      .ops-countdown-card__core {
        position: relative;
        display: grid;
        text-align: center;
        gap: 2px;
      }
      .ops-countdown-card__core strong {
        font-size: 1.2rem;
        font-family: "Palatino Linotype", Georgia, serif;
      }
      .ops-countdown-card__core span {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .ops-countdown-card__copy h3 { margin: 0 0 6px; font-size: 1rem; }
      .ops-flow-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.6);
      }
      .ops-flow-card h3 { margin: 0 0 6px; }
      .ops-relay {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 14px;
        position: relative;
      }
      .ops-relay::before {
        content: "";
        position: absolute;
        left: calc(16.66% + 12px);
        right: calc(16.66% + 12px);
        top: 14px;
        height: 4px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(38,77,125,0.2), rgba(123,75,40,0.2));
      }
      .ops-relay-compact { margin-top: 0; }
      .ops-relay__stage {
        position: relative;
        display: grid;
        gap: 8px;
        justify-items: center;
        text-align: center;
        z-index: 1;
      }
      .ops-relay__node {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255,255,255,0.9);
        border: 2px solid rgba(49,39,31,0.18);
        box-shadow: 0 0 0 8px rgba(255,255,255,0.58);
      }
      .ops-relay__label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .ops-relay__stage-done .ops-relay__node {
        background: var(--accent);
        border-color: rgba(38,77,125,0.24);
      }
      .ops-relay__stage-active .ops-relay__node {
        background: var(--accent-2);
        border-color: rgba(123,75,40,0.28);
        animation: ops-relay-pulse 1.8s ease-in-out infinite;
      }
      .ops-relay__stage-queued .ops-relay__node {
        background: rgba(255,255,255,0.96);
      }
      .ops-source-ribbon {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.58);
      }
      .ops-source-ribbon__head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: baseline;
        margin-bottom: 8px;
      }
      .ops-source-ribbon__head span {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .ops-source-ribbon__track {
        position: relative;
        height: 12px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(49,39,31,0.08);
      }
      .ops-source-ribbon__fill {
        position: relative;
        height: 100%;
        border-radius: 999px;
        overflow: hidden;
      }
      .ops-source-ribbon__fill::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.42), transparent);
        animation: ops-ribbon-shimmer 2.6s linear infinite;
      }
      .ops-source-ribbon__fill-good { background: linear-gradient(90deg, #2e8d73, #245c4d); }
      .ops-source-ribbon__fill-warn { background: linear-gradient(90deg, #d5a443, #9a6d12); }
      .ops-source-ribbon__fill-danger { background: linear-gradient(90deg, #cf6a54, #9f3d2d); }
      .ops-source-ribbon__fill-neutral { background: linear-gradient(90deg, #8fa0b1, #4f5a67); }
      .ops-scan-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(360px, 0.9fr); gap: 18px; }
      .ops-studio-map {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 12px;
      }
      .ops-map-zone {
        min-height: 210px;
        display: grid;
        align-content: start;
      }
      .ops-map-zone-0 { grid-column: span 7; }
      .ops-map-zone-1 { grid-column: span 5; }
      .ops-map-zone-2 { grid-column: span 5; }
      .ops-map-zone-3 { grid-column: span 7; }
      .ops-map-zone__head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      .ops-map-zone__sentinel {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border-radius: 50%;
      }
      .ops-map-zone__sentinel::before {
        content: "";
        position: absolute;
        inset: 4px;
        border-radius: 50%;
        border: 1px solid currentColor;
        opacity: 0.28;
      }
      .ops-map-zone__sentinel-good { color: var(--good); }
      .ops-map-zone__sentinel-warn { color: var(--warn); }
      .ops-map-zone__sentinel-danger { color: var(--danger); }
      .ops-map-zone__sentinel-neutral { color: var(--neutral); }
      .ops-map-zone__sentinel::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1px solid currentColor;
        opacity: 0.18;
        animation: ops-halo-pulse 2.8s ease-in-out infinite;
      }
      .ops-map-zone__status {
        display: inline-flex;
        width: 14px;
        height: 14px;
        border-radius: 999px;
        box-shadow: 0 0 0 6px rgba(255,255,255,0.85);
        animation: ops-pulse-dot 2.4s ease-in-out infinite;
      }
      .ops-map-zone__status-good { background: var(--good); }
      .ops-map-zone__status-warn { background: var(--warn); }
      .ops-map-zone__status-danger { background: var(--danger); }
      .ops-map-zone__status-neutral { background: var(--neutral); }
      .ops-zone-ribbon {
        display: flex;
        gap: 6px;
        margin-top: 12px;
        min-height: 10px;
      }
      .ops-zone-ribbon__segment {
        flex: 1 1 0;
        min-width: 16px;
        height: 10px;
        border-radius: 999px;
        opacity: 0.9;
        animation: ops-ribbon-breathe 2.8s ease-in-out infinite;
      }
      .ops-zone-ribbon__segment-good { background: linear-gradient(90deg, #2e8d73, #245c4d); }
      .ops-zone-ribbon__segment-warn { background: linear-gradient(90deg, #d5a443, #9a6d12); }
      .ops-zone-ribbon__segment-danger { background: linear-gradient(90deg, #cf6a54, #9f3d2d); }
      .ops-zone-ribbon__segment-neutral { background: linear-gradient(90deg, #8fa0b1, #4f5a67); }
      .ops-map-zone__next { margin: 12px 0 0; color: var(--muted); }
      .ops-timeline {
        display: grid;
        gap: 12px;
        position: relative;
      }
      .ops-timeline-entry {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        gap: 12px;
        padding: 14px 0 14px 14px;
        border-left: 3px solid rgba(49,39,31,0.12);
      }
      .ops-timeline-entry__time {
        font-size: 0.8rem;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding-top: 2px;
      }
      .ops-timeline-entry__head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .ops-timeline-entry__countdown {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        background: rgba(255,255,255,0.8);
        border: 1px solid currentColor;
      }
      .ops-timeline-entry__countdown-good { color: var(--good); }
      .ops-timeline-entry__countdown-warn { color: var(--warn); }
      .ops-timeline-entry__countdown-danger { color: var(--danger); }
      .ops-timeline-entry__countdown-neutral { color: var(--neutral); }
      .ops-timeline-entry__body h4 {
        margin: 0 0 4px;
        font-size: 1rem;
      }
      .ops-timeline-entry__body p:last-child { margin: 0; color: var(--muted); }
      .ops-conveyor {
        position: relative;
        display: flex;
        gap: 8px;
        margin-top: 10px;
        overflow: hidden;
      }
      .ops-conveyor span {
        display: inline-flex;
        width: 28px;
        height: 6px;
        border-radius: 999px;
        opacity: 0.55;
        transform: translateX(0);
        animation: ops-conveyor-flow 2.2s linear infinite;
      }
      .ops-conveyor span:nth-child(2) { animation-delay: 0.24s; }
      .ops-conveyor span:nth-child(3) { animation-delay: 0.48s; }
      .ops-conveyor-good span { background: linear-gradient(90deg, #2e8d73, #245c4d); }
      .ops-conveyor-warn span { background: linear-gradient(90deg, #d5a443, #9a6d12); }
      .ops-conveyor-danger span { background: linear-gradient(90deg, #cf6a54, #9f3d2d); }
      .ops-conveyor-neutral span { background: linear-gradient(90deg, #8fa0b1, #4f5a67); }
      .ops-command-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
      .ops-detail-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
      .ops-sequence-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
      .ops-sequence-step {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .ops-sequence-step__index {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border-radius: 999px;
        background: rgba(38,77,125,0.12);
        color: var(--accent);
        font-weight: 700;
      }
      .ops-sequence-step p { margin: 0; color: var(--muted); }
      .ops-spotlight-signal-row {
        display: grid;
        grid-template-columns: 96px minmax(0, 1fr);
        gap: 14px;
        align-items: center;
        margin-top: 12px;
      }
      .ops-spotlight-orb {
        position: relative;
        width: 96px;
        height: 96px;
        display: grid;
        place-items: center;
      }
      .ops-spotlight-orb__ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background:
          radial-gradient(circle at center, rgba(255,255,255,0.9) 0 56%, transparent 57%),
          conic-gradient(from -90deg, var(--countdown-color) 0deg var(--countdown-progress), rgba(49,39,31,0.08) var(--countdown-progress) 360deg);
        animation: ops-orbit-breathe 3.1s ease-in-out infinite;
      }
      .ops-spotlight-orb__core {
        position: relative;
        display: grid;
        text-align: center;
        gap: 2px;
      }
      .ops-spotlight-orb__core strong { font-size: 1rem; }
      .ops-spotlight-orb__core span {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .ops-inline-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
        margin: 12px 0 0;
      }
      .ops-inline-meta dt {
        font-size: 0.73rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .ops-inline-meta dd { margin: 4px 0 0; }
      .ops-meter { display: grid; gap: 6px; margin-top: 10px; }
      .ops-meter span {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
      }
      .ops-meter__track {
        height: 9px;
        border-radius: 999px;
        background: rgba(49,39,31,0.08);
        overflow: hidden;
      }
      .ops-meter__fill {
        height: 100%;
        border-radius: 999px;
        animation: ops-meter-breathe 2.8s ease-in-out infinite;
      }
      .ops-meter__fill-good { background: linear-gradient(90deg, #2e8d73, #245c4d); }
      .ops-meter__fill-warn { background: linear-gradient(90deg, #d5a443, #9a6d12); }
      .ops-meter__fill-danger { background: linear-gradient(90deg, #cf6a54, #9f3d2d); }
      .ops-meter__fill-neutral { background: linear-gradient(90deg, #8fa0b1, #4f5a67); }
      .ops-bottom-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; margin-top: 18px; }
      .ops-scroll-stack {
        display: grid;
        gap: 12px;
        max-height: min(72vh, 1080px);
        overflow: auto;
        padding-right: 4px;
      }
      .ops-station-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.58);
      }
      .ops-station-card h3 { margin: 0; }
      .ops-panel { padding: 18px; }
      .ops-panel__head, .ops-zone__head, .ops-task-card__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .ops-panel h2, .ops-zone h3, .ops-task-card h3, .ops-case h3, .ops-approval h3 { margin: 0; }
      .ops-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; color: var(--muted); }
      .ops-summary, .ops-meta { color: var(--muted); }
      .ops-zone-grid, .ops-stack, .ops-truth-grid { display: grid; gap: 12px; }
      .ops-zone-grid { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); margin-top: 14px; }
      .ops-task-card, .ops-zone, .ops-case, .ops-watchdog, .ops-approval, .ops-conversation { padding: 16px; }
      .ops-task-grid, .ops-meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin: 14px 0 0; }
      .ops-task-grid dt, .ops-meta-grid dt { font-size: 0.77rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
      .ops-task-grid dd, .ops-meta-grid dd { margin: 4px 0 0; }
      .ops-span-2 { grid-column: 1 / -1; }
      .ops-subpanel { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
      .ops-actions, .ops-chip-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      .ops-pill {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(79,90,103,0.10);
        color: var(--neutral);
        border: 1px solid rgba(79,90,103,0.15);
        font-size: 0.82rem;
        font-weight: 700;
      }
      .ops-pill-good, .ops-tone-good { border-color: rgba(36,92,77,0.18); }
      .ops-pill-good { background: var(--good-bg); color: var(--good); }
      .ops-pill-warn, .ops-tone-warn { border-color: rgba(154,109,18,0.18); }
      .ops-pill-warn { background: var(--warn-bg); color: var(--warn); }
      .ops-pill-danger, .ops-tone-danger { border-color: rgba(159,61,45,0.18); }
      .ops-pill-danger { background: var(--danger-bg); color: var(--danger); }
      .ops-task-card__badges { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
      .ops-chat-feed {
        border-radius: 18px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.5);
        padding: 14px;
        min-height: 120px;
        max-height: 340px;
        overflow: auto;
      }
      .ops-chat-message { max-width: 92%; padding: 12px 14px; border-radius: 18px; margin-bottom: 10px; }
      .ops-chat-message-user { margin-left: auto; background: rgba(38,77,125,0.10); }
      .ops-chat-message-assistant { margin-right: auto; background: rgba(255,255,255,0.8); }
      .ops-chat-form, .ops-compose-form { display: grid; gap: 10px; margin-top: 14px; }
      textarea, input {
        width: 100%;
        border: 1px solid rgba(49,39,31,0.18);
        border-radius: 16px;
        padding: 12px 14px;
        font: inherit;
        color: var(--ink);
        background: rgba(255,255,255,0.84);
      }
      .ops-empty {
        padding: 18px;
        border: 1px dashed var(--line);
        border-radius: 18px;
        color: var(--muted);
        background: rgba(255,255,255,0.42);
      }
      .ops-banner {
        margin-bottom: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.68);
        display: none;
      }
      .ops-banner.is-visible { display: block; }
      .ops-banner-success { border-color: rgba(36,92,77,0.22); color: var(--good); }
      .ops-banner-error { border-color: rgba(159,61,45,0.24); color: var(--danger); }
      .ops-truth-grid { margin-top: 14px; }
      @keyframes ops-ticker-scroll {
        from { transform: translateX(0); }
        to { transform: translateX(-50%); }
      }
      @keyframes ops-gauge-sweep {
        from { transform: translateX(-50%) rotate(-132deg); }
        to { transform: translateX(-50%) rotate(var(--gauge-needle)); }
      }
      @keyframes ops-gauge-glow {
        0%, 100% { filter: saturate(0.96) brightness(0.98); }
        50% { filter: saturate(1.12) brightness(1.04); }
      }
      @keyframes ops-pulse-dot {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.18); opacity: 0.72; }
      }
      @keyframes ops-meter-breathe {
        0%, 100% { filter: saturate(1); }
        50% { filter: saturate(1.18) brightness(1.02); }
      }
      @keyframes ops-card-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
      }
      @keyframes ops-countdown-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes ops-orbit-breathe {
        0%, 100% { filter: saturate(1) brightness(1); transform: scale(1); }
        50% { filter: saturate(1.14) brightness(1.03); transform: scale(1.02); }
      }
      @keyframes ops-relay-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(123,75,40,0.24), 0 0 0 8px rgba(255,255,255,0.58); }
        50% { box-shadow: 0 0 0 8px rgba(123,75,40,0.06), 0 0 0 10px rgba(255,255,255,0.7); }
      }
      @keyframes ops-ribbon-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(220%); }
      }
      @keyframes ops-ribbon-breathe {
        0%, 100% { opacity: 0.78; transform: translateY(0); }
        50% { opacity: 1; transform: translateY(-1px); }
      }
      @keyframes ops-halo-pulse {
        0%, 100% { transform: scale(0.92); opacity: 0.14; }
        50% { transform: scale(1.18); opacity: 0.28; }
      }
      @keyframes ops-conveyor-flow {
        0% { transform: translateX(-4px); opacity: 0.28; }
        50% { opacity: 0.92; }
        100% { transform: translateX(16px); opacity: 0.28; }
      }
      ul, ol { margin: 0; padding-left: 18px; }
      li { margin: 6px 0; }
      @media (max-width: 1280px) {
        .ops-kpi-grid, .ops-gauge-strip, .ops-incident-strip, .ops-sequence-grid, .ops-countdown-grid, .ops-countdown-grid-dual { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ops-scan-grid, .ops-detail-grid, .ops-command-grid, .ops-motion-grid { grid-template-columns: 1fr; }
      }
      @media (max-width: 1100px) {
        .ops-layout, .ops-layout-hands, .ops-bottom-grid, .ops-scan-grid, .ops-detail-grid, .ops-command-grid, .ops-gauge-strip, .ops-incident-strip, .ops-sequence-grid, .ops-motion-grid, .ops-countdown-grid, .ops-countdown-grid-dual { grid-template-columns: 1fr; }
        .ops-studio-map { grid-template-columns: 1fr; }
        .ops-map-zone-0, .ops-map-zone-1, .ops-map-zone-2, .ops-map-zone-3 { grid-column: span 1; }
        .ops-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ops-mode-nav { top: 8px; }
      }
      @media (max-width: 720px) {
        .ops-kpi-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="ops-hero">
        <div>
          <p class="ops-kicker">Studio Brain Autonomous Studio OS</p>
          <h1>${esc(model.snapshot.twin.headline)}</h1>
          <p>${esc(model.snapshot.twin.narrative)}</p>
          <p class="ops-meta" style="margin-top:10px;">Generated ${esc(formatTimestamp(model.snapshot.generatedAt))} · Truth ${esc(model.snapshot.truth.readiness)} · Current risk ${esc(model.snapshot.twin.currentRisk || "none surfaced")}</p>
        </div>
        <div class="ops-kpi-grid">
          <article class="ops-kpi"><span>Tasks</span><strong>${esc(model.snapshot.tasks.length)}</strong></article>
          <article class="ops-kpi"><span>Cases</span><strong>${esc(model.snapshot.cases.length)}</strong></article>
          <article class="ops-kpi"><span>Approvals</span><strong>${esc(model.snapshot.approvals.filter((entry) => entry.status === "pending").length)}</strong></article>
          <article class="ops-kpi"><span>Growth / Forge</span><strong>${esc(model.snapshot.ceo.length + model.snapshot.forge.length)}</strong></article>
        </div>
      </header>

      <div class="ops-banner" id="ops-banner"></div>
      ${renderSurfaceShell(model.snapshot, model.displayState)}
    </main>
    <script id="ops-portal-model" type="application/json">${initialJson}</script>
    <script>
      const pageModel = JSON.parse(document.getElementById("ops-portal-model").textContent || "{}");
      const banner = document.getElementById("ops-banner");

      function showBanner(text, tone) {
        banner.textContent = text;
        banner.className = "ops-banner is-visible " + (tone === "error" ? "ops-banner-error" : "ops-banner-success");
      }

      const defaultModes = {
        manager: "overview",
        owner: "brief",
        hands: "now",
        internet: "desk",
        ceo: "portfolio",
        forge: "lab",
      };
      const activeModes = { ...defaultModes };

      function syncOpsUrl(surface) {
        if (
          !window.location
          || window.location.protocol === "about:"
          || String(window.location.href || "").startsWith("about:srcdoc")
        ) {
          return;
        }
        const params = new URLSearchParams(window.location.search);
        params.set("surface", surface);
        const mode = activeModes[surface];
        if (mode) {
          params.set("mode", mode);
        } else {
          params.delete("mode");
        }
        const nextUrl = window.location.pathname + "?" + params.toString();
        try {
          window.history.replaceState({}, "", nextUrl);
        } catch {
          // Ignore history sync when the surface is hosted through a bridge document.
        }
      }

      function setSurfaceMode(surface, mode, shouldSync = true) {
        activeModes[surface] = mode;
        document.querySelectorAll("[data-surface-mode-panel]").forEach((panel) => {
          panel.classList.toggle(
            "is-active",
            panel.getAttribute("data-surface-mode-panel") === surface && panel.getAttribute("data-mode") === mode,
          );
        });
        document.querySelectorAll("[data-surface-mode-tab]").forEach((button) => {
          button.classList.toggle(
            "is-active",
            button.getAttribute("data-surface-mode-tab") === surface && button.getAttribute("data-mode-tab") === mode,
          );
        });
        if (shouldSync) {
          syncOpsUrl(surface);
        }
      }

      function setSurface(surface) {
        document.querySelectorAll("[data-surface]").forEach((section) => {
          section.classList.toggle("is-active", section.getAttribute("data-surface") === surface);
        });
        document.querySelectorAll("[data-surface-tab]").forEach((button) => {
          button.classList.toggle("is-active", button.getAttribute("data-surface-tab") === surface);
        });
        setSurfaceMode(surface, activeModes[surface] || defaultModes[surface] || "overview", false);
        syncOpsUrl(surface);
      }

      async function getJson(url) {
        const headers = {};
        if (pageModel.sessionToken) {
          headers["x-studio-brain-ops-session"] = pageModel.sessionToken;
        }
        const response = await fetch(url, {
          method: "GET",
          credentials: "same-origin",
          headers,
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        if (!response.ok || !payload || payload.ok !== true) {
          throw new Error(payload && payload.message ? payload.message : "Request failed.");
        }
        return payload;
      }

      async function postJson(url, body) {
        const headers = { "content-type": "application/json" };
        if (pageModel.sessionToken) {
          headers["x-studio-brain-ops-session"] = pageModel.sessionToken;
        }
        const response = await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers,
          body: JSON.stringify(body),
        });
        let payload = null;
        try {
          payload = await response.json();
        } catch {}
        if (!response.ok || !payload || payload.ok !== true) {
          throw new Error(payload && payload.message ? payload.message : "Request failed.");
        }
        return payload;
      }

      document.querySelectorAll("[data-surface-tab]").forEach((button) => {
        button.addEventListener("click", () => setSurface(button.getAttribute("data-surface-tab")));
      });
      document.querySelectorAll("[data-surface-mode-tab]").forEach((button) => {
        button.addEventListener("click", () => {
          const surface = button.getAttribute("data-surface-mode-tab");
          const mode = button.getAttribute("data-mode-tab");
          if (!surface || !mode) return;
          setSurfaceMode(surface, mode);
        });
      });
      const params = new URLSearchParams(window.location.search);
      const visibleSurfaces = Array.from(document.querySelectorAll("[data-surface]"))
        .map((section) => section.getAttribute("data-surface"))
        .filter(Boolean);
      const requestedSurface = params.get("surface") || pageModel.surface || visibleSurfaces[0] || "manager";
      const requestedMode = params.get("mode");
      if (requestedMode) {
        activeModes[requestedSurface] = requestedMode;
      }
      setSurface(visibleSurfaces.includes(requestedSurface) ? requestedSurface : (visibleSurfaces[0] || "manager"));

      document.querySelectorAll("[data-task-claim]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await postJson("/api/ops/tasks/" + encodeURIComponent(button.getAttribute("data-task-claim")) + "/claim", { actorId: "staff:local-portal" });
            showBanner("Task claimed. Refresh to see the updated assignment state.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-task-proof]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await postJson("/api/ops/tasks/" + encodeURIComponent(button.getAttribute("data-task-proof")) + "/proof", {
              actorId: "staff:local-portal",
              mode: button.getAttribute("data-task-proof-mode"),
              note: "Proof submitted from the Studio Brain portal.",
              artifactRefs: [],
            });
            showBanner("Proof submitted. Refresh to verify the updated task state.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-task-complete]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await postJson("/api/ops/tasks/" + encodeURIComponent(button.getAttribute("data-task-complete")) + "/complete", { actorId: "staff:local-portal" });
            showBanner("Task completion recorded. If proof is still pending, the truth rail will keep it visibly unverified.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-task-escape]").forEach((button) => {
        button.addEventListener("click", async () => {
          const taskId = button.getAttribute("data-task-id");
          const hatch = button.getAttribute("data-task-escape");
          const reason = window.prompt("Tell the manager why this task needs a different path.", "");
          if (reason === null) return;
          try {
            await postJson("/api/ops/tasks/" + encodeURIComponent(taskId) + "/escape", {
              actorId: "staff:local-portal",
              escapeHatch: hatch,
              reason,
            });
            showBanner("The manager now sees this task as blocked and routed for reconciliation.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-reservation-prepare]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await postJson("/api/ops/reservations/" + encodeURIComponent(button.getAttribute("data-reservation-prepare")) + "/prepare", {
              actorId: "staff:local-portal",
            });
            showBanner("Prep task is staged for that reservation bundle. Refresh to see it in the queue.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-member-activity]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            const payload = await getJson("/api/ops/members/" + encodeURIComponent(button.getAttribute("data-member-activity")) + "/activity");
            const activity = payload.activity || {};
            showBanner(
              (button.getAttribute("data-member-name") || "Member")
                + ": "
                + (activity.reservations || 0)
                + " reservations, "
                + (activity.events || 0)
                + " upcoming events, "
                + (activity.supportThreads || 0)
                + " support threads, "
                + (activity.libraryLoans || 0)
                + " library loans.",
              "success",
            );
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-member-profile]").forEach((button) => {
        button.addEventListener("click", async () => {
          const uid = button.getAttribute("data-member-profile");
          const displayName = window.prompt("Display name", button.getAttribute("data-member-display-name") || "");
          if (displayName === null) return;
          const kilnPreferences = window.prompt("Kiln preferences", button.getAttribute("data-member-kiln-preferences") || "");
          if (kilnPreferences === null) return;
          const staffNotes = window.prompt("Staff notes", button.getAttribute("data-member-staff-notes") || "");
          if (staffNotes === null) return;
          try {
            await postJson("/api/ops/members/" + encodeURIComponent(uid) + "/profile", {
              reason: "Edited from the autonomous ops portal.",
              patch: {
                displayName,
                kilnPreferences,
                staffNotes,
              },
            });
            showBanner("Member profile updated. Refresh to see the new values.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-member-membership]").forEach((button) => {
        button.addEventListener("click", async () => {
          const uid = button.getAttribute("data-member-membership");
          const membershipTier = window.prompt("Membership tier", button.getAttribute("data-member-membership-tier") || "");
          if (membershipTier === null) return;
          try {
            await postJson("/api/ops/members/" + encodeURIComponent(uid) + "/membership", {
              membershipTier,
              reason: "Updated from the autonomous ops portal.",
            });
            showBanner("Membership updated. Refresh to see the new tier.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-member-role]").forEach((button) => {
        button.addEventListener("click", async () => {
          const uid = button.getAttribute("data-member-role");
          const rolesInput = window.prompt("Comma-separated ops roles", button.getAttribute("data-member-roles") || "");
          if (rolesInput === null) return;
          const opsRoles = rolesInput
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          try {
            await postJson("/api/ops/members/" + encodeURIComponent(uid) + "/role", {
              opsRoles,
              reason: "Updated from the autonomous ops portal.",
            });
            showBanner("Role assignment updated. Refresh to see the new capability mask.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-approval-resolve]").forEach((button) => {
        button.addEventListener("click", async () => {
          try {
            await postJson("/api/ops/approvals/" + encodeURIComponent(button.getAttribute("data-approval-resolve")) + "/resolve", {
              actorId: "staff:local-portal",
              status: button.getAttribute("data-approval-status"),
            });
            showBanner("Approval decision recorded. Refresh to see the new state.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-case-note]").forEach((button) => {
        button.addEventListener("click", async () => {
          const body = window.prompt("Add a case note");
          if (!body) return;
          try {
            await postJson("/api/ops/cases/" + encodeURIComponent(button.getAttribute("data-case-note")) + "/note", {
              actorId: "staff:local-portal",
              body,
            });
            showBanner("Case note recorded. Refresh to see it in the ledger.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      document.querySelectorAll("[data-surface-chat]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const surface = form.getAttribute("data-surface-chat");
          const field = form.querySelector("textarea");
          const text = field && field.value ? field.value.trim() : "";
          if (!text) return;
          try {
            const payload = await postJson("/api/ops/chat/" + encodeURIComponent(surface) + "/send", { actorId: "staff:local-portal", text });
            const feed = surface === "manager" ? document.getElementById("ops-chat-feed") : null;
            if (feed) {
              const user = document.createElement("article");
              user.className = "ops-chat-message ops-chat-message-user";
              user.innerHTML = "<p>" + text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + "</p>";
              const assistant = document.createElement("article");
              assistant.className = "ops-chat-message ops-chat-message-assistant";
              assistant.innerHTML = "<p>" + String(payload.reply || "").replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + "</p>";
              feed.appendChild(user);
              feed.appendChild(assistant);
              feed.scrollTop = feed.scrollHeight;
            }
            field.value = "";
            showBanner("Manager reply received.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      });
      const ceoForm = document.getElementById("ops-ceo-form");
      if (ceoForm) {
        ceoForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const title = ceoForm.querySelector("input[name='title']").value.trim();
          const hypothesis = ceoForm.querySelector("textarea[name='hypothesis']").value.trim();
          if (!title || !hypothesis) return;
          try {
            await postJson("/api/ops/ceo/experiments", { title, hypothesis });
            showBanner("CEO experiment added. Refresh to review it in strategy mode.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      }
      const forgeForm = document.getElementById("ops-forge-form");
      if (forgeForm) {
        forgeForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const title = forgeForm.querySelector("input[name='title']").value.trim();
          const problem = forgeForm.querySelector("textarea[name='problem']").value.trim();
          if (!title || !problem) return;
          try {
            await postJson("/api/ops/forge/improvement-cases", { title, problem });
            showBanner("Forge case added. Refresh to track the improvement work.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      }
      const overrideForm = document.getElementById("ops-override-form");
      if (overrideForm) {
        overrideForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const scope = overrideForm.querySelector("input[name='scope']").value.trim();
          const reason = overrideForm.querySelector("textarea[name='reason']").value.trim();
          const expiresAt = overrideForm.querySelector("input[name='expiresAt']").value.trim();
          if (!scope || !reason) return;
          try {
            await postJson("/api/ops/overrides", {
              scope,
              reason,
              expiresAt: expiresAt || null,
            });
            showBanner("Override request recorded. The truth rail will keep it visible until resolved.", "success");
          } catch (error) {
            showBanner(error instanceof Error ? error.message : String(error), "error");
          }
        });
      }
    </script>
  </body>
</html>`;
}
function renderOpsPortalChoicePage(input) {
    const legacyCard = input.legacyUrl
        ? `
      <a class="ops-choice-card ops-choice-card-legacy" href="${esc(input.legacyUrl)}">
        <p class="ops-kicker">A · Original portal</p>
        <h2>Legacy staff experience</h2>
        <p>Use the current portal flow as the control during the trial.</p>
        <span>Open original</span>
      </a>
    `
        : `
      <article class="ops-choice-card ops-choice-card-disabled">
        <p class="ops-kicker">A · Original portal</p>
        <h2>Legacy staff experience</h2>
        <p>No legacy comparison URL is configured yet.</p>
        <span>Unavailable</span>
      </article>
    `;
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Studio Brain Ops Choice</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #061018;
        --ink: #eef5fb;
        --muted: #97acbd;
        --panel: rgba(9,18,29,0.84);
        --line: rgba(126,158,184,0.18);
        --shadow: 0 20px 50px rgba(0, 0, 0, 0.34);
        --accent: #5aa9ff;
        --accent-2: #ef9d65;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Aptos", "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(90,169,255,0.16), transparent 28%),
          radial-gradient(circle at top right, rgba(239,157,101,0.14), transparent 22%),
          linear-gradient(180deg, #08131d 0%, #09141f 48%, #071019 100%);
      }
      main { max-width: 1240px; margin: 0 auto; padding: 36px 24px 48px; display: grid; gap: 20px; }
      .ops-choice-hero,
      .ops-choice-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 28px;
        box-shadow: var(--shadow);
        backdrop-filter: blur(8px);
      }
      .ops-choice-hero { padding: 28px; display: grid; gap: 14px; }
      .ops-choice-hero h1 { margin: 0; font-size: clamp(2.2rem, 4vw, 4rem); font-family: "Palatino Linotype", Georgia, serif; }
      .ops-choice-hero p { margin: 0; color: var(--muted); }
      .ops-kicker {
        margin: 0;
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .ops-choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
      .ops-choice-card {
        display: grid;
        gap: 14px;
        padding: 24px;
        color: inherit;
        text-decoration: none;
      }
      .ops-choice-card h2 { margin: 0; font-size: 1.6rem; }
      .ops-choice-card p { margin: 0; color: var(--muted); line-height: 1.5; }
      .ops-choice-card span {
        display: inline-flex;
        width: fit-content;
        margin-top: 8px;
        padding: 10px 16px;
        border-radius: 999px;
        font-weight: 700;
        background: rgba(38,77,125,0.12);
        color: var(--accent);
      }
      .ops-choice-card-legacy span { background: rgba(123,75,40,0.14); color: var(--accent-2); }
      .ops-choice-card-disabled { opacity: 0.72; }
      .ops-choice-notes {
        padding: 18px 22px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: rgba(255,255,255,0.66);
      }
      .ops-choice-notes p { margin: 0; color: var(--muted); }
      @media (max-width: 900px) {
        .ops-choice-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="ops-choice-hero">
        <p class="ops-kicker">Studio Brain side-by-side trial</p>
        <h1>${esc(input.headline)}</h1>
        <p>${esc(input.narrative)}</p>
        <p>Generated ${esc(formatTimestamp(input.generatedAt))}. Use this page to choose between the original staff portal and the new autonomous ops portal during the production trial.</p>
      </section>
      <section class="ops-choice-grid">
        ${legacyCard}
        <a class="ops-choice-card" href="${esc(input.opsUrl)}">
          <p class="ops-kicker">B · Autonomous Studio OS</p>
          <h2>New ops portal</h2>
          <p>Open the new motion-heavy, role-based operating system alongside the legacy portal.</p>
          <span>Open autonomous ops</span>
        </a>
      </section>
      <section class="ops-choice-notes">
        <p>Recommendation: keep both live during the trial, make the human choice explicit, and tear down the loser only after task completion confidence and operator preference are both clear.</p>
      </section>
    </main>
  </body>
</html>`;
}
