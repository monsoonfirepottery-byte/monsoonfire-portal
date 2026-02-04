type Props = {
  onSignIn: () => void;
};

export default function SignedOutView({ onSignIn }: Props) {
  return (
    <div className="signed-out">
      <div className="signed-out-card">
        <div className="signed-out-logo" aria-hidden="true" />
        <h1>Monsoon Fire Pottery Studio</h1>
        <p>Sign in to access your dashboard, pieces, and studio updates.</p>
        <button className="primary" onClick={onSignIn}>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
