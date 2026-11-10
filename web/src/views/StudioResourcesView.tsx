import "./StudioResourcesView.css";
import { STUDIO_BOOKINGS_PAUSED } from "../utils/reservationsPaths";
const __bundleClass_0 = "studio-step-button";
const __bundleClass_1 = "studio-step-title";
const __bundleClass_2 = "studio-step-copy";


type Props = {
  onOpenReservations: () => void;
  onOpenPieces: () => void;
  onOpenMaterials: () => void;
  onOpenMembership: () => void;
  onOpenProfile: () => void;
};

export default function StudioResourcesView({
  onOpenReservations,
  onOpenPieces,
  onOpenMaterials,
  onOpenMembership,
  onOpenProfile,
}: Props) {
  return (
    <div className="page studio-resources-page">
      <div className="page-header">
        <div>
          <h1>Studio &amp; Resources</h1>
        </div>
      </div>

      <section className="card card-3d studio-resources-hero">
        <div>
          <div className="card-title">Find your footing</div>
          <p className="studio-resources-copy">
            If you feel a little lost, start with your pieces. Everything else supports that work.
          </p>
          <div className="studio-resources-steps">
            {!STUDIO_BOOKINGS_PAUSED ? <button className={__bundleClass_0} onClick={onOpenReservations}>
              <div className={__bundleClass_1}>Reservations</div>
              <div className={__bundleClass_2}>
                Book throwing, handbuilding, glazing, kitchen, dropoff, or community time through the shared reservation board.
              </div>
            </button> : null}
            <button className={__bundleClass_0} onClick={onOpenPieces}>
              <div className={__bundleClass_1}>My Pieces</div>
              <div className={__bundleClass_2}>
                Track wares, add notes, and keep the studio queue tidy.
              </div>
            </button>
            <button className={__bundleClass_0} onClick={onOpenMaterials}>
              <div className={__bundleClass_1}>Store</div>
              <div className={__bundleClass_2}>
                Stock up on clay and tools so momentum doesn’t stall.
              </div>
            </button>
            <button className={__bundleClass_0} onClick={onOpenMembership}>
              <div className={__bundleClass_1}>Membership</div>
              <div className={__bundleClass_2}>
                See what your plan includes and what’s coming next.
              </div>
            </button>
            <button className={__bundleClass_0} onClick={onOpenProfile}>
              <div className={__bundleClass_1}>Profile &amp; Billing</div>
              <div className={__bundleClass_2}>
                Manage account details and open billing from your profile.
              </div>
            </button>
          </div>
        </div>

        <div className="studio-resources-hero-panel">
          <div className="studio-resources-panel-title">Quick studio checklist</div>
          <ul className="studio-resources-panel-list">
            {!STUDIO_BOOKINGS_PAUSED ? <li>Reserve shared studio time before you commute in.</li> : null}
            <li>Check your pieces for status updates or pickup readiness.</li>
            <li>Restock materials before you run out mid‑session.</li>
            <li>Confirm membership access if you’re changing your studio routine.</li>
            <li>Use Profile to reach billing receipts and payment details.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
