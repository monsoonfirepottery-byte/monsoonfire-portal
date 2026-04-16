import flowImage840Png from "../assets/kiln-rentals-flow-840.png";
import flowImage1200Png from "../assets/kiln-rentals-flow-1200.png";
import flowImage840Webp from "../assets/kiln-rentals-flow-840.webp";
import flowImage1200Webp from "../assets/kiln-rentals-flow-1200.webp";
import "./KilnRentalsView.css";

type Props = {
  onOpenKilnLaunch: () => void;
  onOpenWorkSubmission: () => void;
};

export default function KilnRentalsView({
  onOpenKilnLaunch,
  onOpenWorkSubmission,
}: Props) {
  return (
    <div className="page kiln-rentals-page">
      <div className="page-header">
        <div>
          <h1>Firing Services</h1>
        </div>
      </div>

      <section className="card card-3d kiln-rentals-hero">
        <div>
          <div className="card-title">How to get your stuff fired</div>
          <p className="kiln-rentals-copy">
            Check in fast. Join the queue. Watch confirmed firings take shape from the live queue.
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
                The live kiln view shows what is queued, what is loading, and which firings are
                already confirmed next.
              </div>
            </button>
          </div>
        </div>
        <div className="kiln-rentals-hero-media">
          <picture>
            <source
              type="image/webp"
              srcSet={`${flowImage840Webp} 840w, ${flowImage1200Webp} 1200w`}
              sizes="(min-width: 901px) 420px, 92vw"
            />
            <img
              src={flowImage840Png}
              srcSet={`${flowImage840Png} 840w, ${flowImage1200Png} 1200w`}
              sizes="(min-width: 901px) 420px, 92vw"
              alt="Firing services flow overview"
              loading="lazy"
              decoding="async"
              fetchPriority="low"
            />
          </picture>
        </div>
      </section>
    </div>
  );
}
