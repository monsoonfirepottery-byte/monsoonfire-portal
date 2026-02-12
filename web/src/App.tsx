import React, { useEffect, useState } from "react";
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
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
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
import type { SupportRequestInput } from "./views/SupportView";
import { DEFAULT_PORTAL_THEME, isPortalThemeName, PORTAL_THEMES, type PortalThemeName } from "./theme/themes";
import { readStoredPortalTheme, writeStoredPortalTheme } from "./theme/themeStorage";
import { readStoredEnhancedMotion, writeStoredEnhancedMotion } from "./theme/motionStorage";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import { UiSettingsProvider } from "./context/UiSettingsContext";
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

type ImportMetaEnvShape = {
  DEV?: boolean;
  VITE_FUNCTIONS_BASE_URL?: string;
  VITE_ENABLE_DEV_ADMIN_TOKEN?: string;
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

type StaffClaims = {
  staff?: boolean;
  roles?: string[];
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

const NAV_SECTION_KEYS: NavSectionKey[] = ["kilnRentals", "studioResources", "community"];

const isNavKey = (value: string): value is NavKey =>
  Object.prototype.hasOwnProperty.call(NAV_LABELS, value);

const isNavSectionKey = (value: string): value is NavSectionKey =>
  NAV_SECTION_KEYS.includes(value as NavSectionKey);

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
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
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
        const snap = await getDocs(usersQuery);
        if (canceled) return;
        const rows: LiveUser[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Partial<LiveUser>),
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

function useDirectMessages(user: User | null) {
  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user) {
      setThreads([]);
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const threadsQuery = query(
          collection(db, "directMessages"),
          where("participantUids", "array-contains", user.uid),
          orderBy("lastMessageAt", "desc"),
          limit(50)
        );
        const snap = await getDocs(threadsQuery);
        if (canceled) return;
        const rows: DirectMessageThread[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Partial<DirectMessageThread>),
        }));
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
  }, [user]);

  return { threads, loading, error };
}

function useAnnouncements(user: User | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    if (!user) {
      setAnnouncements([]);
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
        const snap = await getDocs(announcementsQuery);
        if (canceled) return;
        const rows: Announcement[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Partial<Announcement>),
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
  }, [user]);

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
        const snap = await getDocs(notificationsQuery);
        if (canceled) return;
        const rows = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
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
    const path = window.location.pathname;
    if (path === "/glazes" || path === "/community/glazes") return "glazes";
    const saved = localStorage.getItem(LOCAL_NAV_KEY);
    if (saved && isNavKey(saved)) return saved;
    return "dashboard";
  });
  const [navCollapsed, setNavCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LOCAL_NAV_COLLAPSED_KEY) === "1";
  });
  const [openSection, setOpenSection] = useState<NavSectionKey | null>(() => {
    if (typeof window === "undefined") return NAV_SECTIONS[0]?.key ?? null;
    const saved = localStorage.getItem(LOCAL_NAV_SECTION_KEY);
    if (saved && isNavSectionKey(saved)) return saved;
    const savedNav = localStorage.getItem(LOCAL_NAV_KEY);
    if (savedNav && isNavKey(savedNav)) return getSectionForNav(savedNav);
    return NAV_SECTIONS[0]?.key ?? null;
  });
  const [devAdminToken, setDevAdminToken] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [supportStatus, setSupportStatus] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [themeName, setThemeName] = useState<PortalThemeName>(() => readStoredPortalTheme());
  const prefersReducedMotion = usePrefersReducedMotion();
  const [enhancedMotion, setEnhancedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const likelyMobile = window.matchMedia?.("(max-width: 720px)")?.matches ?? false;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData ?? false;
    const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory ?? null;
    const cores = (navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? null;
    const lowPower = (typeof deviceMemory === "number" && deviceMemory <= 4) || (typeof cores === "number" && cores <= 4);
    const defaultValue = !(likelyMobile || saveData || lowPower);
    return readStoredEnhancedMotion(defaultValue);
  });
  const [motionAutoReduced, setMotionAutoReduced] = useState(false);

  const authClient = auth;
  const isAuthEmulator =
    typeof import.meta !== "undefined" &&
    (ENV.VITE_USE_AUTH_EMULATOR ?? ENV.VITE_USE_EMULATORS) === "true";
  const devAdminActive = DEV_ADMIN_TOKEN_ENABLED && devAdminToken.trim().length > 0;
  const staffUi = isStaff || devAdminActive;
  const devAdminTokenValue = devAdminActive ? devAdminToken.trim() : "";
  const navBottomItems: NavItem[] = staffUi
    ? [...NAV_BOTTOM_ITEMS, { key: "staff", label: "Staff" }]
    : NAV_BOTTOM_ITEMS;

  useEffect(() => {
    const theme = PORTAL_THEMES[themeName] ?? PORTAL_THEMES[DEFAULT_PORTAL_THEME];
    if (typeof document === "undefined") return;
    document.documentElement.dataset.portalTheme = themeName;
    document.documentElement.dataset.portalMotion =
      prefersReducedMotion || !enhancedMotion ? "reduced" : "enhanced";
    document.documentElement.style.colorScheme = themeName === "memoria" ? "dark" : "light";
    for (const [key, value] of Object.entries(theme)) {
      if (!key.startsWith("--") || value == null) continue;
      document.documentElement.style.setProperty(key, String(value));
    }
  }, [themeName, prefersReducedMotion, enhancedMotion]);

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
        const snap = await getDoc(doc(db, "profiles", uid));
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
    if (!DEV_ADMIN_TOKEN_ENABLED) return;
    const saved = sessionStorage.getItem(SESSION_ADMIN_TOKEN_KEY);
    if (saved) {
      setDevAdminToken(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(LOCAL_NAV_KEY, nav);
    if (typeof window === "undefined") return;
    if (nav === "glazes") {
      window.history.replaceState({}, "", "/glazes");
    } else if (window.location.pathname === "/glazes") {
      window.history.replaceState({}, "", "/");
    }
  }, [nav]);

  useEffect(() => {
    localStorage.setItem(LOCAL_NAV_COLLAPSED_KEY, navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  useEffect(() => {
    if (!openSection) {
      localStorage.removeItem(LOCAL_NAV_SECTION_KEY);
      return;
    }
    localStorage.setItem(LOCAL_NAV_SECTION_KEY, openSection);
  }, [openSection]);

  useEffect(() => {
    if (!DEV_ADMIN_TOKEN_ENABLED) return;
    if (devAdminToken) {
      sessionStorage.setItem(SESSION_ADMIN_TOKEN_KEY, devAdminToken);
    } else {
      sessionStorage.removeItem(SESSION_ADMIN_TOKEN_KEY);
    }
  }, [devAdminToken]);

  useEffect(() => {
    let cancelled = false;
    let unsub = () => {};

    const init = async () => {
      if (typeof window !== "undefined") {
        const link = window.location.href;
        if (isSignInWithEmailLink(authClient, link)) {
          const storedEmail = localStorage.getItem(EMAIL_LINK_KEY);
          if (storedEmail) {
            try {
              await signInWithEmailLink(authClient, storedEmail, link);
              localStorage.removeItem(EMAIL_LINK_KEY);
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
          setUser(result.user);
          setAuthReady(true);
        }
      } catch {
        // Redirect result is best-effort; when no redirect occurred it may throw or return null.
      }
      if (cancelled) return;
      unsub = onIdTokenChanged(authClient, (nextUser) => {
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
              const claims = (result.claims ?? {}) as StaffClaims;
              const roles = Array.isArray(claims.roles) ? claims.roles : [];
              const staff = claims.staff === true || roles.includes("staff");
              setIsStaff(staff);
            })
            .catch(() => setIsStaff(false));
        }
        if (!nextUser) setNav("dashboard");
      });
    };

    void init();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [authClient, isAuthEmulator]);

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
  const { threads, loading: threadsLoading, error: threadsError } = useDirectMessages(user);
  const {
    announcements,
    loading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements(user);
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
    const count = threads.reduce((total, thread) => {
      const participants = Array.isArray(thread.participants)
        ? (thread.participants as Array<{ uid?: string; hasUnread?: boolean }>)
        : [];
      const hasUnread = participants.some(
        (participant) => participant.uid !== user.uid && participant.hasUnread === true
      );
      return total + (hasUnread ? 1 : 0);
    }, 0);
    setUnreadMessages(count);
  }, [threads, user]);

  useEffect(() => {
    const unread = announcements.filter((item) => !item.isRead).length;
    setUnreadAnnouncements(unread);
  }, [announcements]);

  useEffect(() => {
    const unread = notifications.filter((item) => !item.readAt).length;
    setUnreadNotifications(unread);
  }, [notifications]);

  const handleProviderSignIn = async (
    providerId: "google" | "apple" | "facebook" | "microsoft"
  ) => {
    setAuthStatus("");
    setAuthBusy(true);
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
      if (isAuthEmulator) {
        await signInWithRedirect(authClient, provider);
        return;
      }
      try {
        const result = await signInWithPopup(authClient, provider);
        if (result?.user) {
          setUser(result.user);
          setAuthReady(true);
        }
      } catch (error: unknown) {
        // Popups can be blocked (mobile Safari, aggressive privacy settings). Redirect is a reliable fallback.
        const code = getErrorCode(error);
        const shouldFallbackToRedirect =
          code === "auth/popup-blocked" ||
          code === "auth/popup-closed-by-user" ||
          code === "auth/operation-not-supported-in-this-environment";
        if (shouldFallbackToRedirect) {
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
    try {
      if (mode === "create") {
        const result = await createUserWithEmailAndPassword(authClient, trimmedEmail, password);
        if (result?.user) {
          setUser(result.user);
          setAuthReady(true);
        }
      } else {
        const result = await signInWithEmailAndPassword(authClient, trimmedEmail, password);
        if (result?.user) {
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
      localStorage.setItem(EMAIL_LINK_KEY, trimmedEmail);
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
    try {
      const result = await signInWithEmailLink(authClient, trimmedEmail, window.location.href);
      localStorage.removeItem(EMAIL_LINK_KEY);
      setEmailLinkPending(false);
      if (result?.user) {
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
    const result = await signInAnonymously(authClient);
    if (result?.user) {
      setUser(result.user);
      setAuthReady(true);
    }
  };

  const handleSignOut = async () => {
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

  useEffect(() => {
    if (navSection && navSection !== openSection) {
      setOpenSection(navSection);
    }
  }, [navSection, openSection]);

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
    if (nav !== sectionKey) {
      setNav(sectionKey);
    }
    if (navCollapsed) {
      setNavCollapsed(false);
    }
    setOpenSection(sectionKey);
    setMobileNavOpen(false);
  };

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
            onOpenPieces={() => setNav("pieces")}
          />
        );
      case "pieces":
        return (
          <MyPiecesView
            user={user}
            adminToken={devAdminTokenValue}
            isStaff={staffUi}
            onOpenCheckin={() => setNav("reservations")}
          />
        );
      case "profile":
        return (
          <ProfileView
            user={user}
            themeName={themeName}
            onThemeChange={(next) => {
              setThemeName(next);
              writeStoredPortalTheme(next);
            }}
            enhancedMotion={enhancedMotion}
            onEnhancedMotionChange={(next) => {
              setEnhancedMotion(next);
              writeStoredEnhancedMotion(next);
            }}
            onOpenIntegrations={() => setNav("integrations")}
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
            onOpenPieces={() => setNav("pieces")}
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

  return (
    <AppErrorBoundary>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div
        className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`}
        style={PORTAL_THEMES[themeName] ?? PORTAL_THEMES[DEFAULT_PORTAL_THEME]}
      >
        <aside
          className={`sidebar ${mobileNavOpen ? "open" : ""} ${navCollapsed ? "collapsed" : ""}`}
          aria-label="Primary navigation"
        >
          <div
            className="brand brand-home"
            role="button"
            tabIndex={0}
            onClick={() => {
              setNav("dashboard");
              setMobileNavOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setNav("dashboard");
                setMobileNavOpen(false);
              }
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
          </div>
          <nav aria-label="Main navigation">
            <div className="nav-primary">
              {NAV_TOP_ITEMS.map((item) => (
                <button
                  key={item.key}
                  className={`nav-top-item ${nav === item.key ? "active" : ""}`}
                  title={item.label}
                  onClick={() => {
                    setNav(item.key);
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
                        key={item.key}
                        className={`nav-subitem ${nav === item.key ? "active" : ""}`}
                        title={item.label}
                        onClick={() => {
                          setNav(item.key);
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
                  key={item.key}
                  className={nav === item.key ? "active" : ""}
                  title={item.label}
                  onClick={() => {
                    setNav(item.key);
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
              <button
                className="nav-toggle nav-toggle-inline"
                data-collapsed={navCollapsed ? "true" : "false"}
                title={navCollapsed ? "Open nav" : "Collapse nav"}
                onClick={() => {
                  setNavCollapsed((prev) => !prev);
                  setMobileNavOpen(false);
                }}
                aria-label={navCollapsed ? "Open navigation" : "Collapse navigation"}
              >
                <span className="nav-toggle-icon" aria-hidden="true" />
                <span className="nav-label nav-toggle-text">
                  {navCollapsed ? "Open nav" : "Collapse nav"}
                </span>
              </button>
            </div>
          </nav>
          {user && (
            <div className="profile-actions">
              <button
                className="profile-card profile-card-button"
                onClick={() => setNav("profile")}
              >
                <div className="avatar">
                  <span className="avatar-fallback" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                      <path
                        d="M12 12.5a4.25 4.25 0 1 0-4.25-4.25A4.26 4.26 0 0 0 12 12.5Zm0 2c-4.28 0-7.75 2.55-7.75 5.7a.8.8 0 0 0 .8.8h13.9a.8.8 0 0 0 .8-.8c0-3.15-3.47-5.7-7.75-5.7Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName ?? "User"}
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                </div>
                <div className="profile-meta">
                  <strong>{user.displayName ?? "Member"}</strong>
                  <span>{roleLabel}</span>
                </div>
              </button>
              <button
                className="signout-icon"
                onClick={toVoidHandler(handleSignOut, handleAuthHandlerError, "auth.signOut")}
                aria-label="Sign out"
                title="Sign out"
              >
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
          <div className="nav-toggle-row">
            <button className="mobile-nav" onClick={() => setMobileNavOpen((prev) => !prev)}>
              <span className="mobile-nav-icon" aria-hidden="true" />
              Menu
            </button>
          </div>

          {!authReady && (
            <div className="loading">
              <span />
              Loading studio portal
            </div>
          )}

          {authReady ? (
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
              <UiSettingsProvider
                value={{
                  themeName,
                  portalMotion: prefersReducedMotion || !enhancedMotion ? "reduced" : "enhanced",
                  enhancedMotion,
                  prefersReducedMotion,
                }}
              >
                <div key={`${nav}:${themeName}:${enhancedMotion ? "m1" : "m0"}`} className="view-root">
                  {renderView(nav)}
                </div>
              </UiSettingsProvider>
            </React.Suspense>
          ) : null}
        </main>
      </div>
    </AppErrorBoundary>
  );
}


