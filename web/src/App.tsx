import React, { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Announcement, DirectMessageThread, LiveUser } from "./types/messaging";
import DashboardView from "./views/DashboardView";
import KilnScheduleView from "./views/KilnScheduleView";
import MessagesView from "./views/MessagesView";
import MyPiecesView from "./views/MyPiecesView";
import PlaceholderView from "./views/PlaceholderView";
import ProfileView from "./views/ProfileView";
import ReservationsView from "./views/ReservationsView";
import SignedOutView from "./views/SignedOutView";
import SupportView, { type SupportRequestInput } from "./views/SupportView";
import "./App.css";

type NavKey =
  | "dashboard"
  | "profile"
  | "pieces"
  | "kiln"
  | "classes"
  | "reservations"
  | "events"
  | "membership"
  | "billing"
  | "messages"
  | "support"
  | "staff";

type NavItem = {
  key: NavKey;
  label: string;
  hint?: string;
};

type UserRole = "client" | "staff";

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "profile", label: "Profile" },
  { key: "pieces", label: "My Pieces" },
  { key: "kiln", label: "Kiln Schedule" },
  { key: "classes", label: "Classes" },
  { key: "reservations", label: "Reservations" },
  { key: "events", label: "Events" },
  { key: "membership", label: "Membership" },
  { key: "billing", label: "Billing" },
  { key: "messages", label: "Messages" },
  { key: "support", label: "Support" },
];

const LOCAL_ADMIN_TOKEN_KEY = "mf_admin_token";
const SUPPORT_EMAIL = "support@monsoonfire.com";
const MF_LOGO = "/branding/logo.png";

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

function useLiveUsers(user: User | null) {
  const [users, setUsers] = useState<LiveUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setUsers([]);
      return;
    }

    setLoading(true);
    setError("");

    const usersQuery = query(collection(db, "users"), orderBy("displayName", "asc"), limit(100));

    const unsub = onSnapshot(
      usersQuery,
      (snap) => {
        const rows: LiveUser[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setUsers(rows.filter((liveUser) => liveUser.id !== user.uid && liveUser.isActive !== false));
        setLoading(false);
      },
      (err) => {
        setError(`Users failed: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  return { users, loading, error };
}

function useDirectMessages(user: User | null) {
  const [threads, setThreads] = useState<DirectMessageThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setThreads([]);
      return;
    }

    setLoading(true);
    setError("");

    const threadsQuery = query(
      collection(db, "directMessages"),
      where("participantUids", "array-contains", user.uid),
      orderBy("lastMessageAt", "desc"),
      limit(50)
    );

    const unsub = onSnapshot(
      threadsQuery,
      (snap) => {
        const rows: DirectMessageThread[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setThreads(rows);
        setLoading(false);
      },
      (err) => {
        setError(`Direct messages failed: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  return { threads, loading, error };
}

function useAnnouncements(user: User | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) {
      setAnnouncements([]);
      return;
    }

    setLoading(true);
    setError("");

    const announcementsQuery = query(
      collection(db, "announcements"),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      announcementsQuery,
      (snap) => {
        const rows: Announcement[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setAnnouncements(rows);
        setLoading(false);
      },
      (err) => {
        setError(`Announcements failed: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  return { announcements, loading, error };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [nav, setNav] = useState<NavKey>("dashboard");
  const [adminToken, setAdminToken] = useState("" as string);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [role, setRole] = useState<UserRole>("client");
  const [unreadAnnouncements, setUnreadAnnouncements] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [supportStatus, setSupportStatus] = useState("");
  const [supportBusy, setSupportBusy] = useState(false);

  const authClient = auth;

  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_ADMIN_TOKEN_KEY);
    if (saved) {
      setAdminToken(saved);
    }
  }, []);

  useEffect(() => {
    if (adminToken) {
      localStorage.setItem(LOCAL_ADMIN_TOKEN_KEY, adminToken);
    } else {
      localStorage.removeItem(LOCAL_ADMIN_TOKEN_KEY);
    }
  }, [adminToken]);

  useEffect(() => {
    const unsub = onAuthStateChanged(authClient, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsub();
  }, [authClient]);

  const { users: liveUsers, loading: liveUsersLoading, error: liveUsersError } = useLiveUsers(user);
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
      const hasUnread = thread.participants?.some(
        (participant) => participant.uid !== user.uid && participant.hasUnread
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

  const messagesBody = (
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

  const renderBody = () => {
    if (!user) {
      return <SignedOutView onSignIn={handleSignIn} />;
    }

    switch (nav) {
      case "dashboard":
        return (
          <DashboardView
            user={user}
            name={user.displayName ?? "Member"}
            threads={threads}
            announcements={announcements}
            unreadTotal={unreadMessages + unreadAnnouncements}
            onOpenMessages={() => setNav("messages")}
            onOpenPieces={() => setNav("pieces")}
          />
        );
      case "pieces":
        return <MyPiecesView user={user} adminToken={adminToken} />;
      case "profile":
        return <ProfileView user={user} />;
      case "reservations":
        return <ReservationsView user={user} />;
      case "kiln":
        return <KilnScheduleView />;
      case "messages":
        return messagesBody;
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
            title={NAV_ITEMS.find((item) => item.key === nav)?.label ?? "Page"}
            subtitle="We are building this area now."
          />
        );
    }
  };

  return (
    <AppErrorBoundary>
      <div className="app-shell">
        <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
          <div className="brand">
            <img src={MF_LOGO} alt="Monsoon Fire Pottery Studio" />
            <div>
              <h1>Monsoon Fire</h1>
              <span>Pottery Studio</span>
            </div>
          </div>
          <nav>
            <div className="nav-title">Navigation</div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                className={nav === item.key ? "active" : ""}
                onClick={() => {
                  setNav(item.key);
                  setMobileNavOpen(false);
                }}
              >
                {item.label}
                {item.key === "messages" && unreadMessages + unreadAnnouncements > 0 ? (
                  <span className="badge">{unreadMessages + unreadAnnouncements}</span>
                ) : null}
              </button>
            ))}
          </nav>
          {user && (
            <div className="profile-card">
              <div className="avatar">
                {user.photoURL ? <img src={user.photoURL} alt={user.displayName ?? "User"} /> : null}
              </div>
              <div>
                <strong>{user.displayName ?? "Member"}</strong>
                <span>{role === "client" ? "Client" : "Staff"}</span>
              </div>
            </div>
          )}
          {user && (
            <div className="admin-token">
              <label htmlFor="admin-token-input">Dev Admin Token</label>
              <input
                id="admin-token-input"
                type="password"
                value={adminToken}
                placeholder="Paste token"
                onChange={(event) => setAdminToken(event.target.value)}
              />
              <p>Stored locally for this device only.</p>
            </div>
          )}
          {user ? (
            <button className="signout" onClick={handleSignOut}>
              Sign out
            </button>
          ) : null}
          {user && (
            <button
              className="profile-link"
              onClick={() => {
                setNav("profile");
                setMobileNavOpen(false);
              }}
            >
              <span className="profile-link-icon" aria-hidden="true" />
              Profile & settings
            </button>
          )}
        </aside>

        <main className="main">
          <header className="topbar">
            <div className="topbar-left">
              <button className="mobile-nav" onClick={() => setMobileNavOpen((prev) => !prev)}>
                Menu
              </button>
              <div>
                <h2>{NAV_ITEMS.find((item) => item.key === nav)?.label ?? "Dashboard"}</h2>
                <span>Phoenix studio overview</span>
              </div>
            </div>
            {user ? (
              <div className="topbar-actions">
                <button className="pill profile-pill" onClick={() => setNav("profile")} aria-label="Profile">
                  <span className="profile-pill-avatar" aria-hidden="true">
                    {user.photoURL ? <img src={user.photoURL} alt={user.displayName ?? "User"} /> : user.displayName?.[0] ?? "?"}
                  </span>
                  Profile
                </button>
                <button className="pill" onClick={() => setNav("messages")} aria-label="Notifications">
                  <span className="bell" aria-hidden="true" />
                  {unreadMessages + unreadAnnouncements > 0 ? (
                    <span className="badge">{unreadMessages + unreadAnnouncements}</span>
                  ) : null}
                </button>
                <button
                  className="pill role"
                  onClick={() => setRole((prev) => (prev === "client" ? "staff" : "client"))}
                >
                  {role === "client" ? "Client" : "Staff"}
                </button>
                <button className="ghost" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : null}
          </header>

          {!authReady && (
            <div className="loading">
              <span />
              Loading studio portal
            </div>
          )}

          {authReady && renderBody()}
        </main>
      </div>
    </AppErrorBoundary>
  );
}
