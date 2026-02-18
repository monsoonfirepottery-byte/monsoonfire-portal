import type { User } from "firebase/auth";
import StudioBrainModule from "./staff/StudioBrainModule";

type Props = {
  user: User;
  adminToken: string;
  isHouseManager: boolean;
  isHouseMember: boolean;
  isHouseGuest: boolean;
  onNavigate: (next: string) => void;
};

const QUICK_LINKS: Array<{ key: string; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "reservations", label: "Reservations" },
  { key: "kiln", label: "Kiln schedule" },
  { key: "kilnLaunch", label: "Queue management" },
  { key: "messages", label: "Messages" },
  { key: "membership", label: "Membership" },
  { key: "glazes", label: "Glazes" },
];

export default function HouseView({
  user,
  adminToken,
  isHouseManager,
  isHouseMember,
  isHouseGuest,
  onNavigate,
}: Props) {
  const roleLabel = isHouseManager ? "Manager" : isHouseMember ? "Member" : "Guest";
  const readOnlyStudioBrain = !isHouseManager;

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">House</div>
        <button className="btn btn-ghost" onClick={() => onNavigate("dashboard")}>
          Open Dashboard
        </button>
      </div>
      <div className="staff-note">
        Welcome to the house hub. Your role is <strong>{roleLabel}</strong>. Use this view for shared studio context plus
        operational status.
      </div>

      <div className="staff-subtitle">Quick links</div>
      <div className="staff-module-grid">
        {QUICK_LINKS.map((entry) => (
          <button
            key={entry.key}
            className="staff-module-btn"
            onClick={() => onNavigate(entry.key)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="staff-subtitle">Studio Brain</div>
      <StudioBrainModule
        user={user}
        active={isHouseManager || isHouseMember || isHouseGuest}
        disabled={false}
        adminToken={adminToken}
        readOnly={readOnlyStudioBrain}
      />

      {isHouseGuest && (
        <div className="staff-note">
          You are viewing Studio Brain in house-read-only mode. Ask a house manager for Studio-wide governance actions.
        </div>
      )}
    </section>
  );
}
