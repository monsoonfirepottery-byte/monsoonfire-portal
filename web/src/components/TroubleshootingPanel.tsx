// src/components/TroubleshootingPanel.tsx
import type { LastRequest } from "../api/functionsClient";
import { safeJsonStringify } from "../api/functionsClient";
import { toVoidHandler } from "../utils/toVoidHandler";

type Props = {
  lastReq: LastRequest | null;
  curl: string;
  onStatus?: (msg: string) => void;
};

export default function TroubleshootingPanel({ lastReq, curl, onStatus }: Props) {
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      onStatus?.("Copied curl to clipboard.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      onStatus?.(`Copy failed: ${message}`);
    }
  }

  return (
    <details className="panel troubleshooting troubleshooting--panel">
      <summary className="troubleshooting-summary">Troubleshooting</summary>

      <div className="muted-text">
        This shows the last Cloud Function request the UI made (payload + response). Useful for fast debugging.
      </div>

      {!lastReq ? (
        <div className="muted-text">(no requests yet)</div>
      ) : (
        <>
          <div className="troubleshooting-grid-pairs">
            <div className="troubleshooting-subtitle">When</div>
            <div className="troubleshooting-subvalue">{lastReq.atIso}</div>

            <div className="troubleshooting-subtitle">Request ID</div>
            <div className="troubleshooting-subvalue">{lastReq.requestId || "—"}</div>

            <div className="troubleshooting-subtitle">Function</div>
            <div className="troubleshooting-subvalue">{lastReq.fn}</div>

            <div className="troubleshooting-subtitle">Status</div>
            <div className="troubleshooting-subvalue">
              {typeof lastReq.status === "number"
                ? `${lastReq.status} ${lastReq.ok ? "(ok)" : "(error)"}`
                : "—"}
            </div>
          </div>

          <div className="troubleshooting-subtitle-heading">Payload</div>
          <pre className="mono troubleshooting-mono">{safeJsonStringify(lastReq.payloadRedacted ?? lastReq.payload)}</pre>

          <div className="troubleshooting-subtitle-heading">Response</div>
          <pre className="mono troubleshooting-mono">{safeJsonStringify(lastReq.response)}</pre>

          {lastReq.error ? (
            <>
              <div className="troubleshooting-subtitle-heading">Error</div>
              <pre className="mono troubleshooting-mono">{lastReq.error}</pre>
            </>
          ) : null}

          <div className="troubleshooting-subtitle-heading">Curl</div>
          <div className="muted-text">(Redacted by default; safe for sharing.)</div>
          <pre className="mono troubleshooting-mono">{curl || "(no request yet)"}</pre>

          <button
            className="btn-small"
            onClick={toVoidHandler(() => copyToClipboard(curl))}
            disabled={!curl}
            type="button"
          >
            Copy curl
          </button>
        </>
      )}
    </details>
  );
}
