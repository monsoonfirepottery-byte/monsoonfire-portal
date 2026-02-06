// src/components/TroubleshootingPanel.tsx
import type { LastRequest } from "../api/functionsClient";
import { safeJsonStringify } from "../api/functionsClient";
import { styles as S } from "../ui/styles";
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
    <details style={S.card}>
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 16, marginBottom: 10 }}>
        Troubleshooting
      </summary>

      <div style={S.muted}>
        This shows the last Cloud Function request the UI made (payload + response). Useful for fast debugging.
      </div>

      {!lastReq ? (
        <div style={S.muted}>(no requests yet)</div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 8,
              marginTop: 10,
              marginBottom: 10,
            }}
          >
            <div style={{ opacity: 0.7, fontSize: 12 }}>When</div>
            <div style={{ fontSize: 12 }}>{lastReq.atIso}</div>

            <div style={{ opacity: 0.7, fontSize: 12 }}>Request ID</div>
            <div style={{ fontSize: 12 }}>{lastReq.requestId || "—"}</div>

            <div style={{ opacity: 0.7, fontSize: 12 }}>Function</div>
            <div style={{ fontSize: 12 }}>{lastReq.fn}</div>

            <div style={{ opacity: 0.7, fontSize: 12 }}>Status</div>
            <div style={{ fontSize: 12 }}>
              {typeof lastReq.status === "number"
                ? `${lastReq.status} ${lastReq.ok ? "(ok)" : "(error)"}`
                : "—"}
            </div>
          </div>

          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>
            Payload
          </div>
          <pre style={S.pre}>{safeJsonStringify(lastReq.payload)}</pre>

          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>
            Response
          </div>
          <pre style={S.pre}>{safeJsonStringify(lastReq.response)}</pre>

          {lastReq.error ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>
                Error
              </div>
              <pre style={S.pre}>{lastReq.error}</pre>
            </>
          ) : null}

          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 10, marginBottom: 6 }}>
            Curl
          </div>
          <div style={S.muted}>(Redacted by default; safe for sharing.)</div>
          <pre style={S.pre}>{curl || "(no request yet)"}</pre>

          <button style={S.btnSmall} onClick={toVoidHandler(() => copyToClipboard(curl))} disabled={!curl}>
            Copy curl
          </button>
        </>
      )}
    </details>
  );
}
