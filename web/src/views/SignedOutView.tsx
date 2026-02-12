import { useMemo, useState } from "react";

type ProviderId = "google" | "apple" | "facebook" | "microsoft";

type Props = {
  onProviderSignIn: (provider: ProviderId) => void;
  onEmailPassword: (email: string, password: string, mode: "signin" | "create") => void;
  onEmailLink: (email: string) => void;
  onCompleteEmailLink: (email: string) => void;
  emailLinkPending?: boolean;
  status?: string;
  busy?: boolean;
  onEmulatorSignIn?: () => void;
  showEmulatorTools?: boolean;
};

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "google", label: "Continue with Google" },
  { id: "apple", label: "Continue with Apple" },
  { id: "facebook", label: "Continue with Facebook" },
  { id: "microsoft", label: "Continue with Microsoft" },
];

const ProviderIcon = ({ id }: { id: ProviderId }) => {
  switch (id) {
    case "google":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M21.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3.1v2.6h3.2c1.9-1.7 2.9-4.2 2.9-7.5z"
            fill="currentColor"
          />
          <path
            d="M12 22c2.7 0 5-0.9 6.7-2.4l-3.2-2.6c-.9.6-2 .9-3.5.9-2.7 0-5-1.8-5.8-4.3H2.9v2.7A10 10 0 0 0 12 22z"
            fill="currentColor"
          />
          <path
            d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.9a10 10 0 0 0 0 9.8l3.3-2.7z"
            fill="currentColor"
          />
          <path
            d="M12 6.1c1.5 0 2.9.5 3.9 1.6l2.9-2.9A9.9 9.9 0 0 0 12 2a10 10 0 0 0-9.1 5.1l3.3 2.7c.8-2.5 3.1-4.3 5.8-4.3z"
            fill="currentColor"
          />
        </svg>
      );
    case "apple":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M16.6 13.2c0 2.3 2 3.1 2 3.1s-1.5 4.3-3.6 4.3c-1 0-1.7-.7-2.7-.7-1 0-1.9.7-2.7.7-2.1 0-4.3-4-4.3-7.3 0-3.3 2.1-5 4-5 .9 0 1.8.6 2.4.6.6 0 1.7-.7 2.9-.7.5 0 2.1.1 3.2 1.7-.1.1-2 1.2-2 3.3z"
            fill="currentColor"
          />
          <path
            d="M14.9 3.4c.7-.8 1.1-2 1-3.4-1 .1-2.2.7-2.9 1.5-.7.8-1.2 2-1.1 3.2 1 .1 2.2-.5 3-1.3z"
            fill="currentColor"
          />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M14 8.5V7c0-.9.6-1.1 1-1.1h1.7V3.1h-2.4c-2.6 0-3.3 2-3.3 3.3v2.1H9.2v2.8H11V22h3V11.3h2.3l.4-2.8H14z"
            fill="currentColor"
          />
        </svg>
      );
    case "microsoft":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 3h8v8H3z" fill="currentColor" />
          <path d="M13 3h8v8h-8z" fill="currentColor" />
          <path d="M3 13h8v8H3z" fill="currentColor" />
          <path d="M13 13h8v8h-8z" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
};

export default function SignedOutView({
  onProviderSignIn,
  onEmailPassword,
  onEmailLink,
  onCompleteEmailLink,
  emailLinkPending,
  status,
  busy,
  onEmulatorSignIn,
  showEmulatorTools,
}: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailMode, setEmailMode] = useState<"signin" | "create">("signin");
  const [linkEmail, setLinkEmail] = useState("");

  const trimmedEmail = useMemo(() => email.trim(), [email]);
  const trimmedLinkEmail = useMemo(() => linkEmail.trim(), [linkEmail]);

  return (
    <div className="signed-out">
      <div className="signed-out-card">
        <div className="signed-out-logo" aria-hidden="true" />
        <h1>Monsoon Fire Pottery Studio</h1>
        <p>Sign in to access your dashboard, pieces, and studio updates.</p>

        <div className="signed-out-providers">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              className={`provider-btn provider-${provider.id}`}
              onClick={() => onProviderSignIn(provider.id)}
              disabled={busy}
            >
              <span className="provider-icon" aria-hidden="true">
                <ProviderIcon id={provider.id} />
              </span>
              <span>{provider.label}</span>
            </button>
          ))}
        </div>

        <div className="signed-out-divider">
          <span>Or use email</span>
        </div>

        <div className="signed-out-email">
          <div className="signed-out-toggle">
            <button
              type="button"
              className={emailMode === "signin" ? "active" : ""}
              onClick={() => setEmailMode("signin")}
              disabled={busy}
            >
              Sign in
            </button>
            <button
              type="button"
              className={emailMode === "create" ? "active" : ""}
              onClick={() => setEmailMode("create")}
              disabled={busy}
            >
              Create account
            </button>
          </div>

          <label className="signed-out-field">
            Email
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              disabled={busy}
            />
          </label>
          <label className="signed-out-field">
            Password
            <input
              type="password"
              value={password}
              placeholder="Enter a password"
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={emailMode === "create" ? "new-password" : "current-password"}
              disabled={busy}
            />
          </label>
          <button
            className="primary"
            onClick={() => onEmailPassword(trimmedEmail, password, emailMode)}
            disabled={busy}
          >
            {emailMode === "create" ? "Create account" : "Sign in"}
          </button>
        </div>

        <div className="signed-out-divider compact">
          <span>Prefer a sign-in link?</span>
        </div>

        <div className="signed-out-email-link">
          <label className="signed-out-field">
            Email for link
            <input
              type="email"
              value={linkEmail}
              placeholder="you@example.com"
              onChange={(event) => setLinkEmail(event.target.value)}
              autoComplete="email"
              disabled={busy}
            />
          </label>
          <button
            className="secondary"
            onClick={() => onEmailLink(trimmedLinkEmail)}
            disabled={busy}
          >
            Email me a sign-in link
          </button>
          {emailLinkPending ? (
            <button
              className="btn btn-ghost"
              onClick={() => onCompleteEmailLink(trimmedLinkEmail)}
              disabled={busy}
            >
              Finish sign-in from link
            </button>
          ) : null}
        </div>

        {status ? (
          <div className="signed-out-status" role="status" aria-live="polite">
            {status}
          </div>
        ) : null}

        {showEmulatorTools && onEmulatorSignIn ? (
          <div className="signed-out-dev">
            <div className="signed-out-dev-title">Emulator tools</div>
            <button className="secondary" onClick={onEmulatorSignIn} disabled={busy}>
              Sign in (emulator)
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
