import { useCallback, useEffect, useMemo, useState } from "react";
import type { FunctionsClient } from "../../api/functionsClient";
import { safeJsonStringify } from "../../api/functionsClient";

type StripeAuditEntry = {
  id: string;
  changedPaths: string[];
  summary: string;
  updatedAt: string;
  updatedByUid: string;
  updatedByEmail: string | null;
};

type StripeConfigDto = {
  mode: "test" | "live";
  publishableKeys: { test: string; live: string };
  activePublishableKey: string;
  priceIds: Record<string, string>;
  productIds: Record<string, string>;
  enabledFeatures: { checkout: boolean; customerPortal: boolean; invoices: boolean };
  successUrl: string;
  cancelUrl: string;
  updatedAt: string | null;
  updatedByUid: string | null;
  updatedByEmail: string | null;
};

type StripeSettingsResponse = {
  ok: boolean;
  config: StripeConfigDto;
  audit: StripeAuditEntry[];
  webhookEndpointUrl: string;
  safeFields: string[];
  restrictedFields: string[];
};

type StripeValidationResponse = {
  ok: boolean;
  mode: "test" | "live";
  account: {
    id: string;
    businessType: string | null;
    country: string | null;
    defaultCurrency: string | null;
  };
  activePublishableKeyValid: boolean;
  webhookSecretConfigured: boolean;
  priceCheck: {
    key: string;
    id: string;
    active: boolean;
    currency: string | null;
  } | null;
};

function mapToText(map: Record<string, string>): string {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function textToMap(input: string): Record<string, string> {
  return input
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const eq = line.indexOf("=");
      if (eq <= 0) return acc;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!key || !value) return acc;
      acc[key] = value;
      return acc;
    }, {});
}

function validatePublishableKey(mode: "test" | "live", key: string): string | null {
  if (!key.trim()) return null;
  if (mode === "test" && !key.startsWith("pk_test_")) return "Test publishable key must start with pk_test_.";
  if (mode === "live" && !key.startsWith("pk_live_")) return "Live publishable key must start with pk_live_.";
  return null;
}

export default function StripeSettingsModule({ client, isStaff }: { client: FunctionsClient; isStaff: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [showRotation, setShowRotation] = useState(false);

  const [mode, setMode] = useState<"test" | "live">("test");
  const [pkTest, setPkTest] = useState("");
  const [pkLive, setPkLive] = useState("");
  const [priceIdsText, setPriceIdsText] = useState("");
  const [productIdsText, setProductIdsText] = useState("");
  const [successUrl, setSuccessUrl] = useState("");
  const [cancelUrl, setCancelUrl] = useState("");
  const [checkoutEnabled, setCheckoutEnabled] = useState(true);
  const [customerPortalEnabled, setCustomerPortalEnabled] = useState(false);
  const [invoicesEnabled, setInvoicesEnabled] = useState(false);

  const [audit, setAudit] = useState<StripeAuditEntry[]>([]);
  const [safeFields, setSafeFields] = useState<string[]>([]);
  const [restrictedFields, setRestrictedFields] = useState<string[]>([]);
  const [webhookEndpointUrl, setWebhookEndpointUrl] = useState("");
  const [validationResult, setValidationResult] = useState<StripeValidationResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setStatus("");
    try {
      const resp = await client.postJson<StripeSettingsResponse>("staffGetStripeConfig", {});
      setMode(resp.config.mode);
      setPkTest(resp.config.publishableKeys.test ?? "");
      setPkLive(resp.config.publishableKeys.live ?? "");
      setPriceIdsText(mapToText(resp.config.priceIds ?? {}));
      setProductIdsText(mapToText(resp.config.productIds ?? {}));
      setSuccessUrl(resp.config.successUrl ?? "");
      setCancelUrl(resp.config.cancelUrl ?? "");
      setCheckoutEnabled(resp.config.enabledFeatures?.checkout === true);
      setCustomerPortalEnabled(resp.config.enabledFeatures?.customerPortal === true);
      setInvoicesEnabled(resp.config.enabledFeatures?.invoices === true);
      setAudit(resp.audit ?? []);
      setSafeFields(resp.safeFields ?? []);
      setRestrictedFields(resp.restrictedFields ?? []);
      setWebhookEndpointUrl(resp.webhookEndpointUrl ?? "");
      setStatus("Stripe settings loaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const publishableKeyError = useMemo(() => {
    const testErr = validatePublishableKey("test", pkTest);
    if (testErr) return testErr;
    const liveErr = validatePublishableKey("live", pkLive);
    if (liveErr) return liveErr;
    return null;
  }, [pkLive, pkTest]);

  const save = useCallback(async () => {
    if (saving || validating) return;
    setStatus("");
    setError("");
    setValidationResult(null);
    if (publishableKeyError) {
      setError(publishableKeyError);
      return;
    }
    setSaving(true);
    try {
      await client.postJson("staffUpdateStripeConfig", {
        mode,
        publishableKeys: {
          test: pkTest.trim(),
          live: pkLive.trim(),
        },
        priceIds: textToMap(priceIdsText),
        productIds: textToMap(productIdsText),
        enabledFeatures: {
          checkout: checkoutEnabled,
          customerPortal: customerPortalEnabled,
          invoices: invoicesEnabled,
        },
        successUrl: successUrl.trim(),
        cancelUrl: cancelUrl.trim(),
      });
      await load();
      setStatus("Stripe settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    cancelUrl,
    checkoutEnabled,
    client,
    customerPortalEnabled,
    invoicesEnabled,
    load,
    mode,
    pkLive,
    pkTest,
    priceIdsText,
    productIdsText,
    publishableKeyError,
    saving,
    successUrl,
    validating,
  ]);

  const validate = useCallback(async () => {
    if (saving || validating) return;
    setError("");
    setStatus("");
    setValidating(true);
    try {
      const resp = await client.postJson<StripeValidationResponse>("staffValidateStripeConfig", {});
      setValidationResult(resp);
      setStatus("Stripe configuration validated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setValidationResult(null);
    } finally {
      setValidating(false);
    }
  }, [client, saving, validating]);

  const copyWebhookUrl = useCallback(async () => {
    if (!webhookEndpointUrl) return;
    try {
      await navigator.clipboard.writeText(webhookEndpointUrl);
      setCopyStatus("Webhook URL copied.");
    } catch (err) {
      setCopyStatus(err instanceof Error ? err.message : String(err));
    }
  }, [webhookEndpointUrl]);

  if (!isStaff) {
    return (
      <section className="card staff-console-card">
        <div className="card-title">Stripe settings</div>
        <div className="staff-note staff-note-error">Staff claim required.</div>
      </section>
    );
  }

  return (
    <section className="card staff-console-card">
      <div className="card-title-row">
        <div className="card-title">Stripe settings</div>
        <button className="btn btn-secondary" disabled={loading || saving || validating} onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="staff-note">
        Safe to edit in-app: {safeFields.join(", ") || "mode, publishable keys, IDs, URLs, feature toggles"}.
        Secrets stay server-side only: {restrictedFields.join(", ")}.
      </div>
      {loading ? <div className="staff-note">Loading Stripe configuration...</div> : null}
      {status ? <div className="staff-note">{status}</div> : null}
      {error ? <div className="staff-note staff-note-error">{error}</div> : null}
      {copyStatus ? <div className="staff-note">{copyStatus}</div> : null}

      <div className="staff-module-grid">
        <label className="staff-field">
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as "test" | "live")} disabled={saving || validating}>
            <option value="test">test</option>
            <option value="live">live</option>
          </select>
          <span className="helper">Switch mode only when corresponding secrets are configured on Cloud Functions.</span>
        </label>
        <label className="staff-field">
          Publishable key (test)
          <input
            value={pkTest}
            onChange={(event) => setPkTest(event.target.value)}
            placeholder="pk_test_..."
            disabled={saving || validating}
          />
        </label>
        <label className="staff-field">
          Publishable key (live)
          <input
            value={pkLive}
            onChange={(event) => setPkLive(event.target.value)}
            placeholder="pk_live_..."
            disabled={saving || validating}
          />
        </label>
        <label className="staff-field">
          Checkout success URL
          <input value={successUrl} onChange={(event) => setSuccessUrl(event.target.value)} disabled={saving || validating} />
        </label>
        <label className="staff-field">
          Checkout cancel URL
          <input value={cancelUrl} onChange={(event) => setCancelUrl(event.target.value)} disabled={saving || validating} />
        </label>
      </div>

      <div className="staff-module-grid">
        <label className="staff-field">
          Price IDs (`key=price_...`, one per line)
          <textarea
            value={priceIdsText}
            onChange={(event) => setPriceIdsText(event.target.value)}
            disabled={saving || validating}
            placeholder={"membership_studio=price_123\nfiring_credit=price_456"}
          />
        </label>
        <label className="staff-field">
          Product IDs (`key=prod_...`, one per line)
          <textarea
            value={productIdsText}
            onChange={(event) => setProductIdsText(event.target.value)}
            disabled={saving || validating}
            placeholder={"membership_studio=prod_123\nfiring_credit=prod_456"}
          />
        </label>
      </div>

      <div className="staff-actions-row">
        <label className="staff-field">
          <input
            type="checkbox"
            checked={checkoutEnabled}
            onChange={(event) => setCheckoutEnabled(event.target.checked)}
            disabled={saving || validating}
          />
          Enable Checkout
        </label>
        <label className="staff-field">
          <input
            type="checkbox"
            checked={customerPortalEnabled}
            onChange={(event) => setCustomerPortalEnabled(event.target.checked)}
            disabled={saving || validating}
          />
          Enable customer portal
        </label>
        <label className="staff-field">
          <input
            type="checkbox"
            checked={invoicesEnabled}
            onChange={(event) => setInvoicesEnabled(event.target.checked)}
            disabled={saving || validating}
          />
          Enable invoices
        </label>
      </div>

      {publishableKeyError ? <div className="staff-note staff-note-error">{publishableKeyError}</div> : null}

      <div className="staff-actions-row">
        <button className="btn btn-primary" disabled={saving || validating || loading} onClick={() => void save()}>
          {saving ? "Saving..." : "Save Stripe settings"}
        </button>
        <button className="btn btn-secondary" disabled={saving || validating || loading} onClick={() => void validate()}>
          {validating ? "Validating..." : "Validate configuration"}
        </button>
        <button className="btn btn-ghost" disabled={saving || validating} onClick={() => setShowRotation((prev) => !prev)}>
          {showRotation ? "Hide rotation instructions" : "Rotate secrets instructions"}
        </button>
      </div>

      <div className="staff-note">
        Webhook endpoint: <code>{webhookEndpointUrl || "(not available)"}</code>
        <button className="btn btn-ghost btn-small" disabled={!webhookEndpointUrl} onClick={() => void copyWebhookUrl()}>
          Copy
        </button>
      </div>

      {validationResult ? (
        <details className="staff-troubleshooting" open>
          <summary>Validation report</summary>
          <pre>{safeJsonStringify(validationResult)}</pre>
        </details>
      ) : null}

      {showRotation ? (
        <details className="staff-troubleshooting" open>
          <summary>Secret rotation checklist</summary>
          <div className="staff-list-compact">
            <div className="staff-note">1. In Stripe Dashboard, create new API secret key + webhook signing secret for the target mode.</div>
            <div className="staff-note">2. Update Cloud Functions secrets (`STRIPE_TEST_SECRET_KEY` / `STRIPE_LIVE_SECRET_KEY` and webhook secret).</div>
            <div className="staff-note">3. Deploy functions with new secrets bound.</div>
            <div className="staff-note">4. Run “Validate configuration” in this panel.</div>
            <div className="staff-note">5. After successful validation, remove old keys in Stripe Dashboard.</div>
          </div>
        </details>
      ) : null}

      <section className="card staff-console-card">
        <div className="card-title">Audit log (last 20)</div>
        <div className="staff-table-wrap">
          <table className="staff-table">
            <thead>
              <tr>
                <th>At</th>
                <th>By</th>
                <th>Summary</th>
                <th>Changed fields</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 ? (
                <tr>
                  <td colSpan={4}>No Stripe config changes logged yet.</td>
                </tr>
              ) : (
                audit.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.updatedAt || "-"}</td>
                    <td>{entry.updatedByEmail || entry.updatedByUid || "-"}</td>
                    <td>{entry.summary}</td>
                    <td>{entry.changedPaths.join(", ") || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

