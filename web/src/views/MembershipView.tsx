import type { User } from "firebase/auth";
import "./MembershipView.css";

const EOL_DATE_LABEL = "May 31, 2026";

export default function MembershipView({ user }: { user: User }) {
  const accountLabel = user.email ?? user.displayName ?? "your account";

  return (
    <div className="page membership-page">
      <div className="page-header">
        <div>
          <h1>Membership decommission</h1>
        </div>
      </div>

      <section className="card card-3d membership-journey">
        <div className="journey-head">
          <div>
            <div className="card-title">May 2026 transition</div>
            <p className="membership-copy">
              Membership and reservation tools are being decommissioned during May 2026 and reach
              end-of-life on {EOL_DATE_LABEL}.
            </p>
          </div>
        </div>

        <div className="journey-now">
          <div className="journey-card current">
            <div className="journey-card-top">
              <span className="journey-label">Signed in</span>
              <span className="pill">Transition</span>
            </div>
            <div className="journey-card-title">{accountLabel}</div>
            <div className="journey-card-copy">
              New changes are no longer self-service here. Use Support for billing questions,
              archive requests, or transition help tied to this account.
            </div>
          </div>

          <div className="journey-card next">
            <div className="journey-card-top">
              <span className="journey-label">What to use now</span>
            </div>
            <div className="journey-card-title">Studio workflows</div>
            <div className="journey-card-copy">
              Continue using Active, History, Continue Journey, Timeline, and Support for current
              studio work.
            </div>
          </div>
        </div>
      </section>

      <section className="card card-3d membership-features">
        <div className="card-title">Transition support</div>
        <p className="membership-copy">
          Staff can help with legacy record exports, billing questions, and access planning while
          the old tools wind down.
        </p>
      </section>
    </div>
  );
}
