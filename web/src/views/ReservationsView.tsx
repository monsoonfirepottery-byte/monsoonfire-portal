import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { connectStorageEmulator, getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { createFunctionsClient, type LastRequest } from "../api/functionsClient";
import { createPortalApi } from "../api/portalApi";
import { makeRequestId } from "../api/requestId";
import { parseStaffRoleFromClaims } from "../auth/staffRole";
import { db } from "../firebase";
import {
  FULL_KILN_CUSTOM_PRICE,
  HALF_SHELF_BISQUE_PRICE,
  HALF_SHELF_GLAZE_PRICE,
  DELIVERY_PRICE_PER_TRIP,
  RUSH_REQUEST_PRICE,
  WAX_RESIST_ASSIST_PRICE,
  GLAZE_SANITY_CHECK_PRICE,
  VOLUME_PRICE_PER_IN3,
  applyHalfKilnPriceBreak,
  computeDeliveryCost,
  computeEstimatedCost,
} from "../lib/pricing";
import {
  normalizeReservationRecord,
  type ReservationRecord,
} from "../lib/normalizers/reservations";
import { formatDateTime } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import { shortId, track } from "../lib/analytics";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import { safeStorageReadJson, safeStorageRemoveItem, safeStorageSetItem } from "../lib/safeStorage";
import "./ReservationsView.css";

type StaffUserOption = {
  id: string;
  displayName: string;
  email?: string | null;
};

type StaffQueueStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED";
type PickupWindowStatus = "open" | "confirmed" | "missed" | "expired" | "completed";
type ReservationFilter = "ALL" | "WAITLISTED" | "UPCOMING" | "READY" | "STORAGE_RISK" | "STAFF_HOLD";
type CapacityFilter = "ALL" | "HIGH" | "NORMAL";

const FIRING_OPTIONS = [
  { id: "bisque", label: "Bisque fire" },
  { id: "glaze", label: "Glaze fire" },
  { id: "other", label: "Other / ask us" },
] as const;

const WARE_TYPES = [
  { id: "stoneware", label: "Stoneware" },
  { id: "earthenware", label: "Earthenware" },
  { id: "porcelain", label: "Porcelain" },
  { id: "mixed", label: "Mixed / unsure" },
] as const;

const CHECKIN_NOTE_TAGS = [
  "Fragile handles",
  "Thin rim",
  "Large platter",
  "Tall piece",
  "Stackable plates",
  "Glaze on bottom",
  "Needs stilt",
  "Crystal glaze",
  "Runny glaze",
  "Keep together",
  "Separate pieces",
  "First firing",
] as const;

const PIECE_STATUS_OPTIONS = [
  { id: "awaiting_placement", label: "Awaiting placement" },
  { id: "loaded", label: "Loaded" },
  { id: "fired", label: "Fired" },
  { id: "ready", label: "Ready" },
  { id: "picked_up", label: "Picked up" },
] as const;

const KILN_OPTIONS = [
  {
    id: "studio-electric",
    label: "Studio kiln (electric)",
    detail: "Steady, reliable studio firing.",
    matchNames: ["L&L eQ2827-3", "Studio kiln (electric)"],
  },
  {
    id: "reduction-raku",
    label: "Raku",
    detail: "Reduction firings + raku sessions.",
    matchNames: ["Raku", "Reduction Raku Kiln"],
  },
] as const;

const CHECKIN_PREFILL_KEY = "mf_checkin_prefill";
const KILN_CAPACITY_HALF_SHELVES = 8;
const STATUS_ACTIONS: Array<{ status: StaffQueueStatus; label: string; tone: "primary" | "ghost" | "danger" }> = [
  { status: "CONFIRMED", label: "Confirm", tone: "primary" },
  { status: "WAITLISTED", label: "Waitlist", tone: "ghost" },
  { status: "CANCELLED", label: "Cancel", tone: "danger" },
];
const RESERVATION_FILTERS: Array<{ id: ReservationFilter; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "WAITLISTED", label: "Waitlisted" },
  { id: "UPCOMING", label: "Upcoming" },
  { id: "READY", label: "Ready" },
  { id: "STORAGE_RISK", label: "Storage risk" },
  { id: "STAFF_HOLD", label: "Staff hold" },
];
const STAFF_UNDO_WINDOW_MS = 20_000;
const PICKUP_WINDOW_RESCHEDULE_LIMIT = 1;
const FAIRNESS_OVERRIDE_MAX_POINTS = 20;
const STORAGE_REMINDER_THRESHOLDS_HOURS = [72, 120, 168] as const;
const STORAGE_HOLD_PENDING_HOURS = 240;
const STORAGE_POLICY_CAP_HOURS = 336;
const STAFF_OFFLINE_QUEUE_STORAGE_KEY = "mf_staff_queue_offline_actions_v1";
const STAFF_OFFLINE_QUEUE_MAX = 80;
const STAFF_OFFLINE_SYNC_MIN_DELAY_MS = 1200;
const STAFF_OFFLINE_SYNC_MAX_DELAY_MS = 2800;

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_FUNCTIONS_BASE_URL?: string;
  VITE_USE_EMULATORS?: string;
  VITE_STORAGE_EMULATOR_HOST?: string;
  VITE_STORAGE_EMULATOR_PORT?: string;
};
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEV_MODE = typeof import.meta !== "undefined" && Boolean(ENV.DEV);

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

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; name?: unknown };
  if (typeof value.code === "string") return value.code;
  if (typeof value.name === "string") return value.name;
  return undefined;
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatPreferredWindow(record: ReservationRecord): string {
  const latest = record.preferredWindow?.latestDate?.toDate?.();
  if (!latest) return "Flexible";
  return `Need by: ${formatDateTime(latest)}`;
}

function toReservationStatus(value: unknown): StaffQueueStatus {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (upper === "CONFIRMED" || upper === "WAITLISTED" || upper === "CANCELLED") return upper;
  return "REQUESTED";
}

function toReservationLoadStatus(value: unknown): "queued" | "loading" | "loaded" {
  const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (lower === "loading" || lower === "loaded") return lower;
  return "queued";
}

function toHalfShelves(record: ReservationRecord): number {
  if (typeof record.estimatedHalfShelves === "number" && Number.isFinite(record.estimatedHalfShelves)) {
    return Math.max(1, Math.ceil(record.estimatedHalfShelves));
  }
  if (typeof record.footprintHalfShelves === "number" && Number.isFinite(record.footprintHalfShelves)) {
    return Math.max(1, Math.ceil(record.footprintHalfShelves));
  }
  if (typeof record.shelfEquivalent === "number" && Number.isFinite(record.shelfEquivalent)) {
    return Math.max(1, Math.ceil(record.shelfEquivalent * 2));
  }
  return 1;
}

function getTimestampMs(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const candidate = value as { toDate?: () => Date; seconds?: number };
  if (typeof candidate.toDate === "function") {
    const date = candidate.toDate();
    return Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  if (typeof candidate.seconds === "number" && Number.isFinite(candidate.seconds)) {
    return Math.floor(candidate.seconds * 1000);
  }
  return 0;
}

function hasStaffHoldTag(record: ReservationRecord): boolean {
  const staffNotes = typeof record.staffNotes === "string" ? record.staffNotes.toLowerCase() : "";
  const generalNotes = typeof record.notes?.general === "string" ? record.notes.general.toLowerCase() : "";
  const reason =
    typeof record.stageStatus?.reason === "string" ? record.stageStatus.reason.toLowerCase() : "";
  return staffNotes.includes("hold") || generalNotes.includes("hold") || reason.includes("hold");
}

function normalizeStorageStatus(
  value: unknown
): "active" | "reminder_pending" | "hold_pending" | "stored_by_policy" | null {
  const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    lower === "active" ||
    lower === "reminder_pending" ||
    lower === "hold_pending" ||
    lower === "stored_by_policy"
  ) {
    return lower;
  }
  return null;
}

function getStorageStatusLabel(record: ReservationRecord): string {
  const status = normalizeStorageStatus(record.storageStatus);
  if (status === "reminder_pending") return "Reminder pending";
  if (status === "hold_pending") return "Hold pending";
  if (status === "stored_by_policy") return "Stored by policy";
  return "Active";
}

function getStorageStatusClass(record: ReservationRecord): string {
  return normalizeStorageStatus(record.storageStatus) ?? "active";
}

function normalizePickupWindowStatus(value: unknown): PickupWindowStatus | null {
  const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    lower === "open" ||
    lower === "confirmed" ||
    lower === "missed" ||
    lower === "expired" ||
    lower === "completed"
  ) {
    return lower;
  }
  return null;
}

function getPickupWindowStatusLabel(status: PickupWindowStatus | null): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "missed") return "Missed";
  if (status === "expired") return "Expired";
  if (status === "completed") return "Completed";
  if (status === "open") return "Open";
  return "Pending";
}

function formatQueueFairnessReasonCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "repeat_no_show") return "repeat no-show";
  if (normalized === "no_show") return "no-show";
  if (normalized === "late_arrival") return "late arrival";
  if (normalized === "staff_override_boost") return "staff override";
  return normalized.replace(/_/g, " ");
}

function toDateTimeInputValue(value: Date | null): string {
  if (!value || !Number.isFinite(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseDateTimeInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

function getStorageHoursSinceReady(record: ReservationRecord): number | null {
  const readyAt = record.readyForPickupAt?.toDate?.();
  if (!readyAt || !Number.isFinite(readyAt.getTime())) return null;
  const elapsedMs = Date.now() - readyAt.getTime();
  if (elapsedMs < 0) return 0;
  return elapsedMs / (60 * 60 * 1000);
}

function isStorageCapApproaching(record: ReservationRecord): boolean {
  const hours = getStorageHoursSinceReady(record);
  if (hours == null) return false;
  const warningStartHours = Math.max(
    STORAGE_REMINDER_THRESHOLDS_HOURS[STORAGE_REMINDER_THRESHOLDS_HOURS.length - 1] ?? 0,
    STORAGE_HOLD_PENDING_HOURS
  );
  return hours >= warningStartHours && hours < STORAGE_POLICY_CAP_HOURS;
}

function isStorageRisk(record: ReservationRecord): boolean {
  const storageStatus = normalizeStorageStatus(record.storageStatus);
  const reminderCount =
    typeof record.pickupReminderCount === "number" && Number.isFinite(record.pickupReminderCount)
      ? Math.max(0, Math.round(record.pickupReminderCount))
      : 0;
  const failureCount =
    typeof record.pickupReminderFailureCount === "number" &&
    Number.isFinite(record.pickupReminderFailureCount)
      ? Math.max(0, Math.round(record.pickupReminderFailureCount))
      : 0;
  if (storageStatus === "hold_pending" || storageStatus === "stored_by_policy") return true;
  if (failureCount > 0) return true;
  if (reminderCount >= 2) return true;
  if (isStorageCapApproaching(record)) return true;
  return false;
}

function formatStorageNoticeKind(kind: string): string {
  const value = kind.trim().toLowerCase();
  if (value === "pickup_ready") return "Pickup ready";
  if (value === "pickup_reminder_1") return "Reminder 1";
  if (value === "pickup_reminder_2") return "Reminder 2";
  if (value === "pickup_reminder_3") return "Reminder 3";
  if (value === "hold_pending") return "Hold pending";
  if (value === "stored_by_policy") return "Stored by policy";
  if (value === "reminder_failed") return "Reminder failed";
  return kind;
}

function normalizeArrivalStatus(value: unknown): "expected" | "arrived" | "overdue" | "no_show" | null {
  const lower = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (lower === "expected" || lower === "arrived" || lower === "overdue" || lower === "no_show") {
    return lower;
  }
  return null;
}

function isMemberArrivalCheckInEligible(record: ReservationRecord): boolean {
  const status = toReservationStatus(record.status);
  if (status !== "CONFIRMED") return false;
  const arrivalStatus = normalizeArrivalStatus(record.arrivalStatus);
  return arrivalStatus !== "arrived";
}

function formatArrivalStatusLabel(record: ReservationRecord): string {
  const arrivalStatus = normalizeArrivalStatus(record.arrivalStatus);
  if (arrivalStatus === "arrived") {
    const arrivedAt = record.arrivedAt?.toDate?.();
    return arrivedAt ? `Arrived ${formatDateTime(arrivedAt)}` : "Arrived";
  }
  if (arrivalStatus === "overdue") return "Arrival overdue";
  if (arrivalStatus === "no_show") return "No-show risk";
  if (arrivalStatus === "expected") {
    const expiresAt = record.arrivalTokenExpiresAt?.toDate?.();
    return expiresAt ? `Expected by ${formatDateTime(expiresAt)}` : "Arrival expected";
  }
  return "Arrival not set";
}

function getReadinessBand(record: ReservationRecord): string {
  const status = toReservationStatus(record.status);
  const loadStatus = toReservationLoadStatus(record.loadStatus);
  const latest = record.preferredWindow?.latestDate?.toDate?.();
  const etaStart = record.estimatedWindow?.currentStart ?? null;
  const etaEnd = record.estimatedWindow?.currentEnd ?? null;
  const confidence = typeof record.estimatedWindow?.confidence === "string"
    ? record.estimatedWindow.confidence
    : null;
  const etaWindowCopy =
    etaStart && etaEnd
      ? `${formatDateTime(etaStart)} - ${formatDateTime(etaEnd)}${confidence ? ` (${confidence} confidence)` : ""}`
      : null;
  const transitionReason =
    typeof record.stageStatus?.reason === "string" && record.stageStatus.reason.trim()
      ? record.stageStatus.reason.trim()
      : null;

  if (status === "CANCELLED") return "Cancelled";
  if (loadStatus === "loaded") return "Ready for pickup planning";
  if (loadStatus === "loading") return "Loading in progress";
  if (etaWindowCopy) {
    return transitionReason ? `ETA ${etaWindowCopy} · ${transitionReason}` : `ETA ${etaWindowCopy}`;
  }
  if (status === "WAITLISTED") {
    return latest ? `Waitlisted · target ${formatDateTime(latest)}` : "Waitlisted · target TBD";
  }
  return latest ? `Target by ${formatDateTime(latest)}` : "Flexible target window";
}

function getUpdatedEstimateCopy(record: ReservationRecord): string {
  const etaStart = record.estimatedWindow?.currentStart ?? null;
  const etaEnd = record.estimatedWindow?.currentEnd ?? null;
  const confidence =
    typeof record.estimatedWindow?.confidence === "string"
      ? record.estimatedWindow.confidence
      : null;
  if (etaStart && etaEnd) {
    return `${formatDateTime(etaStart)} - ${formatDateTime(etaEnd)}${confidence ? ` (${confidence} confidence)` : ""}`;
  }
  if (etaStart) {
    return `${formatDateTime(etaStart)} onward`;
  }
  const latest = record.preferredWindow?.latestDate?.toDate?.();
  if (latest) {
    return `Target by ${formatDateTime(latest)}`;
  }
  return "Flexible window - queue adjusts based on kiln safety and load balance.";
}

function getLastChangeReasonCopy(record: ReservationRecord): string {
  const stageReason =
    typeof record.stageStatus?.reason === "string" ? record.stageStatus.reason.trim() : "";
  if (stageReason) return stageReason;
  const latestNote = latestStageNote(record);
  if (latestNote) return latestNote;
  const slaState =
    typeof record.estimatedWindow?.slaState === "string"
      ? record.estimatedWindow.slaState.toLowerCase().trim()
      : "";
  if (slaState === "delayed") {
    return "Queue timing changed while we cleared higher-risk kiln and resource constraints.";
  }
  if (slaState === "at_risk") {
    return "Queue pressure is elevated, so timing is being monitored more closely.";
  }
  return "Queue and station conditions were recalculated.";
}

function getSuggestedNextUpdateWindowCopy(record: ReservationRecord): string {
  const updatedAt = record.estimatedWindow?.updatedAt?.toDate?.() ?? null;
  const fallbackStart = record.estimatedWindow?.currentEnd?.toDate?.() ?? null;
  const anchor = updatedAt ?? fallbackStart;
  if (!anchor) return "Within 24 hours or sooner if queue conditions change.";

  const slaState =
    typeof record.estimatedWindow?.slaState === "string"
      ? record.estimatedWindow.slaState.toLowerCase().trim()
      : "";
  const startOffsetMs = slaState === "delayed" ? 12 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
  const windowLengthMs = slaState === "delayed" ? 12 * 60 * 60 * 1000 : 18 * 60 * 60 * 1000;
  const start = new Date(anchor.getTime() + startOffsetMs);
  const end = new Date(start.getTime() + windowLengthMs);
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function latestStageNote(record: ReservationRecord): string | null {
  const history = Array.isArray(record.stageHistory) ? record.stageHistory : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const raw = history[i];
    if (!raw || typeof raw !== "object") continue;
    const notes = (raw as { notes?: unknown }).notes;
    if (typeof notes === "string" && notes.trim()) return notes.trim();
  }
  return null;
}

function getCapacityPressure(usedHalfShelves: number) {
  const ratio = usedHalfShelves / KILN_CAPACITY_HALF_SHELVES;
  if (ratio >= 1) return { label: "At capacity", tone: "high" as const };
  if (ratio >= 0.75) return { label: "High pressure", tone: "high" as const };
  if (ratio >= 0.45) return { label: "Moderate pressure", tone: "medium" as const };
  return { label: "Light pressure", tone: "low" as const };
}

function normalizeStationValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
}

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatUsd(value: number) {
  return USD_FORMATTER.format(value);
}

function formatHalfShelfCount(value: number | null | undefined) {
  if (!Number.isFinite(value)) return "0 half shelves";
  const rounded = Math.round(value as number);
  return `${rounded} half shelf${rounded === 1 ? "" : "es"}`;
}

function sanitizeDebugPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload || typeof payload !== "object") return payload;
  const next = { ...payload };
  if (next.photoUrl) next.photoUrl = "<redacted>";
  if (next.photoPath) next.photoPath = "<redacted>";
  if (next.notes) next.notes = "<redacted>";
  if (next.ownerUid) next.ownerUid = "<uid>";
  if (next.linkedBatchId) next.linkedBatchId = "<batch>";
  return next;
}

function sanitizeDateInput(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getFileExtension(file: File) {
  const name = file.name || "";
  const idx = name.lastIndexOf(".");
  if (idx > -1 && idx < name.length - 1) {
    return name.slice(idx + 1).toLowerCase();
  }
  const type = file.type || "";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  return "jpg";
}

function isOnlineNow(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function isRetryableOfflineError(error: unknown): boolean {
  const code = getErrorCode(error)?.toLowerCase() ?? "";
  const message = getErrorMessage(error).toLowerCase();
  if (code.includes("network") || code.includes("unavailable") || code.includes("timeout")) {
    return true;
  }
  return (
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("network request failed") ||
    message.includes("offline") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable")
  );
}

function isManualResolutionError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("conflict") ||
    message.includes("forbidden") ||
    message.includes("permission") ||
    message.includes("owner_mismatch") ||
    message.includes("not found") ||
    message.includes("not permitted") ||
    message.includes("limit")
  );
}

function normalizeOfflineActionType(value: unknown): StaffOfflineActionType | null {
  if (value === "status_update") return value;
  if (value === "assign_station") return value;
  if (value === "pickup_window") return value;
  if (value === "queue_fairness") return value;
  return null;
}

function normalizeOfflineActionStatus(value: unknown): StaffOfflineActionStatus {
  return value === "failed" ? "failed" : "pending";
}

function normalizeOfflineActionRow(value: unknown): StaffOfflineAction | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const actionType = normalizeOfflineActionType(row.actionType);
  if (!actionType) return null;
  const reservationId = asTrimmedString(row.reservationId);
  const actorUid = asTrimmedString(row.actorUid);
  const actionId = asTrimmedString(row.actionId);
  if (!reservationId || !actorUid || !actionId) return null;
  const queueRevisionRaw = Number(row.queueRevision);
  const queueRevision =
    Number.isFinite(queueRevisionRaw) && queueRevisionRaw > 0 ? Math.round(queueRevisionRaw) : 1;
  const payload = row.payload && typeof row.payload === "object"
    ? (row.payload as Record<string, unknown>)
    : {};
  const attemptRaw = Number(row.attemptCount);
  return {
    actionId,
    actionType,
    reservationId,
    actorUid,
    actorRole: "staff",
    queueRevision,
    queuedAtIso: asTrimmedString(row.queuedAtIso) || new Date().toISOString(),
    payload,
    status: normalizeOfflineActionStatus(row.status),
    attemptCount: Number.isFinite(attemptRaw) && attemptRaw > 0 ? Math.round(attemptRaw) : 0,
    lastAttemptAtIso: asTrimmedString(row.lastAttemptAtIso) || null,
    lastError: asTrimmedString(row.lastError) || null,
  };
}

function loadStaffOfflineQueue(): StaffOfflineAction[] {
  const parsed = safeStorageReadJson<unknown[]>("localStorage", STAFF_OFFLINE_QUEUE_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  const rows = parsed
    .map((entry) => normalizeOfflineActionRow(entry))
    .filter((entry): entry is StaffOfflineAction => entry !== null);
  return rows.slice(-STAFF_OFFLINE_QUEUE_MAX);
}

function downloadTextFile(fileName: string, body: string, mimeType: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([body], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFileNameToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "artifact";
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
}

type Props = {
  user: User;
  isStaff: boolean;
  adminToken?: string;
};

type KilnOption = (typeof KILN_OPTIONS)[number] & {
  status?: string | null;
  isOffline?: boolean;
};

type PendingStatusAction = {
  reservationId: string;
  currentStatus: StaffQueueStatus;
  nextStatus: StaffQueueStatus;
};

type StaffOfflineActionType =
  | "status_update"
  | "assign_station"
  | "pickup_window"
  | "queue_fairness";

type StaffOfflineActionStatus = "pending" | "failed";

type StaffOfflineAction = {
  actionId: string;
  actionType: StaffOfflineActionType;
  reservationId: string;
  actorUid: string;
  actorRole: "staff";
  queueRevision: number;
  queuedAtIso: string;
  payload: Record<string, unknown>;
  status: StaffOfflineActionStatus;
  attemptCount: number;
  lastAttemptAtIso: string | null;
  lastError: string | null;
};

type UndoStatusAction = {
  reservationId: string;
  previousStatus: StaffQueueStatus;
  previousStaffNotes: string | null;
  expiresAt: number;
};

type ArrivalLookupOutstanding = {
  needsArrivalCheckIn?: boolean;
  needsStationAssignment?: boolean;
  needsQueuePlacement?: boolean;
  needsResourceProfile?: boolean;
};

type ReservationPieceDraftStatus = (typeof PIECE_STATUS_OPTIONS)[number]["id"];

type ReservationPieceDraft = {
  rowId: string;
  pieceId: string;
  pieceLabel: string;
  pieceCount: number;
  piecePhotoUrl: string;
  pieceStatus: ReservationPieceDraftStatus;
};

function sanitizePieceCodeInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 120);
}

function createEmptyPieceDraft(seed?: number): ReservationPieceDraft {
  return {
    rowId: makeRequestId("piece"),
    pieceId: "",
    pieceLabel: "",
    pieceCount: Math.max(1, Math.round(seed ?? 1)),
    piecePhotoUrl: "",
    pieceStatus: "awaiting_placement",
  };
}

function parsePieceBulkRows(input: string): ReservationPieceDraft[] {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows: ReservationPieceDraft[] = [];
  lines.forEach((line) => {
    const [labelChunk, countChunk] = line.split(/[,|]/);
    const label = (labelChunk ?? "").trim();
    const parsedCount = Number((countChunk ?? "").trim());
    const pieceCount =
      Number.isFinite(parsedCount) && parsedCount > 0
        ? Math.max(1, Math.round(parsedCount))
        : 1;
    rows.push({
      ...createEmptyPieceDraft(pieceCount),
      pieceLabel: label,
    });
  });
  return rows;
}

export default function ReservationsView({ user, isStaff, adminToken }: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);
  const [kilnStatusByName, setKilnStatusByName] = useState<Record<string, string>>({});
  const [isOnline, setIsOnline] = useState<boolean>(() => isOnlineNow());
  const [offlineQueue, setOfflineQueue] = useState<StaffOfflineAction[]>(() => loadStaffOfflineQueue());
  const [offlineSyncMessage, setOfflineSyncMessage] = useState("");
  const [offlineSyncBusy, setOfflineSyncBusy] = useState(false);
  const offlineQueueRef = useRef<StaffOfflineAction[]>(offlineQueue);
  const offlineQueueRevisionRef = useRef<number>(0);
  const offlineRetryTimerRef = useRef<number | null>(null);
  const loadReservationsRef = useRef<() => Promise<void>>(async () => undefined);

  const [mode, setMode] = useState<"client" | "staff">("client");
  const [staffUsers, setStaffUsers] = useState<StaffUserOption[]>([]);
  const [staffTargetUid, setStaffTargetUid] = useState("");

  const [wareType, setWareType] = useState("stoneware");
  const [kilnId, setKilnId] = useState("studio-electric");
  const [firingType, setFiringType] = useState<(typeof FIRING_OPTIONS)[number]["id"]>("bisque");
  const [footprintHalfShelves, setFootprintHalfShelves] = useState(1);
  const [showMoreFootprints, setShowMoreFootprints] = useState(false);
  const [hasTallPieces, setHasTallPieces] = useState(false);
  const [tiers, setTiers] = useState<number | null>(1);
  const [estimatedHalfShelves, setEstimatedHalfShelves] = useState<number | null>(1);
  const [useVolumePricing, setUseVolumePricing] = useState(false);
  const [volumeMode, setVolumeMode] = useState<"total" | "dimensions">("total");
  const [volumeIn3, setVolumeIn3] = useState<number | null>(null);
  const [volumeLengthIn, setVolumeLengthIn] = useState<number | null>(null);
  const [volumeWidthIn, setVolumeWidthIn] = useState<number | null>(null);
  const [volumeHeightIn, setVolumeHeightIn] = useState<number | null>(null);
  const [fitsOnOneLayer, setFitsOnOneLayer] = useState<"yes" | "no" | null>(null);

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState("");
  const [animateEstimate, setAnimateEstimate] = useState(false);

  const [latest, setLatest] = useState("");
  const [linkedBatchId, setLinkedBatchId] = useState("");
  const [notesGeneral, setNotesGeneral] = useState("");
  const [notesTags, setNotesTags] = useState<string[]>([]);
  const [pieceRows, setPieceRows] = useState<ReservationPieceDraft[]>([createEmptyPieceDraft()]);
  const [pieceBulkInput, setPieceBulkInput] = useState("");
  const [rushRequested, setRushRequested] = useState(false);
  const [waxResistAssistRequested, setWaxResistAssistRequested] = useState(false);
  const [glazeSanityCheckRequested, setGlazeSanityCheckRequested] = useState(false);
  const [wholeKilnRequested, setWholeKilnRequested] = useState(false);
  const [pickupDeliveryRequested, setPickupDeliveryRequested] = useState(false);
  const [returnDeliveryRequested, setReturnDeliveryRequested] = useState(false);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [useStudioGlazes, setUseStudioGlazes] = useState(false);
  const [glazeAccessCost, setGlazeAccessCost] = useState<number | null>(null);

  const [formError, setFormError] = useState("");
  const [formStatus, setFormStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [submitRequestId, setSubmitRequestId] = useState<string | null>(null);
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [authDebug, setAuthDebug] = useState<{
    uid: string;
    isAnonymous: boolean;
    roles: string[];
    isStaff: boolean;
  } | null>(null);
  const [hasStaffClaim, setHasStaffClaim] = useState(false);
  const [devError, setDevError] = useState<{
    context: string;
    code?: string;
    message?: string;
    path?: string;
  } | null>(null);
  const [devCopyStatus, setDevCopyStatus] = useState("");
  const [reservationFilter, setReservationFilter] = useState<ReservationFilter>("ALL");
  const [pieceLookupQuery, setPieceLookupQuery] = useState("");
  const [laneFilter, setLaneFilter] = useState<string>("all");
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>("ALL");
  const [staffNotesByReservationId, setStaffNotesByReservationId] = useState<Record<string, string>>({});
  const [stationDraftByReservationId, setStationDraftByReservationId] = useState<Record<string, string>>({});
  const [queueClassDraftByReservationId, setQueueClassDraftByReservationId] = useState<Record<string, string>>(
    {}
  );
  const [pickupWindowStartByReservationId, setPickupWindowStartByReservationId] = useState<Record<string, string>>(
    {}
  );
  const [pickupWindowEndByReservationId, setPickupWindowEndByReservationId] = useState<Record<string, string>>({});
  const [pickupWindowRequestStartByReservationId, setPickupWindowRequestStartByReservationId] = useState<
    Record<string, string>
  >({});
  const [pickupWindowRequestEndByReservationId, setPickupWindowRequestEndByReservationId] = useState<
    Record<string, string>
  >({});
  const [queueFairnessReasonByReservationId, setQueueFairnessReasonByReservationId] = useState<
    Record<string, string>
  >({});
  const [queueFairnessBoostByReservationId, setQueueFairnessBoostByReservationId] = useState<
    Record<string, string>
  >({});
  const [queueFairnessOverrideUntilByReservationId, setQueueFairnessOverrideUntilByReservationId] = useState<
    Record<string, string>
  >({});
  const [staffActionBusyId, setStaffActionBusyId] = useState<string | null>(null);
  const [pickupWindowBusyId, setPickupWindowBusyId] = useState<string | null>(null);
  const [queueFairnessBusyId, setQueueFairnessBusyId] = useState<string | null>(null);
  const [staffActionMessage, setStaffActionMessage] = useState("");
  const [pickupWindowMessage, setPickupWindowMessage] = useState("");
  const [queueFairnessMessage, setQueueFairnessMessage] = useState("");
  const [continuityExportBusy, setContinuityExportBusy] = useState(false);
  const [continuityExportMessage, setContinuityExportMessage] = useState("");
  const [pendingStatusAction, setPendingStatusAction] = useState<PendingStatusAction | null>(null);
  const [undoStatusAction, setUndoStatusAction] = useState<UndoStatusAction | null>(null);
  const [staffToolsUnavailable, setStaffToolsUnavailable] = useState("");
  const [arrivalBusyId, setArrivalBusyId] = useState<string | null>(null);
  const [arrivalMessage, setArrivalMessage] = useState("");
  const [arrivalNoteByReservationId, setArrivalNoteByReservationId] = useState<Record<string, string>>({});
  const [arrivalLookupToken, setArrivalLookupToken] = useState("");
  const [arrivalLookupBusy, setArrivalLookupBusy] = useState(false);
  const [arrivalLookupResult, setArrivalLookupResult] = useState<ReservationRecord | null>(null);
  const [arrivalLookupOutstanding, setArrivalLookupOutstanding] = useState<ArrivalLookupOutstanding | null>(null);

  const targetOwnerUid = mode === "staff" ? staffTargetUid : user.uid;
  const kilnOptions: KilnOption[] = useMemo(() => {
    const statusEntries = Object.entries(kilnStatusByName);
    return KILN_OPTIONS.map((option) => {
      const match = option.matchNames.find((name) => {
        const needle = name.toLowerCase();
        return statusEntries.some(([stored]) => {
          const storedLower = stored.toLowerCase();
          return (
            storedLower === needle ||
            storedLower.includes(needle) ||
            needle.includes(storedLower)
          );
        });
      });
      const statusEntry = match
        ? statusEntries.find(([stored]) => {
            const storedLower = stored.toLowerCase();
            const matchLower = match.toLowerCase();
            return (
              storedLower === matchLower ||
              storedLower.includes(matchLower) ||
              matchLower.includes(storedLower)
            );
          })
        : null;
      const status = statusEntry ? statusEntry[1] : null;
      const normalizedStatus =
        typeof status === "string" ? status.toLowerCase().trim() : "";
      const inferredOffline =
        normalizedStatus.includes("offline") ||
        normalizedStatus.includes("down") ||
        normalizedStatus.includes("unavailable");
      const fallbackOffline = option.id === "reduction-raku" && normalizedStatus.length === 0;
      return {
        ...option,
        status,
        isOffline: inferredOffline || fallbackOffline,
      };
    });
  }, [kilnStatusByName]);
  const selectedKiln = kilnOptions.find((option) => option.id === kilnId);
  const derivedHeightInches = hasTallPieces ? 11 : 10;
  const computedTiers = 1;
  const computedHalfShelves = useMemo(() => {
    const safeFootprint = Math.min(8, Math.max(1, footprintHalfShelves));
    return safeFootprint + (hasTallPieces ? 1 : 0);
  }, [footprintHalfShelves, hasTallPieces]);
  const computedCost = useMemo(() => {
    const base = computeEstimatedCost({
      kilnType: selectedKiln?.id ?? null,
      firingType,
      estimatedHalfShelves: computedHalfShelves,
      useVolumePricing,
      volumeIn3,
    });
    if (useVolumePricing) return base;
    return applyHalfKilnPriceBreak({
      estimatedHalfShelves: computedHalfShelves,
      estimatedCost: base,
    }).estimatedCost;
  }, [selectedKiln?.id, firingType, computedHalfShelves, useVolumePricing, volumeIn3]);
  const shelfEquivalent = useMemo(() => {
    if (!Number.isFinite(estimatedHalfShelves)) return 1;
    return Math.max(0.25, (estimatedHalfShelves ?? 1) / 2);
  }, [estimatedHalfShelves]);
  const estimatedHalfShelvesRounded = useMemo(() => {
    if (!Number.isFinite(estimatedHalfShelves)) return 0;
    return Math.round(estimatedHalfShelves as number);
  }, [estimatedHalfShelves]);
  const spaceLabel = estimatedHalfShelvesRounded > 8 ? "8+" : String(estimatedHalfShelvesRounded);
  const showFitPrompt = (tiers ?? 1) > 1;
  const firingLabel =
    firingType === "bisque" ? "Bisque" : firingType === "glaze" ? "Glaze" : "Other";
  const kilnLabel = selectedKiln?.label ?? "Select kiln";
  const comparisonLabel = `${formatUsd(HALF_SHELF_BISQUE_PRICE)} bisque / ${formatUsd(
    HALF_SHELF_GLAZE_PRICE
  )} glaze`;
  const volumeCost = useMemo(() => {
    if (!useVolumePricing || !Number.isFinite(volumeIn3)) return null;
    return (volumeIn3 as number) * VOLUME_PRICE_PER_IN3;
  }, [useVolumePricing, volumeIn3]);
  const volumeNudgeThreshold =
    selectedKiln?.id === "reduction-raku"
      ? HALF_SHELF_GLAZE_PRICE
      : firingType === "bisque"
      ? HALF_SHELF_BISQUE_PRICE
      : HALF_SHELF_GLAZE_PRICE;
  const showVolumeNudge = volumeCost != null && volumeCost >= volumeNudgeThreshold;
  const baseHalfShelfPrice =
    selectedKiln?.id === "reduction-raku" || firingType === "glaze"
      ? HALF_SHELF_GLAZE_PRICE
      : HALF_SHELF_BISQUE_PRICE;
  const showVolumeToggle =
    computedCost != null && computedCost < baseHalfShelfPrice && !useVolumePricing;
  const deliveryTrips = (pickupDeliveryRequested ? 1 : 0) + (returnDeliveryRequested ? 1 : 0);
  const deliveryCost = computeDeliveryCost(deliveryTrips);
  const estimatedCostWithDelivery =
    computedCost != null ? computedCost + deliveryCost : computedCost;
  const rushCost = rushRequested ? RUSH_REQUEST_PRICE : 0;
  const waxResistCost = waxResistAssistRequested ? WAX_RESIST_ASSIST_PRICE : 0;
  const glazeSanityCost = glazeSanityCheckRequested ? GLAZE_SANITY_CHECK_PRICE : 0;
  const totalEstimate =
    estimatedCostWithDelivery != null
      ? estimatedCostWithDelivery + (glazeAccessCost ?? 0) + rushCost + waxResistCost + glazeSanityCost
      : estimatedCostWithDelivery;
  const priceBreakApplied = useMemo(() => {
    if (useVolumePricing) return false;
    const base = computeEstimatedCost({
      kilnType: selectedKiln?.id ?? null,
      firingType,
      estimatedHalfShelves: computedHalfShelves,
      useVolumePricing,
      volumeIn3,
    });
    return applyHalfKilnPriceBreak({
      estimatedHalfShelves: computedHalfShelves,
      estimatedCost: base,
    }).priceBreakApplied;
  }, [selectedKiln?.id, firingType, computedHalfShelves, useVolumePricing, volumeIn3]);

  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: resolveFunctionsBaseUrl(),
        getIdToken: () => user.getIdToken(),
        getAdminToken: () => adminToken,
        onLastRequest: setLastReq,
      }),
    [user, adminToken]
  );
  const portalApi = useMemo(() => createPortalApi({ baseUrl: resolveFunctionsBaseUrl() }), []);

  const persistOfflineQueue = useCallback((nextQueue: StaffOfflineAction[]) => {
    const trimmed = nextQueue.slice(-STAFF_OFFLINE_QUEUE_MAX);
    offlineQueueRef.current = trimmed;
    setOfflineQueue(trimmed);
    if (trimmed.length > 0) {
      safeStorageSetItem("localStorage", STAFF_OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(trimmed));
    } else {
      safeStorageRemoveItem("localStorage", STAFF_OFFLINE_QUEUE_STORAGE_KEY);
    }
  }, []);

  const queueOfflineStaffAction = useCallback(
    (args: {
      reservationId: string;
      actionType: StaffOfflineActionType;
      payload: Record<string, unknown>;
      message: string;
    }) => {
      const nowIso = new Date().toISOString();
      const queueRevision = offlineQueueRevisionRef.current + 1;
      offlineQueueRevisionRef.current = queueRevision;
      const entry: StaffOfflineAction = {
        actionId: makeRequestId("offline"),
        actionType: args.actionType,
        reservationId: args.reservationId,
        actorUid: user.uid,
        actorRole: "staff",
        queueRevision,
        queuedAtIso: nowIso,
        payload: args.payload,
        status: "pending",
        attemptCount: 0,
        lastAttemptAtIso: null,
        lastError: null,
      };
      persistOfflineQueue([...offlineQueueRef.current, entry]);
      setOfflineSyncMessage(args.message);
    },
    [persistOfflineQueue, user.uid]
  );

  const executeOfflineAction = useCallback(
    async (entry: StaffOfflineAction, idToken: string): Promise<void> => {
      if (entry.actionType === "status_update") {
        await portalApi.updateReservation({
          idToken,
          adminToken,
          payload: entry.payload as {
            reservationId: string;
            status: StaffQueueStatus;
            staffNotes?: string | null;
          },
        });
        return;
      }
      if (entry.actionType === "assign_station") {
        await portalApi.assignReservationStation({
          idToken,
          adminToken,
          payload: entry.payload as {
            reservationId: string;
            assignedStationId: string;
            queueClass?: string | null;
          },
        });
        return;
      }
      if (entry.actionType === "pickup_window") {
        await portalApi.updateReservationPickupWindow({
          idToken,
          adminToken,
          payload: entry.payload as {
            reservationId: string;
            action: "staff_set_open_window" | "staff_mark_missed" | "staff_mark_completed";
            confirmedStart?: string | null;
            confirmedEnd?: string | null;
            note?: string | null;
            force?: boolean;
          },
        });
        return;
      }
      if (entry.actionType === "queue_fairness") {
        await portalApi.updateReservationQueueFairness({
          idToken,
          adminToken,
          payload: entry.payload as {
            reservationId: string;
            action: "record_no_show" | "record_late_arrival" | "set_override_boost" | "clear_override";
            reason: string;
            boostPoints?: number | null;
            overrideUntil?: string | null;
          },
        });
      }
    },
    [portalApi, adminToken]
  );

  const flushOfflineQueue = useCallback(async () => {
    if (!isStaff) return;
    if (!isOnlineNow()) return;
    const queue = offlineQueueRef.current;
    if (!queue.length) {
      setOfflineSyncMessage("");
      return;
    }
    if (offlineSyncBusy) return;

    setOfflineSyncBusy(true);
    setOfflineSyncMessage("Syncing queued staff actions...");

    let syncedCount = 0;
    const survivors: StaffOfflineAction[] = [];
    let shouldRetrySoon = false;

    try {
      const idToken = await user.getIdToken();
      for (let index = 0; index < queue.length; index += 1) {
        const entry = queue[index];
        try {
          await executeOfflineAction(entry, idToken);
          syncedCount += 1;
        } catch (error: unknown) {
          const errorMessage = getErrorMessage(error);
          const updated: StaffOfflineAction = {
            ...entry,
            attemptCount: entry.attemptCount + 1,
            lastAttemptAtIso: new Date().toISOString(),
            lastError: errorMessage,
          };
          if (isRetryableOfflineError(error)) {
            survivors.push({
              ...updated,
              status: "pending",
            });
            for (let rest = index + 1; rest < queue.length; rest += 1) {
              survivors.push(queue[rest]);
            }
            shouldRetrySoon = true;
            break;
          }
          survivors.push({
            ...updated,
            status: "failed",
            lastError: isManualResolutionError(error)
              ? `Manual review required: ${errorMessage}`
              : errorMessage,
          });
        }
      }
    } catch (error: unknown) {
      const failure = getErrorMessage(error);
      survivors.push(
        ...queue.map((entry) => ({
          ...entry,
          attemptCount: entry.attemptCount + 1,
          lastAttemptAtIso: new Date().toISOString(),
          lastError: failure,
          status: "pending" as const,
        }))
      );
      shouldRetrySoon = true;
    } finally {
      persistOfflineQueue(survivors);
      if (syncedCount > 0) {
        await loadReservationsRef.current();
      }

      const failedCount = survivors.filter((entry) => entry.status === "failed").length;
      const pendingCount = survivors.length - failedCount;
      if (!survivors.length) {
        setOfflineSyncMessage(`Queued actions synced (${syncedCount}).`);
      } else if (failedCount > 0) {
        setOfflineSyncMessage(
          `Synced ${syncedCount}. ${failedCount} action(s) need manual correction and ${pendingCount} pending action(s) remain.`
        );
      } else {
        setOfflineSyncMessage(`Synced ${syncedCount}. ${pendingCount} action(s) still pending retry.`);
      }

      if (offlineRetryTimerRef.current != null) {
        window.clearTimeout(offlineRetryTimerRef.current);
        offlineRetryTimerRef.current = null;
      }
      if (shouldRetrySoon && survivors.some((entry) => entry.status === "pending")) {
        const delay =
          STAFF_OFFLINE_SYNC_MIN_DELAY_MS +
          Math.floor(Math.random() * (STAFF_OFFLINE_SYNC_MAX_DELAY_MS - STAFF_OFFLINE_SYNC_MIN_DELAY_MS));
        offlineRetryTimerRef.current = window.setTimeout(() => {
          offlineRetryTimerRef.current = null;
          void flushOfflineQueue();
        }, delay);
      }
      setOfflineSyncBusy(false);
    }
  }, [executeOfflineAction, isStaff, offlineSyncBusy, persistOfflineQueue, user]);

  useEffect(() => {
    let cancelled = false;
    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) return;
        const parsedRole = parseStaffRoleFromClaims(result?.claims ?? {});
        setHasStaffClaim(parsedRole.isStaff);
        if (!DEV_MODE) return;
        setAuthDebug({
          uid: user.uid,
          isAnonymous: user.isAnonymous,
          roles: parsedRole.roles,
          isStaff: parsedRole.isStaff,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setHasStaffClaim(false);
        if (!DEV_MODE) return;
        setAuthDebug({
          uid: user.uid,
          isAnonymous: user.isAnonymous,
          roles: [],
          isStaff: false,
        });
        setDevError({
          context: "auth",
          code: getErrorCode(error),
          message: getErrorMessage(error) || "Unable to read auth claims.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    offlineQueueRef.current = offlineQueue;
    const maxRevision = offlineQueue.reduce((maxValue, entry) => {
      const revision =
        typeof entry.queueRevision === "number" && Number.isFinite(entry.queueRevision)
          ? Math.max(1, Math.round(entry.queueRevision))
          : 1;
      return Math.max(maxValue, revision);
    }, 0);
    offlineQueueRevisionRef.current = Math.max(offlineQueueRevisionRef.current, maxRevision);
  }, [offlineQueue]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => {
      setIsOnline(true);
      setOfflineSyncMessage("Connection restored. Syncing queued staff actions...");
    };
    const onOffline = () => {
      setIsOnline(false);
      setOfflineSyncMessage("Offline mode: staff queue actions will sync automatically when connection returns.");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (offlineRetryTimerRef.current != null) {
        window.clearTimeout(offlineRetryTimerRef.current);
        offlineRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isStaff) return;
    if (!isOnline) return;
    if (!offlineQueue.some((entry) => entry.status === "pending")) return;
    if (offlineSyncBusy) return;
    if (offlineRetryTimerRef.current != null) return;
    void flushOfflineQueue();
  }, [flushOfflineQueue, isOnline, isStaff, offlineQueue, offlineSyncBusy]);

  const captureDevError = useCallback((context: string, error: unknown, path?: string) => {
    if (!DEV_MODE) return;
    const detail = {
      context,
      code: getErrorCode(error),
      message: getErrorMessage(error),
      path,
    };
    setDevError(detail);
    console.error("Check-in debug error:", detail);
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  useEffect(() => {
    setTiers(computedTiers);
  }, [computedTiers]);

  useEffect(() => {
    setEstimatedHalfShelves(computedHalfShelves);
  }, [computedHalfShelves]);

  useEffect(() => {
    if (!useVolumePricing) {
      setVolumeMode("total");
      setVolumeIn3(null);
      setVolumeLengthIn(null);
      setVolumeWidthIn(null);
      setVolumeHeightIn(null);
    }
  }, [useVolumePricing]);

  useEffect(() => {
    if (!useStudioGlazes) {
      setGlazeAccessCost(null);
      return;
    }
    if (!Number.isFinite(estimatedHalfShelvesRounded)) {
      setGlazeAccessCost(null);
      return;
    }
    setGlazeAccessCost(estimatedHalfShelvesRounded * 3);
  }, [useStudioGlazes, estimatedHalfShelvesRounded]);

  useEffect(() => {
    if (!useVolumePricing || volumeMode !== "dimensions") return;
    const length = Number(volumeLengthIn);
    const width = Number(volumeWidthIn);
    const height = Number(volumeHeightIn);
    if (!Number.isFinite(length) || !Number.isFinite(width) || !Number.isFinite(height)) {
      setVolumeIn3(null);
      return;
    }
    if (length <= 0 || width <= 0 || height <= 0) {
      setVolumeIn3(null);
      return;
    }
    const nextVolume = length * width * height;
    if (nextVolume !== volumeIn3) {
      setVolumeIn3(nextVolume);
    }
  }, [useVolumePricing, volumeMode, volumeLengthIn, volumeWidthIn, volumeHeightIn, volumeIn3]);

  useEffect(() => {
    if (totalEstimate == null) return;
    setAnimateEstimate(true);
    const timer = window.setTimeout(() => setAnimateEstimate(false), 320);
    return () => window.clearTimeout(timer);
  }, [totalEstimate]);

  useEffect(() => {
    if (!showFitPrompt) {
      setFitsOnOneLayer(null);
    }
  }, [showFitPrompt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = safeStorageReadJson<{
      linkedBatchId?: string;
      firingType?: string;
      pieceCode?: string;
    }>("sessionStorage", CHECKIN_PREFILL_KEY, null);
    if (!parsed) {
      setPrefillNote(null);
      safeStorageRemoveItem("sessionStorage", CHECKIN_PREFILL_KEY);
      return;
    }
    if (parsed.linkedBatchId) {
      setLinkedBatchId(parsed.linkedBatchId);
    }
    if (parsed.firingType === "bisque" || parsed.firingType === "glaze" || parsed.firingType === "other") {
      setFiringType(parsed.firingType);
    }
    if (parsed.pieceCode) {
      setPrefillNote(`Prefilled from ${parsed.pieceCode}.`);
    } else {
      setPrefillNote(null);
    }
    safeStorageRemoveItem("sessionStorage", CHECKIN_PREFILL_KEY);
  }, []);

  useEffect(() => {
    if (footprintHalfShelves > 4 && !wholeKilnRequested) {
      setWholeKilnRequested(true);
      return;
    }
    if (footprintHalfShelves <= 4 && wholeKilnRequested) {
      setWholeKilnRequested(false);
    }
  }, [footprintHalfShelves, wholeKilnRequested]);

  useEffect(() => {
    if (footprintHalfShelves > 3) {
      setShowMoreFootprints(true);
    }
  }, [footprintHalfShelves]);

  useEffect(() => {
    if (!hasStaffClaim) return;
    const usersQuery = query(collection(db, "users"), orderBy("displayName", "asc"), limit(120));
    getDocs(usersQuery)
      .then((snap) => {
        const rows: StaffUserOption[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as Partial<StaffUserOption>;
          return {
            id: docSnap.id,
            displayName: data?.displayName || "Member",
            email: data?.email || null,
          };
        });
        setStaffUsers(rows);
      })
      .catch((err) => {
        setStaffUsers([]);
        captureDevError("staff-users", err, "users");
      });
  }, [hasStaffClaim, captureDevError]);

  useEffect(() => {
    const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
    getDocs(kilnsQuery)
      .then((snap) => {
        const next: Record<string, string> = {};
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as { name?: unknown; status?: unknown };
          if (data?.name) {
            next[String(data.name)] = String(data.status || "idle");
          }
        });
        setKilnStatusByName(next);
      })
      .catch((err) => {
        setKilnStatusByName({});
        captureDevError("kilns", err, "kilns");
      });
  }, [captureDevError]);

  useEffect(() => {
    if (!selectedKiln?.isOffline) return;
    setKilnId("");
  }, [selectedKiln]);

  useEffect(() => {
    if (selectedKiln?.id !== "reduction-raku") return;
    if (firingType === "bisque") {
      setFiringType("glaze");
    }
  }, [selectedKiln?.id, firingType]);

  const loadReservations = useCallback(async () => {
    const ownerUid = targetOwnerUid;
    if (!ownerUid) {
      setReservations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setListError("");
    setStaffToolsUnavailable("");

    try {
      const reservationsQuery = query(
        collection(db, "reservations"),
        where("ownerUid", "==", ownerUid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(reservationsQuery);
      const rows: ReservationRecord[] = snap.docs.map((docSnap) =>
        normalizeReservationRecord(docSnap.id, docSnap.data() as Partial<ReservationRecord>)
      );
      setReservations(rows);
    } catch (err: unknown) {
      const errObj = err as { message?: unknown; code?: unknown } | null | undefined;
      const message =
        typeof errObj?.message === "string" ? errObj.message : "Unable to load check-ins.";
      const code = typeof errObj?.code === "string" ? errObj.code : "";
      const isPermission =
        code.includes("permission-denied") ||
        String(message).toLowerCase().includes("missing or insufficient permissions");
      if (isPermission) {
        setListError("");
        if (hasStaffClaim || isStaff) {
          setStaffToolsUnavailable(
            "Staff queue tools are unavailable right now due to permissions. Retry after claims sync, or contact support with code RES-STAFF-PERM."
          );
        }
      } else {
        setListError(`Check-ins failed: ${message}`);
      }
      captureDevError("reservations", err, "reservations");
    } finally {
      setLoading(false);
    }
  }, [targetOwnerUid, hasStaffClaim, isStaff, captureDevError]);

  useEffect(() => {
    loadReservationsRef.current = loadReservations;
  }, [loadReservations]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      const aTime = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const bTime = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [reservations]);
  const recentBisqueReservation = useMemo(() => {
    return sortedReservations.find(
      (reservation) => reservation.firingType === "bisque" && reservation.linkedBatchId
    );
  }, [sortedReservations]);
  const activeQueueReservations = useMemo(
    () =>
      sortedReservations
        .filter((reservation) => toReservationStatus(reservation.status) !== "CANCELLED")
        .sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt)),
    [sortedReservations]
  );
  const queuePositionByReservationId = useMemo(() => {
    const out: Record<string, number> = {};
    activeQueueReservations.forEach((reservation, index) => {
      out[reservation.id] = index + 1;
    });
    return out;
  }, [activeQueueReservations]);
  const kilnHalfShelvesInQueue = useMemo(
    () => activeQueueReservations.reduce((sum, reservation) => sum + toHalfShelves(reservation), 0),
    [activeQueueReservations]
  );
  const capacityPressure = useMemo(
    () => getCapacityPressure(kilnHalfShelvesInQueue),
    [kilnHalfShelvesInQueue]
  );
  const stationUsage = useMemo(() => {
    const usageByStation = new Map<string, number>();
    activeQueueReservations.forEach((reservation) => {
      const stationId =
        normalizeStationValue(reservation.assignedStationId) ??
        normalizeStationValue(reservation.kilnId);
      if (!stationId) return;
      const next = (usageByStation.get(stationId) ?? 0) + toHalfShelves(reservation);
      usageByStation.set(stationId, next);
    });
    return usageByStation;
  }, [activeQueueReservations]);
  const laneOptions = useMemo(() => {
    const lanes = new Set<string>();
    reservations.forEach((reservation) => {
      const lane = normalizeStationValue(reservation.queueClass);
      if (lane) lanes.add(lane);
    });
    return Array.from(lanes).sort((a, b) => a.localeCompare(b));
  }, [reservations]);
  useEffect(() => {
    if (laneFilter === "all") return;
    if (laneOptions.includes(laneFilter)) return;
    setLaneFilter("all");
  }, [laneFilter, laneOptions]);
  const filterCounts = useMemo(() => {
    const counts: Record<ReservationFilter, number> = {
      ALL: sortedReservations.length,
      WAITLISTED: 0,
      UPCOMING: 0,
      READY: 0,
      STORAGE_RISK: 0,
      STAFF_HOLD: 0,
    };
    sortedReservations.forEach((reservation) => {
      const status = toReservationStatus(reservation.status);
      const loadStatus = toReservationLoadStatus(reservation.loadStatus);
      const ready = loadStatus === "loaded";
      const hold = hasStaffHoldTag(reservation);
      const storageRisk = isStorageRisk(reservation);
      if (status === "WAITLISTED") counts.WAITLISTED += 1;
      if (status !== "CANCELLED" && !ready && status !== "WAITLISTED") counts.UPCOMING += 1;
      if (ready) counts.READY += 1;
      if (storageRisk) counts.STORAGE_RISK += 1;
      if (hold) counts.STAFF_HOLD += 1;
    });
    return counts;
  }, [sortedReservations]);
  const pieceLookupNeedle = pieceLookupQuery.trim().toUpperCase();
  const pieceLookupMatchReservationId = useMemo(() => {
    if (!pieceLookupNeedle) return null;
    for (const reservation of sortedReservations) {
      const pieces = Array.isArray(reservation.pieces) ? reservation.pieces : [];
      const hit = pieces.some((piece) =>
        typeof piece.pieceId === "string" &&
        piece.pieceId.toUpperCase().includes(pieceLookupNeedle)
      );
      if (hit) return reservation.id;
    }
    return null;
  }, [sortedReservations, pieceLookupNeedle]);
  const filteredReservations = useMemo(() => {
    return sortedReservations.filter((reservation) => {
      const status = toReservationStatus(reservation.status);
      const loadStatus = toReservationLoadStatus(reservation.loadStatus);
      const ready = loadStatus === "loaded";
      const hold = hasStaffHoldTag(reservation);
      const storageRisk = isStorageRisk(reservation);
      const lane = normalizeStationValue(reservation.queueClass);
      if (pieceLookupNeedle) {
        const pieces = Array.isArray(reservation.pieces) ? reservation.pieces : [];
        const hit = pieces.some((piece) =>
          typeof piece.pieceId === "string" &&
          piece.pieceId.toUpperCase().includes(pieceLookupNeedle)
        );
        if (!hit) return false;
      }
      if (laneFilter !== "all" && lane !== laneFilter) {
        return false;
      }

      if (capacityFilter !== "ALL") {
        const stationId =
          normalizeStationValue(reservation.assignedStationId) ??
          normalizeStationValue(reservation.kilnId);
        const stationLoad = stationId ? stationUsage.get(stationId) ?? 0 : 0;
        const stationRatio = stationLoad / KILN_CAPACITY_HALF_SHELVES;
        const isHighPressure = stationRatio >= 0.75;
        if (capacityFilter === "HIGH" && !isHighPressure) return false;
        if (capacityFilter === "NORMAL" && isHighPressure) return false;
      }

      switch (reservationFilter) {
      case "WAITLISTED":
        return status === "WAITLISTED";
      case "UPCOMING":
        return status !== "CANCELLED" && !ready && status !== "WAITLISTED";
      case "READY":
        return ready;
      case "STORAGE_RISK":
        return storageRisk;
      case "STAFF_HOLD":
        return hold;
      case "ALL":
      default:
        return true;
      }
    });
  }, [sortedReservations, reservationFilter, laneFilter, capacityFilter, stationUsage, pieceLookupNeedle]);

  const storageTriageSummary = useMemo(() => {
    let enteringHold = 0;
    let storedByPolicy = 0;
    let reminderFailures = 0;
    let approachingCap = 0;
    sortedReservations.forEach((reservation) => {
      const storageStatus = normalizeStorageStatus(reservation.storageStatus);
      if (storageStatus === "hold_pending") enteringHold += 1;
      if (storageStatus === "stored_by_policy") storedByPolicy += 1;
      if (
        typeof reservation.pickupReminderFailureCount === "number" &&
        Number.isFinite(reservation.pickupReminderFailureCount) &&
        reservation.pickupReminderFailureCount > 0
      ) {
        reminderFailures += 1;
      }
      if (isStorageCapApproaching(reservation)) approachingCap += 1;
    });
    return {
      enteringHold,
      storedByPolicy,
      reminderFailures,
      approachingCap,
    };
  }, [sortedReservations]);
  const queueFairnessSummary = useMemo(() => {
    let noShowCount = 0;
    let lateArrivalCount = 0;
    let activeOverrides = 0;
    let effectivePenaltyPoints = 0;
    const nowMs = Date.now();
    sortedReservations.forEach((reservation) => {
      const queueFairness = reservation.queueFairness ?? null;
      const queueFairnessPolicy = reservation.queueFairnessPolicy ?? null;
      const noShowValue =
        typeof queueFairness?.noShowCount === "number" && Number.isFinite(queueFairness.noShowCount)
          ? Math.max(0, Math.round(queueFairness.noShowCount))
          : 0;
      const lateValue =
        typeof queueFairness?.lateArrivalCount === "number" &&
        Number.isFinite(queueFairness.lateArrivalCount)
          ? Math.max(0, Math.round(queueFairness.lateArrivalCount))
          : 0;
      const overrideBoost =
        typeof queueFairness?.overrideBoost === "number" && Number.isFinite(queueFairness.overrideBoost)
          ? Math.max(0, Math.round(queueFairness.overrideBoost))
          : 0;
      const overrideUntil = queueFairness?.overrideUntil?.toDate?.() ?? null;
      const overrideActive =
        overrideBoost > 0 &&
        (!overrideUntil || (Number.isFinite(overrideUntil.getTime()) && overrideUntil.getTime() >= nowMs));
      if (overrideActive) activeOverrides += 1;
      const effectivePenalty =
        typeof queueFairnessPolicy?.effectivePenaltyPoints === "number" &&
        Number.isFinite(queueFairnessPolicy.effectivePenaltyPoints)
          ? Math.max(0, Math.round(queueFairnessPolicy.effectivePenaltyPoints))
          : 0;
      noShowCount += noShowValue;
      lateArrivalCount += lateValue;
      effectivePenaltyPoints += effectivePenalty;
    });
    return {
      noShowCount,
      lateArrivalCount,
      activeOverrides,
      effectivePenaltyPoints,
    };
  }, [sortedReservations]);
  const offlinePendingCount = useMemo(
    () => offlineQueue.filter((entry) => entry.status === "pending").length,
    [offlineQueue]
  );
  const offlineFailedCount = useMemo(
    () => offlineQueue.filter((entry) => entry.status === "failed").length,
    [offlineQueue]
  );
  const offlineSyncStatus: "pending" | "failed" | "synced" = useMemo(() => {
    if (offlineQueue.length === 0) return "synced";
    if (offlineFailedCount > 0) return "failed";
    return "pending";
  }, [offlineFailedCount, offlineQueue.length]);

  useEffect(() => {
    if (!pieceLookupNeedle || !pieceLookupMatchReservationId) return;
    const card = document.getElementById(`reservation-${pieceLookupMatchReservationId}`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pieceLookupNeedle, pieceLookupMatchReservationId]);

  useEffect(() => {
    if (!undoStatusAction) return;
    const waitMs = undoStatusAction.expiresAt - Date.now();
    if (waitMs <= 0) {
      setUndoStatusAction(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setUndoStatusAction((current) =>
        current?.expiresAt === undoStatusAction.expiresAt ? null : current
      );
    }, waitMs);
    return () => window.clearTimeout(timer);
  }, [undoStatusAction]);

  const debugPacket = useMemo(() => {
    if (!DEV_MODE) return null;
    return {
      auth: authDebug,
      error: devError,
      lastRequest: lastReq
        ? {
          fn: lastReq.fn,
          url: lastReq.url,
          status: lastReq.status,
          ok: lastReq.ok,
          error: lastReq.error,
          payload: sanitizeDebugPayload(lastReq.payload as Record<string, unknown>),
        }
        : null,
      firestorePaths: {
        createReservation: `${resolveFunctionsBaseUrl()}/createReservation (server-side write)`,
        reservationsRead: "reservations where ownerUid == <uid>",
        staffUsersRead: "users (staff only)",
      },
      rulesMapping:
        "Firestore rules: reservations allow read for ownerUid; writes are expected via createReservation.",
    };
  }, [authDebug, devError, lastReq]);

  const handleCopyDebug = async () => {
    if (!debugPacket) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugPacket, null, 2));
      setDevCopyStatus("Debug snapshot copied.");
    } catch (error: unknown) {
      setDevCopyStatus(getErrorMessage(error) || "Copy failed.");
    }
  };

  const handleFormHandlerError = (error: unknown) => {
    setFormError(getErrorMessage(error) || "Submission failed.");
    setIsSaving(false);
  };

  const handleCopyDebugError = (error: unknown) => {
    setDevCopyStatus(getErrorMessage(error) || "Copy failed.");
  };

  const retryOfflineQueueNow = useCallback(() => {
    if (!isOnlineNow()) {
      setOfflineSyncMessage("Still offline. Reconnect to sync queued actions.");
      return;
    }
    if (!offlineQueue.some((entry) => entry.status === "pending")) {
      setOfflineSyncMessage("No pending offline actions to sync.");
      return;
    }
    void flushOfflineQueue();
  }, [flushOfflineQueue, offlineQueue]);

  const clearFailedOfflineActions = useCallback(() => {
    const next = offlineQueue.filter((entry) => entry.status !== "failed");
    persistOfflineQueue(next);
    setOfflineSyncMessage(
      next.length
        ? "Failed actions removed. Pending queue is preserved."
        : "Failed actions removed and offline queue is clear."
    );
  }, [offlineQueue, persistOfflineQueue]);

  const exportContinuityBundle = useCallback(async () => {
    if (continuityExportBusy) return;
    setContinuityExportBusy(true);
    setContinuityExportMessage("");
    try {
      const idToken = await user.getIdToken();
      const ownerUid = targetOwnerUid || user.uid;
      const envelope = await portalApi.exportReservationContinuity({
        idToken,
        adminToken,
        payload: {
          ownerUid,
          includeCsv: true,
          limit: 500,
        },
      });
      const data = envelope.data ?? {};
      const exportHeader =
        data.exportHeader && typeof data.exportHeader === "object"
          ? (data.exportHeader as Record<string, unknown>)
          : {};
      const artifactIdRaw = asTrimmedString(exportHeader.artifactId);
      const artifactId = sanitizeFileNameToken(artifactIdRaw || `mf-continuity-${Date.now()}`);
      const summary = data.summary && typeof data.summary === "object"
        ? (data.summary as Record<string, unknown>)
        : {};
      const redactionRules = Array.isArray(data.redactionRules)
        ? data.redactionRules
        : [];
      const warnings = Array.isArray(data.warnings)
        ? data.warnings
        : [];
      const jsonBundle = data.jsonBundle && typeof data.jsonBundle === "object"
        ? (data.jsonBundle as Record<string, unknown>)
        : {};

      downloadTextFile(
        `${artifactId}.json`,
        JSON.stringify(
          {
            exportHeader,
            summary,
            redactionRules,
            warnings,
            jsonBundle,
          },
          null,
          2
        ),
        "application/json;charset=utf-8"
      );

      const csvBundle = data.csvBundle && typeof data.csvBundle === "object"
        ? (data.csvBundle as Record<string, unknown>)
        : null;
      let csvCount = 0;
      if (csvBundle) {
        for (const [name, csv] of Object.entries(csvBundle)) {
          if (typeof csv !== "string" || !csv.trim()) continue;
          const safeName = sanitizeFileNameToken(name || "table");
          downloadTextFile(`${artifactId}-${safeName}.csv`, csv, "text/csv;charset=utf-8");
          csvCount += 1;
        }
      }

      setContinuityExportMessage(
        `Continuity export ready: ${artifactId}. Downloaded JSON + ${csvCount} CSV file${csvCount === 1 ? "" : "s"}.`
      );
    } catch (error: unknown) {
      setContinuityExportMessage(`Continuity export failed: ${getErrorMessage(error)}`);
    } finally {
      setContinuityExportBusy(false);
    }
  }, [adminToken, continuityExportBusy, portalApi, targetOwnerUid, user]);

  const toggleNotesTag = (tag: string) => {
    setNotesTags((prev) => (prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]));
  };

  const setPieceRowField = (
    rowId: string,
    key: keyof Omit<ReservationPieceDraft, "rowId">,
    value: string | number
  ) => {
    setPieceRows((prev) =>
      prev.map((row) => {
        if (row.rowId !== rowId) return row;
        if (key === "pieceCount") {
          const count = Number(value);
          return {
            ...row,
            pieceCount:
              Number.isFinite(count) && count > 0 ? Math.max(1, Math.round(count)) : 1,
          };
        }
        if (key === "pieceId") {
          return {
            ...row,
            pieceId: sanitizePieceCodeInput(String(value)),
          };
        }
        if (key === "pieceStatus") {
          const normalized = String(value);
          const nextStatus = PIECE_STATUS_OPTIONS.some((option) => option.id === normalized)
            ? (normalized as ReservationPieceDraftStatus)
            : "awaiting_placement";
          return {
            ...row,
            pieceStatus: nextStatus,
          };
        }
        return {
          ...row,
          [key]: String(value),
        };
      })
    );
  };

  const addPieceRow = () => {
    setPieceRows((prev) => [...prev, createEmptyPieceDraft()]);
  };

  const removePieceRow = (rowId: string) => {
    setPieceRows((prev) => {
      const next = prev.filter((row) => row.rowId !== rowId);
      return next.length ? next : [createEmptyPieceDraft()];
    });
  };

  const importPieceBulkRows = () => {
    const parsed = parsePieceBulkRows(pieceBulkInput);
    if (!parsed.length) return;
    setPieceRows(parsed);
    setPieceBulkInput("");
  };

  const setStaffNotesDraft = (reservationId: string, value: string) => {
    setStaffNotesByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setArrivalNoteDraft = (reservationId: string, value: string) => {
    setArrivalNoteByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setStationDraft = (reservationId: string, value: string) => {
    setStationDraftByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setQueueClassDraft = (reservationId: string, value: string) => {
    setQueueClassDraftByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setPickupWindowStartDraft = (reservationId: string, value: string) => {
    setPickupWindowStartByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setPickupWindowEndDraft = (reservationId: string, value: string) => {
    setPickupWindowEndByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setPickupWindowRequestStartDraft = (reservationId: string, value: string) => {
    setPickupWindowRequestStartByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setPickupWindowRequestEndDraft = (reservationId: string, value: string) => {
    setPickupWindowRequestEndByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setQueueFairnessReasonDraft = (reservationId: string, value: string) => {
    setQueueFairnessReasonByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setQueueFairnessBoostDraft = (reservationId: string, value: string) => {
    setQueueFairnessBoostByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const setQueueFairnessOverrideUntilDraft = (reservationId: string, value: string) => {
    setQueueFairnessOverrideUntilByReservationId((prev) => ({
      ...prev,
      [reservationId]: value,
    }));
  };

  const runPickupWindowAction = async (
    reservationId: string,
    payload: {
      action:
        | "staff_set_open_window"
        | "member_confirm_window"
        | "member_request_reschedule"
        | "staff_mark_missed"
        | "staff_mark_completed";
      confirmedStart?: string | null;
      confirmedEnd?: string | null;
      requestedStart?: string | null;
      requestedEnd?: string | null;
      note?: string | null;
      force?: boolean;
    },
    successMessage: string,
    options?: {
      allowOfflineQueue?: boolean;
    }
  ) => {
    if (pickupWindowBusyId) return;
    const allowOfflineQueue = options?.allowOfflineQueue === true;
    const requestPayload: Record<string, unknown> = {
      reservationId,
      ...payload,
    };
    setPickupWindowBusyId(reservationId);
    setPickupWindowMessage("");
    try {
      if (allowOfflineQueue && isStaff && !isOnlineNow()) {
        queueOfflineStaffAction({
          reservationId,
          actionType: "pickup_window",
          payload: requestPayload,
          message:
            "Offline mode: pickup window action queued. It will sync automatically when connection returns.",
        });
        setPickupWindowMessage(
          "Offline mode: pickup window action queued. It will sync automatically when connection returns."
        );
        return;
      }
      const idToken = await user.getIdToken();
      await portalApi.updateReservationPickupWindow({
        idToken,
        adminToken,
        payload: requestPayload as {
          reservationId: string;
          action:
            | "staff_set_open_window"
            | "member_confirm_window"
            | "member_request_reschedule"
            | "staff_mark_missed"
            | "staff_mark_completed";
          confirmedStart?: string | null;
          confirmedEnd?: string | null;
          requestedStart?: string | null;
          requestedEnd?: string | null;
          note?: string | null;
          force?: boolean;
        },
      });
      setPickupWindowMessage(successMessage);
      await loadReservations();
    } catch (error: unknown) {
      if (allowOfflineQueue && isStaff && isRetryableOfflineError(error)) {
        queueOfflineStaffAction({
          reservationId,
          actionType: "pickup_window",
          payload: requestPayload,
          message:
            "Network issue detected. Pickup window action queued for automatic retry when online.",
        });
        setPickupWindowMessage(
          "Network issue detected. Pickup window action queued for automatic retry when online."
        );
        return;
      }
      setPickupWindowMessage(`Pickup window update failed: ${getErrorMessage(error)}`);
    } finally {
      setPickupWindowBusyId(null);
    }
  };

  const openPickupWindowForReservation = async (reservation: ReservationRecord) => {
    const draftStart = pickupWindowStartByReservationId[reservation.id] ?? "";
    const draftEnd = pickupWindowEndByReservationId[reservation.id] ?? "";
    const fallbackStart = reservation.pickupWindow?.requestedStart?.toDate?.() ?? null;
    const fallbackEnd = reservation.pickupWindow?.requestedEnd?.toDate?.() ?? null;
    const confirmedStartIso =
      parseDateTimeInputToIso(draftStart) ??
      (fallbackStart ? fallbackStart.toISOString() : null);
    const confirmedEndIso =
      parseDateTimeInputToIso(draftEnd) ??
      (fallbackEnd ? fallbackEnd.toISOString() : null);
    if (!confirmedStartIso || !confirmedEndIso) {
      setPickupWindowMessage("Set both pickup window start and end before opening availability.");
      return;
    }
    await runPickupWindowAction(
      reservation.id,
      {
        action: "staff_set_open_window",
        confirmedStart: confirmedStartIso,
        confirmedEnd: confirmedEndIso,
      },
      "Pickup window is now open for member confirmation.",
      { allowOfflineQueue: true }
    );
  };

  const confirmPickupWindowForReservation = async (reservation: ReservationRecord) => {
    await runPickupWindowAction(
      reservation.id,
      {
        action: "member_confirm_window",
      },
      "Pickup window confirmed."
    );
  };

  const requestPickupRescheduleForReservation = async (reservation: ReservationRecord) => {
    const existingRescheduleCount =
      typeof reservation.pickupWindow?.rescheduleCount === "number" &&
      Number.isFinite(reservation.pickupWindow.rescheduleCount)
        ? Math.max(0, Math.round(reservation.pickupWindow.rescheduleCount))
        : 0;
    if (existingRescheduleCount >= PICKUP_WINDOW_RESCHEDULE_LIMIT) {
      setPickupWindowMessage("Reschedule request limit has already been used for this reservation.");
      return;
    }

    const draftStart = pickupWindowRequestStartByReservationId[reservation.id] ?? "";
    const draftEnd = pickupWindowRequestEndByReservationId[reservation.id] ?? "";
    const fallbackStart = reservation.pickupWindow?.confirmedStart?.toDate?.() ?? null;
    const fallbackEnd = reservation.pickupWindow?.confirmedEnd?.toDate?.() ?? null;
    const requestedStartIso =
      parseDateTimeInputToIso(draftStart) ??
      (fallbackStart ? fallbackStart.toISOString() : null);
    const requestedEndIso =
      parseDateTimeInputToIso(draftEnd) ??
      (fallbackEnd ? fallbackEnd.toISOString() : null);
    if (!requestedStartIso || !requestedEndIso) {
      setPickupWindowMessage("Set your requested pickup window start and end first.");
      return;
    }

    await runPickupWindowAction(
      reservation.id,
      {
        action: "member_request_reschedule",
        requestedStart: requestedStartIso,
        requestedEnd: requestedEndIso,
      },
      "Reschedule request sent. Staff will reopen the pickup window."
    );
  };

  const markPickupWindowMissedForReservation = async (reservation: ReservationRecord) => {
    await runPickupWindowAction(
      reservation.id,
      {
        action: "staff_mark_missed",
      },
      "Pickup window marked missed and policy state updated.",
      { allowOfflineQueue: true }
    );
  };

  const markPickupWindowCompletedForReservation = async (reservation: ReservationRecord) => {
    await runPickupWindowAction(
      reservation.id,
      {
        action: "staff_mark_completed",
      },
      "Pickup marked complete.",
      { allowOfflineQueue: true }
    );
  };

  const runQueueFairnessAction = async (
    reservationId: string,
    payload: {
      action: "record_no_show" | "record_late_arrival" | "set_override_boost" | "clear_override";
      reason: string;
      boostPoints?: number | null;
      overrideUntil?: string | null;
    },
    successMessage: string
  ) => {
    if (queueFairnessBusyId) return;
    const requestPayload: Record<string, unknown> = {
      reservationId,
      ...payload,
    };
    setQueueFairnessBusyId(reservationId);
    setQueueFairnessMessage("");
    try {
      if (isStaff && !isOnlineNow()) {
        queueOfflineStaffAction({
          reservationId,
          actionType: "queue_fairness",
          payload: requestPayload,
          message:
            "Offline mode: fairness action queued. It will sync automatically when connection returns.",
        });
        setQueueFairnessMessage(
          "Offline mode: fairness action queued. It will sync automatically when connection returns."
        );
        return;
      }
      const idToken = await user.getIdToken();
      await portalApi.updateReservationQueueFairness({
        idToken,
        adminToken,
        payload: requestPayload as {
          reservationId: string;
          action: "record_no_show" | "record_late_arrival" | "set_override_boost" | "clear_override";
          reason: string;
          boostPoints?: number | null;
          overrideUntil?: string | null;
        },
      });
      setQueueFairnessMessage(successMessage);
      await loadReservations();
    } catch (error: unknown) {
      if (isStaff && isRetryableOfflineError(error)) {
        queueOfflineStaffAction({
          reservationId,
          actionType: "queue_fairness",
          payload: requestPayload,
          message:
            "Network issue detected. Fairness action queued for automatic retry when online.",
        });
        setQueueFairnessMessage(
          "Network issue detected. Fairness action queued for automatic retry when online."
        );
        return;
      }
      setQueueFairnessMessage(`Queue fairness update failed: ${getErrorMessage(error)}`);
    } finally {
      setQueueFairnessBusyId(null);
    }
  };

  const recordNoShowForReservation = async (reservation: ReservationRecord) => {
    const reason = (queueFairnessReasonByReservationId[reservation.id] ?? "").trim();
    if (!reason) {
      setQueueFairnessMessage("Add a fairness reason before recording a no-show.");
      return;
    }
    await runQueueFairnessAction(
      reservation.id,
      {
        action: "record_no_show",
        reason,
      },
      "No-show recorded and fairness policy refreshed."
    );
  };

  const recordLateArrivalForReservation = async (reservation: ReservationRecord) => {
    const reason = (queueFairnessReasonByReservationId[reservation.id] ?? "").trim();
    if (!reason) {
      setQueueFairnessMessage("Add a fairness reason before recording a late arrival.");
      return;
    }
    await runQueueFairnessAction(
      reservation.id,
      {
        action: "record_late_arrival",
        reason,
      },
      "Late arrival recorded and fairness policy refreshed."
    );
  };

  const setQueueFairnessOverrideForReservation = async (reservation: ReservationRecord) => {
    const reason = (queueFairnessReasonByReservationId[reservation.id] ?? "").trim();
    if (!reason) {
      setQueueFairnessMessage("Add a fairness reason before applying an override.");
      return;
    }
    const boostDraft = (queueFairnessBoostByReservationId[reservation.id] ?? "").trim();
    const boostParsed = Number(boostDraft);
    if (!Number.isFinite(boostParsed)) {
      setQueueFairnessMessage("Set override boost points (0-20) before applying override.");
      return;
    }
    const boostPoints = Math.max(0, Math.min(FAIRNESS_OVERRIDE_MAX_POINTS, Math.round(boostParsed)));
    const overrideUntilDraft = (queueFairnessOverrideUntilByReservationId[reservation.id] ?? "").trim();
    const overrideUntilIso = overrideUntilDraft ? parseDateTimeInputToIso(overrideUntilDraft) : null;
    if (overrideUntilDraft && !overrideUntilIso) {
      setQueueFairnessMessage("Override until must be a valid date/time.");
      return;
    }
    await runQueueFairnessAction(
      reservation.id,
      {
        action: "set_override_boost",
        reason,
        boostPoints,
        overrideUntil: overrideUntilIso,
      },
      "Queue fairness override applied."
    );
  };

  const clearQueueFairnessOverrideForReservation = async (reservation: ReservationRecord) => {
    const reason = (queueFairnessReasonByReservationId[reservation.id] ?? "").trim();
    if (!reason) {
      setQueueFairnessMessage("Add a fairness reason before clearing override.");
      return;
    }
    await runQueueFairnessAction(
      reservation.id,
      {
        action: "clear_override",
        reason,
      },
      "Queue fairness override cleared."
    );
  };

  const assignStationForReservation = async (reservation: ReservationRecord) => {
    if (staffActionBusyId) return;
    const stationId =
      normalizeStationValue(stationDraftByReservationId[reservation.id]) ??
      normalizeStationValue(reservation.assignedStationId) ??
      normalizeStationValue(reservation.kilnId);
    if (!stationId) {
      setStaffActionMessage("Select a station before assigning.");
      return;
    }
    const laneDraft = (queueClassDraftByReservationId[reservation.id] ?? "").trim().toLowerCase();
    const requestPayload: Record<string, unknown> = {
      reservationId: reservation.id,
      assignedStationId: stationId,
      queueClass: laneDraft || null,
    };
    setStaffActionBusyId(reservation.id);
    setStaffActionMessage("");
    try {
      if (isStaff && !isOnlineNow()) {
        queueOfflineStaffAction({
          reservationId: reservation.id,
          actionType: "assign_station",
          payload: requestPayload,
          message:
            "Offline mode: station assignment queued. It will sync automatically when connection returns.",
        });
        setStaffActionMessage(
          "Offline mode: station assignment queued. It will sync automatically when connection returns."
        );
        return;
      }
      const idToken = await user.getIdToken();
      const result = await portalApi.assignReservationStation({
        idToken,
        adminToken,
        payload: requestPayload as {
          reservationId: string;
          assignedStationId: string;
          queueClass?: string | null;
        },
      });
      const data = result.data ?? {};
      const used = typeof data.stationUsedAfter === "number" ? data.stationUsedAfter : null;
      const capacity = typeof data.stationCapacity === "number" ? data.stationCapacity : null;
      const capacityCopy =
        used !== null && capacity !== null ? ` (${used}/${capacity} half shelves)` : "";
      setStaffActionMessage(`Station assigned to ${stationId}${capacityCopy}.`);
      await loadReservations();
    } catch (error: unknown) {
      if (isStaff && isRetryableOfflineError(error)) {
        queueOfflineStaffAction({
          reservationId: reservation.id,
          actionType: "assign_station",
          payload: requestPayload,
          message:
            "Network issue detected. Station assignment queued for automatic retry when online.",
        });
        setStaffActionMessage(
          "Network issue detected. Station assignment queued for automatic retry when online."
        );
        return;
      }
      setStaffActionMessage(`Station assignment failed: ${getErrorMessage(error)}`);
    } finally {
      setStaffActionBusyId(null);
    }
  };

  const requestStatusAction = (reservationId: string, currentStatus: unknown, nextStatus: StaffQueueStatus) => {
    setStaffActionMessage("");
    setPendingStatusAction({
      reservationId,
      currentStatus: toReservationStatus(currentStatus),
      nextStatus,
    });
  };

  const applyStatusAction = async () => {
    if (!pendingStatusAction || staffActionBusyId) return;
    const notesDraft = (staffNotesByReservationId[pendingStatusAction.reservationId] ?? "").trim();
    const requestPayload: Record<string, unknown> = {
      reservationId: pendingStatusAction.reservationId,
      status: pendingStatusAction.nextStatus,
      staffNotes: notesDraft || null,
    };
    setStaffActionBusyId(pendingStatusAction.reservationId);
    setStaffActionMessage("");
    setStaffToolsUnavailable("");
    try {
      if (isStaff && !isOnlineNow()) {
        queueOfflineStaffAction({
          reservationId: pendingStatusAction.reservationId,
          actionType: "status_update",
          payload: requestPayload,
          message:
            "Offline mode: status change queued. It will sync automatically when connection returns.",
        });
        setStaffActionMessage(
          "Offline mode: status change queued. It will sync automatically when connection returns."
        );
        setPendingStatusAction(null);
        return;
      }
      const idToken = await user.getIdToken();
      const response = await portalApi.updateReservation({
        idToken,
        adminToken,
        payload: requestPayload as {
          reservationId: string;
          status: StaffQueueStatus;
          staffNotes?: string | null;
        },
      });
      const responseData = (response.data ?? {}) as { arrivalToken?: unknown };
      const arrivalTokenIssued =
        typeof responseData.arrivalToken === "string" ? responseData.arrivalToken : null;
      setUndoStatusAction({
        reservationId: pendingStatusAction.reservationId,
        previousStatus: pendingStatusAction.currentStatus,
        previousStaffNotes: notesDraft || null,
        expiresAt: Date.now() + STAFF_UNDO_WINDOW_MS,
      });
      setStaffActionMessage(
        `Reservation moved to ${pendingStatusAction.nextStatus}. Undo is available for ${Math.floor(
          STAFF_UNDO_WINDOW_MS / 1000
        )} seconds.${arrivalTokenIssued ? ` Arrival code: ${arrivalTokenIssued}` : ""}`
      );
      setPendingStatusAction(null);
      await loadReservations();
    } catch (error: unknown) {
      if (isStaff && isRetryableOfflineError(error)) {
        queueOfflineStaffAction({
          reservationId: pendingStatusAction.reservationId,
          actionType: "status_update",
          payload: requestPayload,
          message:
            "Network issue detected. Status change queued for automatic retry when online.",
        });
        setStaffActionMessage(
          "Network issue detected. Status change queued for automatic retry when online."
        );
        setPendingStatusAction(null);
        return;
      }
      const message = getErrorMessage(error) || "Unable to update reservation.";
      const lower = message.toLowerCase();
      if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("permission")) {
        setStaffToolsUnavailable(
          "Staff queue tools are unavailable right now due to permissions. Retry after claims sync, or contact support with code RES-STAFF-AUTH."
        );
      }
      setStaffActionMessage(`Status update failed: ${message}`);
    } finally {
      setStaffActionBusyId(null);
    }
  };

  const undoLastStatusAction = async () => {
    if (!undoStatusAction || staffActionBusyId) return;
    if (Date.now() > undoStatusAction.expiresAt) {
      setUndoStatusAction(null);
      return;
    }
    setStaffActionBusyId(undoStatusAction.reservationId);
    setStaffActionMessage("");
    try {
      const idToken = await user.getIdToken();
      await portalApi.updateReservation({
        idToken,
        adminToken,
        payload: {
          reservationId: undoStatusAction.reservationId,
          status: undoStatusAction.previousStatus,
          staffNotes: undoStatusAction.previousStaffNotes,
        },
      });
      setStaffActionMessage("Last status change was reverted.");
      setUndoStatusAction(null);
      await loadReservations();
    } catch (error: unknown) {
      setStaffActionMessage(`Undo failed: ${getErrorMessage(error)}`);
    } finally {
      setStaffActionBusyId(null);
    }
  };

  const checkInArrivalForReservation = async (reservation: ReservationRecord) => {
    if (arrivalBusyId) return;
    const draftNote = (arrivalNoteByReservationId[reservation.id] ?? "").trim();
    setArrivalBusyId(reservation.id);
    setArrivalMessage("");
    try {
      const envelope = await client.postJson<{
        data?: {
          idempotentReplay?: boolean;
        };
      }>("apiV1/v1/reservations.checkIn", {
        reservationId: reservation.id,
        note: draftNote || null,
      });
      const replay = envelope?.data?.idempotentReplay === true;
      setArrivalMessage(
        replay
          ? "Arrival was already recorded. You’re all set."
          : "Arrival check-in saved. Staff can now stage your reservation."
      );
      setArrivalNoteByReservationId((prev) => {
        const next = { ...prev };
        delete next[reservation.id];
        return next;
      });
      await loadReservations();
    } catch (error: unknown) {
      setArrivalMessage(`Arrival check-in failed: ${getErrorMessage(error)}`);
    } finally {
      setArrivalBusyId(null);
    }
  };

  const lookupArrivalTokenForStaff = async () => {
    const token = arrivalLookupToken.trim();
    if (!token || arrivalLookupBusy) return;
    setArrivalLookupBusy(true);
    setArrivalMessage("");
    setArrivalLookupResult(null);
    setArrivalLookupOutstanding(null);
    try {
      const envelope = await client.postJson<{
        data?: {
          reservation?: Partial<ReservationRecord> & { id?: string };
          outstandingRequirements?: ArrivalLookupOutstanding;
        };
      }>("apiV1/v1/reservations.lookupArrival", {
        arrivalToken: token,
      });
      const reservationRaw = envelope?.data?.reservation ?? null;
      if (!reservationRaw?.id) {
        throw new Error("Lookup returned no reservation.");
      }
      setArrivalLookupResult(
        normalizeReservationRecord(
          String(reservationRaw.id),
          reservationRaw as Partial<ReservationRecord>
        )
      );
      setArrivalLookupOutstanding(envelope?.data?.outstandingRequirements ?? null);
      setArrivalMessage("Arrival code matched successfully.");
    } catch (error: unknown) {
      setArrivalMessage(`Arrival lookup failed: ${getErrorMessage(error)}`);
    } finally {
      setArrivalLookupBusy(false);
    }
  };

  const rotateArrivalTokenForReservation = async (reservation: ReservationRecord) => {
    if (staffActionBusyId) return;
    setStaffActionBusyId(reservation.id);
    setStaffActionMessage("");
    try {
      const envelope = await client.postJson<{
        data?: {
          arrivalToken?: string;
        };
      }>("apiV1/v1/reservations.rotateArrivalToken", {
        reservationId: reservation.id,
        reason: "manual_staff_reissue",
      });
      const nextToken =
        envelope?.data?.arrivalToken && typeof envelope.data.arrivalToken === "string"
          ? envelope.data.arrivalToken
          : "new code issued";
      setStaffActionMessage(`Arrival code reissued: ${nextToken}`);
      await loadReservations();
    } catch (error: unknown) {
      setStaffActionMessage(`Arrival code reissue failed: ${getErrorMessage(error)}`);
    } finally {
      setStaffActionBusyId(null);
    }
  };

  const anyAddOnsSelected =
    useStudioGlazes ||
    rushRequested ||
    waxResistAssistRequested ||
    glazeSanityCheckRequested ||
    wholeKilnRequested ||
    pickupDeliveryRequested ||
    returnDeliveryRequested;

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      setPhotoStatus("");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoStatus("Photo is too large. Please keep it under 8MB.");
      setPhotoFile(null);
      return;
    }
    setPhotoStatus("");
    setPhotoFile(file);
  };

  const uploadPhoto = async (ownerUid: string, requestId: string) => {
    const file = photoFile;
    if (!file) return { url: null, path: null };
    const storage = getStorage();
    if (typeof import.meta !== "undefined" && ENV.VITE_USE_EMULATORS === "true") {
      const host = String(ENV.VITE_STORAGE_EMULATOR_HOST || "127.0.0.1");
      const port = Number(ENV.VITE_STORAGE_EMULATOR_PORT || 9199);
      connectStorageEmulator(storage, host, port);
    }

    const ext = getFileExtension(file);
    const safeFileName = `work-${Date.now()}.${ext}`;
    const path = `checkins/${ownerUid}/${requestId}/${safeFileName}`;
    const photoRef = ref(storage, path);

    setPhotoStatus("Uploading photo…");
    await uploadBytes(photoRef, file, { contentType: file.type || "image/jpeg" });
    const url = await getDownloadURL(photoRef);
    setPhotoStatus("Photo uploaded.");

    return { url, path };
  };

  const resetForm = () => {
    setWareType("stoneware");
    setKilnId("studio-electric");
    setFiringType("bisque");
    setFootprintHalfShelves(1);
    setHasTallPieces(false);
    setTiers(1);
    setEstimatedHalfShelves(1);
    setUseVolumePricing(false);
    setVolumeMode("total");
    setVolumeIn3(null);
    setVolumeLengthIn(null);
    setVolumeWidthIn(null);
    setVolumeHeightIn(null);
    setFitsOnOneLayer(null);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setPhotoStatus("");
    setLatest("");
    setLinkedBatchId("");
    setNotesTags([]);
    setNotesGeneral("");
    setPieceRows([createEmptyPieceDraft()]);
    setPieceBulkInput("");
    setRushRequested(false);
    setWaxResistAssistRequested(false);
    setGlazeSanityCheckRequested(false);
    setWholeKilnRequested(false);
    setPickupDeliveryRequested(false);
    setReturnDeliveryRequested(false);
    setDeliveryAddress("");
    setDeliveryInstructions("");
    setUseStudioGlazes(false);
    setGlazeAccessCost(null);
    setSubmitRequestId(null);
    setPrefillNote(null);
    setDevError(null);
    setDevCopyStatus("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    setFormStatus("");
    if (DEV_MODE) {
      setDevError(null);
      setDevCopyStatus("");
    }

    if (mode === "staff" && !staffTargetUid) {
      setFormError("Select a client for this staff check-in.");
      return;
    }

    if (!wareType) {
      setFormError("Choose a clay body for this work.");
      return;
    }

    if (!kilnId) {
      setFormError("Pick which kiln the work should go in.");
      return;
    }

    if (selectedKiln?.isOffline) {
      setFormError("That kiln is temporarily unavailable right now.");
      return;
    }

    if (!Number.isFinite(footprintHalfShelves) || footprintHalfShelves < 1) {
      setFormError("Tell us roughly how much table space you need.");
      return;
    }

    if (useVolumePricing && (!volumeIn3 || volumeIn3 <= 0)) {
      setFormError("Add a volume estimate so we can guide tiny-run pricing.");
      return;
    }

    if (pickupDeliveryRequested || returnDeliveryRequested) {
      if (!deliveryAddress.trim()) {
        setFormError("Add the delivery address so we can schedule pickup/return.");
        return;
      }
      if (!deliveryInstructions.trim()) {
        setFormError("Add gate codes or delivery instructions so we can find you.");
        return;
      }
    }

    const latestDate = sanitizeDateInput(latest);
    const normalizedPieces = pieceRows
      .map((row) => {
        const pieceId = sanitizePieceCodeInput(row.pieceId || "");
        const pieceLabel = row.pieceLabel.trim();
        const piecePhotoUrl = row.piecePhotoUrl.trim();
        const pieceCount =
          Number.isFinite(row.pieceCount) && row.pieceCount > 0
            ? Math.max(1, Math.round(row.pieceCount))
            : 1;
        if (!pieceId && !pieceLabel && !piecePhotoUrl) return null;
        return {
          pieceId: pieceId || null,
          pieceLabel: pieceLabel || null,
          pieceCount,
          piecePhotoUrl: piecePhotoUrl || null,
          pieceStatus: row.pieceStatus,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (normalizedPieces.length > 0) {
      const totalPieceCount = normalizedPieces.reduce((sum, row) => sum + row.pieceCount, 0);
      const shelfEstimate = Math.max(1, estimatedHalfShelvesRounded || computedHalfShelves);
      const minimumExpected = Math.max(1, shelfEstimate - 1);
      const maximumExpected = Math.max(minimumExpected, shelfEstimate * 12);
      if (totalPieceCount < minimumExpected || totalPieceCount > maximumExpected) {
        setFormError(
          `Piece count (${totalPieceCount}) looks out of range for ${shelfEstimate} half shelves. Adjust piece rows or space estimate before submitting.`
        );
        return;
      }
    }

    const requestId = submitRequestId ?? makeRequestId("req");
    if (!submitRequestId) {
      setSubmitRequestId(requestId);
    }
    track("batch_create_test_clicked", {
      uid: shortId(user.uid),
      batchId: shortId(linkedBatchId || requestId),
      mode,
      firingType,
      kilnId,
    });

    setIsSaving(true);
    try {
      const ownerUid = targetOwnerUid;
      const photoResult = ownerUid ? await uploadPhoto(ownerUid, requestId) : { url: null, path: null };

      const safeEstimatedHalfShelves = Number.isFinite(estimatedHalfShelves)
        ? Math.round(estimatedHalfShelves as number)
        : null;
      const safeEstimatedCost = Number.isFinite(totalEstimate)
        ? (totalEstimate as number)
        : null;
      const payload = {
        firingType,
        shelfEquivalent,
        footprintHalfShelves: Number.isFinite(footprintHalfShelves) ? footprintHalfShelves : null,
        heightInches: hasTallPieces ? derivedHeightInches : null,
        tiers: Number.isFinite(tiers) ? tiers : null,
        estimatedHalfShelves: safeEstimatedHalfShelves,
        useVolumePricing,
        volumeIn3: Number.isFinite(volumeIn3) ? volumeIn3 : null,
        estimatedCost: safeEstimatedCost,
        preferredWindow: {
          latestDate: latestDate ? latestDate.toISOString() : null,
        },
        linkedBatchId: linkedBatchId.trim() || null,
        clientRequestId: requestId,
        ownerUid: mode === "staff" ? staffTargetUid || null : null,
        wareType,
        kilnId,
        kilnLabel: selectedKiln?.label || null,
        photoUrl: photoResult.url,
        photoPath: photoResult.path,
        notes: {
          general: [notesGeneral.trim(), notesTags.join(", ")].filter(Boolean).join(" · ") || null,
          clayBody: null,
          glazeNotes: null,
        },
        pieces: normalizedPieces.length ? normalizedPieces : null,
        addOns: {
          rushRequested,
          waxResistAssistRequested,
          glazeSanityCheckRequested,
          wholeKilnRequested,
          pickupDeliveryRequested,
          returnDeliveryRequested,
          useStudioGlazes,
          glazeAccessCost: useStudioGlazes ? glazeAccessCost : null,
          deliveryAddress: deliveryAddress.trim() || null,
          deliveryInstructions: deliveryInstructions.trim() || null,
        },
      };

      await client.postJson("createReservation", payload);
      track("batch_create_test_success", {
        uid: shortId(user.uid),
        batchId: shortId(linkedBatchId || requestId),
        mode,
        firingType,
        kilnId,
      });
      setFormStatus(mode === "staff" ? "Staff check-in saved." : "Check-in sent.");
      resetForm();
    } catch (error: unknown) {
      const recentReq = client.getLastRequest();
      captureDevError("submit", error, recentReq?.url || "functions/createReservation");
      track("batch_create_test_error", {
        uid: shortId(user.uid),
        batchId: shortId(linkedBatchId || requestId),
        mode,
        firingType,
        kilnId,
        message: getErrorMessage(error).slice(0, 160),
      });
      setFormError(getErrorMessage(error) || "Submission failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const showStaffTools = isStaff;

  return (
    <div className="page reservations-page">
      <div className="page-header">
        <div>
          <h1>Ware Check-in</h1>
          <p className="page-subtitle">
            Think of it like an airport: pre-check here to breeze through the gate-check, or let
            an agent help you check in. Both are equally good ways to use the studio kiln rentals.
          </p>
        </div>
      </div>

      {showStaffTools ? (
        <RevealCard
          as="section"
          className="card card-3d staff-checkin-card"
          index={0}
          enabled={motionEnabled}
        >
          <div className="card-title">Staff check-in tool</div>
          <p className="form-helper">
            Use this when a client is not on the portal. Select a client, then complete the same
            check-in flow on their behalf.
          </p>
          <div className="segmented staff-mode-toggle">
            <button
              type="button"
              className={mode === "client" ? "active" : ""}
              onClick={() => setMode("client")}
            >
              Client self-check-in
            </button>
            <button
              type="button"
              className={mode === "staff" ? "active" : ""}
              onClick={() => setMode("staff")}
            >
              Staff check-in
            </button>
          </div>
          {mode === "staff" ? (
            <div className="staff-client-grid">
              <label>
                Client
                <select value={staffTargetUid} onChange={(event) => setStaffTargetUid(event.target.value)}>
                  <option value="">Select a client</option>
                  {staffUsers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                      {member.email ? ` · ${member.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-helper staff-client-note">
                Staff submissions do not charge automatically. Pricing is handled offline.
              </p>
            </div>
          ) : null}
          {mode === "staff" && !hasStaffClaim ? (
            <div className="notice inline-alert">
              Staff client lists require a staff auth claim. Dev admin tokens only apply to
              Cloud Functions.
            </div>
          ) : null}
        </RevealCard>
      ) : null}

      {recentBisqueReservation ? (
        <RevealCard
          as="section"
          className="card card-3d recent-checkin-card"
          index={1}
          enabled={motionEnabled}
        >
          <div className="card-title">Recently bisqued? Send it to glaze</div>
          <p className="form-helper">
            We found a recent bisque check-in. Reuse it as a glaze submission with one tap.
          </p>
          <div className="recent-checkin-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setLinkedBatchId(recentBisqueReservation.linkedBatchId ?? "");
                setFiringType("glaze");
                if (recentBisqueReservation.kilnId) {
                  setKilnId(recentBisqueReservation.kilnId);
                }
                setPrefillNote(`Loaded from ${recentBisqueReservation.linkedBatchId}.`);
              }}
            >
              Re-submit this bisque to glaze
            </button>
          </div>
        </RevealCard>
      ) : null}

      <RevealCard as="section" className="card card-3d reservation-form" index={2} enabled={motionEnabled}>
        <div className="card-title">
          {mode === "staff" ? "Staff check-in workflow" : "Self check-in workflow"}
        </div>
        <p className="form-helper">
          {mode === "staff"
            ? "Capture the essentials so the studio can load the next firing smoothly."
            : "Tell us what you’re dropping off, snap a quick photo, and pick your kiln path."}
        </p>

        {mode === "staff" && !staffTargetUid ? (
          <div className="notice inline-alert">Select a client above to unlock the form.</div>
        ) : (
          <form
            onSubmit={toVoidHandler(handleSubmit, handleFormHandlerError, "reservations.submit")}
            className="checkin-form"
          >
            <div className="checkin-step">
              <div className="checkin-step-title">1. Choose the clay body</div>
              <div className="option-grid">
                {WARE_TYPES.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card ${wareType === option.id ? "selected" : ""}`}
                    onClick={() => setWareType(option.id)}
                    aria-pressed={wareType === option.id}
                  >
                    <span className={`option-icon option-icon-${option.id}`} aria-hidden="true" />
                    <span className="option-title">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">2. Snap a photo of the work (optional)</div>
              <div className="photo-upload">
                <label className="photo-frame">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                  />
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Work preview" />
                  ) : (
                    <div className="photo-placeholder">
                      Tap to open your camera.
                      <span>Optional — photos stay with the piece for reference.</span>
                    </div>
                  )}
                </label>
                {photoStatus ? <div className="photo-status">{photoStatus}</div> : null}
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">3. Pick the kiln + firing</div>
              <div className="option-grid">
                {kilnOptions.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card ${option.isOffline ? "offline" : ""} ${
                      kilnId === option.id ? "selected" : ""
                    }`}
                    onClick={() => setKilnId(option.id)}
                    disabled={option.isOffline}
                    aria-pressed={kilnId === option.id}
                  >
                    {option.isOffline ? (
                      <span className="option-sticker">Temporarily unavailable</span>
                    ) : null}
                    <span className="option-icon option-icon-kiln" aria-hidden="true" />
                    <span className="option-title">{option.label}</span>
                    <span className="option-meta">{option.detail}</span>
                  </button>
                ))}
              </div>
              <div className="option-grid firing-grid">
                {FIRING_OPTIONS.filter((option) => {
                  if (selectedKiln?.id === "reduction-raku") {
                    return option.id !== "bisque";
                  }
                  return true;
                }).map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`option-card compact ${firingType === option.id ? "selected" : ""}`}
                    onClick={() => setFiringType(option.id)}
                    aria-pressed={firingType === option.id}
                  >
                    <span className="option-title">{option.label}</span>
                  </button>
                ))}
              </div>
              {selectedKiln?.id === "reduction-raku" ? (
                <div className="notice inline-alert">
                  Raku is always glaze pricing. We&apos;ll confirm space together.
                </div>
              ) : null}
            </div>

            <div className="checkin-step estimator-step">
              <div className="checkin-step-title">4. Space + cost estimate</div>
              <div className="estimator-grid">
                <div className="estimator-controls">
                <div className="estimator-block">
                  <div className="estimator-label">How much table space?</div>
                  <div
                    className={`segmented-grid footprint-grid ${
                      fitsOnOneLayer === "no" ? "needs-attention" : ""
                    }`}
                  >
                    {[1, 2, 3].map((count) => (
                      <button
                        type="button"
                        key={`footprint-${count}`}
                        className={`segmented-button ${
                          footprintHalfShelves === count ? "selected" : ""
                        }`}
                        onClick={() => setFootprintHalfShelves(count)}
                        aria-pressed={footprintHalfShelves === count}
                      >
                        <span className="segmented-main">{count}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`segmented-button ${showMoreFootprints ? "selected" : ""}`}
                      onClick={() => setShowMoreFootprints((prev) => !prev)}
                      aria-label="Show more shelf options"
                      aria-pressed={showMoreFootprints}
                    >
                      <span className="segmented-main">More</span>
                    </button>
                    {showMoreFootprints
                      ? Array.from({ length: 5 }, (_, index) => index + 4).map((count) => (
                          <button
                            type="button"
                            key={`footprint-${count}`}
                            className={`segmented-button ${
                              footprintHalfShelves === count ? "selected" : ""
                            }`}
                            onClick={() => {
                              setFootprintHalfShelves(count);
                              setShowMoreFootprints(true);
                            }}
                            aria-pressed={footprintHalfShelves === count}
                          >
                            <span className="segmented-main">{count}</span>
                            {count === 4 ? (
                              <span className="segmented-sub">Whole kiln option</span>
                            ) : null}
                          </button>
                        ))
                      : null}
                  </div>
                  <p className="form-helper">
                    About one carry-on suitcase laid flat.
                  </p>
                </div>

                  {showFitPrompt ? (
                    <div className="estimator-block">
                      <div className="estimator-label">
                        Do these pieces still fit side-by-side on one layer?
                      </div>
                      <div className="segmented-grid yesno-grid">
                        <button
                          type="button"
                          className={`segmented-button ${fitsOnOneLayer === "yes" ? "selected" : ""}`}
                          onClick={() => setFitsOnOneLayer("yes")}
                          aria-pressed={fitsOnOneLayer === "yes"}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          className={`segmented-button ${fitsOnOneLayer === "no" ? "selected" : ""}`}
                          onClick={() => setFitsOnOneLayer("no")}
                          aria-pressed={fitsOnOneLayer === "no"}
                        >
                          No
                        </button>
                      </div>
                      {fitsOnOneLayer === "no" ? (
                        <div className="notice inline-alert">
                          If things feel tight, bump up the footprint. We&apos;ll adjust together.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {showVolumeToggle || useVolumePricing ? (
                    <div className="estimator-block">
                      <button
                        type="button"
                        className={`tiny-toggle ${useVolumePricing ? "active" : ""}`}
                        onClick={() => setUseVolumePricing((prev) => !prev)}
                        aria-expanded={useVolumePricing}
                        aria-pressed={useVolumePricing}
                      >
                        Tiny run? Price by volume instead
                      </button>
                      {useVolumePricing ? (
                      <div className="tiny-run-panel">
                        <div className="segmented volume-mode-toggle">
                          <button
                            type="button"
                            className={volumeMode === "total" ? "active" : ""}
                            onClick={() => setVolumeMode("total")}
                          >
                            Total volume
                          </button>
                          <button
                            type="button"
                            className={volumeMode === "dimensions" ? "active" : ""}
                            onClick={() => setVolumeMode("dimensions")}
                          >
                            L × W × H
                          </button>
                        </div>
                        {volumeMode === "total" ? (
                          <label>
                            Total volume (in^3)
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={volumeIn3 ?? ""}
                              onChange={(event) =>
                                setVolumeIn3(event.target.value ? Number(event.target.value) : null)
                              }
                            />
                          </label>
                        ) : (
                          <div className="volume-dimensions">
                            <label>
                              Length (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeLengthIn ?? ""}
                                onChange={(event) =>
                                  setVolumeLengthIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                            <label>
                              Width (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeWidthIn ?? ""}
                                onChange={(event) =>
                                  setVolumeWidthIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                            <label>
                              Height (in)
                              <input
                                type="number"
                                min="1"
                                step="0.5"
                                value={volumeHeightIn ?? ""}
                                onChange={(event) =>
                                  setVolumeHeightIn(
                                    event.target.value ? Number(event.target.value) : null
                                  )
                                }
                              />
                            </label>
                          </div>
                        )}
                        <p className="form-helper">
                          Best for 1–3 small pieces. We&apos;ll help you decide in person.
                        </p>
                        <div className="tiny-run-compare">
                          Half-shelf would be {comparisonLabel}.
                        </div>
                        {volumeCost != null ? (
                          <div className="tiny-run-cost">
                            Volume estimate: {formatUsd(volumeCost)}
                          </div>
                        ) : null}
                        {showVolumeNudge ? (
                          <div className="notice inline-alert">
                            At this size, a half-shelf is usually simpler.
                          </div>
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="estimator-side">
                  <div className="estimator-block estimate-height">
                    <div className="estimator-label">Anything taller than 10 inches?</div>
                    <div className="segmented-grid yesno-grid">
                      <button
                        type="button"
                        className={`segmented-button ${hasTallPieces ? "selected" : ""}`}
                        onClick={() => setHasTallPieces(true)}
                        aria-pressed={hasTallPieces}
                      >
                        Yes, it&apos;s tall
                      </button>
                      <button
                        type="button"
                        className={`segmented-button ${!hasTallPieces ? "selected" : ""}`}
                        onClick={() => setHasTallPieces(false)}
                        aria-pressed={!hasTallPieces}
                      >
                        No, standard height
                      </button>
                    </div>
                    {hasTallPieces ? (
                      <div className="form-helper">Tall pieces usually count as 2–3 half-shelves.</div>
                    ) : null}
                    <div className="form-helper">
                      Not sure? Choose standard height. We&apos;ll measure it with you.
                    </div>
                  </div>

                  <aside className={`estimate-summary ${animateEstimate ? "animate" : ""}`}>
                  <details className="shelf-guide">
                    <summary>How to count half shelves</summary>
                    <div className="shelf-guide-grid" aria-hidden="true">
                      {Array.from({ length: 8 }, (_, index) => {
                        const active = index < Math.min(estimatedHalfShelvesRounded, 8);
                        return (
                          <span
                            key={`guide-${index}`}
                            className={`shelf-guide-cell ${active ? "active" : ""}`}
                          />
                        );
                      })}
                    </div>
                    <div className="shelf-guide-caption">
                      Each box is a half-shelf. 1–2 for small drops, 4 for a half kiln (price break),
                      8 for a full load. Tall pieces add one extra half shelf.
                    </div>
                  </details>
                  <div className="estimate-summary-header">
                    <div className="estimate-label">Estimate summary</div>
                    <span className="estimate-chip soft">Reviewed with you in person</span>
                    {wholeKilnRequested ? (
                      <span className="estimate-chip">
                        Whole kiln: {formatUsd(FULL_KILN_CUSTOM_PRICE)}
                      </span>
                    ) : null}
                    {priceBreakApplied ? (
                      <span className="estimate-chip">Whole kiln option</span>
                    ) : null}
                    {selectedKiln?.id === "reduction-raku" ? (
                      <span className="estimate-chip">Raku is always glaze pricing</span>
                    ) : null}
                  </div>
                  <div className="estimate-primary">
                    <span>
                      {useStudioGlazes ||
                      rushRequested ||
                      waxResistAssistRequested ||
                      glazeSanityCheckRequested
                        ? "Total estimate"
                        : "Estimated cost"}
                    </span>
                    <strong className={animateEstimate ? "estimate-amount animate" : "estimate-amount"}>
                      {totalEstimate != null ? formatUsd(totalEstimate) : "We’ll confirm pricing"}
                    </strong>
                    {animateEstimate ? <span className="estimate-updated">updated</span> : null}
                  </div>
                  <div className="estimate-reassure">
                    You only pay for what survives the firing. We confirm everything in person. You won’t be overcharged.
                  </div>
                  {estimatedCostWithDelivery != null &&
                  (useStudioGlazes ||
                    rushRequested ||
                    waxResistAssistRequested ||
                    glazeSanityCheckRequested) ? (
                    <div className="estimate-breakdown">
                      <div className="estimate-line">
                        <span>Firing estimate</span>
                        <span>{formatUsd(estimatedCostWithDelivery)}</span>
                      </div>
                      {useStudioGlazes && glazeAccessCost != null ? (
                        <div className="estimate-line">
                          <span>Studio glaze access</span>
                          <span>{formatUsd(glazeAccessCost)}</span>
                        </div>
                      ) : null}
                      {rushRequested ? (
                        <div className="estimate-line">
                          <span>Priority queue</span>
                          <span>{formatUsd(RUSH_REQUEST_PRICE)}</span>
                        </div>
                      ) : null}
                      {waxResistAssistRequested ? (
                        <div className="estimate-line">
                          <span>Wax resist assist</span>
                          <span>{formatUsd(WAX_RESIST_ASSIST_PRICE)}</span>
                        </div>
                      ) : null}
                      {glazeSanityCheckRequested ? (
                        <div className="estimate-line">
                          <span>Glaze sanity check</span>
                          <span>{formatUsd(GLAZE_SANITY_CHECK_PRICE)}</span>
                        </div>
                      ) : null}
                      <div className="estimate-line total">
                        <span>Total estimate</span>
                        <span>{formatUsd(totalEstimate ?? 0)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="estimate-meta">
                    Based on: {kilnLabel} · {firingLabel} ·{" "}
                    {formatHalfShelfCount(estimatedHalfShelvesRounded)}
                  </div>
                  <div className="estimate-hint">Most people start here.</div>
                  {selectedKiln?.id === "reduction-raku" ? (
                    <div className="estimate-meta">
                      Raku is always glaze pricing. We&apos;ll confirm space together.
                    </div>
                  ) : null}
                  {deliveryTrips > 0 ? (
                    <div className="estimate-meta">
                      Delivery: {deliveryTrips} trip{deliveryTrips === 1 ? "" : "s"} ·{" "}
                      {formatUsd(deliveryCost)}
                    </div>
                  ) : null}
                  <div className="space-meter">
                    <progress
                      className="space-meter-track"
                      value={Math.min(estimatedHalfShelvesRounded, 8)}
                      max={8}
                      aria-label="Estimated kiln space used"
                    />
                    <div className="space-meter-label">
                      Space used: {spaceLabel} / 8 half shelves
                    </div>
                  </div>
                  {priceBreakApplied ? (
                    <div className="estimate-note">Price break starts at 4 half shelves.</div>
                  ) : null}
                  <div className="estimate-disclaimer">
                    Estimate only. Final charge after check-in review + measurement.
                  </div>
                  </aside>
                </div>
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">5. Helpful extras (optional)</div>
              <div className="addon-section">
                <div className="addon-subtitle">Studio glaze access</div>
                <div className="addon-grid">
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={useStudioGlazes}
                      onChange={(event) => setUseStudioGlazes(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Use Studio Glazes + Kitchen Access</span>
                    </span>
                    <span className="addon-tag">$3 per half-shelf</span>
                  </label>
                </div>
                <div className="addon-helper">
                  Includes house glazes, tools, wax, sinks, and a quick walkthrough with staff.
                </div>
                <div className="addon-helper">Finish your pieces here and we&apos;ll help you get set up.</div>
                <a className="addon-link" href="/glazes">
                  See available glazes
                </a>
                {useStudioGlazes && totalEstimate != null ? (
                  <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
                ) : null}
              </div>
              <div className="addon-section">
                <div className="addon-subtitle">Firing boosts</div>
                <div className="addon-grid">
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={rushRequested}
                      onChange={(event) => setRushRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Priority queue (next available firing)</span>
                      <span className="addon-copy">Jump to the next opening without a custom schedule.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(RUSH_REQUEST_PRICE)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={waxResistAssistRequested}
                      onChange={(event) => setWaxResistAssistRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Wax resist assist</span>
                      <span className="addon-copy">We&apos;ll help you prep clean bottoms.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(WAX_RESIST_ASSIST_PRICE)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={glazeSanityCheckRequested}
                      onChange={(event) => setGlazeSanityCheckRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Glaze sanity check</span>
                      <span className="addon-copy">Reduce surprises before the kiln goes hot.</span>
                    </span>
                    <span className="addon-tag">{formatUsd(GLAZE_SANITY_CHECK_PRICE)}</span>
                  </label>
                  {estimatedHalfShelvesRounded < 4 ? (
                    <label className="addon-toggle">
                      <input
                        type="checkbox"
                        checked={wholeKilnRequested}
                        onChange={(event) => setWholeKilnRequested(event.target.checked)}
                      />
                      <span className="addon-text">
                        <span className="addon-title">Whole kiln request</span>
                      </span>
                      <span className="addon-tag">{formatUsd(FULL_KILN_CUSTOM_PRICE)}</span>
                    </label>
                  ) : null}
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={pickupDeliveryRequested}
                      onChange={(event) => setPickupDeliveryRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Pickup run: we collect your drop-off for firing</span>
                    </span>
                    <span className="addon-tag">{formatUsd(DELIVERY_PRICE_PER_TRIP)}</span>
                  </label>
                  <label className="addon-toggle">
                    <input
                      type="checkbox"
                      checked={returnDeliveryRequested}
                      onChange={(event) => setReturnDeliveryRequested(event.target.checked)}
                    />
                    <span className="addon-text">
                      <span className="addon-title">Return run: we bring finished work back to you</span>
                    </span>
                    <span className="addon-tag">{formatUsd(DELIVERY_PRICE_PER_TRIP)}</span>
                  </label>
                </div>
                {pickupDeliveryRequested || returnDeliveryRequested ? (
                  <div className="addon-fields">
                    <label>
                      Delivery address
                      <textarea
                        value={deliveryAddress}
                        onChange={(event) => setDeliveryAddress(event.target.value)}
                        placeholder="Street, city, and any delivery notes"
                      />
                    </label>
                    <label>
                      Gate code / instructions
                      <input
                        type="text"
                        value={deliveryInstructions}
                        onChange={(event) => setDeliveryInstructions(event.target.value)}
                        placeholder="Gate code, parking, call box, etc."
                      />
                    </label>
                  </div>
                ) : null}
                {(rushRequested ||
                  waxResistAssistRequested ||
                  glazeSanityCheckRequested ||
                  wholeKilnRequested ||
                  pickupDeliveryRequested ||
                  returnDeliveryRequested) &&
                totalEstimate != null ? (
                  <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
                ) : null}
              </div>
              <div className="addon-helper">Add only what you need. We&apos;ll confirm together.</div>
              {anyAddOnsSelected && totalEstimate != null ? (
                <div className="addon-total">New estimate: {formatUsd(totalEstimate)}</div>
              ) : null}
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">6. Piece details (optional)</div>
              <p className="form-helper">
                Add per-piece labels or codes so staff can quickly locate your work at pickup.
              </p>
              <div className="piece-bulk-panel">
                <label>
                  Bulk paste rows (`label,count`)
                  <textarea
                    value={pieceBulkInput}
                    onChange={(event) => setPieceBulkInput(event.target.value)}
                    placeholder={`Mug set,4\nLarge platter,1`}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={importPieceBulkRows}
                  disabled={!pieceBulkInput.trim()}
                >
                  Import rows
                </button>
              </div>
              <div className="piece-row-list">
                {pieceRows.map((row, index) => (
                  <div className="piece-row-card" key={row.rowId}>
                    <div className="piece-row-header">
                      <strong>Piece row {index + 1}</strong>
                      <button
                        type="button"
                        className="btn btn-ghost piece-remove-btn"
                        onClick={() => removePieceRow(row.rowId)}
                        disabled={pieceRows.length <= 1}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="piece-row-grid">
                      <label>
                        Piece code
                        <input
                          type="text"
                          value={row.pieceId}
                          onChange={(event) => setPieceRowField(row.rowId, "pieceId", event.target.value)}
                          placeholder="MF-RES-..."
                        />
                      </label>
                      <label>
                        Piece label
                        <input
                          type="text"
                          value={row.pieceLabel}
                          onChange={(event) => setPieceRowField(row.rowId, "pieceLabel", event.target.value)}
                          placeholder="Mug set"
                        />
                      </label>
                      <label>
                        Piece count
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={row.pieceCount}
                          onChange={(event) => setPieceRowField(row.rowId, "pieceCount", event.target.value)}
                        />
                      </label>
                      <label>
                        Piece status
                        <select
                          value={row.pieceStatus}
                          onChange={(event) => setPieceRowField(row.rowId, "pieceStatus", event.target.value)}
                        >
                          {PIECE_STATUS_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      Piece photo URL (optional)
                      <input
                        type="url"
                        value={row.piecePhotoUrl}
                        onChange={(event) => setPieceRowField(row.rowId, "piecePhotoUrl", event.target.value)}
                        placeholder="https://..."
                      />
                    </label>
                  </div>
                ))}
              </div>
              <div className="piece-actions">
                <button type="button" className="btn btn-ghost" onClick={addPieceRow}>
                  Add piece row
                </button>
                <span className="form-helper">
                  Leave code blank to auto-generate an `MF-RES-...` identifier server-side.
                </span>
              </div>
            </div>

            <div className="checkin-step">
              <div className="checkin-step-title">7. Notes (optional)</div>
              <div className="notes-grid">
                <label>
                  General notes
                  <textarea
                    value={notesGeneral}
                    onChange={(event) => setNotesGeneral(event.target.value)}
                    placeholder="Anything we should watch for?"
                  />
                </label>
                <label>
                  Preferred date
                  <input
                    type="datetime-local"
                    value={latest}
                    onChange={(event) => setLatest(event.target.value)}
                  />
                </label>
              </div>
              <details className="notes-details">
                <summary>More details (optional)</summary>
                <div className="notes-tags">
                  {CHECKIN_NOTE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className={`note-tag ${notesTags.includes(tag) ? "selected" : ""}`}
                      onClick={() => toggleNotesTag(tag)}
                      aria-pressed={notesTags.includes(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
                <div className="form-helper">Pick any tags that apply. We&apos;ll confirm at drop-off.</div>
                <div className="notes-grid">
                  <label>
                    Link a piece or collection (optional)
                    <input
                      type="text"
                      placeholder="Paste piece code or collection ID"
                      value={linkedBatchId}
                      onChange={(event) => setLinkedBatchId(event.target.value)}
                    />
                  </label>
                </div>
              </details>
              {prefillNote ? <div className="notice inline-alert">{prefillNote}</div> : null}
              <p className="form-helper">
                Add anything that helps the studio load and fire safely.
              </p>
            </div>

            {formError ? <div className="alert card card-3d form-error">{formError}</div> : null}
            {formStatus ? <div className="notice card card-3d form-status">{formStatus}</div> : null}

            <div className="submit-note">We&apos;ll confirm space + pricing together at drop-off.</div>
            <button type="submit" className="btn btn-primary checkin-submit-btn" disabled={isSaving}>
              {isSaving ? (
                "Submitting..."
              ) : (
                <>
                  <span className="checkin-submit-title">Submit check-in</span>
                  <span className="checkin-submit-sub">Billing starts after your firing is complete</span>
                </>
              )}
            </button>
          </form>
        )}
      </RevealCard>

      <RevealCard as="section" className="card card-3d reservation-list" index={3} enabled={motionEnabled}>
        <div className="reservation-list-header">
          <div>
            <div className="card-title">Your check-ins</div>
            <p className="reservation-list-meta">
              Queue pressure:{" "}
              <span className={`queue-pressure tone-${capacityPressure.tone}`}>
                {capacityPressure.label}
              </span>{" "}
              · {kilnHalfShelvesInQueue}/{KILN_CAPACITY_HALF_SHELVES} half shelves planned
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost reservation-refresh"
            onClick={toVoidHandler(loadReservations)}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <div className="piece-lookup-row">
          <label>
            Piece code lookup
            <input
              type="text"
              value={pieceLookupQuery}
              onChange={(event) => setPieceLookupQuery(event.target.value)}
              placeholder="MF-RES-..."
            />
          </label>
          {pieceLookupNeedle ? (
            pieceLookupMatchReservationId ? (
              <div className="piece-lookup-result">
                Jumped to reservation <code>{pieceLookupMatchReservationId}</code>.
              </div>
            ) : (
              <div className="piece-lookup-result missing">
                No reservation in this list matches <code>{pieceLookupNeedle}</code>.
              </div>
            )
          ) : (
            <div className="piece-lookup-result">Search by piece code to jump to its reservation card.</div>
          )}
        </div>
        <div className="continuity-export-panel">
          <div className="continuity-export-copy">
            <strong>Record continuity</strong>
            <span>
              Export JSON + CSV records for reservations, stage history, piece tracking, and storage/notification
              audits.
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={toVoidHandler(exportContinuityBundle)}
            disabled={continuityExportBusy || !targetOwnerUid}
          >
            {continuityExportBusy ? "Exporting..." : "Export continuity bundle"}
          </button>
        </div>
        {continuityExportMessage ? <div className="notice">{continuityExportMessage}</div> : null}
        {isStaff ? (
          <>
            <div className="reservation-filter-row" role="tablist" aria-label="Reservation filters">
              {RESERVATION_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`reservation-filter-chip ${reservationFilter === filter.id ? "active" : ""}`}
                  onClick={() => setReservationFilter(filter.id)}
                  aria-pressed={reservationFilter === filter.id}
                >
                  {filter.label} <span>{filterCounts[filter.id]}</span>
                </button>
              ))}
            </div>
            <div className="reservation-ops-filters">
              <label>
                Lane
                <select value={laneFilter} onChange={(event) => setLaneFilter(event.target.value)}>
                  <option value="all">All lanes</option>
                  {laneOptions.map((lane) => (
                    <option key={lane} value={lane}>
                      {lane}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Capacity
                <select
                  value={capacityFilter}
                  onChange={(event) => setCapacityFilter(event.target.value as CapacityFilter)}
                >
                  <option value="ALL">All</option>
                  <option value="HIGH">High pressure</option>
                  <option value="NORMAL">Normal pressure</option>
                </select>
              </label>
            </div>
            <div className="storage-triage-strip">
              <span>
                Entering hold: <strong>{storageTriageSummary.enteringHold}</strong>
              </span>
              <span>
                Stored by policy: <strong>{storageTriageSummary.storedByPolicy}</strong>
              </span>
              <span>
                Reminder failures: <strong>{storageTriageSummary.reminderFailures}</strong>
              </span>
              <span>
                Approaching cap: <strong>{storageTriageSummary.approachingCap}</strong>
              </span>
              <span>
                Fairness penalties: <strong>{queueFairnessSummary.effectivePenaltyPoints}</strong>
              </span>
              <span>
                No-shows: <strong>{queueFairnessSummary.noShowCount}</strong> · late arrivals:{" "}
                <strong>{queueFairnessSummary.lateArrivalCount}</strong> · overrides:{" "}
                <strong>{queueFairnessSummary.activeOverrides}</strong>
              </span>
              <span>
                Audit trail: <code>reservationQueueFairnessAudit</code>
              </span>
            </div>
            <div className={`offline-sync-panel sync-${offlineSyncStatus} ${isOnline ? "online" : "offline"}`}>
              <div className="offline-sync-title">
                Staff queue sync: {isOnline ? "online" : "offline"} · {offlineQueue.length} queued ·{" "}
                {offlinePendingCount} pending · {offlineFailedCount} failed
              </div>
              <div className="offline-sync-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={retryOfflineQueueNow}
                  disabled={!isOnline || offlineSyncBusy || offlinePendingCount === 0}
                >
                  {offlineSyncBusy ? "Syncing..." : "Sync now"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={clearFailedOfflineActions}
                  disabled={offlineFailedCount === 0}
                >
                  Clear failed
                </button>
              </div>
            </div>
            <div className="arrival-lookup-panel">
              <div className="arrival-lookup-title">Arrival code lookup</div>
              <div className="arrival-lookup-row">
                <input
                  type="text"
                  value={arrivalLookupToken}
                  onChange={(event) => setArrivalLookupToken(event.target.value)}
                  placeholder="MF-ARR-XXXX-XXXX"
                />
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={toVoidHandler(lookupArrivalTokenForStaff)}
                  disabled={arrivalLookupBusy || (isStaff && !hasStaffClaim)}
                >
                  {arrivalLookupBusy ? "Looking up..." : "Lookup"}
                </button>
              </div>
              {arrivalLookupResult ? (
                <div className="arrival-lookup-result">
                  <div>
                    <strong>{arrivalLookupResult.id}</strong> · {toReservationStatus(arrivalLookupResult.status)}
                  </div>
                  <div>
                    Queue #{arrivalLookupResult.queuePositionHint ?? "—"} · {formatArrivalStatusLabel(arrivalLookupResult)}
                  </div>
                  <div>
                    Outstanding:
                    {arrivalLookupOutstanding?.needsArrivalCheckIn ? " check-in" : ""}
                    {arrivalLookupOutstanding?.needsStationAssignment ? " station assignment" : ""}
                    {arrivalLookupOutstanding?.needsQueuePlacement ? " queue placement" : ""}
                    {arrivalLookupOutstanding?.needsResourceProfile ? " resource profile" : ""}
                    {!arrivalLookupOutstanding?.needsArrivalCheckIn &&
                    !arrivalLookupOutstanding?.needsStationAssignment &&
                    !arrivalLookupOutstanding?.needsQueuePlacement &&
                    !arrivalLookupOutstanding?.needsResourceProfile
                      ? " none"
                      : ""}
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {isStaff && !hasStaffClaim ? (
          <div className="notice">
            Staff mode is active, but this account does not currently have a staff claim in token
            metadata. Queue controls stay read-only until claims sync completes.
          </div>
        ) : null}
        {staffToolsUnavailable ? <div className="alert">{staffToolsUnavailable}</div> : null}
        {offlineSyncMessage ? <div className="notice">{offlineSyncMessage}</div> : null}
        {staffActionMessage ? <div className="notice">{staffActionMessage}</div> : null}
        {pickupWindowMessage ? <div className="notice">{pickupWindowMessage}</div> : null}
        {queueFairnessMessage ? <div className="notice">{queueFairnessMessage}</div> : null}
        {arrivalMessage ? <div className="notice">{arrivalMessage}</div> : null}
        {undoStatusAction ? (
          <div className="reservation-undo">
            <span>
              Undo available for reservation <code>{undoStatusAction.reservationId}</code>.
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={toVoidHandler(undoLastStatusAction)}
              disabled={staffActionBusyId !== null}
            >
              Undo
            </button>
          </div>
        ) : null}
        {listError ? <div className="alert">{listError}</div> : null}
        {loading ? (
          <div className="empty-state">Loading check-ins...</div>
        ) : filteredReservations.length === 0 ? (
          <div className="empty-state">No check-ins yet.</div>
        ) : (
          <div className="reservation-grid">
            {filteredReservations.map((reservation) => {
              const status = toReservationStatus(reservation.status);
              const loadStatus = toReservationLoadStatus(reservation.loadStatus);
              const serverQueuePosition =
                typeof reservation.queuePositionHint === "number" &&
                Number.isFinite(reservation.queuePositionHint)
                  ? Math.max(1, Math.round(reservation.queuePositionHint))
                  : null;
              const queuePosition = serverQueuePosition ?? queuePositionByReservationId[reservation.id] ?? null;
              const stationId =
                normalizeStationValue(reservation.assignedStationId) ??
                normalizeStationValue(reservation.kilnId);
              const stationLoad = stationId ? stationUsage.get(stationId) ?? 0 : 0;
              const stationPressure = getCapacityPressure(stationLoad);
              const queueLane = normalizeStationValue(reservation.queueClass);
              const readinessBand = getReadinessBand(reservation);
              const updatedEstimateCopy = getUpdatedEstimateCopy(reservation);
              const lastChangeReasonCopy = getLastChangeReasonCopy(reservation);
              const suggestedNextUpdateCopy = getSuggestedNextUpdateWindowCopy(reservation);
              const statusChangedAt = reservation.stageStatus?.at ?? reservation.updatedAt;
              const latestNote = latestStageNote(reservation);
              const isPendingCard = pendingStatusAction?.reservationId === reservation.id;
              const pendingFromStatus = isPendingCard ? pendingStatusAction?.currentStatus ?? status : status;
              const pendingToStatus = isPendingCard ? pendingStatusAction?.nextStatus ?? status : status;
              const notesDraft =
                staffNotesByReservationId[reservation.id] ??
                (typeof reservation.staffNotes === "string" ? reservation.staffNotes : "");
              const arrivalNoteDraft = arrivalNoteByReservationId[reservation.id] ?? "";
              const arrivalStatus = normalizeArrivalStatus(reservation.arrivalStatus);
              const memberCanCheckIn = !isStaff && isMemberArrivalCheckInEligible(reservation);
              const stationDraft =
                stationDraftByReservationId[reservation.id] ??
                stationId ??
                "";
              const queueClassValue =
                queueClassDraftByReservationId[reservation.id] ??
                queueLane ??
                "";
              const reservationPieces = Array.isArray(reservation.pieces) ? reservation.pieces : [];
              const reservationPieceTotal = reservationPieces.reduce((sum, piece) => {
                const next =
                  typeof piece.pieceCount === "number" && Number.isFinite(piece.pieceCount)
                    ? Math.max(1, Math.round(piece.pieceCount))
                    : 1;
                return sum + next;
              }, 0);
              const pieceCodePreview = reservationPieces
                .map((piece) => (typeof piece.pieceId === "string" ? piece.pieceId : ""))
                .filter(Boolean)
                .slice(0, 3)
                .join(", ");
              const pieceLookupHit =
                Boolean(pieceLookupNeedle) &&
                pieceLookupMatchReservationId === reservation.id;
              const storageStatusLabel = getStorageStatusLabel(reservation);
              const storageStatusClass = getStorageStatusClass(reservation);
              const pickupReminderCount =
                typeof reservation.pickupReminderCount === "number" &&
                Number.isFinite(reservation.pickupReminderCount)
                  ? Math.max(0, Math.round(reservation.pickupReminderCount))
                  : 0;
              const pickupReminderFailureCount =
                typeof reservation.pickupReminderFailureCount === "number" &&
                Number.isFinite(reservation.pickupReminderFailureCount)
                  ? Math.max(0, Math.round(reservation.pickupReminderFailureCount))
                  : 0;
              const readyForPickupDate = reservation.readyForPickupAt?.toDate?.() ?? null;
              const storageHoursSinceReady = getStorageHoursSinceReady(reservation);
              const storageRisk = isStorageRisk(reservation);
              const storageHistory = Array.isArray(reservation.storageNoticeHistory)
                ? reservation.storageNoticeHistory
                : [];
              const pickupWindow = reservation.pickupWindow ?? null;
              const pickupWindowStatus = normalizePickupWindowStatus(pickupWindow?.status);
              const pickupWindowStatusLabel = getPickupWindowStatusLabel(pickupWindowStatus);
              const pickupWindowStart =
                pickupWindow?.confirmedStart?.toDate?.() ??
                pickupWindow?.requestedStart?.toDate?.() ??
                null;
              const pickupWindowEnd =
                pickupWindow?.confirmedEnd?.toDate?.() ??
                pickupWindow?.requestedEnd?.toDate?.() ??
                null;
              const pickupWindowStartDraft =
                pickupWindowStartByReservationId[reservation.id] ?? toDateTimeInputValue(pickupWindowStart);
              const pickupWindowEndDraft =
                pickupWindowEndByReservationId[reservation.id] ?? toDateTimeInputValue(pickupWindowEnd);
              const pickupWindowRequestStartDraft =
                pickupWindowRequestStartByReservationId[reservation.id] ?? toDateTimeInputValue(pickupWindowStart);
              const pickupWindowRequestEndDraft =
                pickupWindowRequestEndByReservationId[reservation.id] ?? toDateTimeInputValue(pickupWindowEnd);
              const pickupWindowRescheduleCount =
                typeof pickupWindow?.rescheduleCount === "number" &&
                Number.isFinite(pickupWindow.rescheduleCount)
                  ? Math.max(0, Math.round(pickupWindow.rescheduleCount))
                  : 0;
              const pickupWindowMissedCount =
                typeof pickupWindow?.missedCount === "number" && Number.isFinite(pickupWindow.missedCount)
                  ? Math.max(0, Math.round(pickupWindow.missedCount))
                  : 0;
              const pickupWindowBusy = pickupWindowBusyId === reservation.id;
              const memberCanConfirmPickupWindow = !isStaff && pickupWindowStatus === "open";
              const memberCanRequestReschedule =
                !isStaff &&
                pickupWindowStatus !== "completed" &&
                pickupWindowRescheduleCount < PICKUP_WINDOW_RESCHEDULE_LIMIT;
              const queueFairness = reservation.queueFairness ?? null;
              const queueFairnessPolicy = reservation.queueFairnessPolicy ?? null;
              const queueNoShowCount =
                typeof queueFairness?.noShowCount === "number" && Number.isFinite(queueFairness.noShowCount)
                  ? Math.max(0, Math.round(queueFairness.noShowCount))
                  : 0;
              const queueLateArrivalCount =
                typeof queueFairness?.lateArrivalCount === "number" &&
                Number.isFinite(queueFairness.lateArrivalCount)
                  ? Math.max(0, Math.round(queueFairness.lateArrivalCount))
                  : 0;
              const queueOverrideBoost =
                typeof queueFairness?.overrideBoost === "number" && Number.isFinite(queueFairness.overrideBoost)
                  ? Math.max(0, Math.round(queueFairness.overrideBoost))
                  : 0;
              const queueOverrideUntil = queueFairness?.overrideUntil?.toDate?.() ?? null;
              const queuePenaltyPoints =
                typeof queueFairnessPolicy?.penaltyPoints === "number" &&
                Number.isFinite(queueFairnessPolicy.penaltyPoints)
                  ? Math.max(0, Math.round(queueFairnessPolicy.penaltyPoints))
                  : 0;
              const queueEffectivePenaltyPoints =
                typeof queueFairnessPolicy?.effectivePenaltyPoints === "number" &&
                Number.isFinite(queueFairnessPolicy.effectivePenaltyPoints)
                  ? Math.max(0, Math.round(queueFairnessPolicy.effectivePenaltyPoints))
                  : queuePenaltyPoints;
              const queueOverrideBoostApplied =
                typeof queueFairnessPolicy?.overrideBoostApplied === "number" &&
                Number.isFinite(queueFairnessPolicy.overrideBoostApplied)
                  ? Math.max(0, Math.round(queueFairnessPolicy.overrideBoostApplied))
                  : 0;
              const queueReasonCodes = Array.isArray(queueFairnessPolicy?.reasonCodes)
                ? queueFairnessPolicy.reasonCodes
                    .map((value) => (typeof value === "string" ? value.trim() : ""))
                    .filter((value) => value.length > 0)
                : [];
              const queueFairnessReasonDraft = queueFairnessReasonByReservationId[reservation.id] ?? "";
              const queueFairnessBoostDraft =
                queueFairnessBoostByReservationId[reservation.id] ??
                (queueOverrideBoost > 0 ? String(queueOverrideBoost) : "");
              const queueFairnessOverrideUntilDraft =
                queueFairnessOverrideUntilByReservationId[reservation.id] ??
                toDateTimeInputValue(queueOverrideUntil);
              const queueFairnessBusy = queueFairnessBusyId === reservation.id;
              return (
                <article
                  id={`reservation-${reservation.id}`}
                  className={`reservation-card ${pieceLookupHit ? "lookup-hit" : ""}`}
                  key={reservation.id}
                >
                  <header className="reservation-card-header">
                    <h3>{reservation.firingType}</h3>
                    <div className="reservation-status-pills">
                      <span className={`status-pill status-${status.toLowerCase()}`}>{status}</span>
                      <span className={`status-pill status-load-${loadStatus}`}>{loadStatus}</span>
                      <span className={`status-pill status-storage-${storageStatusClass}`}>
                        {storageStatusLabel}
                      </span>
                      {storageRisk ? <span className="status-pill status-storage-risk">Risk</span> : null}
                    </div>
                  </header>
                  <div className="reservation-row">
                    <span>Clay: {reservation.wareType || "—"}</span>
                    <span>Kiln: {reservation.kilnLabel || "—"}</span>
                  </div>
                  <div className="reservation-row">
                    <span>
                      Space:{" "}
                      {reservation.estimatedHalfShelves != null
                        ? formatHalfShelfCount(reservation.estimatedHalfShelves)
                        : `${reservation.shelfEquivalent} shelf`}
                    </span>
                    <span>Created: {formatDateTime(reservation.createdAt)}</span>
                  </div>
                  <div className="reservation-row">
                    <span>
                      {reservation.useVolumePricing && reservation.volumeIn3
                        ? `Volume: ${reservation.volumeIn3} in^3`
                        : `Footprint: ${reservation.footprintHalfShelves ?? "—"} half shelf`}
                    </span>
                    <span>
                      {reservation.estimatedCost != null ? `Est. ${formatUsd(reservation.estimatedCost)}` : " "}
                    </span>
                  </div>
                  <div className="reservation-row">
                    <span>Queue position: {queuePosition ?? "—"}</span>
                    <span>{readinessBand}</span>
                  </div>
                  <div className="reservation-row">
                    <span>
                      Fairness penalty: {queueEffectivePenaltyPoints}
                      {queuePenaltyPoints > 0 || queueOverrideBoostApplied > 0
                        ? ` (base ${queuePenaltyPoints}${
                            queueOverrideBoostApplied > 0 ? ` - override ${queueOverrideBoostApplied}` : ""
                          })`
                        : ""}
                    </span>
                    <span>
                      No-shows {queueNoShowCount} · late arrivals {queueLateArrivalCount}
                    </span>
                  </div>
                  {queueReasonCodes.length > 0 ? (
                    <div className="reservation-note-history">
                      Fairness flags:{" "}
                      <strong>{queueReasonCodes.map((code) => formatQueueFairnessReasonCode(code)).join(", ")}</strong>
                    </div>
                  ) : null}
                  {queueOverrideBoost > 0 ? (
                    <div className="reservation-note-history">
                      Override boost {queueOverrideBoost}
                      {queueFairness?.overrideReason ? ` · ${queueFairness.overrideReason}` : ""}
                      {queueOverrideUntil ? ` · until ${formatDateTime(queueOverrideUntil)}` : ""}
                    </div>
                  ) : null}
                  {reservationPieces.length > 0 ? (
                    <div className="reservation-row">
                      <span>
                        Pieces: {reservationPieces.length} row{reservationPieces.length === 1 ? "" : "s"} ·{" "}
                        {reservationPieceTotal} total
                      </span>
                      <span>{pieceCodePreview ? `Codes: ${pieceCodePreview}` : "Codes pending"}</span>
                    </div>
                  ) : null}
                  <div className="reservation-row">
                    <span>
                      Station: {stationId ?? "unassigned"}
                      {queueLane ? ` · lane ${queueLane}` : ""}
                    </span>
                    <span className={`queue-pressure tone-${stationPressure.tone}`}>
                      {stationPressure.label} ({stationLoad}/{KILN_CAPACITY_HALF_SHELVES})
                    </span>
                  </div>
                  <div className="reservation-row">
                    <span>Window: {formatPreferredWindow(reservation)}</span>
                    <span>
                      Status updated: {formatDateTime(statusChangedAt)}
                      {reservation.linkedBatchId ? ` · Ref ${reservation.linkedBatchId}` : ""}
                    </span>
                  </div>
                  <div className="reservation-row">
                    <span>
                      Pickup window:{" "}
                      {pickupWindowStart && pickupWindowEnd
                        ? `${formatDateTime(pickupWindowStart)} → ${formatDateTime(pickupWindowEnd)}`
                        : "Not scheduled"}
                    </span>
                    <span>
                      Pickup status: {pickupWindowStatusLabel}
                      {pickupWindowMissedCount > 0 ? ` · misses ${pickupWindowMissedCount}` : ""}
                      {pickupWindowRescheduleCount > 0
                        ? ` · reschedules ${pickupWindowRescheduleCount}/${PICKUP_WINDOW_RESCHEDULE_LIMIT}`
                        : ""}
                    </span>
                  </div>
                  {!isStaff ? (
                    <div className="reservation-pickup-actions">
                      {memberCanConfirmPickupWindow ? (
                        <button
                          type="button"
                          className="reservation-action primary"
                          onClick={toVoidHandler(() => confirmPickupWindowForReservation(reservation))}
                          disabled={pickupWindowBusy}
                        >
                          {pickupWindowBusy ? "Saving..." : "Confirm pickup window"}
                        </button>
                      ) : null}
                      {memberCanRequestReschedule ? (
                        <>
                          <label>
                            Request start
                            <input
                              type="datetime-local"
                              value={pickupWindowRequestStartDraft}
                              onChange={(event) =>
                                setPickupWindowRequestStartDraft(reservation.id, event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Request end
                            <input
                              type="datetime-local"
                              value={pickupWindowRequestEndDraft}
                              onChange={(event) =>
                                setPickupWindowRequestEndDraft(reservation.id, event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="reservation-action ghost"
                            onClick={toVoidHandler(() => requestPickupRescheduleForReservation(reservation))}
                            disabled={pickupWindowBusy}
                          >
                            {pickupWindowBusy ? "Saving..." : "Request one reschedule"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="reservation-row">
                    <span>
                      Storage: {storageStatusLabel} · reminders {pickupReminderCount}
                      {pickupReminderFailureCount > 0
                        ? ` · failures ${pickupReminderFailureCount}`
                        : ""}
                    </span>
                    <span>
                      {readyForPickupDate
                        ? `Ready since ${formatDateTime(readyForPickupDate)}`
                        : "Ready timestamp pending"}
                      {storageHoursSinceReady != null
                        ? ` · ${Math.max(0, Math.round(storageHoursSinceReady))}h elapsed`
                        : ""}
                    </span>
                  </div>
                  {isStorageCapApproaching(reservation) ? (
                    <div className="reservation-storage-warning">
                      Pickup window is approaching the storage policy cap. Queue staff follow-up now.
                    </div>
                  ) : null}
                  {storageStatusClass === "stored_by_policy" ? (
                    <div className="reservation-storage-warning critical">
                      Reservation is marked stored by policy. Coordinate support action before disposal.
                    </div>
                  ) : null}
                  <div className="reservation-sla-copy">
                    <div>
                      <strong>Updated estimate:</strong> {updatedEstimateCopy}
                    </div>
                    <div>
                      <strong>Last change reason:</strong> {lastChangeReasonCopy}
                    </div>
                    <div>
                      <strong>Suggested next update window:</strong> {suggestedNextUpdateCopy}
                    </div>
                  </div>
                  <div className="reservation-row">
                    <span>Arrival: {formatArrivalStatusLabel(reservation)}</span>
                    <span>
                      {reservation.arrivalToken ? `Code ${reservation.arrivalToken}` : "Code pending confirmation"}
                    </span>
                  </div>
                  {memberCanCheckIn ? (
                    <div className="reservation-arrival-actions">
                      <label>
                        Arrival note (optional)
                        <input
                          type="text"
                          value={arrivalNoteDraft}
                          onChange={(event) =>
                            setArrivalNoteDraft(reservation.id, event.target.value)
                          }
                          placeholder="Front desk, parking lot, etc."
                        />
                      </label>
                      <button
                        type="button"
                        className="reservation-action primary"
                        onClick={toVoidHandler(() => checkInArrivalForReservation(reservation))}
                        disabled={arrivalBusyId !== null || arrivalStatus === "arrived"}
                      >
                        {arrivalBusyId === reservation.id
                          ? "Checking in..."
                          : arrivalStatus === "arrived"
                            ? "Checked in"
                            : "I'm here"}
                      </button>
                    </div>
                  ) : null}
                  {latestNote ? (
                    <div className="reservation-note-history">
                      Latest status note: <strong>{latestNote}</strong>
                    </div>
                  ) : null}
                  {storageHistory.length > 0 ? (
                    <div className="reservation-storage-history">
                      <div className="reservation-storage-history-title">Storage notice history</div>
                      {storageHistory
                        .slice(-5)
                        .reverse()
                        .map((entry, index) => {
                          const historyAt = entry.at ?? null;
                          const detail =
                            typeof entry.detail === "string" && entry.detail.trim().length > 0
                              ? entry.detail.trim()
                              : null;
                          return (
                            <div
                              key={`${reservation.id}-storage-${index}-${entry.kind}`}
                              className="reservation-storage-history-row"
                            >
                              <span>
                                {formatDateTime(historyAt)} · {formatStorageNoticeKind(entry.kind ?? "notice")}
                              </span>
                              {detail ? <span>{detail}</span> : null}
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                  {reservation.addOns?.pickupDeliveryRequested || reservation.addOns?.returnDeliveryRequested ? (
                    <div className="reservation-addons-inline">
                      {reservation.addOns?.pickupDeliveryRequested ? (
                        <span className="reservation-addon-pill">Pickup delivery</span>
                      ) : null}
                      {reservation.addOns?.returnDeliveryRequested ? (
                        <span className="reservation-addon-pill">Return delivery</span>
                      ) : null}
                    </div>
                  ) : null}
                  {isStaff ? (
                    <div className="reservation-staff-tools">
                      <label>
                        Staff notes
                        <textarea
                          value={notesDraft}
                          onChange={(event) =>
                            setStaffNotesDraft(reservation.id, event.target.value)
                          }
                          placeholder="Optional handoff note for this status update"
                          rows={2}
                        />
                      </label>
                      <div className="reservation-pickup-actions staff">
                        <label>
                          Pickup start
                          <input
                            type="datetime-local"
                            value={pickupWindowStartDraft}
                            onChange={(event) =>
                              setPickupWindowStartDraft(reservation.id, event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Pickup end
                          <input
                            type="datetime-local"
                            value={pickupWindowEndDraft}
                            onChange={(event) =>
                              setPickupWindowEndDraft(reservation.id, event.target.value)
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className="reservation-action ghost"
                          onClick={toVoidHandler(() => openPickupWindowForReservation(reservation))}
                          disabled={pickupWindowBusy || (isStaff && !hasStaffClaim)}
                        >
                          Open pickup window
                        </button>
                        <button
                          type="button"
                          className="reservation-action ghost"
                          onClick={toVoidHandler(() => markPickupWindowMissedForReservation(reservation))}
                          disabled={pickupWindowBusy || (isStaff && !hasStaffClaim)}
                        >
                          Mark missed
                        </button>
                        <button
                          type="button"
                          className="reservation-action primary"
                          onClick={toVoidHandler(() => markPickupWindowCompletedForReservation(reservation))}
                          disabled={pickupWindowBusy || (isStaff && !hasStaffClaim)}
                        >
                          Mark pickup complete
                        </button>
                      </div>
                      <div className="reservation-fairness-controls">
                        <label>
                          Fairness reason
                          <input
                            type="text"
                            value={queueFairnessReasonDraft}
                            onChange={(event) =>
                              setQueueFairnessReasonDraft(reservation.id, event.target.value)
                            }
                            placeholder="Why this fairness action is needed"
                          />
                        </label>
                        <div className="reservation-fairness-actions">
                          <button
                            type="button"
                            className="reservation-action ghost"
                            onClick={toVoidHandler(() => recordNoShowForReservation(reservation))}
                            disabled={queueFairnessBusy || (isStaff && !hasStaffClaim)}
                          >
                            {queueFairnessBusy ? "Saving..." : "Record no-show"}
                          </button>
                          <button
                            type="button"
                            className="reservation-action ghost"
                            onClick={toVoidHandler(() => recordLateArrivalForReservation(reservation))}
                            disabled={queueFairnessBusy || (isStaff && !hasStaffClaim)}
                          >
                            {queueFairnessBusy ? "Saving..." : "Record late arrival"}
                          </button>
                        </div>
                        <div className="reservation-fairness-actions">
                          <label>
                            Override boost (0-{FAIRNESS_OVERRIDE_MAX_POINTS})
                            <input
                              type="number"
                              min={0}
                              max={FAIRNESS_OVERRIDE_MAX_POINTS}
                              value={queueFairnessBoostDraft}
                              onChange={(event) =>
                                setQueueFairnessBoostDraft(reservation.id, event.target.value)
                              }
                            />
                          </label>
                          <label>
                            Override until (optional)
                            <input
                              type="datetime-local"
                              value={queueFairnessOverrideUntilDraft}
                              onChange={(event) =>
                                setQueueFairnessOverrideUntilDraft(reservation.id, event.target.value)
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="reservation-action ghost"
                            onClick={toVoidHandler(() => setQueueFairnessOverrideForReservation(reservation))}
                            disabled={queueFairnessBusy || (isStaff && !hasStaffClaim)}
                          >
                            {queueFairnessBusy ? "Saving..." : "Apply override"}
                          </button>
                          <button
                            type="button"
                            className="reservation-action danger"
                            onClick={toVoidHandler(() => clearQueueFairnessOverrideForReservation(reservation))}
                            disabled={queueFairnessBusy || (isStaff && !hasStaffClaim)}
                          >
                            {queueFairnessBusy ? "Saving..." : "Clear override"}
                          </button>
                        </div>
                        <div className="form-helper">
                          Every fairness action writes audit evidence to <code>reservationQueueFairnessAudit</code>.
                        </div>
                      </div>
                      <div className="reservation-station-controls">
                        <label>
                          Station
                          <select
                            value={stationDraft}
                            onChange={(event) =>
                              setStationDraft(reservation.id, event.target.value)
                            }
                          >
                            <option value="">Unassigned</option>
                            {kilnOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                                {option.status ? ` (${option.status})` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Lane
                          <input
                            type="text"
                            value={queueClassValue}
                            onChange={(event) =>
                              setQueueClassDraft(reservation.id, event.target.value)
                            }
                            placeholder="studio-kiln-a"
                          />
                        </label>
                        <button
                          type="button"
                          className="reservation-action ghost"
                          onClick={toVoidHandler(() => assignStationForReservation(reservation))}
                          disabled={staffActionBusyId !== null || (isStaff && !hasStaffClaim)}
                        >
                          Assign station
                        </button>
                      </div>
                      <div className="reservation-staff-actions">
                        <button
                          type="button"
                          className="reservation-action ghost"
                          onClick={toVoidHandler(() => rotateArrivalTokenForReservation(reservation))}
                          disabled={staffActionBusyId !== null || (isStaff && !hasStaffClaim)}
                        >
                          Reissue arrival code
                        </button>
                        {STATUS_ACTIONS.filter((action) => action.status !== status).map((action) => (
                          <button
                            key={action.status}
                            type="button"
                            className={`reservation-action ${action.tone}`}
                            onClick={() => requestStatusAction(reservation.id, status, action.status)}
                            disabled={staffActionBusyId !== null || (isStaff && !hasStaffClaim)}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                      {isPendingCard ? (
                        <div className="reservation-action-confirm">
                          <p>
                            Change status from <strong>{pendingFromStatus}</strong> to{" "}
                            <strong>{pendingToStatus}</strong>? This writes an audit
                            trail and refreshes queue order immediately.
                          </p>
                          <div className="reservation-confirm-actions">
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={toVoidHandler(applyStatusAction)}
                              disabled={staffActionBusyId !== null}
                            >
                              Confirm change
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setPendingStatusAction(null)}
                              disabled={staffActionBusyId !== null}
                            >
                              Keep current status
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {reservation.photoUrl ? (
                    <div className="reservation-photo">
                      <img src={reservation.photoUrl} alt="Checked-in work" />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </RevealCard>

      {DEV_MODE ? (
        <details className="card card-3d debug-panel">
          <summary className="debug-summary">Check-in debug (dev only)</summary>
          <div className="debug-grid">
            <div className="debug-label">Auth uid</div>
            <div>{authDebug?.uid || user.uid}</div>

            <div className="debug-label">Role</div>
            <div>{authDebug?.isStaff ? "staff" : "client"}</div>

            <div className="debug-label">Target path</div>
            <div>{debugPacket?.firestorePaths?.createReservation}</div>

            <div className="debug-label">Rules map</div>
            <div>{debugPacket?.rulesMapping}</div>

            <div className="debug-label">Payload</div>
            <pre className="debug-pre">
              {JSON.stringify(debugPacket?.lastRequest?.payload ?? {}, null, 2)}
            </pre>

            <div className="debug-label">Error</div>
            <div>
              {devError
                ? `${devError.context} · ${devError.code || "unknown"} · ${devError.message || ""}`
                : "—"}
            </div>
          </div>

          <div className="debug-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={toVoidHandler(handleCopyDebug, handleCopyDebugError, "reservations.copyDebug")}
            >
              Copy debug snapshot
            </button>
            {devCopyStatus ? <span className="form-helper">{devCopyStatus}</span> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
