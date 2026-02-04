import flowImage from "../assets/kiln-rentals-flow.png";
import "./KilnRentalsView.css";

type Props = {
  onOpenKilnLaunch: () => void;
  onOpenKilnSchedule: () => void;
  onOpenWorkSubmission: () => void;
};

export default function KilnRentalsView({
  onOpenKilnLaunch,
  onOpenKilnSchedule,
  onOpenWorkSubmission,
}: Props) {
  return (
    <div className="page kiln-rentals-page">
      <div className="page-header">
        <div>
          <h1>Kiln Rentals</h1>
          <p className="page-subtitle">
            Everything you need to submit work, join the load queue, and track upcoming firings.
            Use the overview to understand the flow, then jump into the subpages to take action.
          </p>
        </div>
      </div>

      <section className="card card-3d kiln-rentals-hero">
        <div>
          <div className="card-title">How to get your stuff fired</div>
          <p className="kiln-rentals-copy">
            Check in fast. Join the queue. Track the firing.
          </p>
          <div className="kiln-rentals-steps">
            <button className="kiln-step-button" onClick={onOpenWorkSubmission}>
              <div className="kiln-step-title">1. Ware Check-in</div>
              <div className="kiln-step-copy">
                Check in with staff at the studio, or self-check-in ahead of time so drop-off is
                quick and calm.
              </div>
            </button>
            <button className="kiln-step-button" onClick={onOpenKilnLaunch}>
              <div className="kiln-step-title">2. View the Queues</div>
              <div className="kiln-step-copy">
                The live, gamified queue—see the whole studio load, fill shelves together, and
                rally the next firing.
              </div>
            </button>
            <button className="kiln-step-button" onClick={onOpenKilnSchedule}>
              <div className="kiln-step-title">3. Firings</div>
              <div className="kiln-step-copy">
                The long-view plan of what is coming next and what has already fired.
              </div>
            </button>
          </div>
        </div>
        <div className="kiln-rentals-hero-media">
          <img src={flowImage} alt="Kiln rentals flow overview" />
        </div>
      </section>
    </div>
  );
}
