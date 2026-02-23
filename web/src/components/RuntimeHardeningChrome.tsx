import { useEffect, useMemo, useState, type ReactNode } from "react";
import ErrorBanner from "./ErrorBanner";
import type { AppError } from "../errors/appError";
import { toAppError } from "../errors/appError";
import { safeReadBoolean, safeStorageSetItem } from "../lib/safeStorage";
import {
  getLatestRequestTelemetry,
  subscribeRequestTelemetry,
  type RequestTelemetry,
} from "../lib/requestTelemetry";

type Props = {
  children: ReactNode;
};

const ADVANCED_TOGGLE_KEY = "mf_runtime_advanced_panel";

function readBooleanSetting(key: string): boolean {
  return safeReadBoolean("localStorage", key, false);
}

function writeBooleanSetting(key: string, value: boolean): void {
  safeStorageSetItem("localStorage", key, value ? "1" : "0");
}

function copyToClipboard(text: string): Promise<void> {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) {
    return Promise.reject(new Error("Clipboard is not available in this environment."));
  }
  return navigator.clipboard.writeText(text);
}

export default function RuntimeHardeningChrome({ children }: Props) {
  const [isOnline, setIsOnline] = useState(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });
  const [runtimeError, setRuntimeError] = useState<AppError | null>(null);
  const [lastRequest, setLastRequest] = useState<RequestTelemetry | null>(() =>
    getLatestRequestTelemetry()
  );
  const [advancedOpen, setAdvancedOpen] = useState(() => readBooleanSetting(ADVANCED_TOGGLE_KEY));
  const [copyStatus, setCopyStatus] = useState("");

  const showInspector = import.meta.env.DEV || advancedOpen;
  const requestDump = useMemo(
    () => (lastRequest ? JSON.stringify(lastRequest, null, 2) : ""),
    [lastRequest]
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    return subscribeRequestTelemetry((entry) => {
      setLastRequest(entry);
    });
  }, []);

  useEffect(() => {
    writeBooleanSetting(ADVANCED_TOGGLE_KEY, advancedOpen);
  }, [advancedOpen]);

  useEffect(() => {
    const onUnhandledError = (event: ErrorEvent) => {
      setRuntimeError(
        toAppError(event.error ?? event.message, {
          retryable: true,
          debugMessage: event.message || "Unhandled runtime error",
        })
      );
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      // We surface this in-app via RuntimeHardeningChrome; prevent duplicate "Uncaught (in promise)"
      // console spam once captured.
      event.preventDefault();
      setRuntimeError(
        toAppError(event.reason, {
          retryable: true,
          debugMessage:
            event.reason instanceof Error ? event.reason.message : String(event.reason ?? "Unhandled rejection"),
        })
      );
    };

    window.addEventListener("error", onUnhandledError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onUnhandledError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const offlineError = useMemo(() => {
    if (isOnline) return null;
    return toAppError("Offline", {
      kind: "network",
      retryable: true,
      userMessage: "You are offline. Reconnect to continue, then try again.",
      debugMessage: "navigator.onLine returned false",
    });
  }, [isOnline]);

  return (
    <div className="runtime-hardening-shell">
      {offlineError ? (
        <ErrorBanner
          error={offlineError}
          title="Offline mode detected"
          onRetry={() => window.location.reload()}
          showDebug={import.meta.env.DEV}
        />
      ) : null}

      {runtimeError ? (
        <ErrorBanner
          error={runtimeError}
          title="Unexpected runtime issue"
          onRetry={() => window.location.reload()}
          onDismiss={() => setRuntimeError(null)}
          showDebug={import.meta.env.DEV}
        />
      ) : null}

      {children}

      <div className="runtime-hardening-tools">
        {!import.meta.env.DEV ? (
          <button
            type="button"
            className="runtime-hardening-toggle"
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            {advancedOpen ? "Hide advanced diagnostics" : "Advanced diagnostics"}
          </button>
        ) : null}

        {showInspector ? (
          <details className="runtime-request-panel">
            <summary>Last request diagnostics</summary>
            {!lastRequest ? (
              <p className="runtime-request-empty">No requests captured yet.</p>
            ) : (
              <div className="runtime-request-body">
                <div className="runtime-request-grid">
                  <div>When</div>
                  <div>{lastRequest.atIso}</div>
                  <div>Source</div>
                  <div>{lastRequest.source}</div>
                  <div>Request ID</div>
                  <div>{lastRequest.requestId}</div>
                  <div>Status</div>
                  <div>
                    {typeof lastRequest.status === "number"
                      ? `${lastRequest.status} ${lastRequest.ok ? "(ok)" : "(error)"}`
                      : "pending"}
                  </div>
                </div>
                <div className="runtime-request-subtitle">Endpoint</div>
                <pre>{`${lastRequest.method} ${lastRequest.endpoint}`}</pre>
                <div className="runtime-request-subtitle">Payload (redacted)</div>
                <pre>{JSON.stringify(lastRequest.payload, null, 2)}</pre>
                <div className="runtime-request-subtitle">Response snippet</div>
                <pre>{lastRequest.responseSnippet || "(empty)"}</pre>
                {typeof lastRequest.authFailureReason === "string" && lastRequest.authFailureReason ? (
                  <>
                    <div className="runtime-request-subtitle">Auth failure reason</div>
                    <pre>{lastRequest.authFailureReason}</pre>
                  </>
                ) : null}
                {lastRequest.error ? (
                  <>
                    <div className="runtime-request-subtitle">Error</div>
                    <pre>{lastRequest.error}</pre>
                  </>
                ) : null}
                <div className="runtime-request-subtitle">Curl (redacted)</div>
                <pre>{lastRequest.curl || "(not available)"}</pre>
                <div className="runtime-request-actions">
                  <button
                    type="button"
                    onClick={() => {
                      void copyToClipboard(requestDump)
                        .then(() => setCopyStatus("Copied request JSON."))
                        .catch((error: unknown) =>
                          setCopyStatus(
                            `Copy failed: ${
                              error instanceof Error ? error.message : String(error ?? "unknown")
                            }`
                          )
                        );
                    }}
                    disabled={!requestDump}
                  >
                    Copy request JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void copyToClipboard(lastRequest.curl || "")
                        .then(() => setCopyStatus("Copied curl command."))
                        .catch((error: unknown) =>
                          setCopyStatus(
                            `Copy failed: ${
                              error instanceof Error ? error.message : String(error ?? "unknown")
                            }`
                          )
                        );
                    }}
                    disabled={!lastRequest.curl}
                  >
                    Copy curl
                  </button>
                </div>
                {copyStatus ? <div className="runtime-request-copy-status">{copyStatus}</div> : null}
              </div>
            )}
          </details>
        ) : null}
      </div>
    </div>
  );
}
