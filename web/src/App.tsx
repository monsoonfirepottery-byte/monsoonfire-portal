import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FacebookAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  isSignInWithEmailLink,
  onIdTokenChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  sendSignInLinkToEmail,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Announcement, DirectMessageThread, LiveUser } from "./types/messaging";
import { toVoidHandler } from "./utils/toVoidHandler";
import { identify, shortId, track } from "./lib/analytics";
import { ensureUserDocForSession } from "./api/ensureUserDoc";
import FirestoreTelemetryPanel from "./components/FirestoreTelemetryPanel";
import type { SupportRequestInput } from "./views/SupportView";
import { DEFAULT_PORTAL_THEME, isPortalThemeName, PORTAL_THEMES, type PortalThemeName } from "./theme/themes";
import { readStoredPortalTheme, writeStoredPortalTheme } from "./theme/themeStorage";
import { readStoredEnhancedMotion, writeStoredEnhancedMotion } from "./theme/motionStorage";
import { computeEnhancedMotionDefault, resolvePortalMotion } from "./theme/motionPreference";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import { UiSettingsProvider } from "./context/UiSettingsContext";
import { PROFILE_DEFAULT_AVATAR_URL } from "./lib/profileAvatars";
import { setTelemetryView, trackedGetDoc, trackedGetDocs } from "./lib/firestoreTelemetry";
import { safeReadBoolean, safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "./lib/safeStorage";
import { parseStaffRoleFromClaims } from "./auth/staffRole";
import "./App.css";

const BillingView = React.lazy(() => import("./views/BillingView"));
const CommunityView = React.lazy(() => import("./views/CommunityView"));
const DashboardView = React.lazy(() => import("./views/DashboardView"));
const EventsView = React.lazy(() => import("./views/EventsView"));
const IntegrationsView = React.lazy(() => import("./views/IntegrationsView"));
const KilnLaunchView = React.lazy(() => import("./views/KilnLaunchView"));
const KilnRentalsView = React.lazy(() => import("./views/KilnRentalsView"));
const KilnScheduleView = React.lazy(() => import("./views/KilnScheduleView"));
const LendingLibraryView = React.lazy(() => import("./views/LendingLibraryView"));
const GlazeBoardView = React.lazy(() => import("./views/GlazeBoardView"));
const MembershipView = React.lazy(() => import("./views/MembershipView"));
const MaterialsView = React.lazy(() => import("./views/MaterialsView"));
const MessagesView = React.lazy(() => import("./views/MessagesView"));
const MyPiecesView = React.lazy(() => import("./views/MyPiecesView"));
const NotificationsView = React.lazy(() => import("./views/NotificationsView"));
const PlaceholderView = React.lazy(() => import("./views/PlaceholderView"));
const ProfileView = React.lazy(() => import("./views/ProfileView"));
const ReservationsView = React.lazy(() => import("./views/ReservationsView"));
const SignedOutView = React.lazy(() => import("./views/SignedOutView"));
const StudioResourcesView = React.lazy(() => import("./views/StudioResourcesView"));
const SupportView = React.lazy(() => import("./views/SupportView"));
const StaffView = React.lazy(() => import("./views/StaffView"));

type NavKey =
  | "dashboard"
  | "profile"
  | "integrations"
  | "pieces"
  | "kiln"
  | "kilnRentals"
  | "kilnLaunch"
  | "reservations"
  | "events"
  | "community"
  | "lendingLibrary"
  | "glazes"
  | "membership"
  | "materials"
  | "billing"
  | "studioResources"
  | "notifications"
  | "messages"
  | "support"
  | "staff";

type NavItem = {
  key: NavKey;
  label: string;
  hint?: string;
};

type NavSectionKey = "kilnRentals" | "studioResources" | "community";

type NavSection = {
  key: NavSectionKey;
  title: string;
  items: NavItem[];
};

type NavDockPosition = "left" | "top" | "right" | "bottom";

type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_FUNCTIONS_BASE_URL?: string;
  VITE_ENABLE_DEV_ADMIN_TOKEN?: string;
  VITE_PERSIST_DEV_ADMIN_TOKEN?: string;
  VITE_USE_EMULATORS?: string;
  VITE_USE_AUTH_EMULATOR?: string;
};

type NotificationItem = {
  id: string;
  title?: string;
  body?: string;
  createdAt?: { toDate?: () => Date } | null;
  readAt?: { toDate?: () => Date } | null;
  data?: {
    firingId?: string;
    kilnName?: string | null;
    firingType?: string | null;
  };
};

type PieceFocusTarget = {
  batchId: string;
  pieceId?: string;
};

type LegacyRequestsDestination = "support" | "lendingLibrary" | "events";

type LegacyRequestsRedirect = {
  targetNav: LegacyRequestsDestination;
  notice: string;
};

type StaffWorkspaceMode = "default" | "cockpit" | "workshops";

type StaffWorkspaceLaunch = {
  targetNav: "staff";
  mode: StaffWorkspaceMode;
};

const NAV_TOP_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
];

const NAV_BOTTOM_ITEMS: NavItem[] = [
  { key: "notifications", label: "Notifications" },
  { key: "messages", label: "Messages" },
  { key: "support", label: "Support" },
];

const NAV_SECTIONS: NavSection[] = [
  {
    key: "kilnRentals",
    title: "Kiln Rentals",
    items: [
      { key: "kilnRentals", label: "Overview" },
      { key: "reservations", label: "Ware Check-in" },
      { key: "kilnLaunch", label: "View the Queues" },
      { key: "kiln", label: "Firings" },
    ],
  },
  {
    key: "studioResources",
    title: "Studio & Resources",
    items: [
      { key: "studioResources", label: "Overview" },
      { key: "pieces", label: "My Pieces" },
      { key: "glazes", label: "Glaze Board" },
      { key: "materials", label: "Store" },
      { key: "membership", label: "Membership" },
      { key: "billing", label: "Billing" },
    ],
  },
  {
    key: "community",
    title: "Community",
    items: [
      { key: "community", label: "Overview" },
      { key: "events", label: "Workshops" },
      { key: "lendingLibrary", label: "Lending Library" },
    ],
  },
];

const NAV_ITEM_ICONS: Partial<Record<NavKey, React.ReactNode>> = {
  dashboard: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  messages: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 7h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H10l-4 3v-3H6a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  ),
  notifications: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3V9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 18a2.5 2.5 0 0 0 5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M9.5 9.2a2.7 2.7 0 0 1 5 1.1c0 1.8-2 2.3-2.3 3.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17.5" r="1" fill="currentColor" />
    </svg>
  ),
  staff: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const NAV_SECTION_ICONS: Record<NavSectionKey, React.ReactNode> = {
  kilnRentals: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 9c1.6 1.8 2.4 2.9 2.4 4.2a2.4 2.4 0 0 1-4.8 0c0-1.3.8-2.4 2.4-4.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  studioResources: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8 9h8M8 13h8M8 17h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  community: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="10" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="16.5" cy="11" r="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M4.5 19a4.5 4.5 0 0 1 9 0M13 19c.3-1.8 1.9-3 3.7-3 1.8 0 3.3 1.2 3.8 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
};

const NAV_LABELS: Record<NavKey, string> = {
  dashboard: "Dashboard",
  profile: "Profile",
  integrations: "Integrations",
  pieces: "My Pieces",
  kiln: "Firings",
  kilnRentals: "Kiln Rentals",
  kilnLaunch: "View the Queues",
  reservations: "Ware Check-in",
  community: "Community",
  events: "Workshops",
  lendingLibrary: "Lending Library",
  glazes: "Glaze Board",
  membership: "Membership",
  materials: "Store",
  billing: "Billing",
  studioResources: "Studio & Resources",
  notifications: "Notifications",
  messages: "Messages",
  support: "Support",
  staff: "Staff",
};

const SESSION_ADMIN_TOKEN_KEY = "mf_dev_admin_token";
const EMAIL_LINK_KEY = "mf_email_link_email";
const LOCAL_NAV_KEY = "mf_nav_key";
const LOCAL_NAV_SECTION_KEY = "mf_nav_section_key";
const LOCAL_NAV_COLLAPSED_KEY = "mf_nav_collapsed";
const LOCAL_NAV_DOCK_KEY = "mf_nav_dock";
const SUPPORT_EMAIL = "support@monsoonfire.com";
const MF_LOGO = "/branding/logo-mark-black.webp";
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const FUNCTIONS_BASE_URL =
  typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
    ? String(ENV.VITE_FUNCTIONS_BASE_URL)
    : DEFAULT_FUNCTIONS_BASE_URL;
const DEV_ADMIN_TOKEN_ENABLED =
  typeof import.meta !== "undefined" &&
  ENV.DEV === true &&
  ENV.VITE_ENABLE_DEV_ADMIN_TOKEN === "true" &&
  (FUNCTIONS_BASE_URL.includes("localhost") || FUNCTIONS_BASE_URL.includes("127.0.0.1"));
const DEV_ADMIN_TOKEN_PERSIST_ENABLED =
  DEV_ADMIN_TOKEN_ENABLED && ENV.VITE_PERSIST_DEV_ADMIN_TOKEN === "true";
const SUPPORT_THREAD_PREFIX = "support_";
const SUPPORT_MESSAGE_PREFIX = "welcome";
const WELCOME_NOTIFICATION_ID = "welcome-messaging-infra";
const WELCOME_MESSAGE_SUBJECT = "Welcome to Monsoon Fire Support";
const WELCOME_NOTIFICATION_TITLE = "Welcome to your Monsoon Fire portal";

const NAV_SECTION_KEYS: NavSectionKey[] = ["kilnRentals", "studioResources", "community"];
const NAV_DOCK_POSITIONS: NavDockPosition[] = ["left", "top", "right", "bottom"];
const NAV_DOCK_LABELS: Record<NavDockPosition, string> = {
  left: "Left",
  top: "Top",
  right: "Right",
  bottom: "Bottom",
};
const NAV_DOCK_DRAG_THRESHOLD_PX = 130;

function normalizeHashPath(hash: string): string {
  if (!hash) return "";
  const trimmed = hash.replace(/^#/, "").replace(/^!/, "").trim();
  if (!trimmed) return "";
  const pathCandidate = trimmed.split("?")[0] ?? "";
  if (!pathCandidate) return "";
  return pathCandidate.startsWith("/") ? pathCandidate : `/${pathCandidate}`;
}

function isLegacyRequestsPath(pathname: string): boolean {
  return /^\/(?:community\/)?requests(?:\/|$)/i.test(pathname);
}

function isStaffPath(pathname: string): boolean {
  return /^\/staff(?:\/|$)/i.test(pathname);
}

function isStaffCockpitPath(pathname: string): boolean {
  return /^\/staff\/cockpit(?:\/|$)/i.test(pathname) || /^\/cockpit(?:\/|$)/i.test(pathname);
}

function isStaffWorkshopsPath(pathname: string): boolean {
  return /^\/staff\/workshops(?:\/|$)/i.test(pathname);
}

function resolveStaffWorkspaceLaunch(pathname: string, hash: string): StaffWorkspaceLaunch | null {
  const normalizedHashPath = normalizeHashPath(hash);
  const candidates = [pathname, normalizedHashPath].filter(Boolean);
  if (candidates.some((value) => isStaffWorkshopsPath(value))) {
    return { targetNav: "staff", mode: "workshops" };
  }
  if (candidates.some((value) => isStaffCockpitPath(value))) {
    return { targetNav: "staff", mode: "cockpit" };
  }
  if (candidates.some((value) => isStaffPath(value))) {
    return { targetNav: "staff", mode: "default" };
  }
  return null;
}

function getLegacyRequestsNotice(targetNav: LegacyRequestsDestination): string {
  if (targetNav === "events") {
    return "Requests has moved. This legacy link now opens Workshops. Use Lending Library for borrowing needs, or Support for general help.";
  }
  if (targetNav === "lendingLibrary") {
    return "Requests has moved. This legacy link now opens Lending Library. Use Workshops for class interest, or Support for general help.";
  }
  return "Requests has moved. This legacy link now opens Support. Use Lending Library for borrowing needs and Workshops for class interest.";
}

function resolveLegacyRequestsRedirect(pathname: string, search: string, hash: string): LegacyRequestsRedirect | null {
  const normalizedHashPath = normalizeHashPath(hash);
  if (!isLegacyRequestsPath(pathname) && !isLegacyRequestsPath(normalizedHashPath)) {
    return null;
  }

  const normalizedHints = `${pathname} ${search} ${hash}`.toLowerCase();
  const workshopHint = /\b(workshop|workshops|event|events|class|classes)\b/.test(normalizedHints);
  const lendingHint = /\b(lending|library|borrow|loan|tool)\b/.test(normalizedHints);
  const targetNav: LegacyRequestsDestination = workshopHint ? "events" : lendingHint ? "lendingLibrary" : "support";
  return {
    targetNav,
    notice: getLegacyRequestsNotice(targetNav),
  };
}

function readLocalItem(key: string): string | null {
  return safeStorageGetItem("localStorage", key);
}

function writeLocalItem(key: string, value: string): void {
  safeStorageSetItem("localStorage", key, value);
}

function clearLocalItem(key: string): void {
  safeStorageRemoveItem("localStorage", key);
}

function readSessionItem(key: string): string | null {
  return safeStorageGetItem("sessionStorage", key);
}

function writeSessionItem(key: string, value: string): void {
  safeStorageSetItem("sessionStorage", key, value);
}

function clearSessionItem(key: string): void {
  safeStorageRemoveItem("sessionStorage", key);
}

function readLocalBoolean(key: string, fallback = false): boolean {
  return safeReadBoolean("localStorage", key, fallback);
}

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

function isPermissionDeniedError(error: unknown): boolean {
  const payload = (error ?? {}) as ErrorLike;
  const code = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
  return (
    code.includes("permission-denied") ||
    message.includes("missing or insufficient permissions")
  );
}

function isMissingIndexError(error: unknown): boolean {
  const payload = (error ?? {}) as ErrorLike;
  const code = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
  return code.includes("failed-precondition") && message.includes("requires an index");
}

const isNavKey = (value: string): value is NavKey =>
  Object.prototype.hasOwnProperty.call(NAV_LABELS, value);

const isNavSectionKey = (value: string): value is NavSectionKey =>
  NAV_SECTION_KEYS.includes(value as NavSectionKey);

const isNavDockPosition = (value: string): value is NavDockPosition =>
  NAV_DOCK_POSITIONS.includes(value as NavDockPosition);

const isHorizontalNavDock = (dock: NavDockPosition): boolean => dock === "top" || dock === "bottom";

function resolveDockDropTarget(clientX: number, clientY: number): NavDockPosition | null {
  if (typeof window === "undefined") return null;
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const distances: Array<[NavDockPosition, number]> = [
    ["left", Math.max(clientX, 0)],
    ["right", Math.max(width - clientX, 0)],
    ["top", Math.max(clientY, 0)],
    ["bottom", Math.max(height - clientY, 0)],
  ];
  const closest = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best), distances[0]);
  if (closest[1] > NAV_DOCK_DRAG_THRESHOLD_PX) return null;
  return closest[0];
}

function UserProfileGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="avatar-fallback-icon">
      <circle cx="12" cy="8" r="3.3" fill="none" strokeWidth="1.7" stroke="currentColor" />
      <path
        d="M6 19c0-3 2.2-5.2 6-5.2s6 2.2 6 5.2"
        fill="none"
        strokeWidth="1.7"
        stroke="currentColor"
      />
    </svg>
  );
}

const getSectionForNav = (navKey: NavKey): NavSectionKey | null => {
  const match = NAV_SECTIONS.find((section) =>
    section.items.some((item) => item.key === navKey)
  );
  return match?.key ?? null;
};

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

function getErrorMessage(error: unknown): string {
  const code = getErrorCode(error);
  if (code) {
    const message = error instanceof Error ? error.message : String(error);
    if (code && message && !message.includes(code)) return `${message} (${code})`;
    if (code) return code;
  }
  return error instanceof Error ? error.message : String(error);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

type TimestampWithMillis = { toMillis?: () => number };

function readTimestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const maybe = value as TimestampWithMillis;
  if (typeof maybe.toMillis !== "function") return null;
  try {
    const millis = maybe.toMillis();
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function isDirectMessageThreadUnread(thread: DirectMessageThread, uid: string): boolean {
  const lastMessageMillis = readTimestampMillis(thread.lastMessageAt);
  if (lastMessageMillis === null) return false;
  const lastReadMillis = readTimestampMillis(thread.lastReadAtByUid?.[uid]);
  if (lastReadMillis === null) return true;
  return lastMessageMillis > lastReadMillis;
}

function isAnnouncementUnreadForUser(announcement: Announcement, uid: string): boolean {
  if (!Array.isArray(announcement.readBy)) return true;
  return !announcement.readBy.includes(uid);
}

function getWelcomeNotificationBody(supportEmail: string) {
  return `Welcome to your Monsoon Fire portal. We're excited to be your partner. Use the Messages area in the app for questions, support requests, and studio updates. For any needs, contact us at ${supportEmail}.`;
}

function getWelcomeMessageBody(supportEmail: string) {
  return `Welcome to Monsoon Fire! We're excited to partner with you. This thread is your messaging hub for studio support and general questions. Any questions can be directed to support by replying here or emailing ${supportEmail}.`;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: getErrorMessage(error) };
  }
  componentDidCatch(error: unknown) {
    console.error("AppErrorBoundary caught:", error);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="error-screen">
        <div className="error-card">
          <div className="error-title">Monsoon Fire Portal</div>
          <div className="error-copy">
            The app hit a runtime error. Refresh usually fixes it.
          </div>
          <pre className="error-pre">{this.state.message}</pre>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function useLiveUsers(user: User | null, canLoad: boolean) {
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user || !canLoad) {
      setUsers([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const usersQuery = query(collection(db, "users"), orderBy("displayName", "asc"), limit(100));
        const snap = await trackedGetDocs("messages:liveUsers", usersQuery);
        if (canceled) return;
        const rows: LiveUser[] = snap.docs.map((docSnap) => ({
          ...(docSnap.data() as Partial<LiveUser>),
          id: docSnap.id,
        }));
        setUsers(rows.filter((liveUser) => liveUser.id !== user.uid && liveUser.isActive !== false));
      } catch (error: unknown) {
        if (!canceled) setError(`Users failed: ${getErrorMessage(error)}`);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [user, canLoad]);

  return { users, loading, error };
}

function useDirectMessages(user: User | null, canLoad: boolean) {
  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user || !canLoad) {
      setThreads([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        let snap;
        let usedNoIndexFallback = false;
        const threadsCollection = collection(db, "directMessages");
        const threadsQuery = query(
          threadsCollection,
          where("participantUids", "array-contains", user.uid),
          orderBy("lastMessageAt", "desc"),
          limit(50)
        );
        try {
          snap = await trackedGetDocs("messages:threads", threadsQuery);
        } catch (error: unknown) {
          if (!isMissingIndexError(error)) {
            throw error;
          }
          usedNoIndexFallback = true;
          const fallbackQuery = query(
            threadsCollection,
            where("participantUids", "array-contains", user.uid),
            limit(120)
          );
          snap = await trackedGetDocs("messages:threads:no-index-fallback", fallbackQuery);
        }
        if (canceled) return;
        const rows = snap.docs.map((docSnap) => ({
          ...(docSnap.data() as Partial<DirectMessageThread>),
          id: docSnap.id,
        })) as DirectMessageThread[];

        if (usedNoIndexFallback) {
          rows.sort((a, b) => {
            const left = readTimestampMillis(a.lastMessageAt) ?? 0;
            const right = readTimestampMillis(b.lastMessageAt) ?? 0;
            return right - left;
          });
          setThreads(rows.slice(0, 50));
          setError("");
          return;
        }

        setThreads(rows);
      } catch (error: unknown) {
        if (!canceled) setError(`Direct messages failed: ${getErrorMessage(error)}`);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [user, canLoad]);

  return { threads, loading, error };
}

function useAnnouncements(user: User | null, canLoad: boolean) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user || !canLoad) {
      setAnnouncements([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const announcementsQuery = query(
          collection(db, "announcements"),
          orderBy("createdAt", "desc"),
          limit(30)
        );
        const snap = await trackedGetDocs("messages:announcements", announcementsQuery);
        if (canceled) return;
        const rows: Announcement[] = snap.docs.map((docSnap) => ({
          ...(docSnap.data() as Partial<Announcement>),
          id: docSnap.id,
        }));
        setAnnouncements(rows);
      } catch (error: unknown) {
        if (!canceled) setError(`Announcements failed: ${getErrorMessage(error)}`);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [user, canLoad]);

  return { announcements, loading, error };
}

function useNotifications(user: User | null, canLoad: boolean) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user || !canLoad) {
      setNotifications([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const notificationsQuery = query(
          collection(db, "users", user.uid, "notifications"),
          orderBy("createdAt", "desc"),
          limit(50)
        );
        const snap = await trackedGetDocs("notifications:list", notificationsQuery);
        if (canceled) return;
        const rows = snap.docs.map((docSnap) => ({
          ...(docSnap.data() as Record<string, unknown>),
          id: docSnap.id,
        }));
        setNotifications(rows as NotificationItem[]);
      } catch (error: unknown) {
        if (!canceled) setError(`Notifications failed: ${getErrorMessage(error)}`);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    void load();
    return () => {
      canceled = true;
    };
  }, [user, canLoad]);

  return { notifications, loading, error };
}

function prefetchLikelyNextViews() {
  void import("./views/KilnRentalsView");
  void import("./views/ReservationsView");
  void import("./views/KilnLaunchView");
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [emailLinkPending, setEmailLinkPending] = useState(false);
  const [nav, setNav] = useState<NavKey>(() => {
    if (typeof window === "undefined") return "dashboard";
    const staffWorkspaceLaunch = resolveStaffWorkspaceLaunch(window.location.pathname, window.location.hash);
    if (staffWorkspaceLaunch) return staffWorkspaceLaunch.targetNav;
    const legacyRedirect = resolveLegacyRequestsRedirect(
      window.location.pathname,
      window.location.search,
      window.location.hash
    );
    if (legacyRedirect) return legacyRedirect.targetNav;
    const path = window.location.pathname;
    if (path === "/glazes" || path === "/community/glazes") return "glazes";
    const saved = readLocalItem(LOCAL_NAV_KEY);
    if (saved && isNavKey(saved)) return saved;
    return "dashboard";
  });
  const [staffWorkspaceMode] = useState<StaffWorkspaceMode>(() => {
    if (typeof window === "undefined") return "default";
    const launch = resolveStaffWorkspaceLaunch(window.location.pathname, window.location.hash);
    return launch?.mode ?? "default";
  });
  const [legacyRouteNotice] = useState(() => {
    if (typeof window === "undefined") return "";
    const legacyRedirect = resolveLegacyRequestsRedirect(
      window.location.pathname,
      window.location.search,
      window.location.hash
    );
    return legacyRedirect?.notice ?? "";
  });
  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return readLocalBoolean(LOCAL_NAV_COLLAPSED_KEY);
  });
  const [navDock, setNavDock] = useState<NavDockPosition>(() => {
    if (typeof window === "undefined") return "left";
    const saved = readLocalItem(LOCAL_NAV_DOCK_KEY);
    if (saved && isNavDockPosition(saved)) return saved;
    return "left";
  });
  const [openSection, setOpenSection] = useState<NavSectionKey | null>(() => {
    if (typeof window === "undefined") return NAV_SECTIONS[0]?.key ?? null;
    const saved = readLocalItem(LOCAL_NAV_SECTION_KEY);
    if (saved && isNavSectionKey(saved)) return saved;
    const savedNav = readLocalItem(LOCAL_NAV_KEY);
    if (savedNav && isNavKey(savedNav)) return getSectionForNav(savedNav);
    return NAV_SECTIONS[0]?.key ?? null;
  });
  const [navDockDragActive, setNavDockDragActive] = useState(false);
  const [navDockDragHover, setNavDockDragHover] = useState<NavDockPosition | null>(null);
  const [devAdminToken, setDevAdminToken] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [supportStatus, setSupportStatus] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const [piecesFocusTarget, setPiecesFocusTarget] = useState<PieceFocusTarget | null>(null);
  const [bootstrapWarning, setBootstrapWarning] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [themeName, setThemeName] = useState<PortalThemeName>(() => readStoredPortalTheme());
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [enhancedMotion, setEnhancedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const likelyMobile = window.matchMedia?.("(max-width: 720px)")?.matches ?? false;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData ?? false;
    const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory ?? null;
    const cores = (navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? null;
    const defaultValue = computeEnhancedMotionDefault({
      likelyMobile,
      saveData,
      deviceMemory,
      hardwareConcurrency: cores,
    });
    return readStoredEnhancedMotion(defaultValue);
  });
  const [motionAutoReduced, setMotionAutoReduced] = useState(false);
  const profileThemeSyncBlockedRef = useRef(false);
  const navDockDragPointerIdRef = useRef<number | null>(null);

  const authClient = auth;
  const isAuthEmulator =
    typeof import.meta !== "undefined" &&
    (ENV.VITE_USE_AUTH_EMULATOR ?? ENV.VITE_USE_EMULATORS) === "true";
  const devAdminActive = DEV_ADMIN_TOKEN_ENABLED && devAdminToken.trim().length > 0;
  const staffUi = isStaff || devAdminActive;
  const devAdminTokenValue = devAdminActive ? devAdminToken.trim() : "";
  const navIsHorizontalDock = isHorizontalNavDock(navDock);
  const navSupportsCollapse = !navIsHorizontalDock;
  const navIsCollapsed = navSupportsCollapse && navCollapsed;
  const navBottomItems: NavItem[] = staffUi
    ? [...NAV_BOTTOM_ITEMS, { key: "staff", label: "Staff" }]
    : NAV_BOTTOM_ITEMS;

  const persistThemeName = async (next: PortalThemeName): Promise<void> => {
    setThemeName(next);
    writeStoredPortalTheme(next);
    if (!user?.uid || profileThemeSyncBlockedRef.current) return;
    try {
      await setDoc(
        doc(db, "profiles", user.uid),
        { uiTheme: next, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (error: unknown) {
      // Keep theme switching resilient even if profile writes are denied.
      if (isPermissionDeniedError(error)) {
        profileThemeSyncBlockedRef.current = true;
        if (ENV.DEV) {
          console.warn("[profile] uiTheme sync disabled for this session (permission denied).", {
            uid: user.uid,
          });
        }
        return;
      }
      if (ENV.DEV) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[profile] uiTheme sync failed", {
          uid: user.uid,
          message,
        });
      }
    }
  };

  const syncUserFromAuth = useCallback(async () => {
    const current = authClient.currentUser;
    if (!current) return;
    try {
      await current.reload();
      setUser(authClient.currentUser);
    } catch {
      // Ignore transient auth sync errors.
    }
  }, [authClient]);

  const ensureDefaultProfileAvatar = useCallback(async (nextUser: User) => {
    if (!nextUser || nextUser.photoURL) return;
    try {
      await updateProfile(nextUser, { photoURL: PROFILE_DEFAULT_AVATAR_URL });
      await syncUserFromAuth();
    } catch {
      // Best effort.
    }
  }, [syncUserFromAuth]);

  useEffect(() => {
    const theme = PORTAL_THEMES[themeName] ?? PORTAL_THEMES[DEFAULT_PORTAL_THEME];
    if (typeof document === "undefined") return;
    document.documentElement.dataset.portalTheme = themeName;
    document.documentElement.dataset.portalMotion = resolvePortalMotion(prefersReducedMotion, enhancedMotion);
    document.documentElement.style.colorScheme = themeName === "memoria" ? "dark" : "light";
    for (const [key, value] of Object.entries(theme)) {
      if (!key.startsWith("--") || value == null) continue;
      document.documentElement.style.setProperty(key, String(value));
    }
  }, [themeName, prefersReducedMotion, enhancedMotion]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.photoURL]);

  useEffect(() => {
    profileThemeSyncBlockedRef.current = false;
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    void ensureDefaultProfileAvatar(user);
  }, [user, ensureDefaultProfileAvatar]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prefersReducedMotion) return;
    if (!enhancedMotion) return;
    if (themeName !== "memoria") return;

    let stopped = false;
    let armed = true;

    const runProbe = () => {
      if (stopped || !armed) return;
      armed = false;
      let frames = 0;
      let last = performance.now();
      const deltas: number[] = [];

      const tick = (now: number) => {
        if (stopped) return;
        const dt = now - last;
        last = now;
        deltas.push(dt);
        frames += 1;
        if (frames < 50) {
          requestAnimationFrame(tick);
          return;
        }
        const sorted = deltas.slice().sort((a, b) => a - b);
        const avg = deltas.reduce((t, v) => t + v, 0) / Math.max(1, deltas.length);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? avg;
        const slow = avg > 24 || p95 > 34;
        if (slow) {
          setEnhancedMotion(false);
          writeStoredEnhancedMotion(false);
          setMotionAutoReduced(true);
          // Best effort: sync to profile when signed in.
          if (user?.uid) {
            setDoc(
              doc(db, "profiles", user.uid),
              { uiEnhancedMotion: false, updatedAt: serverTimestamp() },
              { merge: true }
            ).catch(() => {});
          }
        }
      };

      requestAnimationFrame(tick);
    };

    const onFirstInteraction = () => runProbe();
    window.addEventListener("pointerdown", onFirstInteraction, { once: true, passive: true });
    window.addEventListener("keydown", onFirstInteraction, { once: true, passive: true });
    window.addEventListener("scroll", onFirstInteraction, { once: true, passive: true });

    return () => {
      stopped = true;
      window.removeEventListener("pointerdown", onFirstInteraction);
      window.removeEventListener("keydown", onFirstInteraction);
      window.removeEventListener("scroll", onFirstInteraction);
    };
  }, [prefersReducedMotion, enhancedMotion, themeName, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    async function loadThemeFromProfile(uid: string) {
      try {
        const snap = await trackedGetDoc("startup:profile", doc(db, "profiles", uid));
        const data = (snap.data() as { uiTheme?: unknown; uiEnhancedMotion?: unknown } | undefined) ?? undefined;
        const raw = data?.uiTheme;
        const rawMotion = data?.uiEnhancedMotion;
        if (cancelled) return;
        if (isPortalThemeName(raw)) {
          setThemeName(raw);
          writeStoredPortalTheme(raw);
        }
        if (typeof rawMotion === "boolean") {
          setEnhancedMotion(rawMotion);
          writeStoredEnhancedMotion(rawMotion);
        }
      } catch {
        // Ignore theme load failures; default/localStorage theme still works.
      }
    }
    void loadThemeFromProfile(user.uid);
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!DEV_ADMIN_TOKEN_ENABLED || !DEV_ADMIN_TOKEN_PERSIST_ENABLED) {
      clearSessionItem(SESSION_ADMIN_TOKEN_KEY);
      return;
    }
    const saved = readSessionItem(SESSION_ADMIN_TOKEN_KEY);
    if (saved) {
      setDevAdminToken(saved);
    }
  }, []);

  useEffect(() => {
    writeLocalItem(LOCAL_NAV_KEY, nav);
    if (typeof window === "undefined") return;
    const hasLegacyRequestsPath = isLegacyRequestsPath(window.location.pathname);
    const hasLegacyRequestsHash = isLegacyRequestsPath(normalizeHashPath(window.location.hash));
    const hasStaffPath = isStaffPath(window.location.pathname);
    const hasStaffHashPath = isStaffPath(normalizeHashPath(window.location.hash));
    const hasStaffCockpitPath = isStaffCockpitPath(window.location.pathname);
    const hasStaffCockpitHashPath = isStaffCockpitPath(normalizeHashPath(window.location.hash));
    if (nav === "glazes") {
      window.history.replaceState({}, "", "/glazes");
    } else if (nav === "staff" && staffWorkspaceMode === "cockpit") {
      if (!hasStaffCockpitPath && !hasStaffCockpitHashPath) {
        window.history.replaceState({}, "", "/staff/cockpit");
      }
    } else if (nav === "staff" && staffWorkspaceMode === "workshops") {
      if (!hasStaffPath || window.location.pathname !== "/staff/workshops") {
        window.history.replaceState({}, "", "/staff/workshops");
      }
    } else if (window.location.pathname === "/glazes" || hasLegacyRequestsPath || hasLegacyRequestsHash) {
      window.history.replaceState({}, "", "/");
    } else if (hasStaffPath || hasStaffHashPath || hasStaffCockpitPath || hasStaffCockpitHashPath) {
      window.history.replaceState({}, "", "/");
    }
  }, [nav, staffWorkspaceMode]);

  useEffect(() => {
    writeLocalItem(LOCAL_NAV_COLLAPSED_KEY, navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  useEffect(() => {
    writeLocalItem(LOCAL_NAV_DOCK_KEY, navDock);
  }, [navDock]);

  useEffect(() => {
    if (!navIsHorizontalDock) return;
    if (navCollapsed) {
      setNavCollapsed(false);
    }
  }, [navIsHorizontalDock, navCollapsed]);

  useEffect(() => {
    if (!openSection) {
      clearLocalItem(LOCAL_NAV_SECTION_KEY);
      return;
    }
    writeLocalItem(LOCAL_NAV_SECTION_KEY, openSection);
  }, [openSection]);

  useEffect(() => {
    if (!DEV_ADMIN_TOKEN_ENABLED || !DEV_ADMIN_TOKEN_PERSIST_ENABLED) {
      clearSessionItem(SESSION_ADMIN_TOKEN_KEY);
      return;
    }
    if (devAdminToken) {
      writeSessionItem(SESSION_ADMIN_TOKEN_KEY, devAdminToken);
    } else {
      clearSessionItem(SESSION_ADMIN_TOKEN_KEY);
    }
  }, [devAdminToken]);

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};

    const init = async () => {
      if (typeof window !== "undefined") {
        const link = window.location.href;
        if (isSignInWithEmailLink(authClient, link)) {
          const storedEmail = readLocalItem(EMAIL_LINK_KEY);
          if (storedEmail) {
            try {
              await signInWithEmailLink(authClient, storedEmail, link);
              clearLocalItem(EMAIL_LINK_KEY);
              if (!cancelled) setEmailLinkPending(false);
            } catch (_err: unknown) {
              if (!cancelled) {
                setEmailLinkPending(true);
                setAuthStatus("Sign-in link failed. Please try again.");
              }
            }
          } else if (!cancelled) {
            setEmailLinkPending(true);
          }
        }
      }
      try {
        const result = await getRedirectResult(authClient);
        if (!cancelled && result?.user) {
          track("auth_sign_in_success", {
            method: "redirect",
            uid: shortId(result.user.uid),
          });
          identify(result.user);
          setUser(result.user);
          setAuthReady(true);
        }
      } catch {
        // Redirect result is best-effort; when no redirect occurred it may throw or return null.
      }
      if (cancelled) return;
      unsub = onIdTokenChanged(authClient, (nextUser) => {
        if (nextUser) {
          identify(nextUser);
        }
        setUser(nextUser);
        setAuthReady(true);
        if (typeof window !== "undefined" && import.meta.env?.DEV) {
          const debugWindow = window as Window & {
            __mfGetIdToken?: () => Promise<string>;
            __mfGetUid?: () => string | null;
          };
          if (!nextUser) {
            delete debugWindow.__mfGetIdToken;
            delete debugWindow.__mfGetUid;
          } else {
            debugWindow.__mfGetUid = () => nextUser.uid ?? null;
            debugWindow.__mfGetIdToken = async () => await nextUser.getIdToken(true);
          }
        }
        if (!nextUser) {
          setIsStaff(false);
        } else {
          nextUser
            .getIdTokenResult()
            .then((result) => {
              const parsedRole = parseStaffRoleFromClaims(result.claims ?? {});
              setIsStaff(parsedRole.isStaff);
            })
            .catch(() => setIsStaff(false));
        }
        if (!nextUser) {
          setPiecesFocusTarget(null);
          setNav("dashboard");
        }
      });
    };

    void init();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [authClient, isAuthEmulator]);

  useEffect(() => {
    if (!user?.uid) {
      setBootstrapWarning("");
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retriedTransientFailure = false;

    const runEnsureUserDoc = async () => {
      const projectId = authClient.app.options.projectId ?? "monsoonfire-portal";
      const result = await ensureUserDocForSession({
        uid: user.uid,
        getIdToken: async () => await user.getIdToken(),
        baseUrl: FUNCTIONS_BASE_URL,
        projectId,
      });
      if (cancelled) return;

      const isTransientFailure =
        result.code === "TOKEN_UNAVAILABLE" ||
        result.code === "NETWORK_ERROR" ||
        result.code === "RETRY_COOLDOWN";

      if (!result.ok) {
        if (isTransientFailure && !retriedTransientFailure) {
          retriedTransientFailure = true;
          setBootstrapWarning("");
          const retryDelayMs = Math.max(1_200, Math.min(result.retryAfterMs ?? 5_000, 15_000));
          console.info("[bootstrap] ensureUserDoc deferred retry", {
            uid: user.uid,
            code: result.code ?? "unknown",
            retryDelayMs,
          });
          retryTimer = setTimeout(() => {
            if (cancelled) return;
            void runEnsureUserDoc();
          }, retryDelayMs);
          return;
        }

        const nextWarning = result.message
          ? `Account setup check failed: ${result.message}`
          : "Account setup check failed. Some personalization may be delayed.";
        setBootstrapWarning(nextWarning);
        const log = result.retrySuppressed ? console.info : console.warn;
        log("[bootstrap] ensureUserDoc failed", {
          uid: user.uid,
          message: result.message ?? "unknown",
          code: result.code ?? "unknown",
        });
        return;
      }
      setBootstrapWarning("");
      if (result.userCreated || result.profileCreated) {
        console.info("[bootstrap] ensureUserDoc complete", {
          uid: user.uid,
          userCreated: result.userCreated,
          profileCreated: result.profileCreated,
        });
      }
    };

    void runEnsureUserDoc();
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
      }
    };
  }, [authClient.app.options.projectId, user]);

  useEffect(() => {
    setTelemetryView(nav);
  }, [nav]);

  useEffect(() => {
    if (!user?.uid) return;

    let cancelled = false;
    const supportThreadId = `${SUPPORT_THREAD_PREFIX}${user.uid}`;
    const supportThreadRef = doc(db, "directMessages", supportThreadId);
    const welcomeMessageRef = doc(supportThreadRef, "messages", SUPPORT_MESSAGE_PREFIX);
    const welcomeNotificationRef = doc(db, "users", user.uid, "notifications", WELCOME_NOTIFICATION_ID);
    const welcomeBody = getWelcomeMessageBody(SUPPORT_EMAIL);

    const seedWelcomeInfrastructure = async () => {
      try {
        const [threadSnap, notificationSnap] = await Promise.all([
          trackedGetDoc("startup:welcome", supportThreadRef),
          trackedGetDoc("startup:welcome", welcomeNotificationRef),
        ]);

        if (cancelled) return;

        if (!notificationSnap.exists()) {
          await setDoc(welcomeNotificationRef, {
            title: WELCOME_NOTIFICATION_TITLE,
            body: getWelcomeNotificationBody(SUPPORT_EMAIL),
            createdAt: serverTimestamp(),
          });
        }

        const threadData = threadSnap.data() as Record<string, unknown> | undefined;
        const threadPayload: Record<string, unknown> = {
          kind: typeof threadData?.kind === "string" ? threadData.kind : "support",
          participantUids: [...new Set([...toStringArray(threadData?.participantUids), user.uid])],
          updatedAt: serverTimestamp(),
        };

        if (typeof threadData?.subject !== "string" || !threadData.subject.trim().length) {
          threadPayload.subject = WELCOME_MESSAGE_SUBJECT;
        }

        const hasWelcomeMessage = threadSnap.exists()
          ? (await trackedGetDoc("startup:welcome", welcomeMessageRef)).exists()
          : false;

        if (!threadSnap.exists() || !hasWelcomeMessage) {
          await setDoc(
            welcomeMessageRef,
            {
              messageId: `<${SUPPORT_MESSAGE_PREFIX}-thread@monsoonfire.local>`,
              subject: WELCOME_MESSAGE_SUBJECT,
              body: welcomeBody,
              fromUid: "support-system",
              fromName: "Monsoon Fire Studio",
              fromEmail: SUPPORT_EMAIL,
              replyToEmail: SUPPORT_EMAIL,
              toUids: [user.uid],
              toEmails: user.email ? [user.email] : [],
              sentAt: serverTimestamp(),
              inReplyTo: null,
              references: [],
            },
            { merge: true }
          );

          threadPayload.lastMessagePreview = welcomeBody.slice(0, 180);
          threadPayload.lastMessageAt = serverTimestamp();
          threadPayload.lastMessageId = SUPPORT_MESSAGE_PREFIX;
          threadPayload.lastSenderName = "Monsoon Fire Studio";
          threadPayload.lastSenderEmail = SUPPORT_EMAIL;
          if (!threadSnap.exists()) {
            threadPayload.createdAt = serverTimestamp();
          }
        }

        await setDoc(supportThreadRef, threadPayload, { merge: true });
      } catch {
        // Keep onboarding tolerant: failure to seed should not block auth or portal usage.
      }
    };

    void seedWelcomeInfrastructure();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.email]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (typeof window === "undefined") return;
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return;
    if (!("serviceWorker" in navigator)) return;
    const resetKey = "mf-dev-message-sw-reset";
    void (async () => {
      const hadReset = readLocalBoolean(resetKey);
      let didCleanup = false;
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (registrations.length > 0) {
          didCleanup = true;
        }
        for (const registration of registrations) {
          await registration.unregister();
        }
      } catch {
        // Ignore service worker teardown failures; they can happen in constrained dev contexts.
      }

      if (typeof caches === "undefined") return;
      try {
        const cacheKeys = await caches.keys();
        if (cacheKeys.length > 0) {
          didCleanup = true;
        }
        await Promise.all(cacheKeys.map((name) => caches.delete(name)));
      } catch {
        // Ignore cache cleanup failures; this should not block app usage.
      }

      if (didCleanup && !hadReset) {
        writeLocalItem(resetKey, "1");
        window.location.reload();
      } else if (hadReset) {
        clearLocalItem(resetKey);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) {
      setNotificationsEnabled(false);
      return;
    }
    if (nav === "notifications") {
      setNotificationsEnabled(true);
      return;
    }

    let canceled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const enable = () => {
      if (!canceled) setNotificationsEnabled(true);
    };
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(enable, { timeout: 2200 });
      return () => {
        canceled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(enable, 700);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [user, nav]);

  const { users: liveUsers, loading: liveUsersLoading, error: liveUsersError } = useLiveUsers(
    user,
    isStaff && nav === "messages"
  );
  const shouldLoadMessages = nav === "messages" || nav === "dashboard";
  const shouldLoadAnnouncements = nav === "messages" || nav === "dashboard";
  const { threads, loading: threadsLoading, error: threadsError } = useDirectMessages(
    user,
    shouldLoadMessages
  );
  const {
    announcements,
    loading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements(user, shouldLoadAnnouncements);
  const {
    notifications,
    loading: notificationsLoading,
    error: notificationsError,
  } = useNotifications(user, notificationsEnabled);

  useEffect(() => {
    if (!user) {
      setUnreadMessages(0);
      return;
    }
    const count = threads.reduce(
      (total, thread) => total + (isDirectMessageThreadUnread(thread, user.uid) ? 1 : 0),
      0
    );
    setUnreadMessages(count);
  }, [threads, user]);

  useEffect(() => {
    if (!user) {
      setUnreadAnnouncements(0);
      return;
    }
    const unread = announcements.filter((item) => isAnnouncementUnreadForUser(item, user.uid)).length;
    setUnreadAnnouncements(unread);
  }, [announcements, user]);

  useEffect(() => {
    const unread = notifications.filter((item) => !item.readAt).length;
    setUnreadNotifications(unread);
  }, [notifications]);

  const handleProviderSignIn = async (
    providerId: "google" | "apple" | "facebook" | "microsoft"
  ) => {
    setAuthStatus("");
    setAuthBusy(true);
    track("auth_sign_in_start", {
      method: providerId,
    });
    try {
      let provider;
      switch (providerId) {
        case "google":
          provider = new GoogleAuthProvider();
          provider.addScope("email");
          break;
        case "facebook":
          provider = new FacebookAuthProvider();
          provider.addScope("email");
          break;
        case "apple":
          provider = new OAuthProvider("apple.com");
          provider.addScope("email");
          provider.addScope("name");
          break;
        case "microsoft":
          provider = new OAuthProvider("microsoft.com");
          provider.addScope("email");
          break;
        default:
          return;
      }
      try {
        const result = await signInWithPopup(authClient, provider);
        if (result?.user) {
          track("auth_sign_in_success", {
            method: providerId,
            uid: shortId(result.user.uid),
          });
          identify(result.user);
          setUser(result.user);
          setAuthReady(true);
        }
      } catch (error: unknown) {
        // Popups can be blocked (mobile Safari, aggressive privacy settings). Redirect is a reliable fallback.
        const code = getErrorCode(error);
        const shouldFallbackToRedirect =
          code === "auth/cancelled-popup-request" ||
          code === "auth/popup-blocked" ||
          code === "auth/popup-closed-by-user" ||
          code === "auth/operation-not-supported-in-this-environment";
        if (shouldFallbackToRedirect) {
          if (!isAuthEmulator) {
            setAuthStatus("Continuing sign-in in redirect mode...");
          }
          await signInWithRedirect(authClient, provider);
          return;
        }
        throw error;
      }
    } catch (error: unknown) {
      setAuthStatus(getErrorMessage(error) || "Sign-in failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailPassword = async (
    email: string,
    password: string,
    mode: "signin" | "create"
  ) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthStatus("Please enter your email and password.");
      return;
    }
    setAuthStatus("");
    setAuthBusy(true);
    track("auth_sign_in_start", {
      method: "email_password",
      mode,
    });
    try {
      if (mode === "create") {
        const result = await createUserWithEmailAndPassword(authClient, trimmedEmail, password);
        if (result?.user) {
          track("auth_sign_in_success", {
            method: "email_password_create",
            uid: shortId(result.user.uid),
          });
          identify(result.user);
          setUser(result.user);
          setAuthReady(true);
        }
      } else {
        const result = await signInWithEmailAndPassword(authClient, trimmedEmail, password);
        if (result?.user) {
          track("auth_sign_in_success", {
            method: "email_password_signin",
            uid: shortId(result.user.uid),
          });
          identify(result.user);
          setUser(result.user);
          setAuthReady(true);
        }
      }
    } catch (error: unknown) {
      setAuthStatus(getErrorMessage(error) || "Email sign-in failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailLink = async (email: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthStatus("Enter an email to receive a sign-in link.");
      return;
    }
    setAuthStatus("");
    setAuthBusy(true);
    try {
      const actionCodeSettings = {
        url: window.location.origin,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(authClient, trimmedEmail, actionCodeSettings);
      writeLocalItem(EMAIL_LINK_KEY, trimmedEmail);
      setAuthStatus("Check your email for your sign-in link.");
    } catch (error: unknown) {
      setAuthStatus(getErrorMessage(error) || "Unable to send sign-in link.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleCompleteEmailLink = async (email: string) => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setAuthStatus("Enter the email that received the link.");
      return;
    }
    setAuthStatus("");
    setAuthBusy(true);
    track("auth_sign_in_start", {
      method: "email_link",
    });
    try {
      const result = await signInWithEmailLink(authClient, trimmedEmail, window.location.href);
      clearLocalItem(EMAIL_LINK_KEY);
      setEmailLinkPending(false);
      if (result?.user) {
        track("auth_sign_in_success", {
          method: "email_link",
          uid: shortId(result.user.uid),
        });
        identify(result.user);
        setUser(result.user);
        setAuthReady(true);
      }
    } catch (error: unknown) {
      setAuthStatus(getErrorMessage(error) || "Unable to finish sign-in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmulatorSignIn = async () => {
    if (!isAuthEmulator) return;
    track("auth_sign_in_start", {
      method: "auth_emulator_anonymous",
    });
    const result = await signInAnonymously(authClient);
    if (result?.user) {
      track("auth_sign_in_success", {
        method: "auth_emulator_anonymous",
        uid: shortId(result.user.uid),
      });
      identify(result.user);
      setUser(result.user);
      setAuthReady(true);
    }
  };

  const handleSignOut = async () => {
    track("auth_sign_out", {
      uid: user?.uid ? shortId(user.uid) : "unknown",
    });
    await signOut(authClient);
    setNav("dashboard");
  };

  const handleAuthHandlerError = (error: unknown) => {
    setAuthStatus(getErrorMessage(error) || "Authentication action failed.");
    setAuthBusy(false);
  };

  const handleSupportSubmit = async (input: SupportRequestInput) => {
    if (!user || supportBusy) return false;
    setSupportBusy(true);
    setSupportStatus("");

    const trimmedSubject = input.subject.trim();
    const trimmedBody = input.body.trim();

    if (!trimmedSubject || !trimmedBody) {
      setSupportStatus("Please include a subject and your question.");
      setSupportBusy(false);
      return false;
    }

    try {
      await addDoc(collection(db, "supportRequests"), {
        uid: user.uid,
        subject: trimmedSubject,
        body: trimmedBody,
        category: input.category,
        status: "new",
        urgency: "non-urgent",
        channel: "portal",
        createdAt: serverTimestamp(),
        displayName: user.displayName || null,
        email: user.email || null,
      });
      setSupportStatus("Thanks! Your question was sent to the studio.");
      return true;
    } catch (error: unknown) {
      setSupportStatus(`Support request failed: ${getErrorMessage(error)}`);
      return false;
    } finally {
      setSupportBusy(false);
    }
  };

  const navSection = getSectionForNav(nav);
  const roleLabel = staffUi ? (isStaff ? "Staff" : "Dev Admin") : "Client";
  const sidebarAvatarUrl = user?.photoURL || PROFILE_DEFAULT_AVATAR_URL;

  useEffect(() => {
    if (navIsHorizontalDock) return;
    if (navSection && navSection !== openSection) {
      setOpenSection(navSection);
    }
  }, [navSection, openSection, navIsHorizontalDock]);

  useEffect(() => {
    if (!staffUi && nav === "staff") {
      setNav("dashboard");
    }
  }, [staffUi, nav]);

  useEffect(() => {
    if (!authReady || !user || nav !== "dashboard" || typeof window === "undefined") {
      return;
    }

    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let canceled = false;
    const runPrefetch = () => {
      if (canceled) return;
      prefetchLikelyNextViews();
    };

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(runPrefetch, { timeout: 1500 });
      return () => {
        canceled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const timer = window.setTimeout(runPrefetch, 300);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [authReady, user, nav]);

  const handleSectionToggle = (sectionKey: NavSectionKey) => {
    if (navIsHorizontalDock) {
      setOpenSection((previous) => (previous === sectionKey ? null : sectionKey));
      setMobileNavOpen(false);
      return;
    }
    if (nav !== sectionKey) {
      setNav(sectionKey);
    }
    if (navIsCollapsed) {
      setNavCollapsed(false);
    }
    setOpenSection(sectionKey);
    setMobileNavOpen(false);
  };

  const handleNavDockChange = (nextDock: NavDockPosition) => {
    if (nextDock === navDock) return;
    setNavDock(nextDock);
    setMobileNavOpen(false);
    if (isHorizontalNavDock(nextDock)) {
      setNavCollapsed(false);
      setOpenSection(null);
    }
  };

  // Dock source of truth: both click controls and drag-to-dock commit through handleNavDockChange.
  const clearNavDockDragState = useCallback(() => {
    navDockDragPointerIdRef.current = null;
    setNavDockDragActive(false);
    setNavDockDragHover(null);
  }, []);

  const updateNavDockHoverFromPointer = useCallback((clientX: number, clientY: number) => {
    setNavDockDragHover(resolveDockDropTarget(clientX, clientY));
  }, []);

  const handleNavDockDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 960px)")?.matches) {
      return;
    }
    navDockDragPointerIdRef.current = event.pointerId;
    setNavDockDragActive(true);
    updateNavDockHoverFromPointer(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handleNavDockDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!navDockDragActive) return;
    if (navDockDragPointerIdRef.current !== event.pointerId) return;
    updateNavDockHoverFromPointer(event.clientX, event.clientY);
  };

  const finishNavDockDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    commitDrop: boolean
  ) => {
    if (navDockDragPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextDock = resolveDockDropTarget(event.clientX, event.clientY) ?? navDockDragHover;
    clearNavDockDragState();
    if (commitDrop && nextDock) {
      handleNavDockChange(nextDock);
    }
  };

  const renderNavDockControls = (
    className = "",
    options: { showDragHandle?: boolean } = {}
  ) => (
    <div className={`nav-dock-controls ${className}`.trim()} role="group" aria-label="Navigation position">
      <span className="nav-dock-label">Dock</span>
      <div className="nav-dock-buttons">
        {NAV_DOCK_POSITIONS.map((position) => (
          <button
            type="button"
            key={`dock-${position}`}
            className={`nav-dock-btn ${navDock === position ? "active" : ""}`}
            aria-pressed={navDock === position}
            onClick={() => handleNavDockChange(position)}
            title={`Move navigation to ${NAV_DOCK_LABELS[position].toLowerCase()}`}
          >
            {NAV_DOCK_LABELS[position]}
          </button>
        ))}
      </div>
      {(options.showDragHandle ?? true) ? (
        <button
          type="button"
          className={`nav-dock-drag-handle ${navDockDragActive ? "dragging" : ""}`.trim()}
          aria-label="Drag to dock navigation"
          title="Drag to dock navigation to left, top, right, or bottom"
          onPointerDown={handleNavDockDragStart}
          onPointerMove={handleNavDockDragMove}
          onPointerUp={(event) => finishNavDockDrag(event, true)}
          onPointerCancel={(event) => finishNavDockDrag(event, false)}
          onLostPointerCapture={() => clearNavDockDragState()}
        >
          <span className="nav-dock-drag-handle-icon" aria-hidden="true">
            ⋮⋮
          </span>
          <span className="nav-dock-drag-handle-text">Drag</span>
        </button>
      ) : null}
    </div>
  );

  const openPieces = useCallback((target?: PieceFocusTarget) => {
    setPiecesFocusTarget(target ?? null);
    setNav("pieces");
  }, []);

  const handlePiecesFocusConsumed = useCallback(() => {
    setPiecesFocusTarget(null);
  }, []);

  const renderView = (key: NavKey) => {
      if (!user) {
        return (
          <SignedOutView
            onProviderSignIn={toVoidHandler(handleProviderSignIn, handleAuthHandlerError, "auth.provider")}
            onEmailPassword={toVoidHandler(handleEmailPassword, handleAuthHandlerError, "auth.emailPassword")}
            onEmailLink={toVoidHandler(handleEmailLink, handleAuthHandlerError, "auth.emailLinkSend")}
            onCompleteEmailLink={toVoidHandler(handleCompleteEmailLink, handleAuthHandlerError, "auth.emailLinkComplete")}
            emailLinkPending={emailLinkPending}
            status={authStatus}
            busy={authBusy}
            onEmulatorSignIn={toVoidHandler(handleEmulatorSignIn, handleAuthHandlerError, "auth.emulator")}
            showEmulatorTools={isAuthEmulator}
          />
        );
      }

    switch (key) {
      case "dashboard":
        return (
          <DashboardView
            user={user}
            name={user.displayName ?? "Member"}
            themeName={themeName}
            onThemeChange={(next) => {
              void persistThemeName(next);
            }}
            threads={threads}
            announcements={announcements}
            onOpenKilnRentals={() => setNav("kilnRentals")}
            onOpenCheckin={() => setNav("reservations")}
            onOpenQueues={() => setNav("kilnLaunch")}
            onOpenFirings={() => setNav("kiln")}
            onOpenStudioResources={() => setNav("studioResources")}
            onOpenGlazeBoard={() => setNav("glazes")}
            onOpenCommunity={() => setNav("community")}
            onOpenMessages={() => setNav("messages")}
            onOpenPieces={openPieces}
          />
        );
      case "pieces":
        return (
          <MyPiecesView
            user={user}
            adminToken={devAdminTokenValue}
            isStaff={staffUi}
            focusTarget={piecesFocusTarget}
            onFocusTargetConsumed={handlePiecesFocusConsumed}
            onOpenCheckin={() => setNav("reservations")}
          />
        );
      case "profile":
        return (
          <ProfileView
            user={user}
            themeName={themeName}
            onThemeChange={(next) => {
              void persistThemeName(next);
            }}
            enhancedMotion={enhancedMotion}
            onEnhancedMotionChange={(next) => {
              setEnhancedMotion(next);
              writeStoredEnhancedMotion(next);
            }}
            onOpenIntegrations={() => setNav("integrations")}
            onAvatarUpdated={() => {
              void syncUserFromAuth();
            }}
          />
        );
      case "integrations":
        return (
          <IntegrationsView
            user={user}
            functionsBaseUrl={FUNCTIONS_BASE_URL}
            onBack={() => setNav("profile")}
          />
        );
      case "community":
        return (
          <CommunityView
            user={user}
            onOpenLendingLibrary={() => setNav("lendingLibrary")}
            onOpenWorkshops={() => setNav("events")}
          />
        );
      case "events":
        return <EventsView user={user} adminToken={devAdminTokenValue} isStaff={staffUi} />;
      case "lendingLibrary":
        return (
          <LendingLibraryView user={user} adminToken={devAdminTokenValue} isStaff={staffUi} />
        );
      case "glazes":
        return <GlazeBoardView user={user} isStaff={staffUi} />;
      case "membership":
        return <MembershipView user={user} />;
      case "materials":
        return <MaterialsView user={user} adminToken={devAdminTokenValue} isStaff={staffUi} />;
      case "billing":
        return <BillingView user={user} />;
      case "reservations":
        return <ReservationsView user={user} isStaff={staffUi} adminToken={devAdminTokenValue} />;
      case "kiln":
        return <KilnScheduleView user={user} isStaff={staffUi} />;
      case "kilnRentals":
        return (
          <KilnRentalsView
            onOpenKilnLaunch={() => setNav("kilnLaunch")}
            onOpenKilnSchedule={() => setNav("kiln")}
            onOpenWorkSubmission={() => setNav("reservations")}
          />
        );
      case "kilnLaunch":
        return <KilnLaunchView user={user} isStaff={staffUi} />;
      case "studioResources":
        return (
          <StudioResourcesView
            onOpenPieces={() => openPieces()}
            onOpenMaterials={() => setNav("materials")}
            onOpenMembership={() => setNav("membership")}
            onOpenBilling={() => setNav("billing")}
          />
        );
      case "messages":
        return (
          <MessagesView
            user={user}
            supportEmail={SUPPORT_EMAIL}
            threads={threads}
            threadsLoading={threadsLoading}
            threadsError={threadsError}
            liveUsers={liveUsers}
            liveUsersLoading={liveUsersLoading}
            liveUsersError={liveUsersError}
            announcements={announcements}
            announcementsLoading={announcementsLoading}
            announcementsError={announcementsError}
            unreadAnnouncements={unreadAnnouncements}
          />
        );
      case "notifications":
        return (
          <NotificationsView
            user={user}
            onOpenFirings={() => setNav("kiln")}
            notifications={notifications}
            loading={notificationsLoading}
            error={notificationsError}
          />
        );
      case "support":
        return (
          <SupportView
            user={user}
            supportEmail={SUPPORT_EMAIL}
            onSubmit={handleSupportSubmit}
            status={supportStatus}
            isBusy={supportBusy}
          />
        );
      case "staff":
        return (
          <StaffView
            user={user}
            isStaff={isStaff}
            devAdminToken={devAdminToken}
            onDevAdminTokenChange={setDevAdminToken}
            devAdminEnabled={DEV_ADMIN_TOKEN_ENABLED}
            showEmulatorTools={isAuthEmulator}
            onOpenCheckin={() => setNav("reservations")}
            initialModule={staffWorkspaceMode === "cockpit" ? "cockpit" : staffWorkspaceMode === "workshops" ? "events" : undefined}
            forceCockpitWorkspace={staffWorkspaceMode === "cockpit"}
            forceEventsWorkspace={staffWorkspaceMode === "workshops"}
          />
        );
      default:
        return (
          <PlaceholderView
            title={NAV_LABELS[key] ?? "Page"}
            subtitle="We are building this area now."
          />
        );
    }
  };

  if (!authReady) {
    return (
      <AppErrorBoundary>
        <a className="skip-link" href="#auth-bootstrap-main">
          Skip to sign in
        </a>
        <main id="auth-bootstrap-main" className="auth-bootstrap-screen" tabIndex={-1}>
          <section className="auth-bootstrap-card" role="status" aria-live="polite">
            <img
              src={MF_LOGO}
              alt="Monsoon Fire Pottery Studio"
              className="auth-bootstrap-logo"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <h1>Monsoon Fire Portal</h1>
            <p>Checking your studio sign-in status...</p>
            <div className="auth-bootstrap-loading" aria-hidden="true" />
          </section>
        </main>
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {navDockDragActive ? (
        <div className="nav-dock-drop-overlay" aria-hidden="true">
          {NAV_DOCK_POSITIONS.map((position) => (
            <div
              key={`drop-zone-${position}`}
              className={`nav-dock-drop-zone nav-dock-drop-zone-${position} ${
                navDockDragHover === position ? "active" : ""
              }`.trim()}
            >
              <span>{NAV_DOCK_LABELS[position]}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className={`app-shell dock-${navDock} ${navIsCollapsed ? "nav-collapsed" : ""}`.trim()}>
        <aside
          id="portal-sidebar-nav"
          className={`sidebar ${mobileNavOpen ? "open" : ""} ${navIsCollapsed ? "collapsed" : ""}`}
          aria-label="Primary navigation"
        >
          <button
            type="button"
            className="brand brand-home"
            onClick={() => {
              setNav("dashboard");
              setMobileNavOpen(false);
            }}
            aria-label="Go to dashboard"
            title="Go to dashboard"
          >
            <img
              src={MF_LOGO}
              alt="Monsoon Fire Pottery Studio"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            <div>
              <h1>Monsoon Fire</h1>
              <span>Pottery Studio</span>
            </div>
          </button>
          <nav aria-label="Main navigation">
            <div className="nav-primary">
              {NAV_TOP_ITEMS.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`nav-top-item ${nav === item.key ? "active" : ""}`}
                  aria-current={nav === item.key ? "page" : undefined}
                  title={item.label}
                  onClick={() => {
                    setNav(item.key);
                    if (navIsHorizontalDock) {
                      setOpenSection(null);
                    }
                    setMobileNavOpen(false);
                  }}
                >
                  {NAV_ITEM_ICONS[item.key] ? (
                    <span className="nav-icon">{NAV_ITEM_ICONS[item.key]}</span>
                  ) : null}
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
              {NAV_SECTIONS.map((section) => (
                <div
                  key={section.key}
                  className={`nav-section ${openSection === section.key ? "open" : "closed"}`}
                >
                  <button
                    type="button"
                    className="nav-section-title"
                    aria-expanded={openSection === section.key}
                    aria-controls={`nav-section-${section.key}`}
                    title={section.title}
                    onClick={() => handleSectionToggle(section.key)}
                  >
                    <span className="nav-icon">{NAV_SECTION_ICONS[section.key]}</span>
                    <span className="nav-label">{section.title}</span>
                  </button>
                  <div
                    className="nav-section-items"
                    id={`nav-section-${section.key}`}
                    aria-hidden={openSection !== section.key}
                  >
                    {section.items.map((item) => (
                      <button
                        type="button"
                        key={item.key}
                        className={`nav-subitem ${nav === item.key ? "active" : ""}`}
                        aria-current={nav === item.key ? "page" : undefined}
                        title={item.label}
                        onClick={() => {
                          setNav(item.key);
                          if (navIsHorizontalDock) {
                            setOpenSection(null);
                          }
                          setMobileNavOpen(false);
                        }}
                      >
                        {item.label === "Overview" ? null : (
                          <span className="nav-subdot" aria-hidden="true" />
                        )}
                        <span className="nav-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="nav-bottom">
              {navBottomItems.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={nav === item.key ? "active" : ""}
                  aria-current={nav === item.key ? "page" : undefined}
                  title={item.label}
                  onClick={() => {
                    setNav(item.key);
                    if (navIsHorizontalDock) {
                      setOpenSection(null);
                    }
                    setMobileNavOpen(false);
                  }}
                >
                  {NAV_ITEM_ICONS[item.key] ? (
                    <span className="nav-icon">{NAV_ITEM_ICONS[item.key]}</span>
                  ) : null}
                  <span className="nav-label">{item.label}</span>
                  {item.key === "messages" && unreadMessages + unreadAnnouncements > 0 ? (
                    <span className="badge">{unreadMessages + unreadAnnouncements}</span>
                  ) : null}
                  {item.key === "notifications" && unreadNotifications > 0 ? (
                    <span className="badge">{unreadNotifications}</span>
                  ) : null}
                </button>
              ))}
              {navSupportsCollapse ? (
                <button
                  type="button"
                  className="nav-toggle nav-toggle-inline"
                  data-collapsed={navIsCollapsed ? "true" : "false"}
                  title={navIsCollapsed ? "Open nav" : "Collapse nav"}
                  onClick={() => {
                    setNavCollapsed((prev) => !prev);
                    setMobileNavOpen(false);
                  }}
                  aria-label={navIsCollapsed ? "Open navigation" : "Collapse navigation"}
                  aria-pressed={!navIsCollapsed}
                >
                  <span className="nav-toggle-icon" aria-hidden="true" />
                  <span className="nav-label nav-toggle-text">
                    {navIsCollapsed ? "Open nav" : "Collapse nav"}
                  </span>
                </button>
              ) : null}
            </div>
          </nav>
          {renderNavDockControls()}
          {user && (
            <div className="profile-actions">
              <button
                type="button"
                className="profile-card profile-card-button"
                title="Open profile"
                aria-label="Open profile"
                onClick={() => setNav("profile")}
              >
                <div className="avatar">
                <span className="avatar-fallback" aria-hidden="true">
                    <UserProfileGlyph />
                  </span>
                  {sidebarAvatarUrl && !avatarLoadFailed ? (
                    <img
                      src={sidebarAvatarUrl}
                      alt={user.displayName ?? "User"}
                      onError={() => {
                        setAvatarLoadFailed(true);
                      }}
                    />
                  ) : null}
                </div>
                <div className="profile-meta">
                  <span className="profile-label">Profile</span>
                  <strong className="profile-name">{user.displayName ?? "Member"}</strong>
                  <span className="profile-role">{roleLabel}</span>
                </div>
              </button>
              <button
                type="button"
                className="signout-icon"
                onClick={toVoidHandler(handleSignOut, handleAuthHandlerError, "auth.signOut")}
                aria-label="Sign out"
                title="Sign out"
              >
                <span className="signout-text">Sign out</span>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M10 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7 12h10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M13 8l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}
        </aside>

        <main id="main-content" className="main" tabIndex={-1}>
          <div className={`nav-toggle-row ${navIsHorizontalDock ? "dock-horizontal-row" : ""}`.trim()}>
            {!navIsHorizontalDock ? (
              <button
                type="button"
                className="mobile-nav"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                aria-expanded={mobileNavOpen}
                aria-controls="portal-sidebar-nav"
                aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
                title={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-pressed={mobileNavOpen}
              >
                <span className="mobile-nav-icon" aria-hidden="true" />
                Menu
              </button>
            ) : null}
            {renderNavDockControls("nav-dock-controls-inline", { showDragHandle: false })}
          </div>

          <React.Suspense
            fallback={
              <div className="loading">
                <span />
                Loading studio view
              </div>
            }
          >
            {motionAutoReduced && themeName === "memoria" ? (
              <div className="notice motion-notice">
                Enhanced motion was disabled for performance. You can re-enable it in Profile.
              </div>
            ) : null}
            {legacyRouteNotice ? (
              <div className="notice motion-notice" role="status" aria-live="polite">
                {legacyRouteNotice}
              </div>
            ) : null}
            {bootstrapWarning ? (
              <div className="notice motion-notice" role="status" aria-live="polite">
                {bootstrapWarning}
              </div>
            ) : null}
            <UiSettingsProvider
              value={{
                themeName,
                portalMotion: resolvePortalMotion(prefersReducedMotion, enhancedMotion),
                enhancedMotion,
                prefersReducedMotion,
              }}
            >
              <div key={`${nav}:${themeName}:${enhancedMotion ? "m1" : "m0"}`} className="view-root">
                {renderView(nav)}
              </div>
            </UiSettingsProvider>
            <FirestoreTelemetryPanel enabled={import.meta.env.DEV} />
          </React.Suspense>
        </main>
      </div>
    </AppErrorBoundary>
  );
}
