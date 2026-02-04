import React, { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Announcement, DirectMessageThread, LiveUser } from "./types/messaging";
import type { SupportRequestInput } from "./views/SupportView";
import { portalTheme } from "./theme/themes";
import "./App.css";

const BillingView = React.lazy(() => import("./views/BillingView"));
const CommunityView = React.lazy(() => import("./views/CommunityView"));
const DashboardView = React.lazy(() => import("./views/DashboardView"));
const EventsView = React.lazy(() => import("./views/EventsView"));
const KilnLaunchView = React.lazy(() => import("./views/KilnLaunchView"));
const KilnRentalsView = React.lazy(() => import("./views/KilnRentalsView"));
const KilnScheduleView = React.lazy(() => import("./views/KilnScheduleView"));
const LendingLibraryView = React.lazy(() => import("./views/LendingLibraryView"));
const GlazeBoardView = React.lazy(() => import("./views/GlazeBoardView"));
const MembershipView = React.lazy(() => import("./views/MembershipView"));
const MaterialsView = React.lazy(() => import("./views/MaterialsView"));
const MessagesView = React.lazy(() => import("./views/MessagesView"));
const MyPiecesView = React.lazy(() => import("./views/MyPiecesView"));
const PlaceholderView = React.lazy(() => import("./views/PlaceholderView"));
const ProfileView = React.lazy(() => import("./views/ProfileView"));
const ReservationsView = React.lazy(() => import("./views/ReservationsView"));
const SignedOutView = React.lazy(() => import("./views/SignedOutView"));
const StudioResourcesView = React.lazy(() => import("./views/StudioResourcesView"));
const SupportView = React.lazy(() => import("./views/SupportView"));

type NavKey =
  | "dashboard"
  | "profile"
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

const NAV_TOP_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
];

const NAV_BOTTOM_ITEMS: NavItem[] = [
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
  messages: "Messages",
  support: "Support",
  staff: "Staff",
};

const SESSION_ADMIN_TOKEN_KEY = "mf_dev_admin_token";
const LOCAL_NAV_KEY = "mf_nav_key";
const LOCAL_NAV_SECTION_KEY = "mf_nav_section_key";
const LOCAL_NAV_COLLAPSED_KEY = "mf_nav_collapsed";
const SUPPORT_EMAIL = "support@monsoonfire.com";
const MF_LOGO = "/branding/logo.png";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const FUNCTIONS_BASE_URL =
  typeof import.meta !== "undefined" &&
  (import.meta as any).env &&
  (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
    ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
    : DEFAULT_FUNCTIONS_BASE_URL;
const DEV_ADMIN_TOKEN_ENABLED =
  typeof import.meta !== "undefined" &&
  (import.meta as any).env?.DEV === true &&
  (import.meta as any).env?.VITE_ENABLE_DEV_ADMIN_TOKEN === "true" &&
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

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message || String(err) };
  }
  componentDidCatch(err: any) {
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", err);
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
          ...(docSnap.data() as any),
        }));
        setUsers(rows.filter((liveUser) => liveUser.id !== user.uid && liveUser.isActive !== false));
      } catch (err: any) {
        if (!canceled) setError(`Users failed: ${err.message || String(err)}`);
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
          ...(docSnap.data() as any),
        }));
        setThreads(rows);
      } catch (err: any) {
        if (!canceled) setError(`Direct messages failed: ${err.message || String(err)}`);
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
          ...(docSnap.data() as any),
        }));
        setAnnouncements(rows);
      } catch (err: any) {
        if (!canceled) setError(`Announcements failed: ${err.message || String(err)}`);
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
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
  const [supportStatus, setSupportStatus] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);

  const authClient = auth;
  const devAdminActive = DEV_ADMIN_TOKEN_ENABLED && devAdminToken.trim().length > 0;
  const staffUi = isStaff || devAdminActive;
  const devAdminTokenValue = devAdminActive ? devAdminToken.trim() : "";

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
    const unsub = onAuthStateChanged(authClient, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) setNav("dashboard");
    });
    return () => unsub();
  }, [authClient]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setIsStaff(false);
      return () => {
        cancelled = true;
      };
    }

    user
      .getIdTokenResult()
      .then((result) => {
        if (cancelled) return;
        const claims: any = result.claims ?? {};
        const roles = Array.isArray(claims.roles) ? claims.roles : [];
        const staff = claims.staff === true || roles.includes("staff");
        setIsStaff(staff);
      })
      .catch(() => {
        if (!cancelled) setIsStaff(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const { users: liveUsers, loading: liveUsersLoading, error: liveUsersError } = useLiveUsers(
    user,
    isStaff
  );
  const { threads, loading: threadsLoading, error: threadsError } = useDirectMessages(user);
  const {
    announcements,
    loading: announcementsLoading,
    error: announcementsError,
  } = useAnnouncements(user);

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

  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(authClient, provider);
  };

  const handleSignOut = async () => {
    await signOut(authClient);
    setNav("dashboard");
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
    } catch (err: any) {
      setSupportStatus(`Support request failed: ${err?.message || String(err)}`);
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
      return <SignedOutView onSignIn={handleSignIn} />;
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
            onOpenStudioResources={() => setNav("studioResources")}
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
        return <ProfileView user={user} />;
      case "community":
        return <CommunityView onOpenLendingLibrary={() => setNav("lendingLibrary")} />;
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
        return <KilnScheduleView />;
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
      <div className={`app-shell ${navCollapsed ? "nav-collapsed" : ""}`} style={portalTheme}>
        <aside className={`sidebar ${mobileNavOpen ? "open" : ""} ${navCollapsed ? "collapsed" : ""}`}>
          <div className="brand">
            <img src={MF_LOGO} alt="Monsoon Fire Pottery Studio" />
            <div>
              <h1>Monsoon Fire</h1>
              <span>Pottery Studio</span>
            </div>
          </div>
          <nav>
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
                    title={section.title}
                    onClick={() => handleSectionToggle(section.key)}
                  >
                    <span className="nav-icon">{NAV_SECTION_ICONS[section.key]}</span>
                    <span className="nav-label">{section.title}</span>
                  </button>
                  <div
                    className="nav-section-items"
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
              {NAV_BOTTOM_ITEMS.map((item) => (
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
                  {user.photoURL ? <img src={user.photoURL} alt={user.displayName ?? "User"} /> : null}
                </div>
                <div className="profile-meta">
                  <strong>{user.displayName ?? "Member"}</strong>
                  <span>{roleLabel}</span>
                </div>
              </button>
              <button
                className="signout-icon"
                onClick={handleSignOut}
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
          {user && DEV_ADMIN_TOKEN_ENABLED ? (
            <div className="admin-token">
              <label htmlFor="admin-token-input">Dev admin token (emulator only)</label>
              <input
                id="admin-token-input"
                type="password"
                value={devAdminToken}
                placeholder="Paste token"
                onChange={(event) => setDevAdminToken(event.target.value)}
              />
              <p>Stored for this browser session only. Disabled in production.</p>
            </div>
          ) : null}
        </aside>

        <main className="main">
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
              {renderView(nav)}
            </React.Suspense>
          ) : null}
        </main>
      </div>
    </AppErrorBoundary>
  );
}


