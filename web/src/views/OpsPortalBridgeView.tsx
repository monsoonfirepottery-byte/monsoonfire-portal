import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";

type Props = {
  user: User | null;
  authReady: boolean;
  isStaff: boolean;
};

function injectBaseHref(html: string): string {
  if (typeof window === "undefined" || !html.includes("<head")) {
    return html;
  }
  if (html.includes("<base ")) {
    return html;
  }
  return html.replace(/<head([^>]*)>/i, `<head$1><base href="${window.location.origin}/">`);
}

function buildBridgeUrl(locationKey: string): string {
  if (typeof window === "undefined") {
    return "/__studio-brain/ops";
  }
  const current = new URL(locationKey, window.location.origin);
  return `/__studio-brain${current.pathname}${current.search}`;
}

export default function OpsPortalBridgeView({ user, authReady, isStaff }: Props) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const locationKey = typeof window === "undefined" ? "/ops" : `${window.location.pathname}${window.location.search}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load(): Promise<void> {
      if (!authReady) {
        setLoading(true);
        setError("");
        return;
      }

      if (!user) {
        setLoading(false);
        setHtml("");
        setError("Sign in with a staff account to open Studio Ops.");
        return;
      }

      if (!isStaff) {
        setLoading(false);
        setHtml("");
        setError("Studio Ops is only available to staff accounts.");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const idToken = await user.getIdToken();
        const response = await fetch(buildBridgeUrl(locationKey), {
          method: "GET",
          headers: {
            authorization: `Bearer ${idToken}`,
            accept: "text/html",
            "cache-control": "no-cache",
            pragma: "no-cache",
          },
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(body || `Studio Ops bridge returned ${response.status}.`);
        }
        if (cancelled) return;
        setHtml(injectBaseHref(body));
      } catch (caught) {
        if (controller.signal.aborted || cancelled) return;
        const message = caught instanceof Error ? caught.message : String(caught);
        setHtml("");
        setError(message || "Unable to load Studio Ops.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authReady, isStaff, locationKey, reloadNonce, user]);

  const title = useMemo(() => {
    if (typeof window === "undefined") return "Studio Ops";
    const search = new URLSearchParams(window.location.search);
    const surface = search.get("surface");
    return surface ? `Studio Ops · ${surface}` : "Studio Ops";
  }, [locationKey]);

  if (loading) {
    return (
      <section className="ops-bridge-shell">
        <div className="card ops-bridge-card" role="status" aria-live="polite">
          <div className="card-title">Loading Studio Ops</div>
          <p className="card-subtitle">Bridging your signed-in portal session into the new Studio Brain surface.</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="ops-bridge-shell">
        <div className="card ops-bridge-card" role="alert" aria-live="assertive">
          <div className="card-title">Studio Ops Bridge Unavailable</div>
          <p className="card-subtitle">{error}</p>
          <div className="staff-note">
            The public `/ops` route now bridges into Studio Brain, so it needs a live staff session before the new operating surface can mount.
          </div>
          <div className="staff-actions-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setLoading(true);
                setError("");
                setReloadNonce((value) => value + 1);
              }}
            >
              Retry bridge
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-bridge-shell">
      <iframe className="ops-bridge-frame" title={title} srcDoc={html} />
    </section>
  );
}
