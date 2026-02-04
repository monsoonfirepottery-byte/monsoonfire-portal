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
        <p>Coming soon. We are designing this area next.</p>
        <div className="placeholder-grid">
          <div className="placeholder-card" />
          <div className="placeholder-card" />
          <div className="placeholder-card" />
        </div>
      </div>
    </section>
  );
}
