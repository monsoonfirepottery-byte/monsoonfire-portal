import type {
  ApprovalItem,
  GrowthExperiment,
  HumanTaskRecord,
  ImprovementCase,
  OpsCaseRecord,
  OpsConversationThreadRecord,
  OpsPortalSnapshot,
  OpsSourceFreshness,
  OpsTwinZone,
  OpsWatchdog,
  StationDisplayState,
} from "../contracts";
import type { OpsPortalPageModel } from "./contracts";

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function formatTimestamp(value: string | null): string {
  if (!value) return "unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatConfidence(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesUntil(value: string | null): number | null {
  const parsed = parseTimestamp(value);
  if (parsed === null) return null;
  return Math.round((parsed - Date.now()) / 60000);
}

function formatCountdown(minutes: number | null): string {
  if (minutes === null) return "live";
  if (minutes <= 0) return `${Math.abs(minutes)}m late`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function countdownPercent(minutes: number | null, horizonMinutes: number): number {
  if (minutes === null) return 52;
  const bounded = Math.max(0, Math.min(horizonMinutes, minutes));
  return Math.round((1 - bounded / horizonMinutes) * 100);
}

function freshnessPercent(freshnessSeconds: number | null, budgetSeconds: number): number {
  if (freshnessSeconds === null || budgetSeconds <= 0) return 26;
  const bounded = Math.max(0, Math.min(budgetSeconds, freshnessSeconds));
  return Math.round((1 - bounded / budgetSeconds) * 100);
}

function statusTone(status: string): string {
  if (status === "healthy" || status === "ready" || status === "verified" || status === "approved") return "good";
  if (status === "warning" || status === "degraded" || status === "proof_pending" || status === "pending") return "warn";
  if (status === "critical" || status === "blocked" || status === "rejected" || status === "canceled") return "danger";
  return "neutral";
}

function titleizeWords(value: string): string {
  return value.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function humanizeToken(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Unknown";
  if (/^p\d+$/i.test(normalized)) return normalized.toUpperCase();
  return titleizeWords(normalized.replaceAll("_", " ").replaceAll("-", " "));
}

function formatRoleLabel(value: string | null | undefined): string {
  return humanizeToken(value);
}

function formatStatusLabel(value: string | null | undefined): string {
  return humanizeToken(value);
}

function formatProofModeLabel(value: string | null | undefined): string {
  return humanizeToken(value);
}

function formatVerificationClassLabel(value: string | null | undefined): string {
  return humanizeToken(value);
}

function formatPriorityLabel(value: string | null | undefined): string {
  return humanizeToken(value);
}

function formatEscapeHatchLabel(value: string | null | undefined): string {
  switch (String(value ?? "")) {
    case "need_help":
      return "Need help";
    case "unsafe":
      return "Unsafe";
    case "missing_tool":
      return "Missing tool";
    case "not_my_role":
      return "Not my role";
    case "already_done":
      return "Already done";
    case "defer_with_reason":
      return "Defer with reason";
    default:
      return humanizeToken(value);
  }
}

function renderZone(zone: OpsTwinZone): string {
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

function renderTask(task: HumanTaskRecord): string {
  const checklist = task.checklist.length
    ? task.checklist.map((item) => `<li><strong>${esc(item.label)}</strong>${item.detail ? ` · ${esc(item.detail)}` : ""}</li>`).join("")
    : "<li>No checklist has been generated yet.</li>";
  const proofModes = task.proofModes.length > 1
    ? task.proofModes.slice(1).map((entry) => formatProofModeLabel(entry)).join(", ")
    : "";
  return `
    <article class="ops-task-card ops-tone-${esc(statusTone(task.status))}" data-task-id="${esc(task.id)}">
      <div class="ops-task-card__head">
        <div>
          <p class="ops-kicker">${esc(humanizeToken(task.surface))} lane · ${esc(formatRoleLabel(task.role))} · ${esc(task.zone)}</p>
          <h3>${esc(task.title)}</h3>
        </div>
        <div class="ops-task-card__badges">
          <span class="ops-pill ops-pill-${esc(statusTone(task.status))}">${esc(formatStatusLabel(task.status))}</span>
          <span class="ops-pill">${esc(formatPriorityLabel(task.priority))}</span>
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
        <div><dt>Proof path</dt><dd>${esc(formatProofModeLabel(task.preferredProofMode))}${proofModes ? ` (fallbacks: ${esc(proofModes)})` : ""}</dd></div>
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
          ${task.blockerEscapeHatches.map((entry) => `<button type="button" class="ops-chip" data-task-escape="${esc(entry)}" data-task-id="${esc(task.id)}">${esc(formatEscapeHatchLabel(entry))}</button>`).join("")}
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

function renderApproval(row: ApprovalItem): string {
  return `
    <article class="ops-approval ops-tone-${esc(statusTone(row.status))}">
      <div class="ops-zone__head">
        <div>
          <p class="ops-kicker">Approval · ${esc(humanizeToken(row.actionClass))} · ${esc(formatRoleLabel(row.requiredRole))}</p>
          <h3>${esc(row.title)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(statusTone(row.status))}">${esc(formatStatusLabel(row.status))}</span>
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

function renderCase(row: OpsCaseRecord): string {
  return `
    <article class="ops-case ops-tone-${esc(statusTone(row.status))}">
      <p class="ops-kicker">${esc(humanizeToken(row.kind))} · ${esc(humanizeToken(row.lane))} · ${esc(formatPriorityLabel(row.priority))}</p>
      <h3>${esc(row.title)}</h3>
      <p class="ops-summary">${esc(row.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Status</dt><dd>${esc(formatStatusLabel(row.status))}</dd></div>
        <div><dt>Verification</dt><dd>${esc(formatVerificationClassLabel(row.verificationClass))}</dd></div>
        <div><dt>Freshest</dt><dd>${esc(formatTimestamp(row.freshestAt))}</dd></div>
        <div><dt>Confidence</dt><dd>${esc(formatConfidence(row.confidence))}</dd></div>
      </dl>
      <div class="ops-actions">
        <button type="button" class="ops-button ops-button-secondary" data-case-note="${esc(row.id)}">Add note</button>
      </div>
    </article>
  `;
}

function renderConversation(row: OpsConversationThreadRecord): string {
  return `
    <article class="ops-conversation ops-rail-card">
      <div class="ops-rail-card__head">
        <div>
          <p class="ops-kicker">${esc(formatRoleLabel(row.roleMask))} · ${esc(row.senderIdentity)}</p>
          <h4>${esc(row.summary)}</h4>
        </div>
        <span class="ops-pill ops-pill-${esc(row.unread ? "warn" : "neutral")}">${esc(row.unread ? "Unread" : "Read")}</span>
      </div>
      <p class="ops-meta">Last activity ${esc(formatTimestamp(row.latestMessageAt))}</p>
    </article>
  `;
}

function renderTaskRailCard(task: HumanTaskRecord): string {
  const tone = statusTone(task.status);
  const dueLabel = task.dueAt ? formatTimestamp(task.dueAt) : (task.etaMinutes ? `${task.etaMinutes}m ETA` : "No ETA");
  return `
    <article class="ops-rail-card ops-tone-${esc(tone)}" data-task-id="${esc(task.id)}">
      <div class="ops-rail-card__head">
        <div>
          <p class="ops-kicker">${esc(humanizeToken(task.surface))} lane · ${esc(formatRoleLabel(task.role))}</p>
          <h3>${esc(task.title)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(tone)}">${esc(formatStatusLabel(task.status))}</span>
      </div>
      <p class="ops-summary">${esc(task.whyNow)}</p>
      <dl class="ops-rail-card__meta">
        <div><dt>Zone</dt><dd>${esc(task.zone)}</dd></div>
        <div><dt>Due</dt><dd>${esc(dueLabel)}</dd></div>
        <div><dt>Proof</dt><dd>${esc(formatProofModeLabel(task.preferredProofMode))}</dd></div>
        <div><dt>Confidence</dt><dd>${esc(formatConfidence(task.confidence))}</dd></div>
      </dl>
    </article>
  `;
}

function renderMemberCard(
  row: OpsPortalSnapshot["members"][number],
  options: {
    canEditProfile?: boolean;
    canEditMembership?: boolean;
    canEditRole?: boolean;
    canEditBilling?: boolean;
    canViewActivity?: boolean;
  } = {},
): string {
  const filterText = [
    row.displayName,
    row.email || "",
    row.membershipTier || "",
    row.portalRole,
    row.opsRoles.join(" "),
    row.opsCapabilities.join(" "),
  ].join(" ").toLowerCase();
  const rolePills = row.opsRoles.length
    ? row.opsRoles.map((entry) => `<span class="ops-pill">${esc(formatRoleLabel(entry))}</span>`).join("")
    : '<span class="ops-chip">No ops roles</span>';
  const billingSummary = row.billing?.paymentMethodSummary
    || (row.billing?.stripeCustomerId ? "Tokenized billing refs on file" : "No billing profile on file");
  const recommendationLabel = !row.membershipTier
    ? "Set membership"
    : (!row.billing?.stripeCustomerId && !row.billing?.paymentMethodSummary)
      ? "Attach billing"
      : (row.portalRole !== "member" && row.opsRoles.length === 0)
        ? "Mask access"
        : (!row.staffNotes ? "Add context" : "Record healthy");
  const actions = [
    `<button type="button" class="ops-button" data-member-open="${esc(row.uid)}" data-member-tab="overview">Focus</button>`,
    options.canEditProfile
      ? `<button type="button" class="ops-button ops-button-secondary" data-member-open="${esc(row.uid)}" data-member-tab="profile">Profile</button>`
      : "",
    options.canEditMembership
      ? `<button type="button" class="ops-button ops-button-secondary" data-member-open="${esc(row.uid)}" data-member-tab="membership">Membership</button>`
      : "",
    options.canEditRole
      ? `<button type="button" class="ops-button ops-button-secondary" data-member-open="${esc(row.uid)}" data-member-tab="roles">Roles</button>`
      : "",
    options.canEditBilling
      ? `<button type="button" class="ops-button ops-button-secondary" data-member-open="${esc(row.uid)}" data-member-tab="billing">Billing</button>`
      : "",
    options.canViewActivity
      ? `<button type="button" class="ops-button ops-button-secondary" data-member-open="${esc(row.uid)}" data-member-tab="overview">Activity</button>`
      : "",
  ].filter(Boolean);
  return `
    <article class="ops-case ops-tone-neutral ops-member-roster-card ops-rail-card" data-member-card="${esc(row.uid)}" data-member-filter="${esc(filterText)}" data-member-open="${esc(row.uid)}" data-member-tab="overview">
      <div class="ops-member-roster-card__head">
        <div>
          <p class="ops-kicker">${esc(formatRoleLabel(row.portalRole))} · ${esc(row.membershipTier || "membership unset")}</p>
          <h3>${esc(row.displayName)}</h3>
          <p class="ops-summary">${esc(row.email || "No email on file.")}</p>
        </div>
        <span class="ops-pill ops-pill-${esc(row.billing?.stripeCustomerId || row.billing?.paymentMethodSummary ? "good" : "warn")}">${esc(row.billing?.stripeCustomerId || row.billing?.paymentMethodSummary ? "Billing ready" : "Needs billing")}</span>
      </div>
      <div class="ops-chip-row">${rolePills}</div>
      <dl class="ops-member-roster-card__meta">
        <div><dt>Membership</dt><dd>${esc(row.membershipTier || "none")}</dd></div>
        <div><dt>Last seen</dt><dd>${esc(formatTimestamp(row.lastSeenAt))}</dd></div>
        <div><dt>Billing</dt><dd>${esc(billingSummary)}</dd></div>
        <div><dt>Next move</dt><dd>${esc(recommendationLabel)}</dd></div>
      </dl>
      ${actions.length ? `<div class="ops-member-roster-card__actions">${actions.join("")}</div>` : ""}
    </article>
  `;
}

function renderReservationCard(
  row: OpsPortalSnapshot["reservations"][number],
  options: {
    canPrepareReservations?: boolean;
  } = {},
): string {
  return `
    <article class="ops-case ops-tone-${esc(statusTone(row.arrival.status === "arrived" ? "active" : row.degradeReason ? "warning" : "healthy"))}">
      <p class="ops-kicker">${esc(humanizeToken(row.status))} · ${esc(humanizeToken(row.firingType))} · ${esc(humanizeToken(row.arrival.status))}</p>
      <h3>${esc(row.title)}</h3>
      <p class="ops-summary">${esc(row.arrival.summary)}</p>
      <dl class="ops-meta-grid">
        <div><dt>Due</dt><dd>${esc(formatTimestamp(row.dueAt))}</dd></div>
        <div><dt>Items</dt><dd>${esc(String(row.itemCount))}</dd></div>
        <div><dt>Verification</dt><dd>${esc(formatVerificationClassLabel(row.verificationClass))}</dd></div>
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

function renderMemberOpsWorkspace(input: {
  members: OpsPortalSnapshot["members"];
  reservations: OpsPortalSnapshot["reservations"];
  memberCards: string;
  reservationCards: string;
  canViewMembers: boolean;
  canCreateMember: boolean;
}): string {
  const billingReadyCount = input.members.filter((row) => row.billing?.stripeCustomerId || row.billing?.paymentMethodSummary).length;
  const onboardingReadyCount = input.members.filter((row) => !row.membershipTier || !row.billing?.stripeCustomerId).length;
  const arrivalLinkedCount = input.reservations.filter((row) => !!row.ownerUid).length;
  return `
    <div class="ops-member-focus-layout">
      <div class="ops-panel ops-member-focus-rail">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Member ops</p>
            <h2>Roster and onboarding</h2>
          </div>
        </div>
        <p class="ops-panel__note">Search once, pick one person, and move the screen into the exact edit view that matches the decision you need to make.</p>
        <div class="ops-member-toolbar">
          <label class="ops-field ops-field-compact ops-member-search-field">
            <span>Find a member</span>
            <input id="ops-member-search" type="search" placeholder="Search by name, email, membership, or role." />
          </label>
          ${input.canCreateMember ? '<button type="button" class="ops-button" id="ops-member-create-trigger">Create member</button>' : ""}
        </div>
        <div class="ops-member-signal-strip">
          <article class="ops-member-signal">
            <span>Roster</span>
            <strong>${esc(input.members.length)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Billing ready</span>
            <strong>${esc(billingReadyCount)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Needs follow-through</span>
            <strong>${esc(onboardingReadyCount)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Arrival context</span>
            <strong>${esc(arrivalLinkedCount)}</strong>
          </article>
        </div>
        <div class="ops-scroll-stack ops-member-roster" id="ops-member-roster">
          ${input.canViewMembers
            ? (input.memberCards || '<div class="ops-empty">No member rows are visible for this session.</div>')
            : '<div class="ops-empty">This role can use the internet lane, but the member roster is masked.</div>'}
        </div>
      </div>
      <div class="ops-panel ops-member-focus-stage">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Focus stage</p>
            <h2>One member, one intent</h2>
          </div>
        </div>
        <p class="ops-panel__note">The selected person stays centered while the view changes around them. Use the stage tabs to swap intent instead of scrolling for the right form. Never type raw card numbers here.</p>
        <div id="ops-member-workbench" class="ops-member-workbench">
          <div class="ops-empty">Select a member to manage profile, membership, roles, and billing without leaving the lane.</div>
        </div>
      </div>
    </div>
    <datalist id="ops-membership-tier-options">
      <option value="drop-in"></option>
      <option value="community"></option>
      <option value="member"></option>
      <option value="resident"></option>
      <option value="staff"></option>
    </datalist>
  `;
}

function renderHandsQueueWorkspace(input: {
  handsTasks: HumanTaskRecord[];
  activeHandsTasks: HumanTaskRecord[];
  displayState: StationDisplayState | null;
  truth: OpsPortalSnapshot["truth"];
  reservations: OpsPortalSnapshot["reservations"];
}): string {
  const claimedCount = input.handsTasks.filter((task) => task.status === "claimed").length;
  const blockedCount = input.handsTasks.filter((task) => task.status === "blocked" || task.status === "proof_pending").length;
  return `
    <div class="ops-workspace-grid">
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Hands queue</p>
            <h2>Queue</h2>
          </div>
        </div>
        <p class="ops-panel__note">The rail stays compact so staff can spot the next physical move in one glance.</p>
        <div class="ops-member-toolbar">
          <label class="ops-field ops-field-compact">
            <span>Search tasks</span>
            <input id="ops-hands-search" type="search" placeholder="Search by title, zone, status, or role." />
          </label>
        </div>
        <div class="ops-member-signal-strip">
          <article class="ops-member-signal">
            <span>Queued</span>
            <strong>${esc(input.handsTasks.length)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Claimed</span>
            <strong>${esc(claimedCount)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Blocked / proof</span>
            <strong>${esc(blockedCount)}</strong>
          </article>
        </div>
        <div class="ops-scroll-stack" id="ops-hands-queue-rail">
          ${input.handsTasks.map((task) => renderTaskRailCard(task)).join("") || '<div class="ops-empty">No physical tasks are queued.</div>'}
        </div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Task workbench</p>
            <h2>Current task</h2>
          </div>
        </div>
        <p class="ops-panel__note">Open one task and get the why, the how, and the proof path without extra hunting.</p>
        <div id="ops-hands-workbench" class="ops-workbench">
          ${input.activeHandsTasks[0] ? renderTask(input.activeHandsTasks[0]) : '<div class="ops-empty">Select a task from the queue to open its full instructions, proof path, and blocker exits.</div>'}
        </div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Shift context</p>
            <h2>Nearby context</h2>
          </div>
        </div>
        <p class="ops-panel__note">Keep station health, signal freshness, and nearby arrivals beside the task.</p>
        <div id="ops-hands-context" class="ops-workbench">
          ${renderStationContext(input.displayState)}
          <div class="ops-ribbon-stack">${input.truth.sources.slice(0, 3).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
          <div class="ops-scroll-stack">${input.reservations.slice(0, 3).map((row) => renderReservationCard(row, { canPrepareReservations: false })).join("") || '<div class="ops-empty">No nearby reservation bundles are visible right now.</div>'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderSupportWorkspace(input: {
  conversations: OpsPortalSnapshot["conversations"];
  internetTasks: HumanTaskRecord[];
  cases: OpsCaseRecord[];
  approvals: ApprovalItem[];
}): string {
  const unreadCount = input.conversations.filter((row) => row.unread).length;
  const activeCount = input.internetTasks.filter((task) => isActiveTask(task)).length;
  return `
    <div class="ops-workspace-grid">
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Support desk</p>
            <h2>Inbox</h2>
          </div>
        </div>
        <p class="ops-panel__note">Unread and hot threads stay in the rail. Open one and work it to completion.</p>
        <div class="ops-member-toolbar">
          <label class="ops-field ops-field-compact">
            <span>Search threads</span>
            <input id="ops-support-search" type="search" placeholder="Search by sender, role mask, or summary." />
          </label>
        </div>
        <div class="ops-member-signal-strip">
          <article class="ops-member-signal">
            <span>Threads</span>
            <strong>${esc(input.conversations.length)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Unread</span>
            <strong>${esc(unreadCount)}</strong>
          </article>
          <article class="ops-member-signal">
            <span>Active internet tasks</span>
            <strong>${esc(activeCount)}</strong>
          </article>
        </div>
        <div class="ops-scroll-stack" id="ops-support-thread-rail">
          ${input.conversations.map(renderConversation).join("") || '<div class="ops-empty">No recent conversations.</div>'}
        </div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Reply workbench</p>
            <h2>Selected thread</h2>
          </div>
        </div>
        <p class="ops-panel__note">The center pane should always answer what to say next and whether approval is needed.</p>
        <div id="ops-support-workbench" class="ops-workbench">
          <div class="ops-empty">Select a support thread to see its pressure, linked work, and a safe draft path.</div>
        </div>
      </div>
      <div class="ops-panel">
        <div class="ops-panel__head">
          <div>
            <p class="ops-kicker">Linked context</p>
            <h2>Cases and approvals</h2>
          </div>
        </div>
        <p class="ops-panel__note">Keep the surrounding task, case, and approval state visible while you reply.</p>
        <div id="ops-support-context" class="ops-workbench">
          <div class="ops-scroll-stack">${input.cases.map(renderCase).join("") || '<div class="ops-empty">No internet-related cases are active right now.</div>'}</div>
          <div class="ops-stack">${input.approvals.slice(0, 3).map(renderApproval).join("") || '<div class="ops-empty">No approval gates are currently queued.</div>'}</div>
        </div>
      </div>
    </div>
  `;
}

function renderEventCard(row: OpsPortalSnapshot["events"][number]): string {
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

function renderReportCard(row: OpsPortalSnapshot["reports"][number]): string {
  return `
    <article class="ops-case ops-tone-${esc(statusTone(row.severity === "high" ? "critical" : row.status === "open" ? "warning" : "healthy"))}">
      <p class="ops-kicker">${esc(row.severity)} severity · ${esc(row.status)}</p>
      <h3>${esc(row.summary)}</h3>
      <p class="ops-meta">Opened ${esc(formatTimestamp(row.createdAt))}</p>
    </article>
  `;
}

function renderLendingCard(model: OpsPortalSnapshot["lending"]): string {
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

function renderExperiment(row: GrowthExperiment | ImprovementCase, lane: "ceo" | "forge"): string {
  const status = "status" in row ? row.status : "open";
  const title = "title" in row ? row.title : "Untitled";
  const summary = "summary" in row ? row.summary : "";
  const body = lane === "ceo"
    ? esc((row as GrowthExperiment).hypothesis || summary)
    : esc((row as ImprovementCase).problem || summary);
  return `
    <article class="ops-case ops-tone-${esc(statusTone(status))}">
      <p class="ops-kicker">${esc(lane)} strategy</p>
      <h3>${esc(title)}</h3>
      <p class="ops-summary">${body}</p>
      <p class="ops-meta">Status: ${esc(status)}</p>
    </article>
  `;
}

function renderWatchdogs(rows: OpsWatchdog[]): string {
  return rows
    .map(
      (row) => `
      <article class="ops-watchdog ops-tone-${esc(statusTone(row.status))}">
        <h4>${esc(row.label)}</h4>
        <p>${esc(row.summary)}</p>
        <p class="ops-meta"><strong>Next:</strong> ${esc(row.recommendation)}</p>
      </article>`,
    )
    .join("");
}

function renderModeTabs(surface: string, entries: Array<{ id: string; label: string; meta?: string | number }>): string {
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

function renderModePanel(surface: string, mode: string, body: string): string {
  return `<div class="ops-mode-panel" data-surface-mode-panel="${esc(surface)}" data-mode="${esc(mode)}">${body}</div>`;
}

function renderStationContext(displayState: StationDisplayState | null): string {
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
        <div><dt>Mode</dt><dd>${esc(humanizeToken(station.surfaceMode))}</dd></div>
        <div><dt>Actor</dt><dd>${esc(station.actorId || "unclaimed")}</dd></div>
        <div><dt>Last seen</dt><dd>${esc(formatTimestamp(station.lastSeenAt))}</dd></div>
        <div class="ops-span-2"><dt>Capabilities</dt><dd>${esc(station.capabilities.map((entry) => humanizeToken(entry)).join(", ") || "No capabilities advertised.")}</dd></div>
      </dl>
    </article>
  `;
}

function renderHandsFocus(displayState: StationDisplayState | null, fallbackTask: HumanTaskRecord | null = null): string {
  const task = displayState?.focusTask ?? fallbackTask;
  if (!task) {
    return `<div class="ops-empty">No focus task is currently pinned to this station.</div>`;
  }
  return renderTask(task);
}

function isActiveTask(task: HumanTaskRecord): boolean {
  return task.status !== "verified" && task.status !== "canceled";
}

function renderMeter(value: number, tone: string, label: string): string {
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

function renderPulseZone(zone: OpsTwinZone): string {
  const tone = statusTone(zone.status);
  return `
    <article class="ops-pulse-card ops-tone-${esc(tone)}">
      <div class="ops-pulse-card__head">
        <div>
          <p class="ops-kicker">Studio system</p>
          <h3>${esc(zone.label)}</h3>
        </div>
        <span class="ops-pill ops-pill-${esc(tone)}">${esc(formatStatusLabel(zone.status))}</span>
      </div>
      <p class="ops-summary">${esc(zone.summary)}</p>
      ${renderMeter(zone.evidence.confidence * 100, tone, `${formatConfidence(zone.evidence.confidence)} confidence`)}
      <dl class="ops-inline-meta">
        <div><dt>Verification</dt><dd>${esc(formatVerificationClassLabel(zone.evidence.verificationClass))}</dd></div>
        <div><dt>Freshest</dt><dd>${esc(formatTimestamp(zone.evidence.freshestAt))}</dd></div>
      </dl>
      <p class="ops-pulse-card__next"><strong>Next:</strong> ${esc(zone.nextAction || "No explicit next action queued.")}</p>
    </article>
  `;
}

function renderSignalCard(input: { kicker: string; title: string; value: string; summary: string; tone: string; meter: number; meterLabel: string }): string {
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

function renderTaskSpotlight(task: HumanTaskRecord | null, label: string): string {
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

function renderApprovalSpotlight(row: ApprovalItem | null): string {
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

function renderSequenceStep(entry: string, index = 0): string {
  return `
    <article class="ops-sequence-step">
      <span class="ops-sequence-step__index">${index + 1}</span>
      <p>${esc(entry)}</p>
    </article>
  `;
}

function renderIncidentChip(input: { label: string; text: string; tone: string }): string {
  return `
    <article class="ops-incident-chip ops-tone-${esc(input.tone)}">
      <span class="ops-incident-chip__label">${esc(input.label)}</span>
      <p>${esc(input.text)}</p>
    </article>
  `;
}

function toneGaugeColor(tone: string): string {
  if (tone === "good") return "var(--good)";
  if (tone === "warn") return "var(--warn)";
  if (tone === "danger") return "var(--danger)";
  return "var(--neutral)";
}

function renderCountdownOrb(input: { label: string; title: string; summary: string; minutes: number | null; tone: string; horizonMinutes?: number }): string {
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

function renderGaugeCard(input: { label: string; title: string; value: string; summary: string; tone: string; percent: number; meterLabel: string }): string {
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

function renderTickerItem(input: { label: string; text: string; tone: string }): string {
  return `
    <article class="ops-ticker-item ops-tone-${esc(input.tone)}">
      <span class="ops-ticker-item__label">${esc(input.label)}</span>
      <span class="ops-ticker-item__text">${esc(input.text)}</span>
    </article>
  `;
}

function renderFreshnessRibbon(source: OpsSourceFreshness): string {
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

function renderRelayCard(input: { label: string; title: string; summary: string; tone: string; stages: Array<{ label: string; state: "done" | "active" | "queued" }> }): string {
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

function renderTaskRelayCard(task: HumanTaskRecord | null, label: string): string {
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

function renderApprovalRelayCard(row: ApprovalItem | null): string {
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

function renderMapZone(zone: OpsTwinZone, index: number): string {
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
        <span class="ops-map-zone__sentinel ops-map-zone__sentinel-${esc(tone)}" title="${esc(formatVerificationClassLabel(zone.evidence.verificationClass))} · ${esc(formatConfidence(zone.evidence.confidence))}">
          <span class="ops-map-zone__status ops-map-zone__status-${esc(tone)}"></span>
        </span>
      </div>
      <p class="ops-summary">${esc(zone.summary)}</p>
      ${renderMeter(zone.evidence.confidence * 100, tone, `${formatConfidence(zone.evidence.confidence)} confidence`)}
      <div class="ops-zone-ribbon" aria-hidden="true">${sourceSignals}</div>
      <p class="ops-meta"><strong>${esc(formatVerificationClassLabel(zone.evidence.verificationClass))}</strong> · freshest ${esc(formatTimestamp(zone.evidence.freshestAt))}</p>
      <p class="ops-map-zone__next"><strong>Next:</strong> ${esc(zone.nextAction || "No explicit next action queued.")}</p>
    </article>
  `;
}

function renderTimelineEntry(input: {
  time: string | null;
  lane: string;
  title: string;
  summary: string;
  tone: string;
}): string {
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

function renderSurfaceShell(model: OpsPortalSnapshot, displayState: StationDisplayState | null): string {
  const surfaceTabs = model.session?.allowedSurfaces?.length
    ? model.session.allowedSurfaces
    : ["manager", "owner", "hands", "internet", "ceo", "forge"];
  const sessionCapabilities = model.session?.opsCapabilities ?? [];
  const canCreateMember = sessionCapabilities.includes("members:create");
  const canEditMemberProfile = sessionCapabilities.includes("members:edit_profile");
  const canEditMembership = sessionCapabilities.includes("members:edit_membership");
  const canEditRole = sessionCapabilities.includes("members:edit_role");
  const canEditBilling = sessionCapabilities.includes("members:edit_billing");
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
    canEditBilling,
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
      summary:
        activeInternetTasks[0]?.title
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
      summary:
        activeInternetTasks[0]?.whyNow
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
    <div class="ops-shell">
      <nav class="ops-surface-nav">
        ${surfaceTabs.map((surface) => `<button type="button" class="ops-surface-tab" data-surface-tab="${esc(surface)}">${esc(humanizeToken(surface))}</button>`).join("")}
      </nav>
      <div class="ops-surfaces">
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
                  <p class="ops-kicker">Command deck</p>
                  <h2>${esc(model.twin.headline)}</h2>
                </div>
                <span class="ops-pill ops-pill-${esc(statusTone(model.truth.readiness))}">${esc(formatStatusLabel(model.truth.readiness))}</span>
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
                    <p class="ops-kicker">Clocks</p>
                    <h2>Windows that move today</h2>
                  </div>
                </div>
                <div class="ops-countdown-grid">${countdownItems.join("")}</div>
              </div>
              <div class="ops-panel ops-motion-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Handoffs</p>
                    <h2>Who owns the next move</h2>
                  </div>
                </div>
                <div class="ops-relay-stack">${relayItems.join("")}</div>
              </div>
              <div class="ops-panel ops-motion-panel">
                <div class="ops-panel__head">
                  <div>
                    <p class="ops-kicker">Live signals</p>
                    <h2>Which signals are still trustworthy</h2>
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
                ${
                  model.twin.nextActions.length
                    ? model.twin.nextActions.slice(0, 5).map(renderSequenceStep).join("")
                    : '<div class="ops-empty">No next action has been surfaced yet.</div>'
                }
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
              <p class="ops-panel__note">This page should tell a staff member exactly what to do next without making them decode a dashboard.</p>
              ${renderHandsFocus(displayState, activeHandsTasks[0] ?? null)}
            </div>
            <div class="ops-panel">
              <div class="ops-panel__head"><div><p class="ops-kicker">Live telemetry</p><h2>Window, handoff, and truth</h2></div></div>
              <p class="ops-panel__note">The dials and ribbons show time pressure, ownership, and whether the signal path is fresh enough to trust.</p>
              <div class="ops-countdown-grid ops-countdown-grid-dual">${handsNowCountdowns.join("")}</div>
              <div class="ops-relay-stack">${renderTaskRelayCard(activeHandsTasks[0] ?? null, "Hands relay")}</div>
              <div class="ops-ribbon-stack">${model.truth.sources.slice(0, 3).map(renderFreshnessRibbon).join("") || '<div class="ops-empty">No source freshness signals are available.</div>'}</div>
            </div>
          </div>
        `)}
        ${renderModePanel("hands", "queue", `
          ${renderHandsQueueWorkspace({
            handsTasks,
            activeHandsTasks,
            displayState,
            truth: model.truth,
            reservations: reservationBundles,
          })}
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
              <p class="ops-panel__note">Keep the left rail fast to scan. Open one thread or task and do the next safe thing.</p>
              <div class="ops-scroll-stack">${internetTasks.map(renderTaskRailCard).join("") || '<div class="ops-empty">No internet tasks are queued.</div>'}</div>
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
          ${renderMemberOpsWorkspace({
            members: memberRows,
            reservations: reservationBundles,
            memberCards,
            reservationCards,
            canViewMembers,
            canCreateMember,
          })}
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
          ${renderSupportWorkspace({
            conversations: model.conversations,
            internetTasks,
            cases: internetCases,
            approvals: pendingApprovals,
          })}
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
      </div>
    </div>
  `;
}

export function renderOpsPortalPage(model: OpsPortalPageModel): string {
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
        --bg: #071119;
        --panel: #0d1823;
        --panel-2: #12202e;
        --panel-3: #162737;
        --panel-quiet: #0a141d;
        --ink: #f5f8fc;
        --ink-soft: #d5e1ec;
        --muted: #a6b7c7;
        --muted-soft: #8194a6;
        --line: rgba(135, 162, 189, 0.18);
        --line-strong: rgba(167, 194, 221, 0.28);
        --shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
        --good: #82e6be;
        --good-bg: rgba(41, 119, 92, 0.24);
        --warn: #ffd36f;
        --warn-bg: rgba(154, 102, 20, 0.24);
        --danger: #ff9588;
        --danger-bg: rgba(150, 53, 35, 0.24);
        --neutral: #a8b8c7;
        --neutral-bg: rgba(84, 103, 122, 0.22);
        --accent: #69b4ff;
        --accent-2: #ffb37d;
        --focus-ring: 0 0 0 2px rgba(105, 180, 255, 0.24);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        color: var(--ink);
        line-height: 1.45;
        font-family: "Aptos", "Segoe UI", system-ui, sans-serif;
        background:
          radial-gradient(circle at top left, rgba(105,180,255,0.12), transparent 26%),
          radial-gradient(circle at top right, rgba(255,179,125,0.08), transparent 20%),
          linear-gradient(180deg, #08131d 0%, #09131d 44%, #060d15 100%);
      }
      main {
        max-width: 1560px;
        margin: 0 auto;
        padding: 24px;
      }
      .ops-shell,
      .ops-surfaces {
        display: grid;
        gap: 18px;
      }
      .ops-hero, .ops-panel, .ops-task-card, .ops-case, .ops-zone, .ops-watchdog, .ops-approval, .ops-conversation {
        background: var(--panel);
        border: 1px solid var(--line-strong);
        border-radius: 24px;
        box-shadow: var(--shadow);
      }
      .ops-hero {
        padding: 20px 22px;
        display: grid;
        gap: 16px;
        margin-bottom: 18px;
      }
      .ops-hero__top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .ops-hero__actions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .ops-hero h1 { margin: 0 0 6px; font-size: clamp(2rem, 2.8vw, 3.3rem); font-family: "Palatino Linotype", Georgia, serif; }
      .ops-hero p { margin: 0; color: var(--ink-soft); max-width: 92ch; }
      .ops-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .ops-kpi { padding: 16px; border-radius: 18px; border: 1px solid var(--line); background: var(--panel-2); }
      .ops-kpi span { display: block; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted-soft); }
      .ops-kpi strong { display: block; margin-top: 10px; font-size: 1.55rem; }
      .ops-surface-nav {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .ops-surface-tab, .ops-button, .ops-chip {
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 10px 16px;
        background: var(--panel-2);
        color: var(--ink-soft);
        cursor: pointer;
        font-weight: 700;
      }
      .ops-surface-tab:hover, .ops-button:hover, .ops-chip:hover, .ops-mode-tab:hover, .ops-member-tab:hover { border-color: var(--line-strong); }
      .ops-surface-tab.is-active, .ops-button { background: linear-gradient(180deg, #2d78c7 0%, #255f9c 100%); color: #f8fbff; }
      .ops-button-secondary { background: rgba(255,179,125,0.12); color: var(--accent-2); border-color: rgba(255,179,125,0.22); }
      .ops-button-ghost {
        background: rgba(255,255,255,0.03);
        color: var(--ink-soft);
        border-color: var(--line);
      }
      .ops-button-ghost.is-active {
        background: rgba(105,180,255,0.14);
        color: var(--accent);
        border-color: rgba(105,180,255,0.34);
      }
      .ops-chip { background: var(--panel-2); color: var(--ink-soft); border-color: var(--line); }
      .ops-chip.is-selected { background: rgba(105,180,255,0.14); color: var(--accent); border-color: rgba(105,180,255,0.34); }
      .ops-surface { display: none; }
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
        border: 1px solid var(--line-strong);
        background: rgba(10, 20, 29, 0.92);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
      }
      .ops-mode-tab {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        color: var(--ink-soft);
        cursor: pointer;
        font-weight: 700;
      }
      .ops-mode-tab strong {
        display: inline-flex;
        min-width: 24px;
        justify-content: center;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(105,180,255,0.12);
        color: var(--accent);
        font-size: 0.74rem;
      }
      .ops-mode-tab.is-active {
        background: linear-gradient(180deg, #2d78c7 0%, #255f9c 100%);
        color: #f8fbff;
        border-color: rgba(105,180,255,0.28);
      }
      .ops-mode-tab.is-active strong {
        background: rgba(255,255,255,0.18);
        color: #f8f3ed;
      }
      .ops-mode-panel { display: none; }
      .ops-mode-panel.is-active { display: block; min-height: 0; }
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
        border: 1px solid var(--line);
        background: linear-gradient(90deg, rgba(13,24,35,0.96), rgba(18,32,46,0.92));
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
        background: linear-gradient(90deg, rgba(13,24,35,1), rgba(13,24,35,0));
      }
      .ops-ticker-shell::after {
        right: 0;
        background: linear-gradient(270deg, rgba(13,24,35,1), rgba(13,24,35,0));
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
        background: var(--panel-2);
        border: 1px solid var(--line);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
      }
      .ops-ticker-item__label {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(105,180,255,0.12);
        color: var(--muted-soft);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .ops-ticker-item__text {
        font-size: 0.96rem;
        color: var(--ink-soft);
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
        background: var(--panel-2);
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
          radial-gradient(circle at center, rgba(8,17,25,0.96) 0 50%, transparent 51%),
          conic-gradient(from -120deg, var(--gauge-color) 0deg var(--gauge-progress), rgba(106,125,144,0.16) var(--gauge-progress) 240deg, transparent 240deg 360deg);
        animation: ops-gauge-glow 2.8s ease-in-out infinite;
      }
      .ops-gauge__needle {
        position: absolute;
        bottom: 50%;
        left: 50%;
        width: 4px;
        height: 46px;
        border-radius: 999px;
        background: linear-gradient(180deg, rgba(216,229,241,0.28), rgba(236,243,250,0.96));
        transform-origin: center bottom;
        transform: translateX(-50%) rotate(var(--gauge-needle));
        animation: ops-gauge-sweep 1.1s cubic-bezier(.2,.8,.2,1);
      }
      .ops-gauge__hub {
        position: absolute;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: rgba(236,243,250,0.94);
        box-shadow: 0 0 0 5px rgba(8,17,25,0.9);
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
        background: rgba(8,17,25,0.72);
        border: 1px solid var(--line);
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-incident-chip p { margin: 0; color: var(--ink-soft); line-height: 1.45; }
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
        background: var(--panel-2);
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
          radial-gradient(circle at center, rgba(8,17,25,0.96) 0 56%, transparent 57%),
          conic-gradient(from -90deg, var(--countdown-color) 0deg var(--countdown-progress), rgba(106,125,144,0.16) var(--countdown-progress) 360deg);
        animation: ops-orbit-breathe 3.2s ease-in-out infinite;
      }
      .ops-countdown-card__ring::after {
        content: "";
        position: absolute;
        inset: 8px;
        border-radius: 50%;
        border: 1px dashed rgba(167, 194, 221, 0.18);
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
        color: var(--muted-soft);
      }
      .ops-countdown-card__copy h3 { margin: 0 0 6px; font-size: 1rem; }
      .ops-flow-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: var(--panel-2);
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
        background: linear-gradient(90deg, rgba(105,180,255,0.24), rgba(255,179,125,0.24));
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
        background: rgba(11,20,30,0.96);
        border: 2px solid var(--line-strong);
        box-shadow: 0 0 0 8px rgba(7,17,25,0.72);
      }
      .ops-relay__label {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-soft);
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
        background: rgba(11,20,30,0.96);
      }
      .ops-source-ribbon {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: var(--panel-2);
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
        color: var(--muted-soft);
      }
      .ops-source-ribbon__track {
        position: relative;
        height: 12px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(104, 123, 142, 0.16);
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
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
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
        box-shadow: 0 0 0 6px rgba(7,17,25,0.9);
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
      .ops-map-zone__next { margin: 12px 0 0; color: var(--ink-soft); }
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
        border-left: 3px solid rgba(167, 194, 221, 0.18);
      }
      .ops-timeline-entry__time {
        font-size: 0.8rem;
        color: var(--muted-soft);
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
        background: var(--panel-2);
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
      .ops-timeline-entry__body p:last-child { margin: 0; color: var(--ink-soft); }
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
        background: rgba(105,180,255,0.12);
        color: var(--accent);
        font-weight: 700;
      }
      .ops-sequence-step p { margin: 0; color: var(--ink-soft); }
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
          radial-gradient(circle at center, rgba(8,17,25,0.96) 0 56%, transparent 57%),
          conic-gradient(from -90deg, var(--countdown-color) 0deg var(--countdown-progress), rgba(106,125,144,0.16) var(--countdown-progress) 360deg);
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
        color: var(--muted-soft);
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
        color: var(--muted-soft);
      }
      .ops-inline-meta dd { margin: 4px 0 0; }
      .ops-meter { display: grid; gap: 6px; margin-top: 10px; }
      .ops-meter span {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-meter__track {
        height: 9px;
        border-radius: 999px;
        background: rgba(104,123,142,0.16);
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
        overflow: auto;
        min-height: 0;
        padding-right: 4px;
      }
      .ops-station-card {
        padding: 16px;
        border-radius: 20px;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .ops-station-card h3 { margin: 0; }
      .ops-panel {
        padding: 18px;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .ops-panel__head, .ops-zone__head, .ops-task-card__head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
      .ops-panel h2, .ops-zone h3, .ops-task-card h3, .ops-case h3, .ops-approval h3 { margin: 0; }
      .ops-kicker { margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.78rem; color: var(--muted-soft); }
      .ops-summary, .ops-meta { color: var(--ink-soft); }
      .ops-panel__note {
        margin: 8px 0 0;
        color: var(--muted-soft);
        font-size: 0.95rem;
        line-height: 1.5;
      }
      .ops-zone-grid, .ops-stack, .ops-truth-grid { display: grid; gap: 12px; }
      .ops-zone-grid { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); margin-top: 14px; }
      .ops-task-card, .ops-zone, .ops-case, .ops-watchdog, .ops-approval, .ops-conversation { padding: 16px; }
      .ops-task-grid, .ops-meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin: 14px 0 0; }
      .ops-task-grid dt, .ops-meta-grid dt { font-size: 0.77rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-soft); }
      .ops-task-grid dd, .ops-meta-grid dd { margin: 4px 0 0; }
      .ops-span-2 { grid-column: 1 / -1; }
      .ops-subpanel { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
      .ops-actions, .ops-chip-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
      .ops-pill {
        display: inline-flex;
        align-items: center;
        padding: 5px 10px;
        border-radius: 999px;
        background: var(--neutral-bg);
        color: var(--neutral);
        border: 1px solid rgba(125,145,166,0.2);
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
        background: var(--panel-quiet);
        padding: 14px;
        min-height: 120px;
        max-height: 340px;
        overflow: auto;
      }
      .ops-chat-message { max-width: 92%; padding: 12px 14px; border-radius: 18px; margin-bottom: 10px; }
      .ops-chat-message-user { margin-left: auto; background: rgba(105,180,255,0.12); }
      .ops-chat-message-assistant { margin-right: auto; background: var(--panel-2); }
      .ops-chat-form, .ops-compose-form { display: grid; gap: 10px; margin-top: 14px; }
      textarea, input, select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 12px 14px;
        font: inherit;
        color: var(--ink);
        background: var(--panel-quiet);
      }
      textarea::placeholder, input::placeholder { color: var(--muted-soft); }
      textarea:focus, input:focus, select:focus {
        outline: none;
        border-color: rgba(105,180,255,0.42);
        box-shadow: var(--focus-ring);
      }
      .ops-empty {
        padding: 18px;
        border: 1px dashed var(--line);
        border-radius: 18px;
        color: var(--muted-soft);
        background: rgba(13,24,35,0.82);
      }
      .ops-banner {
        margin-bottom: 14px;
        padding: 12px 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        display: none;
      }
      .ops-banner.is-visible { display: block; }
      .ops-banner-success { border-color: rgba(36,92,77,0.22); color: var(--good); }
      .ops-banner-error { border-color: rgba(159,61,45,0.24); color: var(--danger); }
      .ops-truth-grid { margin-top: 14px; }
      .ops-field {
        display: grid;
        gap: 6px;
      }
      .ops-field span {
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-field-compact {
        flex: 1 1 260px;
        min-width: 240px;
      }
      .ops-member-toolbar {
        display: flex;
        gap: 12px;
        align-items: end;
        flex-wrap: wrap;
        margin-top: 14px;
      }
      .ops-member-signal-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
        margin-top: 14px;
      }
      .ops-member-signal {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .ops-member-signal span {
        display: block;
        font-size: 0.76rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-member-signal strong {
        display: block;
        margin-top: 8px;
        font-size: 1.35rem;
      }
      .ops-member-focus-layout {
        display: grid;
        grid-template-columns: minmax(300px, 0.88fr) minmax(0, 1.42fr);
        gap: 18px;
        min-height: 0;
      }
      .ops-member-focus-rail,
      .ops-member-focus-stage,
      .ops-workspace-grid {
        min-height: 0;
      }
      .ops-workspace-grid {
        display: grid;
        grid-template-columns: minmax(280px, 0.95fr) minmax(420px, 1.35fr) minmax(280px, 0.95fr);
        gap: 18px;
      }
      .ops-workbench {
        display: grid;
        gap: 12px;
        min-height: 0;
      }
      .ops-rail-card {
        display: grid;
        gap: 10px;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }
      .ops-rail-card.is-selected {
        border-color: rgba(38,77,125,0.26);
        box-shadow: 0 0 0 2px rgba(38,77,125,0.14);
        transform: translateY(-1px);
      }
      .ops-rail-card__head {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: flex-start;
      }
      .ops-rail-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
      }
      .ops-rail-card__meta dt {
        font-size: 0.77rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-rail-card__meta dd { margin: 4px 0 0; }
      .ops-member-roster-card {
        display: grid;
        gap: 12px;
        transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }
      .ops-member-roster-card.is-selected {
        border-color: rgba(38,77,125,0.26);
        box-shadow: 0 0 0 2px rgba(38,77,125,0.14);
        transform: translateY(-1px);
      }
      .ops-member-roster-card__head,
      .ops-member-workbench__header {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: flex-start;
      }
      .ops-member-roster-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
      }
      .ops-member-roster-card__meta dt {
        font-size: 0.77rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-member-roster-card__meta dd { margin: 4px 0 0; }
      .ops-member-roster-card__actions,
      .ops-member-workbench__tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .ops-member-roster-card__actions { margin-top: 2px; }
      .ops-member-tab {
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 8px 12px;
        background: var(--panel-2);
        color: var(--ink-soft);
        cursor: pointer;
        font-weight: 700;
      }
      .ops-member-tab.is-active {
        background: linear-gradient(180deg, #2d78c7 0%, #255f9c 100%);
        color: #f8fbff;
        border-color: transparent;
      }
      .ops-member-workbench { display: grid; gap: 12px; min-height: 0; }
      .ops-member-stage {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 0;
      }
      .ops-member-stage__header {
        display: flex;
        gap: 14px;
        justify-content: space-between;
        align-items: flex-start;
      }
      .ops-member-stage__spotlight {
        display: grid;
        grid-template-columns: minmax(260px, 0.94fr) minmax(0, 1.06fr);
        gap: 12px;
      }
      .ops-member-stage__body {
        display: grid;
        gap: 12px;
        min-height: 0;
        overflow: auto;
        padding-right: 4px;
      }
      .ops-member-pane,
      .ops-member-note,
      .ops-member-reservation {
        padding: 16px;
        border-radius: 18px;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .ops-member-pane h3,
      .ops-member-note h3,
      .ops-member-reservation h3 { margin: 0; }
      .ops-member-pane__split {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .ops-member-form-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px 14px;
      }
      .ops-member-activity-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .ops-member-stat {
        padding: 14px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: var(--panel-3);
      }
      .ops-member-stat span {
        display: block;
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-soft);
      }
      .ops-member-stat strong {
        display: block;
        margin-top: 6px;
        font-size: 1.2rem;
      }
      .ops-member-role-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 8px;
      }
      .ops-member-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 52px;
        padding: 10px 12px;
        border-radius: 16px;
        border: 1px solid var(--line);
        background: var(--panel-quiet);
      }
      .ops-member-checkbox input {
        width: auto;
        margin: 0;
      }
      .ops-member-empty-inline {
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px dashed var(--line);
        color: var(--muted-soft);
        background: rgba(13,24,35,0.72);
      }
      .ops-member-roster {
        flex: 1 1 auto;
        min-height: 0;
      }
      .ops-member-safe {
        border-color: rgba(105,180,255,0.2);
        background: rgba(105,180,255,0.08);
      }
      html[data-viewport-preference="single-screen"],
      body[data-viewport-preference="single-screen"] {
        height: 100%;
        min-height: 100%;
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] main {
        height: 100dvh;
        max-height: 100dvh;
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 10px;
        overflow: hidden;
        padding: 14px 18px;
      }
      body[data-viewport-preference="single-screen"] .ops-hero {
        margin-bottom: 0;
        padding: 14px 16px;
        gap: 12px;
      }
      body[data-viewport-preference="single-screen"] .ops-hero__top {
        align-items: flex-start;
      }
      body[data-viewport-preference="single-screen"] .ops-hero__actions {
        align-self: flex-start;
      }
      body[data-viewport-preference="single-screen"] .ops-hero h1 {
        margin-bottom: 4px;
        font-size: clamp(1.7rem, 2.7vw, 2.85rem);
        line-height: 1.05;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] .ops-hero p:not(.ops-meta) {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] .ops-kpi-grid {
        gap: 8px;
      }
      body[data-viewport-preference="single-screen"] .ops-kpi {
        padding: 10px 12px;
        border-radius: 14px;
        min-height: 0;
      }
      body[data-viewport-preference="single-screen"] .ops-kpi strong {
        margin-top: 4px;
        font-size: 1.2rem;
      }
      body[data-viewport-preference="single-screen"] .ops-shell,
      body[data-viewport-preference="single-screen"] .ops-surfaces,
      body[data-viewport-preference="single-screen"] .ops-surface.is-active,
      body[data-viewport-preference="single-screen"] .ops-manager-canvas,
      body[data-viewport-preference="single-screen"] .ops-mode-panel.is-active,
      body[data-viewport-preference="single-screen"] .ops-layout,
      body[data-viewport-preference="single-screen"] .ops-layout-hands,
      body[data-viewport-preference="single-screen"] .ops-workspace-grid,
      body[data-viewport-preference="single-screen"] .ops-member-focus-layout {
        min-height: 0;
        height: 100%;
      }
      body[data-viewport-preference="single-screen"] .ops-shell {
        grid-template-rows: auto minmax(0, 1fr);
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] .ops-surfaces,
      body[data-viewport-preference="single-screen"] .ops-surface.is-active,
      body[data-viewport-preference="single-screen"] .ops-manager-canvas {
        display: grid;
      }
      body[data-viewport-preference="single-screen"] .ops-manager-canvas {
        grid-template-rows: auto minmax(0, 1fr);
        align-content: stretch;
        gap: 12px;
      }
      body[data-viewport-preference="single-screen"] .ops-surfaces {
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] .ops-mode-nav {
        margin-bottom: 0;
        padding: 6px;
        gap: 8px;
      }
      body[data-viewport-preference="single-screen"] .ops-mode-panel.is-active {
        display: grid;
        align-content: start;
        min-height: 0;
        height: 100%;
        overflow: auto;
        padding-right: 4px;
      }
      body[data-viewport-preference="single-screen"] .ops-member-focus-rail,
      body[data-viewport-preference="single-screen"] .ops-member-focus-stage,
      body[data-viewport-preference="single-screen"] .ops-member-stage {
        overflow: hidden;
      }
      body[data-viewport-preference="single-screen"] .ops-scroll-stack,
      body[data-viewport-preference="single-screen"] .ops-member-stage__body,
      body[data-viewport-preference="single-screen"] .ops-chat-feed {
        flex: 1 1 auto;
        max-height: none;
      }
      body[data-viewport-preference="single-screen"] .ops-layout,
      body[data-viewport-preference="single-screen"] .ops-layout-hands,
      body[data-viewport-preference="single-screen"] .ops-workspace-grid,
      body[data-viewport-preference="single-screen"] .ops-member-focus-layout {
        align-content: start;
      }
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
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,179,125,0.24), 0 0 0 8px rgba(7,17,25,0.72); }
        50% { box-shadow: 0 0 0 8px rgba(255,179,125,0.06), 0 0 0 10px rgba(7,17,25,0.82); }
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
        .ops-kpi-grid, .ops-gauge-strip, .ops-incident-strip, .ops-sequence-grid, .ops-countdown-grid, .ops-countdown-grid-dual, .ops-member-signal-strip, .ops-member-activity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ops-scan-grid, .ops-detail-grid, .ops-command-grid, .ops-motion-grid { grid-template-columns: 1fr; }
        .ops-member-focus-layout { grid-template-columns: minmax(280px, 0.94fr) minmax(0, 1.06fr); }
        .ops-member-stage__spotlight { grid-template-columns: 1fr; }
        .ops-workspace-grid { grid-template-columns: minmax(280px, 1fr) minmax(360px, 1.15fr); }
        .ops-workspace-grid > :last-child { grid-column: 1 / -1; }
      }
      @media (max-width: 1100px) {
        .ops-layout, .ops-layout-hands, .ops-bottom-grid, .ops-scan-grid, .ops-detail-grid, .ops-command-grid, .ops-gauge-strip, .ops-incident-strip, .ops-sequence-grid, .ops-motion-grid, .ops-countdown-grid, .ops-countdown-grid-dual, .ops-member-focus-layout, .ops-workspace-grid, .ops-member-pane__split, .ops-member-form-grid { grid-template-columns: 1fr; }
        .ops-studio-map { grid-template-columns: 1fr; }
        .ops-map-zone-0, .ops-map-zone-1, .ops-map-zone-2, .ops-map-zone-3 { grid-column: span 1; }
        .ops-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .ops-hero__top { flex-direction: column; }
        .ops-mode-nav { top: 8px; }
      }
      @media (max-width: 720px) {
        .ops-kpi-grid, .ops-member-signal-strip, .ops-member-activity-grid { grid-template-columns: 1fr; }
        body[data-viewport-preference="single-screen"] { overflow: auto; }
        body[data-viewport-preference="single-screen"] main {
          height: auto;
          max-height: none;
          overflow: visible;
          padding: 18px 16px 28px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header class="ops-hero">
        <div class="ops-hero__top">
          <div>
            <p class="ops-kicker">Studio Brain Autonomous Studio OS</p>
            <h1>${esc(model.snapshot.twin.headline)}</h1>
            <p>${esc(model.snapshot.twin.narrative)}</p>
            <p class="ops-meta" style="margin-top:10px;">Generated ${esc(formatTimestamp(model.snapshot.generatedAt))} · Truth ${esc(model.snapshot.truth.readiness)} · Current risk ${esc(model.snapshot.twin.currentRisk || "none surfaced")}</p>
          </div>
          <div class="ops-hero__actions">
            <button type="button" class="ops-button ops-button-ghost" id="ops-viewport-toggle" data-viewport-toggle="single-screen" aria-pressed="true">Single-screen focus</button>
          </div>
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
      const viewportPreferenceKey = "ops:viewport-preference";

      function normalizeViewportPreference(value) {
        return value === "document" ? "document" : "single-screen";
      }

      function readViewportPreference() {
        try {
          return normalizeViewportPreference(window.localStorage.getItem(viewportPreferenceKey));
        } catch {
          return "single-screen";
        }
      }

      let viewportPreference = readViewportPreference();

      function applyViewportPreference() {
        document.body.dataset.viewportPreference = viewportPreference;
        document.documentElement.dataset.viewportPreference = viewportPreference;
        const toggle = document.getElementById("ops-viewport-toggle");
        if (toggle) {
          const singleScreen = viewportPreference === "single-screen";
          toggle.textContent = singleScreen ? "Single-screen: on" : "Document flow";
          toggle.classList.toggle("is-active", singleScreen);
          toggle.setAttribute("aria-pressed", singleScreen ? "true" : "false");
          toggle.setAttribute("data-viewport-toggle", viewportPreference);
        }
      }

      function setViewportPreference(nextPreference) {
        viewportPreference = normalizeViewportPreference(nextPreference);
        try {
          window.localStorage.setItem(viewportPreferenceKey, viewportPreference);
        } catch {}
        applyViewportPreference();
      }

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
          throw new Error(payload && payload.message ? payload.message : "Studio Brain could not load that data right now.");
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
          throw new Error(payload && payload.message ? payload.message : "Studio Brain could not complete that request.");
        }
        return payload;
      }

      document.querySelectorAll("[data-surface-tab]").forEach((button) => {
        button.addEventListener("click", () => setSurface(button.getAttribute("data-surface-tab")));
      });
      const viewportToggle = document.getElementById("ops-viewport-toggle");
      if (viewportToggle) {
        viewportToggle.addEventListener("click", () => {
          setViewportPreference(viewportPreference === "single-screen" ? "document" : "single-screen");
        });
      }
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
      applyViewportPreference();
      setSurface(visibleSurfaces.includes(requestedSurface) ? requestedSurface : (visibleSurfaces[0] || "manager"));

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
      }

      function formatPortalTimestamp(value) {
        if (!value) return "unknown";
        const parsed = Date.parse(value);
        if (!Number.isFinite(parsed)) return String(value);
        return new Date(parsed).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      }

      function titleizeWords(value) {
        return String(value || "").replace(/\b([a-z])/g, function (match) { return match.toUpperCase(); });
      }

      function humanizeToken(value) {
        const normalized = String(value || "").trim();
        if (!normalized) return "Unknown";
        if (/^p\d+$/i.test(normalized)) return normalized.toUpperCase();
        return titleizeWords(normalized.replaceAll("_", " ").replaceAll("-", " "));
      }

      function formatRoleLabel(value) {
        return humanizeToken(value);
      }

      function formatStatusLabel(value) {
        return humanizeToken(value);
      }

      function formatProofModeLabel(value) {
        return humanizeToken(value);
      }

      function formatVerificationClassLabel(value) {
        return humanizeToken(value);
      }

      function formatPriorityLabel(value) {
        return humanizeToken(value);
      }

      function formatEscapeHatchLabel(value) {
        switch (String(value || "")) {
          case "need_help":
            return "Need help";
          case "unsafe":
            return "Unsafe";
          case "missing_tool":
            return "Missing tool";
          case "not_my_role":
            return "Not my role";
          case "already_done":
            return "Already done";
          case "defer_with_reason":
            return "Defer with reason";
          default:
            return humanizeToken(value);
        }
      }

      const memberPortalRoles = ["member", "staff", "admin"];
      const memberOpsRoles = ["owner", "member_ops", "support_ops", "kiln_lead", "floor_staff", "events_ops", "library_ops", "finance_ops"];
      const memberCapabilitySet = new Set(((pageModel.snapshot || {}).session || {}).opsCapabilities || []);
      const memberPermissions = {
        canView: memberCapabilitySet.has("members:view"),
        canCreate: memberCapabilitySet.has("members:create"),
        canEditProfile: memberCapabilitySet.has("members:edit_profile"),
        canEditMembership: memberCapabilitySet.has("members:edit_membership"),
        canEditRole: memberCapabilitySet.has("members:edit_role"),
        canEditOwnerRole: memberCapabilitySet.has("members:edit_owner_role"),
        canEditBilling: memberCapabilitySet.has("members:edit_billing"),
        canPrepareReservations: memberCapabilitySet.has("reservations:prepare"),
      };
      const memberState = {
        rows: Array.isArray(pageModel.snapshot?.members) ? pageModel.snapshot.members.slice() : [],
        reservations: Array.isArray(pageModel.snapshot?.reservations) ? pageModel.snapshot.reservations.slice() : [],
        search: "",
        selectedUid: Array.isArray(pageModel.snapshot?.members) && pageModel.snapshot.members[0] ? pageModel.snapshot.members[0].uid : null,
        activeTab: "overview",
        createMode: memberPermissions.canCreate && Array.isArray(pageModel.snapshot?.members) && pageModel.snapshot.members.length === 0,
        detailCache: {},
        activityCache: {},
        loadingUid: null,
        hydratingUid: null,
      };

      function updateMemberRow(member) {
        if (!member || !member.uid) return;
        const index = memberState.rows.findIndex((row) => row.uid === member.uid);
        if (index >= 0) {
          memberState.rows[index] = member;
        } else {
          memberState.rows.unshift(member);
        }
        memberState.detailCache[member.uid] = member;
      }

      function getMemberRecord(uid) {
        if (!uid) return null;
        return memberState.detailCache[uid] || memberState.rows.find((row) => row.uid === uid) || null;
      }

      function getSelectedMember() {
        return getMemberRecord(memberState.selectedUid);
      }

      function getSelectedActivity() {
        return memberState.selectedUid ? memberState.activityCache[memberState.selectedUid] || null : null;
      }

      function allowedMemberTabs() {
        const tabs = ["overview"];
        tabs.push("context");
        if (memberPermissions.canEditProfile) tabs.push("profile");
        if (memberPermissions.canEditMembership) tabs.push("membership");
        if (memberPermissions.canEditRole) tabs.push("roles");
        if (memberPermissions.canEditBilling) tabs.push("billing");
        return tabs;
      }

      function normalizeMemberTab(tab) {
        const allowed = allowedMemberTabs();
        return allowed.includes(tab) ? tab : allowed[0];
      }

      function memberSearchText(row) {
        return [
          row.displayName,
          row.email || "",
          row.membershipTier || "",
          row.portalRole || "",
          Array.isArray(row.opsRoles) ? row.opsRoles.join(" ") : "",
          Array.isArray(row.opsCapabilities) ? row.opsCapabilities.join(" ") : "",
        ].join(" ").toLowerCase();
      }

      function filteredMemberRows() {
        const query = memberState.search.trim().toLowerCase();
        const rows = memberState.rows.slice().sort((left, right) => String(left.displayName || "").localeCompare(String(right.displayName || "")));
        if (!query) return rows;
        return rows.filter((row) => memberSearchText(row).includes(query));
      }

      function memberRecommendation(member) {
        if (!member) {
          return {
            title: "Pick a member to start",
            body: "Use the roster to load one person into the workbench, then drive profile, membership, role, and billing changes without prompts.",
            tab: "overview",
          };
        }
        if (!member.membershipTier) {
          return {
            title: "Assign the right membership tier",
            body: "This person has no membership tier, so billing, access, and studio expectations are still ambiguous.",
            tab: "membership",
          };
        }
        if (!member.billing?.stripeCustomerId && !member.billing?.paymentMethodSummary) {
          return {
            title: "Attach tokenized billing references",
            body: "Finish the billing profile using Stripe-hosted collection, then store only the safe customer and payment method references here.",
            tab: "billing",
          };
        }
        if (member.portalRole !== "member" && (!Array.isArray(member.opsRoles) || member.opsRoles.length === 0)) {
          return {
            title: "Set the ops role mask",
            body: "This account has elevated portal access without an explicit ops role mask, so the work surface still lacks good boundaries.",
            tab: "roles",
          };
        }
        if (!member.staffNotes) {
          return {
            title: "Capture staff context",
            body: "A short operational note here keeps future handoffs from starting over.",
            tab: "profile",
          };
        }
        return {
          title: "Record is healthy",
          body: "The profile, membership, and billing references are all present. Use the context view to inspect linked reservations or recent activity before making changes.",
          tab: "overview",
        };
      }

      function renderMemberRoster() {
        const roster = document.getElementById("ops-member-roster");
        if (!roster) return;
        if (!memberPermissions.canView) {
          roster.innerHTML = '<div class="ops-empty">This role can use the internet lane, but the member roster is masked.</div>';
          return;
        }
        const rows = filteredMemberRows();
        if (!rows.length) {
          roster.innerHTML = '<div class="ops-empty">No members match that search yet.</div>';
          return;
        }
        roster.innerHTML = rows.map((row) => {
          const selected = !memberState.createMode && memberState.selectedUid === row.uid;
          const recommendation = memberRecommendation(row);
          const roles = Array.isArray(row.opsRoles) && row.opsRoles.length
            ? row.opsRoles.map((role) => \`<span class="ops-pill">\${escapeHtml(formatRoleLabel(role))}</span>\`).join("")
            : '<span class="ops-chip">No ops roles</span>';
          const billingSummary = row.billing?.paymentMethodSummary
            || (row.billing?.stripeCustomerId ? "Tokenized billing refs on file" : "No billing profile on file");
          const actions = [
            \`<button type="button" class="ops-button" data-member-open="\${escapeHtml(row.uid)}" data-member-tab="overview">Focus</button>\`,
            recommendation.tab !== "overview"
              ? \`<button type="button" class="ops-button ops-button-secondary" data-member-open="\${escapeHtml(row.uid)}" data-member-tab="\${escapeHtml(recommendation.tab)}">\${escapeHtml(recommendation.title)}</button>\`
              : "",
            memberPermissions.canEditBilling ? \`<button type="button" class="ops-button ops-button-secondary" data-member-open="\${escapeHtml(row.uid)}" data-member-tab="billing">Billing</button>\` : "",
          ].filter(Boolean).join("");
          return \`
            <article class="ops-case ops-tone-neutral ops-member-roster-card ops-rail-card\${selected ? " is-selected" : ""}" data-member-card="\${escapeHtml(row.uid)}" data-member-open="\${escapeHtml(row.uid)}" data-member-tab="overview">
              <div class="ops-member-roster-card__head">
                <div>
                  <p class="ops-kicker">\${escapeHtml(formatRoleLabel(row.portalRole))} · \${escapeHtml(row.membershipTier || "membership unset")}</p>
                  <h3>\${escapeHtml(row.displayName)}</h3>
                  <p class="ops-summary">\${escapeHtml(row.email || "No email on file.")}</p>
                </div>
                <span class="ops-pill ops-pill-\${row.billing?.stripeCustomerId || row.billing?.paymentMethodSummary ? "good" : "warn"}">\${row.billing?.stripeCustomerId || row.billing?.paymentMethodSummary ? "Billing ready" : "Needs billing"}</span>
              </div>
              <div class="ops-chip-row">\${roles}</div>
              <dl class="ops-member-roster-card__meta">
                <div><dt>Membership</dt><dd>\${escapeHtml(row.membershipTier || "none")}</dd></div>
                <div><dt>Last seen</dt><dd>\${escapeHtml(formatPortalTimestamp(row.lastSeenAt))}</dd></div>
                <div><dt>Billing</dt><dd>\${escapeHtml(billingSummary)}</dd></div>
                <div><dt>Next move</dt><dd>\${escapeHtml(recommendation.title)}</dd></div>
              </dl>
              <div class="ops-member-roster-card__actions">\${actions}</div>
            </article>
          \`;
        }).join("");
      }

      function renderMemberRoleCheckboxes(selectedRoles, disabledAll) {
        return memberOpsRoles.map((role) => {
          const checked = Array.isArray(selectedRoles) && selectedRoles.includes(role);
          const ownerLocked = role === "owner" && !memberPermissions.canEditOwnerRole;
          const disabled = disabledAll || ownerLocked;
          return \`
            <label class="ops-member-checkbox">
              <input type="checkbox" name="opsRoles" value="\${escapeHtml(role)}" \${checked ? "checked" : ""} \${disabled ? "disabled" : ""} />
              <span>\${escapeHtml(formatRoleLabel(role))}</span>
            </label>
          \`;
        }).join("");
      }

      function renderActivityStats(activity) {
        const rows = [
          { label: "Reservations", value: activity?.reservations ?? 0, meta: activity?.lastReservationAt ? \`Last \${formatPortalTimestamp(activity.lastReservationAt)}\` : "No recent reservation" },
          { label: "Support", value: activity?.supportThreads ?? 0, meta: "Active thread history" },
          { label: "Events", value: activity?.events ?? 0, meta: activity?.lastEventAt ? \`Last \${formatPortalTimestamp(activity.lastEventAt)}\` : "No recent event" },
          { label: "Library", value: activity?.libraryLoans ?? 0, meta: activity?.lastLoanAt ? \`Last \${formatPortalTimestamp(activity.lastLoanAt)}\` : "No current loans" },
        ];
        return rows.map((row) => \`
          <article class="ops-member-stat">
            <span>\${escapeHtml(row.label)}</span>
            <strong>\${escapeHtml(row.value)}</strong>
            <p class="ops-summary">\${escapeHtml(row.meta)}</p>
          </article>
        \`).join("");
      }

      function renderMemberOverview(member, activity) {
        const billingSummary = member.billing?.paymentMethodSummary
          || (member.billing?.stripeCustomerId ? "Tokenized billing refs are stored." : "No billing profile has been attached yet.");
        return \`
          <div class="ops-member-pane__split">
            <article class="ops-member-note">
              <p class="ops-kicker">Profile snapshot</p>
              <h3>\${escapeHtml(member.displayName)}</h3>
              <p class="ops-summary">\${escapeHtml(member.email || "No email on file.")}</p>
              <dl class="ops-inline-meta">
                <div><dt>Membership</dt><dd>\${escapeHtml(member.membershipTier || "none")}</dd></div>
                <div><dt>Portal role</dt><dd>\${escapeHtml(formatRoleLabel(member.portalRole))}</dd></div>
                <div><dt>Last seen</dt><dd>\${escapeHtml(formatPortalTimestamp(member.lastSeenAt))}</dd></div>
                <div><dt>Updated</dt><dd>\${escapeHtml(formatPortalTimestamp(member.updatedAt))}</dd></div>
              </dl>
            </article>
            <article class="ops-member-note">
              <p class="ops-kicker">Operational context</p>
              <h3>What the staff lane currently knows</h3>
              <p class="ops-summary"><strong>Kiln preferences:</strong> \${escapeHtml(member.kilnPreferences || "Not recorded yet.")}</p>
              <p class="ops-summary"><strong>Staff notes:</strong> \${escapeHtml(member.staffNotes || "No staff note has been captured yet.")}</p>
              <p class="ops-summary"><strong>Billing:</strong> \${escapeHtml(billingSummary)}</p>
            </article>
          </div>
        \`;
      }

      function renderMemberContextBody(member, activity) {
        const recommendation = memberRecommendation(member);
        const bundles = memberState.reservations.filter((bundle) => bundle.ownerUid && bundle.ownerUid === member.uid).slice(0, 4);
        return \`
          <article class="ops-member-note">
            <p class="ops-kicker">Why this matters</p>
            <h3>\${escapeHtml(recommendation.title)}</h3>
            <p class="ops-summary">\${escapeHtml(recommendation.body)}</p>
            \${recommendation.tab !== "overview" && recommendation.tab !== "context"
              ? \`<div class="ops-actions"><button type="button" class="ops-button" data-member-workbench-tab="\${escapeHtml(recommendation.tab)}">Go to \${escapeHtml(humanizeToken(recommendation.tab))}</button></div>\`
              : ""}
          </article>
          <article class="ops-member-note">
            <p class="ops-kicker">Activity context</p>
            <h3>\${escapeHtml(member.displayName)} in the flow</h3>
            <p class="ops-summary">\${escapeHtml((activity?.reservations ?? 0) + " reservations, " + (activity?.events ?? 0) + " events, " + (activity?.supportThreads ?? 0) + " support threads, and " + (activity?.libraryLoans ?? 0) + " library loans are currently linked.")}</p>
            <p class="ops-summary">Last reservation: \${escapeHtml(formatPortalTimestamp(activity?.lastReservationAt || null))}</p>
          </article>
          <article class="ops-member-note ops-member-safe">
            <p class="ops-kicker">Billing safety</p>
            <h3>\${escapeHtml(member.billing?.paymentMethodSummary || "No safe billing summary on file yet")}</h3>
            <p class="ops-summary">Store only Stripe customer and payment method refs plus safe card summary and billing contact context. Never raw PAN or CVC.</p>
          </article>
          \${bundles.length
            ? bundles.map(renderMemberReservation).join("")
            : '<div class="ops-member-empty-inline">No live reservation bundles are tied to this member right now.</div>'}
        \`;
      }

      function renderMemberWorkbench() {
        const workbench = document.getElementById("ops-member-workbench");
        if (!workbench) return;
        if (!memberPermissions.canView && !memberPermissions.canCreate) {
          workbench.innerHTML = '<div class="ops-empty">This role cannot inspect or create members from the current session.</div>';
          return;
        }
        if (memberState.createMode) {
          if (!memberPermissions.canCreate) {
            workbench.innerHTML = '<div class="ops-empty">This role cannot create new members.</div>';
            return;
          }
          workbench.innerHTML = \`
            <article class="ops-member-stage">
              <div class="ops-member-stage__header">
                <div>
                  <p class="ops-kicker">New member</p>
                  <h2>Create a clean account record</h2>
                  <p class="ops-summary">Start with identity and access, then refocus the stage into billing-safe follow-through after the account exists.</p>
                </div>
                <div class="ops-chip-row">
                  <span class="ops-chip is-selected">Create</span>
                  <span class="ops-pill ops-pill-warn">Billing follows later</span>
                </div>
              </div>
              <div class="ops-member-stage__spotlight">
                <article class="ops-member-note">
                  <p class="ops-kicker">Creation path</p>
                  <h3>Open the account, then enrich it</h3>
                  <p class="ops-summary">Use this stage for identity, membership, and role mask. Billing and arrival context become available immediately after creation.</p>
                </article>
                <article class="ops-member-note ops-member-safe">
                  <p class="ops-kicker">Safety rule</p>
                  <h3>Never type raw card numbers here</h3>
                  <p class="ops-summary">After you create the member, use Stripe-hosted collection and store only the customer, payment method, and safe card summary references here.</p>
                </article>
              </div>
              <div class="ops-member-stage__body">
                <form class="ops-compose-form" id="ops-member-create-form">
                  <div class="ops-member-form-grid">
                    <label class="ops-field">
                      <span>Email</span>
                      <input type="email" name="email" required placeholder="member@example.com" />
                    </label>
                    <label class="ops-field">
                      <span>Display name</span>
                      <input type="text" name="displayName" required placeholder="Member name" />
                    </label>
                    <label class="ops-field">
                      <span>Membership tier</span>
                      <input type="text" name="membershipTier" list="ops-membership-tier-options" placeholder="community" />
                    </label>
                    <label class="ops-field">
                      <span>Portal role</span>
                      <select name="portalRole">
                        \${memberPortalRoles.map((role) => \`<option value="\${escapeHtml(role)}"\${role === "member" ? " selected" : ""}>\${escapeHtml(formatRoleLabel(role))}</option>\`).join("")}
                      </select>
                    </label>
                    <label class="ops-field">
                      <span>Kiln preferences</span>
                      <input type="text" name="kilnPreferences" placeholder="Cone 6 preferred" />
                    </label>
                    <div class="ops-field ops-span-2">
                      <span>Ops roles</span>
                      <div class="ops-member-role-grid">
                        \${renderMemberRoleCheckboxes([], false)}
                      </div>
                    </div>
                    <label class="ops-field ops-span-2">
                      <span>Staff notes</span>
                      <textarea name="staffNotes" rows="4" placeholder="Anything future staff should know about this person."></textarea>
                    </label>
                    <label class="ops-field ops-span-2">
                      <span>Why are we creating this member?</span>
                      <textarea name="reason" rows="3" placeholder="Onboarded from the member ops lane."></textarea>
                    </label>
                  </div>
                  <div class="ops-actions">
                    <button type="submit" class="ops-button">Create member</button>
                  </div>
                </form>
                <article class="ops-member-note">
                  <p class="ops-kicker">After create</p>
                  <h3>The stage will refocus on the new account</h3>
                  <p class="ops-summary">Once the account exists, this same surface flips into overview, membership, roles, billing, and context views without sending staff to another page.</p>
                </article>
              </div>
            </article>
          \`;
          bindMemberWorkbenchHandlers();
          return;
        }
        const member = getSelectedMember();
        if (!member) {
          workbench.innerHTML = '<div class="ops-empty">Select a member from the roster to open the workbench.</div>';
          return;
        }
        const activity = getSelectedActivity();
        const recommendation = memberRecommendation(member);
        const selectedTab = normalizeMemberTab(memberState.activeTab);
        memberState.activeTab = selectedTab;
        const selectedRoles = Array.isArray(member.opsRoles) ? member.opsRoles : [];
        const roleLocked = member.uid === pageModel.snapshot?.session?.actorId || (selectedRoles.includes("owner") && !memberPermissions.canEditOwnerRole);
        const billingSummary = member.billing?.paymentMethodSummary
          || (member.billing?.stripeCustomerId ? "Tokenized billing refs on file." : "No billing profile attached yet.");
        const tabButtons = allowedMemberTabs().map((tab) => \`
          <button type="button" class="ops-member-tab\${tab === selectedTab ? " is-active" : ""}" data-member-workbench-tab="\${escapeHtml(tab)}">\${escapeHtml(humanizeToken(tab))}</button>
        \`).join("");
        let body = "";
        if (selectedTab === "overview") {
          body = renderMemberOverview(member, activity);
        } else if (selectedTab === "context") {
          body = renderMemberContextBody(member, activity);
        } else if (selectedTab === "profile") {
          body = \`
            <article class="ops-member-pane">
              <p class="ops-kicker">Profile</p>
              <h3>Edit the human-readable record</h3>
              <form class="ops-compose-form" id="ops-member-profile-form">
                <div class="ops-member-form-grid">
                  <label class="ops-field">
                    <span>Display name</span>
                    <input type="text" name="displayName" value="\${escapeHtml(member.displayName || "")}" required />
                  </label>
                  <label class="ops-field">
                    <span>Kiln preferences</span>
                    <input type="text" name="kilnPreferences" value="\${escapeHtml(member.kilnPreferences || "")}" placeholder="Cone 6 preferred" />
                  </label>
                  <label class="ops-field ops-span-2">
                    <span>Staff notes</span>
                    <textarea name="staffNotes" rows="5" placeholder="Operational context for future staff.">\${escapeHtml(member.staffNotes || "")}</textarea>
                  </label>
                  <label class="ops-field ops-span-2">
                    <span>Reason for change</span>
                    <textarea name="reason" rows="3" placeholder="Why this profile update matters right now."></textarea>
                  </label>
                </div>
                <div class="ops-actions"><button type="submit" class="ops-button">Save profile</button></div>
              </form>
            </article>
          \`;
        } else if (selectedTab === "membership") {
          body = \`
            <article class="ops-member-pane">
              <p class="ops-kicker">Membership</p>
              <h3>Control the studio promise and billing posture</h3>
              <form class="ops-compose-form" id="ops-member-membership-form">
                <div class="ops-member-form-grid">
                  <label class="ops-field">
                    <span>Membership tier</span>
                    <input type="text" name="membershipTier" list="ops-membership-tier-options" value="\${escapeHtml(member.membershipTier || "")}" placeholder="community" />
                  </label>
                  <div class="ops-member-note">
                    <p class="ops-kicker">Why it matters</p>
                    <h3>Membership drives follow-through</h3>
                    <p class="ops-summary">This tier affects how staff triage follow-up, what billing assumptions are safe, and what the studio owes this member next.</p>
                  </div>
                  <label class="ops-field ops-span-2">
                    <span>Reason for change</span>
                    <textarea name="reason" rows="3" placeholder="Why this membership change is happening."></textarea>
                  </label>
                </div>
                <div class="ops-actions"><button type="submit" class="ops-button">Save membership</button></div>
              </form>
            </article>
          \`;
        } else if (selectedTab === "roles") {
          body = \`
            <article class="ops-member-pane">
              <p class="ops-kicker">Roles and access</p>
              <h3>Set the human role mask, not just the portal badge</h3>
              \${roleLocked ? '<div class="ops-member-note ops-member-safe"><p class="ops-kicker">Protected</p><h3>This role mask is locked in this session</h3><p class="ops-summary">You cannot change your own access here, and owner role assignments stay protected unless this session carries explicit owner-edit capability.</p></div>' : ""}
              <form class="ops-compose-form" id="ops-member-role-form">
                <div class="ops-member-form-grid">
                  <label class="ops-field">
                    <span>Portal role</span>
                    <select name="portalRole" \${roleLocked ? "disabled" : ""}>
                      \${memberPortalRoles.map((role) => \`<option value="\${escapeHtml(role)}"\${member.portalRole === role ? " selected" : ""}>\${escapeHtml(formatRoleLabel(role))}</option>\`).join("")}
                    </select>
                  </label>
                  <div class="ops-field ops-span-2">
                    <span>Ops roles</span>
                    <div class="ops-member-role-grid">
                      \${renderMemberRoleCheckboxes(selectedRoles, roleLocked)}
                    </div>
                  </div>
                  <label class="ops-field ops-span-2">
                    <span>Reason for change</span>
                    <textarea name="reason" rows="3" placeholder="Why this access mask should change." \${roleLocked ? "disabled" : ""}></textarea>
                  </label>
                </div>
                <div class="ops-actions"><button type="submit" class="ops-button" \${roleLocked ? "disabled" : ""}>Save roles</button></div>
              </form>
            </article>
          \`;
        } else if (selectedTab === "billing") {
          body = \`
            <article class="ops-member-pane">
              <p class="ops-kicker">Billing-safe profile</p>
              <h3>Store only tokenized references and safe summaries</h3>
              <p class="ops-summary">\${escapeHtml(billingSummary)}</p>
              <form class="ops-compose-form" id="ops-member-billing-form">
                <div class="ops-member-form-grid">
                  <label class="ops-field">
                    <span>Stripe customer ID</span>
                    <input type="text" name="stripeCustomerId" value="\${escapeHtml(member.billing?.stripeCustomerId || "")}" placeholder="cus_..." />
                  </label>
                  <label class="ops-field">
                    <span>Default payment method ID</span>
                    <input type="text" name="defaultPaymentMethodId" value="\${escapeHtml(member.billing?.defaultPaymentMethodId || "")}" placeholder="pm_..." />
                  </label>
                  <label class="ops-field">
                    <span>Card brand</span>
                    <input type="text" name="cardBrand" value="\${escapeHtml(member.billing?.cardBrand || "")}" placeholder="Visa" />
                  </label>
                  <label class="ops-field">
                    <span>Last 4</span>
                    <input type="text" name="cardLast4" value="\${escapeHtml(member.billing?.cardLast4 || "")}" placeholder="4242" maxlength="4" />
                  </label>
                  <label class="ops-field">
                    <span>Exp month</span>
                    <input type="text" name="expMonth" value="\${escapeHtml(member.billing?.expMonth || "")}" placeholder="08" />
                  </label>
                  <label class="ops-field">
                    <span>Exp year</span>
                    <input type="text" name="expYear" value="\${escapeHtml(member.billing?.expYear || "")}" placeholder="2030" />
                  </label>
                  <label class="ops-field">
                    <span>Billing contact name</span>
                    <input type="text" name="billingContactName" value="\${escapeHtml(member.billing?.billingContactName || "")}" />
                  </label>
                  <label class="ops-field">
                    <span>Billing contact email</span>
                    <input type="email" name="billingContactEmail" value="\${escapeHtml(member.billing?.billingContactEmail || "")}" />
                  </label>
                  <label class="ops-field">
                    <span>Billing contact phone</span>
                    <input type="text" name="billingContactPhone" value="\${escapeHtml(member.billing?.billingContactPhone || "")}" />
                  </label>
                  <div class="ops-member-note ops-member-safe">
                    <p class="ops-kicker">Protected path</p>
                    <h3>Never type raw card numbers here</h3>
                    <p class="ops-summary">Collect cards in Stripe-hosted flows only. This form stores safe references and summary fields, never PAN or CVC.</p>
                  </div>
                  <label class="ops-field ops-span-2">
                    <span>Reason for change</span>
                    <textarea name="reason" rows="3" placeholder="Why this billing-safe profile changed."></textarea>
                  </label>
                </div>
                <div class="ops-actions"><button type="submit" class="ops-button">Save billing profile</button></div>
              </form>
            </article>
          \`;
        }
        workbench.innerHTML = \`
          <article class="ops-member-stage">
            <div class="ops-member-stage__header">
              <div>
                <p class="ops-kicker">Focus stage</p>
                <h2>\${escapeHtml(member.displayName)}</h2>
                <p class="ops-summary">\${escapeHtml(member.email || "No email on file.")}</p>
              </div>
              <div class="ops-member-workbench__tabs">\${tabButtons}</div>
            </div>
            <div class="ops-chip-row">
              <span class="ops-pill">\${escapeHtml(formatRoleLabel(member.portalRole))}</span>
              <span class="ops-pill">\${escapeHtml(member.membershipTier || "membership unset")}</span>
              \${(member.opsRoles || []).map((role) => \`<span class="ops-pill">\${escapeHtml(formatRoleLabel(role))}</span>\`).join("") || '<span class="ops-chip">No ops roles</span>'}
            </div>
            <div class="ops-member-stage__spotlight">
              <article class="ops-member-note">
                <p class="ops-kicker">Recommended next move</p>
                <h3>\${escapeHtml(recommendation.title)}</h3>
                <p class="ops-summary">\${escapeHtml(recommendation.body)}</p>
                \${recommendation.tab !== selectedTab && recommendation.tab !== "context"
                  ? \`<div class="ops-actions"><button type="button" class="ops-button" data-member-workbench-tab="\${escapeHtml(recommendation.tab)}">Focus \${escapeHtml(humanizeToken(recommendation.tab))}</button></div>\`
                  : ""}
              </article>
              <div class="ops-member-activity-grid">
                \${renderActivityStats(activity)}
              </div>
            </div>
            <div class="ops-member-stage__body">\${body}</div>
          </article>
        \`;
        bindMemberWorkbenchHandlers();
      }

      function renderMemberReservation(bundle) {
        const tone = bundle.degradeReason ? "warn" : (bundle.arrival?.status === "arrived" ? "good" : "neutral");
        return \`
          <article class="ops-member-reservation ops-tone-\${tone}">
            <p class="ops-kicker">\${escapeHtml(bundle.status)} · \${escapeHtml(bundle.firingType)} · \${escapeHtml(bundle.arrival?.status || "expected")}</p>
            <h3>\${escapeHtml(bundle.title)}</h3>
            <p class="ops-summary">\${escapeHtml(bundle.arrival?.summary || "Arrival context is pending.")}</p>
            <dl class="ops-meta-grid">
              <div><dt>Due</dt><dd>\${escapeHtml(formatPortalTimestamp(bundle.dueAt))}</dd></div>
              <div><dt>Items</dt><dd>\${escapeHtml(bundle.itemCount)}</dd></div>
              <div class="ops-span-2"><dt>Prep</dt><dd>\${escapeHtml(bundle.prep?.summary || "Prep summary unavailable.")}</dd></div>
            </dl>
            \${memberPermissions.canPrepareReservations ? \`<div class="ops-actions"><button type="button" class="ops-button ops-button-secondary" data-member-reservation-prepare="\${escapeHtml(bundle.reservationId)}">Stage prep task</button></div>\` : ""}
          </article>
        \`;
      }

      async function hydrateMember(uid) {
        if (!uid || !memberPermissions.canView) return;
        memberState.hydratingUid = uid;
        try {
          const [memberPayload, activityPayload] = await Promise.all([
            getJson("/api/ops/members/" + encodeURIComponent(uid)),
            getJson("/api/ops/members/" + encodeURIComponent(uid) + "/activity"),
          ]);
          if (memberPayload?.member) {
            updateMemberRow(memberPayload.member);
          }
          if (activityPayload?.activity) {
            memberState.activityCache[uid] = activityPayload.activity;
          }
          renderMemberRoster();
          renderMemberWorkbench();
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        } finally {
          memberState.hydratingUid = null;
        }
      }

      function openMemberWorkbench(uid, tab) {
        memberState.createMode = false;
        memberState.selectedUid = uid;
        memberState.activeTab = normalizeMemberTab(tab || "overview");
        renderMemberRoster();
        renderMemberWorkbench();
        hydrateMember(uid);
      }

      async function handleMemberCreateSubmit(form) {
        const formData = new FormData(form);
        try {
          const payload = await postJson("/api/ops/members", {
            email: String(formData.get("email") || "").trim(),
            displayName: String(formData.get("displayName") || "").trim(),
            membershipTier: String(formData.get("membershipTier") || "").trim() || null,
            portalRole: String(formData.get("portalRole") || "member").trim(),
            opsRoles: formData.getAll("opsRoles").map((entry) => String(entry).trim()).filter(Boolean),
            kilnPreferences: String(formData.get("kilnPreferences") || "").trim() || null,
            staffNotes: String(formData.get("staffNotes") || "").trim() || null,
            reason: String(formData.get("reason") || "").trim() || null,
          });
          if (payload?.member) {
            updateMemberRow(payload.member);
            memberState.selectedUid = payload.member.uid;
            memberState.createMode = false;
            memberState.activeTab = "overview";
            renderMemberRoster();
            renderMemberWorkbench();
            showBanner("Member created. The workbench is now focused on the new account.", "success");
            hydrateMember(payload.member.uid);
          }
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      async function handleMemberProfileSubmit(form) {
        const member = getSelectedMember();
        if (!member) return;
        const formData = new FormData(form);
        try {
          const payload = await postJson("/api/ops/members/" + encodeURIComponent(member.uid) + "/profile", {
            reason: String(formData.get("reason") || "").trim() || null,
            patch: {
              displayName: String(formData.get("displayName") || "").trim(),
              kilnPreferences: String(formData.get("kilnPreferences") || "").trim() || null,
              staffNotes: String(formData.get("staffNotes") || "").trim() || null,
            },
          });
          if (payload?.member) {
            updateMemberRow(payload.member);
            renderMemberRoster();
            renderMemberWorkbench();
            showBanner("Member profile updated.", "success");
          }
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      async function handleMemberMembershipSubmit(form) {
        const member = getSelectedMember();
        if (!member) return;
        const formData = new FormData(form);
        try {
          const payload = await postJson("/api/ops/members/" + encodeURIComponent(member.uid) + "/membership", {
            membershipTier: String(formData.get("membershipTier") || "").trim() || null,
            reason: String(formData.get("reason") || "").trim() || null,
          });
          if (payload?.member) {
            updateMemberRow(payload.member);
            renderMemberRoster();
            renderMemberWorkbench();
            showBanner("Membership updated.", "success");
          }
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      async function handleMemberRoleSubmit(form) {
        const member = getSelectedMember();
        if (!member) return;
        const formData = new FormData(form);
        try {
          const payload = await postJson("/api/ops/members/" + encodeURIComponent(member.uid) + "/role", {
            portalRole: String(formData.get("portalRole") || member.portalRole).trim(),
            opsRoles: formData.getAll("opsRoles").map((entry) => String(entry).trim()).filter(Boolean),
            reason: String(formData.get("reason") || "").trim() || null,
          });
          if (payload?.member) {
            updateMemberRow(payload.member);
            renderMemberRoster();
            renderMemberWorkbench();
            showBanner("Role mask updated.", "success");
          }
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      async function handleMemberBillingSubmit(form) {
        const member = getSelectedMember();
        if (!member) return;
        const formData = new FormData(form);
        try {
          const payload = await postJson("/api/ops/members/" + encodeURIComponent(member.uid) + "/billing", {
            reason: String(formData.get("reason") || "").trim() || null,
            billing: {
              stripeCustomerId: String(formData.get("stripeCustomerId") || "").trim() || null,
              defaultPaymentMethodId: String(formData.get("defaultPaymentMethodId") || "").trim() || null,
              cardBrand: String(formData.get("cardBrand") || "").trim() || null,
              cardLast4: String(formData.get("cardLast4") || "").trim() || null,
              expMonth: String(formData.get("expMonth") || "").trim() || null,
              expYear: String(formData.get("expYear") || "").trim() || null,
              billingContactName: String(formData.get("billingContactName") || "").trim() || null,
              billingContactEmail: String(formData.get("billingContactEmail") || "").trim() || null,
              billingContactPhone: String(formData.get("billingContactPhone") || "").trim() || null,
            },
          });
          if (payload?.member) {
            updateMemberRow(payload.member);
            renderMemberRoster();
            renderMemberWorkbench();
            showBanner("Billing-safe member profile updated.", "success");
          }
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      async function handleMemberReservationPrepare(reservationId) {
        try {
          await postJson("/api/ops/reservations/" + encodeURIComponent(reservationId) + "/prepare", {
            actorId: "staff:local-portal",
          });
          showBanner("Prep task is staged for that reservation bundle. Refresh the hands lane to see it in queue.", "success");
        } catch (error) {
          showBanner(error instanceof Error ? error.message : String(error), "error");
        }
      }

      function bindMemberWorkbenchHandlers() {
        const workbench = document.getElementById("ops-member-workbench");
        if (!workbench) return;
        const createForm = document.getElementById("ops-member-create-form");
        if (createForm) {
          createForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await handleMemberCreateSubmit(createForm);
          }, { once: true });
        }
        const profileForm = document.getElementById("ops-member-profile-form");
        if (profileForm) {
          profileForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await handleMemberProfileSubmit(profileForm);
          }, { once: true });
        }
        const membershipForm = document.getElementById("ops-member-membership-form");
        if (membershipForm) {
          membershipForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await handleMemberMembershipSubmit(membershipForm);
          }, { once: true });
        }
        const roleForm = document.getElementById("ops-member-role-form");
        if (roleForm) {
          roleForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await handleMemberRoleSubmit(roleForm);
          }, { once: true });
        }
        const billingForm = document.getElementById("ops-member-billing-form");
        if (billingForm) {
          billingForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            await handleMemberBillingSubmit(billingForm);
          }, { once: true });
        }
        workbench.querySelectorAll("[data-member-reservation-prepare]").forEach((button) => {
          button.addEventListener("click", async () => {
            await handleMemberReservationPrepare(button.getAttribute("data-member-reservation-prepare"));
          }, { once: true });
        });
        workbench.querySelectorAll("[data-member-workbench-tab]").forEach((button) => {
          button.addEventListener("click", () => {
            memberState.activeTab = normalizeMemberTab(button.getAttribute("data-member-workbench-tab") || "overview");
            renderMemberWorkbench();
          });
        });
      }

      const memberSearch = document.getElementById("ops-member-search");
      if (memberSearch) {
        memberSearch.addEventListener("input", () => {
          memberState.search = memberSearch.value || "";
          renderMemberRoster();
        });
      }
      const memberCreateTrigger = document.getElementById("ops-member-create-trigger");
        if (memberCreateTrigger) {
          memberCreateTrigger.addEventListener("click", () => {
            memberState.createMode = true;
            memberState.activeTab = "overview";
            renderMemberRoster();
            renderMemberWorkbench();
          });
        }
      document.addEventListener("click", (event) => {
        const target = event.target && typeof event.target.closest === "function"
          ? event.target.closest("[data-member-open]")
          : null;
        if (!target) return;
        const uid = target.getAttribute("data-member-open");
        if (!uid) return;
        openMemberWorkbench(uid, target.getAttribute("data-member-tab") || "overview");
      });
      if (document.getElementById("ops-member-roster")) {
        renderMemberRoster();
        renderMemberWorkbench();
        if (memberState.selectedUid && !memberState.createMode) {
          hydrateMember(memberState.selectedUid);
        }
      }

      function taskTone(status) {
        if (status === "healthy" || status === "ready" || status === "verified" || status === "approved") return "good";
        if (status === "warning" || status === "degraded" || status === "proof_pending" || status === "pending") return "warn";
        if (status === "critical" || status === "blocked" || status === "rejected" || status === "canceled") return "danger";
        return "neutral";
      }

      function isClientActiveTask(task) {
        if (!task || !task.status) return false;
        return ["verified", "resolved", "rejected", "canceled"].indexOf(task.status) === -1;
      }

      function joinOrFallback(values, fallback) {
        return Array.isArray(values) && values.length ? values.join(", ") : fallback;
      }

      function checklistHtml(task) {
        if (!Array.isArray(task.checklist) || !task.checklist.length) {
          return "<li>No checklist has been generated yet.</li>";
        }
        return task.checklist.map(function (item) {
          return "<li><strong>" + escapeHtml(item.label) + "</strong>" + (item.detail ? " · " + escapeHtml(item.detail) : "") + "</li>";
        }).join("");
      }

      async function submitTaskEscape(taskId, hatch, reason) {
        const trimmedReason = String(reason || "").trim();
        if (!trimmedReason) {
          throw new Error("Add one sentence so the manager knows why this task needs a different path.");
        }
        await postJson("/api/ops/tasks/" + encodeURIComponent(taskId) + "/escape", {
          actorId: "staff:local-portal",
          escapeHatch: hatch,
          reason: trimmedReason,
        });
        showBanner("The manager now sees this task as blocked and routed for reconciliation.", "success");
      }

      function bindTaskActionButtons(root) {
        if (!root) return;
        root.querySelectorAll("[data-task-claim]").forEach(function (button) {
          if (button.dataset.opsBoundClaim === "1") return;
          button.dataset.opsBoundClaim = "1";
          button.addEventListener("click", async function () {
            try {
              await postJson("/api/ops/tasks/" + encodeURIComponent(button.getAttribute("data-task-claim")) + "/claim", { actorId: "staff:local-portal" });
              showBanner("Task claimed. Refresh to see the updated assignment state.", "success");
            } catch (error) {
              showBanner(error instanceof Error ? error.message : String(error), "error");
            }
          });
        });
        root.querySelectorAll("[data-task-proof]").forEach(function (button) {
          if (button.dataset.opsBoundProof === "1") return;
          button.dataset.opsBoundProof = "1";
          button.addEventListener("click", async function () {
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
        root.querySelectorAll("[data-task-complete]").forEach(function (button) {
          if (button.dataset.opsBoundComplete === "1") return;
          button.dataset.opsBoundComplete = "1";
          button.addEventListener("click", async function () {
            try {
              await postJson("/api/ops/tasks/" + encodeURIComponent(button.getAttribute("data-task-complete")) + "/complete", { actorId: "staff:local-portal" });
              showBanner("Task completion recorded. If proof is still pending, the truth rail will keep it visibly unverified.", "success");
            } catch (error) {
              showBanner(error instanceof Error ? error.message : String(error), "error");
            }
          });
        });
      }

      const handsState = {
        tasks: Array.isArray(pageModel.snapshot?.tasks) ? pageModel.snapshot.tasks.filter(function (task) { return task.surface === "hands"; }) : [],
        search: "",
        selectedTaskId: null,
        escapeHatch: null,
        escapeReason: "",
      };
      handsState.selectedTaskId = ((handsState.tasks.find(function (task) { return isClientActiveTask(task); }) || handsState.tasks[0] || {}).id) || null;

      function getHandsTask(taskId) {
        if (!taskId) return null;
        return handsState.tasks.find(function (task) { return task.id === taskId; }) || null;
      }

      function filteredHandsTasks() {
        const query = (handsState.search || "").trim().toLowerCase();
        const rows = handsState.tasks.slice();
        if (!query) return rows;
        return rows.filter(function (task) {
          return [
            task.title,
            task.zone,
            task.role,
            task.status,
            task.whyNow,
          ].join(" ").toLowerCase().includes(query);
        });
      }

      function renderHandsQueueRail() {
        const rail = document.getElementById("ops-hands-queue-rail");
        if (!rail) return;
        const tasks = filteredHandsTasks();
        if (!tasks.length) {
          rail.innerHTML = '<div class="ops-empty">No physical tasks match that filter.</div>';
          return;
        }
        rail.innerHTML = tasks.map(function (task) {
          const selected = handsState.selectedTaskId === task.id;
          return '<article class="ops-task-card ops-tone-' + escapeHtml(taskTone(task.status)) + ' ops-rail-card' + (selected ? ' is-selected' : '') + '">' +
            '<div class="ops-rail-card__head">' +
              '<div>' +
                '<p class="ops-kicker">' + escapeHtml(humanizeToken(task.surface)) + ' lane · ' + escapeHtml(formatRoleLabel(task.role)) + ' · ' + escapeHtml(task.zone) + '</p>' +
                '<h3>' + escapeHtml(task.title) + '</h3>' +
                '<p class="ops-summary">' + escapeHtml(task.whyNow) + '</p>' +
              '</div>' +
              '<span class="ops-pill ops-pill-' + escapeHtml(taskTone(task.status)) + '">' + escapeHtml(formatStatusLabel(task.status)) + '</span>' +
            '</div>' +
            '<dl class="ops-rail-card__meta">' +
              '<div><dt>Priority</dt><dd>' + escapeHtml(formatPriorityLabel(task.priority)) + '</dd></div>' +
              '<div><dt>ETA</dt><dd>' + escapeHtml(task.etaMinutes === null ? "unknown" : (task.etaMinutes + " min")) + '</dd></div>' +
              '<div><dt>Due</dt><dd>' + escapeHtml(formatPortalTimestamp(task.dueAt)) + '</dd></div>' +
              '<div><dt>Proof</dt><dd>' + escapeHtml(formatProofModeLabel(task.preferredProofMode)) + '</dd></div>' +
            '</dl>' +
            '<div class="ops-actions"><button type="button" class="ops-button" data-hands-open-task="' + escapeHtml(task.id) + '">Open task</button></div>' +
          '</article>';
        }).join("");
      }

      function renderHandsWorkbench() {
        const workbench = document.getElementById("ops-hands-workbench");
        if (!workbench) return;
        const task = getHandsTask(handsState.selectedTaskId);
        if (!task) {
          workbench.innerHTML = '<div class="ops-empty">Select a task from the queue to open its full instructions, proof path, and blocker exits.</div>';
          return;
        }
        if (!handsState.escapeHatch || (task.blockerEscapeHatches || []).indexOf(handsState.escapeHatch) === -1) {
          handsState.escapeHatch = (task.blockerEscapeHatches || [])[0] || null;
          handsState.escapeReason = "";
        }
        const escapeButtons = (task.blockerEscapeHatches || []).map(function (entry) {
          const selected = handsState.escapeHatch === entry;
          return '<button type="button" class="ops-chip' + (selected ? ' is-selected' : '') + '" data-task-escape-select="' + escapeHtml(entry) + '">' + escapeHtml(formatEscapeHatchLabel(entry)) + '</button>';
        }).join("");
        const fallbackProofModes = (task.proofModes || []).slice(1).map(function (entry) { return formatProofModeLabel(entry); }).join(", ");
        workbench.innerHTML = '<article class="ops-task-card ops-tone-' + escapeHtml(taskTone(task.status)) + '">' +
          '<div class="ops-task-card__head">' +
            '<div>' +
              '<p class="ops-kicker">' + escapeHtml(humanizeToken(task.surface)) + ' lane · ' + escapeHtml(formatRoleLabel(task.role)) + ' · ' + escapeHtml(task.zone) + '</p>' +
              '<h3>' + escapeHtml(task.title) + '</h3>' +
            '</div>' +
            '<div class="ops-task-card__badges">' +
              '<span class="ops-pill ops-pill-' + escapeHtml(taskTone(task.status)) + '">' + escapeHtml(formatStatusLabel(task.status)) + '</span>' +
              '<span class="ops-pill">' + escapeHtml(formatPriorityLabel(task.priority)) + '</span>' +
            '</div>' +
          '</div>' +
          '<p class="ops-summary">' + escapeHtml(task.whyNow) + '</p>' +
          '<dl class="ops-task-grid">' +
            '<div><dt>Why now</dt><dd>' + escapeHtml(task.whyNow) + '</dd></div>' +
            '<div><dt>Why you</dt><dd>' + escapeHtml(task.whyYou) + '</dd></div>' +
            '<div><dt>Consequence if delayed</dt><dd>' + escapeHtml(task.consequenceIfDelayed) + '</dd></div>' +
            '<div><dt>Freshness / confidence</dt><dd>' + escapeHtml(formatPortalTimestamp(task.freshestAt)) + ' · ' + escapeHtml(Math.round(Math.max(0, Math.min(1, task.confidence || 0)) * 100) + "%") + '</dd></div>' +
            '<div><dt>Evidence</dt><dd>' + escapeHtml(task.evidenceSummary) + '</dd></div>' +
            '<div><dt>Tools</dt><dd>' + escapeHtml(joinOrFallback(task.toolsNeeded, "Use standard station tools.")) + '</dd></div>' +
            '<div><dt>Done definition</dt><dd>' + escapeHtml(task.doneDefinition) + '</dd></div>' +
            '<div><dt>Proof path</dt><dd>' + escapeHtml(formatProofModeLabel(task.preferredProofMode)) + (fallbackProofModes ? ' (fallbacks: ' + escapeHtml(fallbackProofModes) + ')' : '') + '</dd></div>' +
            '<div class="ops-span-2"><dt>If the signal path is missing</dt><dd>' + escapeHtml(task.fallbackIfSignalMissing) + '</dd></div>' +
          '</dl>' +
          '<div class="ops-subpanel"><h4>How to do it</h4><ol>' + (task.instructions || []).map(function (line) { return '<li>' + escapeHtml(line) + '</li>'; }).join("") + '</ol></div>' +
          '<div class="ops-subpanel"><h4>Checklist</h4><ul>' + checklistHtml(task) + '</ul></div>' +
          '<div class="ops-subpanel"><h4>Need help instead?</h4><p class="ops-summary">Choose the blocker and leave one sentence so the manager can reroute this cleanly.</p><div class="ops-chip-row">' + escapeButtons + '</div><form class="ops-compose-form" id="ops-task-reroute-form"><textarea name="reason" rows="3" placeholder="What blocked this task, and what should happen next?">' + escapeHtml(handsState.escapeReason || "") + '</textarea><div class="ops-actions"><button type="submit" class="ops-button ops-button-secondary"' + (handsState.escapeHatch ? '' : ' disabled') + '>Send to manager</button></div></form></div>' +
          '<div class="ops-actions">' +
            '<button type="button" class="ops-button" data-task-claim="' + escapeHtml(task.id) + '">Claim</button>' +
            '<button type="button" class="ops-button ops-button-secondary" data-task-proof="' + escapeHtml(task.id) + '" data-task-proof-mode="' + escapeHtml(task.preferredProofMode) + '">Proof</button>' +
            '<button type="button" class="ops-button ops-button-secondary" data-task-complete="' + escapeHtml(task.id) + '">Complete</button>' +
          '</div>' +
        '</article>';
        bindTaskActionButtons(workbench);
        workbench.querySelectorAll("[data-task-escape-select]").forEach(function (button) {
          button.addEventListener("click", function () {
            handsState.escapeHatch = button.getAttribute("data-task-escape-select");
            renderHandsWorkbench();
          }, { once: true });
        });
        const rerouteForm = document.getElementById("ops-task-reroute-form");
        if (rerouteForm) {
          const reasonField = rerouteForm.querySelector("textarea");
          if (reasonField) {
            reasonField.addEventListener("input", function () {
              handsState.escapeReason = reasonField.value || "";
            });
          }
          rerouteForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            try {
              await submitTaskEscape(task.id, handsState.escapeHatch, reasonField ? reasonField.value : "");
            } catch (error) {
              showBanner(error instanceof Error ? error.message : String(error), "error");
            }
          }, { once: true });
        }
      }

      const supportState = {
        threads: Array.isArray(pageModel.snapshot?.conversations) ? pageModel.snapshot.conversations.slice() : [],
        tasks: Array.isArray(pageModel.snapshot?.tasks) ? pageModel.snapshot.tasks.filter(function (task) { return task.surface === "internet"; }) : [],
        cases: Array.isArray(pageModel.snapshot?.cases) ? pageModel.snapshot.cases.filter(function (entry) { return entry.lane === "internet" || entry.kind === "support_thread" || entry.kind === "event" || entry.kind === "complaint"; }) : [],
        approvals: Array.isArray(pageModel.snapshot?.approvals) ? pageModel.snapshot.approvals.filter(function (entry) { return entry.status === "pending"; }) : [],
        search: "",
        selectedThreadId: null,
      };
      supportState.selectedThreadId = ((supportState.threads.find(function (row) { return !!row.unread; }) || supportState.threads[0] || {}).id) || null;

      function getSupportThread(threadId) {
        if (!threadId) return null;
        return supportState.threads.find(function (row) { return row.id === threadId; }) || null;
      }

      function filteredSupportThreads() {
        const query = (supportState.search || "").trim().toLowerCase();
        if (!query) return supportState.threads.slice();
        return supportState.threads.filter(function (row) {
          return [
            row.senderIdentity,
            row.roleMask,
            row.summary,
          ].join(" ").toLowerCase().includes(query);
        });
      }

      function supportNextMove(thread) {
        if (!thread) {
          return { title: "Pick a thread", body: "Select a thread from the left rail to see the safest next reply move and any linked tasks or approvals." };
        }
        if (thread.unread) {
          return { title: "Read and draft first response", body: "This thread is unread in the current session, so the next best move is to draft a safe reply before context is lost." };
        }
        if (supportState.approvals.length) {
          return { title: "Check approval posture", body: "The internet lane has pending approvals, so make sure this reply does not cross one of those boundaries without owner signoff." };
        }
        return { title: "Close the loop cleanly", body: "This thread looks readable and low-drama. Draft the next response or document why it is waiting." };
      }

      function renderSupportThreadRail() {
        const rail = document.getElementById("ops-support-thread-rail");
        if (!rail) return;
        const rows = filteredSupportThreads();
        if (!rows.length) {
          rail.innerHTML = '<div class="ops-empty">No support threads match that filter.</div>';
          return;
        }
        rail.innerHTML = rows.map(function (row) {
          const selected = supportState.selectedThreadId === row.id;
          return '<article class="ops-conversation ops-rail-card' + (selected ? ' is-selected' : '') + '">' +
            '<div class="ops-rail-card__head">' +
              '<div>' +
                '<p class="ops-kicker">' + escapeHtml(formatRoleLabel(row.roleMask)) + ' · ' + escapeHtml(row.senderIdentity) + '</p>' +
                '<h4>' + escapeHtml(row.summary) + '</h4>' +
              '</div>' +
              '<span class="ops-pill ops-pill-' + (row.unread ? 'warn' : 'good') + '">' + (row.unread ? 'Unread' : 'Read') + '</span>' +
            '</div>' +
            '<dl class="ops-rail-card__meta">' +
              '<div><dt>Surface</dt><dd>' + escapeHtml(humanizeToken(row.surface)) + '</dd></div>' +
              '<div><dt>Latest</dt><dd>' + escapeHtml(formatPortalTimestamp(row.latestMessageAt)) + '</dd></div>' +
            '</dl>' +
            '<div class="ops-actions"><button type="button" class="ops-button" data-support-open-thread="' + escapeHtml(row.id) + '">Open thread</button></div>' +
          '</article>';
        }).join("");
      }

      function renderSupportWorkbench() {
        const workbench = document.getElementById("ops-support-workbench");
        if (!workbench) return;
        const thread = getSupportThread(supportState.selectedThreadId);
        if (!thread) {
          workbench.innerHTML = '<div class="ops-empty">Select a support thread to see its pressure, linked work, and a safe draft path.</div>';
          return;
        }
        const recommendation = supportNextMove(thread);
        const activeTask = supportState.tasks.find(function (task) { return isClientActiveTask(task); }) || supportState.tasks[0] || null;
        workbench.innerHTML = '<article class="ops-member-pane">' +
            '<div class="ops-member-workbench__header">' +
              '<div>' +
                '<p class="ops-kicker">Selected thread</p>' +
                '<h2>' + escapeHtml(thread.senderIdentity) + '</h2>' +
                '<p class="ops-summary">' + escapeHtml(thread.summary) + '</p>' +
              '</div>' +
              '<div class="ops-chip-row">' +
                '<span class="ops-pill">' + escapeHtml(formatRoleLabel(thread.roleMask)) + '</span>' +
                '<span class="ops-pill ops-pill-' + (thread.unread ? 'warn' : 'good') + '">' + (thread.unread ? 'Unread' : 'Read') + '</span>' +
              '</div>' +
            '</div>' +
          '</article>' +
          '<article class="ops-member-pane">' +
            '<p class="ops-kicker">Recommended next move</p>' +
            '<h3>' + escapeHtml(recommendation.title) + '</h3>' +
            '<p class="ops-summary">' + escapeHtml(recommendation.body) + '</p>' +
            '<dl class="ops-inline-meta">' +
              '<div><dt>Latest activity</dt><dd>' + escapeHtml(formatPortalTimestamp(thread.latestMessageAt)) + '</dd></div>' +
              '<div><dt>Sender identity</dt><dd>' + escapeHtml(thread.senderIdentity) + '</dd></div>' +
            '</dl>' +
          '</article>' +
          (activeTask ? '<article class="ops-member-note">' +
            '<p class="ops-kicker">Current internet task</p>' +
            '<h3>' + escapeHtml(activeTask.title) + '</h3>' +
            '<p class="ops-summary">' + escapeHtml(activeTask.whyNow) + '</p>' +
          '</article>' : '') +
          '<form class="ops-chat-form" id="ops-support-draft-form">' +
            '<textarea name="text" rows="5" placeholder="Draft the safest next reply, explain why this needs approval, or record what should happen next."></textarea>' +
            '<div class="ops-actions"><button type="submit" class="ops-button">Ask internet lane</button></div>' +
          '</form>';
        const draftForm = document.getElementById("ops-support-draft-form");
        if (draftForm) {
          draftForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const field = draftForm.querySelector("textarea");
            const text = field && field.value ? field.value.trim() : "";
            if (!text) return;
            try {
              const payload = await postJson("/api/ops/chat/internet/send", {
                actorId: "staff:local-portal",
                text: "[" + thread.senderIdentity + " · " + formatRoleLabel(thread.roleMask) + "] " + text,
              });
              field.value = "";
              showBanner(payload.reply || "Internet lane reply received.", "success");
            } catch (error) {
              showBanner(error instanceof Error ? error.message : String(error), "error");
            }
          }, { once: true });
        }
      }

      const handsSearch = document.getElementById("ops-hands-search");
      if (handsSearch) {
        handsSearch.addEventListener("input", function () {
          handsState.search = handsSearch.value || "";
          renderHandsQueueRail();
        });
      }
      document.addEventListener("click", function (event) {
        const target = event.target && typeof event.target.closest === "function"
          ? event.target.closest("[data-hands-open-task]")
          : null;
        if (!target) return;
        const taskId = target.getAttribute("data-hands-open-task");
        if (!taskId) return;
        handsState.selectedTaskId = taskId;
        handsState.escapeHatch = null;
        handsState.escapeReason = "";
        renderHandsQueueRail();
        renderHandsWorkbench();
      });
      if (document.getElementById("ops-hands-queue-rail")) {
        renderHandsQueueRail();
        renderHandsWorkbench();
      }

      const supportSearch = document.getElementById("ops-support-search");
      if (supportSearch) {
        supportSearch.addEventListener("input", function () {
          supportState.search = supportSearch.value || "";
          renderSupportThreadRail();
        });
      }
      document.addEventListener("click", function (event) {
        const target = event.target && typeof event.target.closest === "function"
          ? event.target.closest("[data-support-open-thread]")
          : null;
        if (!target) return;
        const threadId = target.getAttribute("data-support-open-thread");
        if (!threadId) return;
        supportState.selectedThreadId = threadId;
        renderSupportThreadRail();
        renderSupportWorkbench();
      });
      if (document.getElementById("ops-support-thread-rail")) {
        renderSupportThreadRail();
        renderSupportWorkbench();
      }

      bindTaskActionButtons(document);
      document.querySelectorAll("[data-task-escape]").forEach((button) => {
        button.addEventListener("click", async () => {
          const taskId = button.getAttribute("data-task-id");
          const hatch = button.getAttribute("data-task-escape");
          const reason = window.prompt("What blocked this task, and what should the manager do next?", "");
          if (reason === null) return;
          try {
            await submitTaskEscape(taskId, hatch, reason);
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

export function renderOpsPortalChoicePage(input: {
  headline: string;
  narrative: string;
  generatedAt: string;
  opsUrl: string;
  legacyUrl: string | null;
}): string {
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
      .ops-choice-hero p { margin: 0; color: var(--ink-soft); }
      .ops-kicker {
        margin: 0;
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-soft);
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
      .ops-choice-card p { margin: 0; color: var(--ink-soft); line-height: 1.5; }
      .ops-choice-card span {
        display: inline-flex;
        width: fit-content;
        margin-top: 8px;
        padding: 10px 16px;
        border-radius: 999px;
        font-weight: 700;
        background: rgba(105,180,255,0.12);
        color: var(--accent);
      }
      .ops-choice-card-legacy span { background: rgba(123,75,40,0.14); color: var(--accent-2); }
      .ops-choice-card-disabled { opacity: 0.72; }
      .ops-choice-notes {
        padding: 18px 22px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: var(--panel-2);
      }
      .ops-choice-notes p { margin: 0; color: var(--ink-soft); }
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
