import React from "react";
import ErrorBanner from "./ErrorBanner";
import { toAppError } from "../errors/appError";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: unknown;
  supportCode: string;
};

const STORAGE_PREFIXES = ["mf_", "mf:"];

function clearPortalStorage() {
  const clearByPrefix = (store: Storage) => {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key) continue;
      if (STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keys.push(key);
      }
    }
    keys.forEach((key) => store.removeItem(key));
  };

  try {
    clearByPrefix(window.localStorage);
  } catch {
    // Ignore storage errors.
  }
  try {
    clearByPrefix(window.sessionStorage);
  } catch {
    // Ignore storage errors.
  }
}

export default class RootErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, supportCode: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const appError = toAppError(error, { retryable: true });
    return {
      error: appError,
      supportCode: appError.correlationId,
    };
  }

  componentDidCatch(error: unknown): void {
    console.error("RootErrorBoundary caught runtime error", error);
  }

  handleResetAndReload = (): void => {
    clearPortalStorage();
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="root-error-screen">
        <div className="root-error-card">
          <h1>Monsoon Fire Portal</h1>
          <ErrorBanner
            error={this.state.error}
            title="The app ran into an unexpected error"
            onRetry={() => window.location.reload()}
            showDebug={import.meta.env.DEV}
          />
          <div className="root-error-actions">
            <button type="button" className="root-error-btn" onClick={() => window.location.reload()}>
              Reload app
            </button>
            <button type="button" className="root-error-btn secondary" onClick={this.handleResetAndReload}>
              Safe reset and reload
            </button>
          </div>
          <p className="root-error-meta">Support code: {this.state.supportCode || "unknown"}</p>
        </div>
      </main>
    );
  }
}

