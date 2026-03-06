import "./StudioResourcesView.css";

type Props = {
  onOpenPieces: () => void;
  onOpenMaterials: () => void;
  onOpenMembership: () => void;
  onOpenProfile: () => void;
};

export default function StudioResourcesView({
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
            <button className="studio-step-button" onClick={onOpenPieces}>
              <div className="studio-step-title">1. My Pieces</div>
              <div className="studio-step-copy">
                Track wares, add notes, and keep the studio queue tidy.
              </div>
            </button>
            <button className="studio-step-button" onClick={onOpenMaterials}>
              <div className="studio-step-title">2. Store</div>
              <div className="studio-step-copy">
                Stock up on clay and tools so momentum doesn’t stall.
              </div>
            </button>
            <button className="studio-step-button" onClick={onOpenMembership}>
              <div className="studio-step-title">3. Membership</div>
              <div className="studio-step-copy">
                See what your plan includes and what’s coming next.
              </div>
            </button>
            <button className="studio-step-button" onClick={onOpenProfile}>
              <div className="studio-step-title">4. Profile &amp; Billing</div>
              <div className="studio-step-copy">
                Manage account details and open billing from your profile.
              </div>
            </button>
          </div>
        </div>

        <div className="studio-resources-hero-panel">
          <div className="studio-resources-panel-title">Quick studio checklist</div>
          <ul className="studio-resources-panel-list">
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
