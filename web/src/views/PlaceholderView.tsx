type Props = {
  title: string;
  subtitle: string;
};

export default function PlaceholderView({ title, subtitle }: Props) {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      <div className="panel-body placeholder">
        <p className="placeholder-copy">
          This area is not ready for live studio work yet. If you expected something active here,
          head back to the dashboard and message the studio so we can route you correctly.
        </p>
        <div className="placeholder-actions">
          <a className="btn btn-primary" href="/">
            Return to dashboard
          </a>
          <a className="btn btn-ghost" href="mailto:support@monsoonfire.com">
            Contact support
          </a>
        </div>
        <div className="placeholder-grid">
          <div className="placeholder-card" />
          <div className="placeholder-card" />
          <div className="placeholder-card" />
        </div>
      </div>
    </section>
  );
}
