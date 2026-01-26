import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import type {
  CreateMaterialsCheckoutSessionResponse,
  ListMaterialsProductsResponse,
  MaterialProduct,
  SeedMaterialsCatalogResponse,
} from "../api/portalContracts";
import {
  createFunctionsClient,
  type LastRequest,
} from "../api/functionsClient";
import TroubleshootingPanel from "../components/TroubleshootingPanel";
import { formatCents } from "../utils/format";
import "./MaterialsView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const CATALOG_CACHE_KEY = "mf_materials_catalog_v1";
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type Props = {
  user: User;
  adminToken?: string;
};

type CartLine = {
  product: MaterialProduct;
  quantity: number;
};

type CachedCatalog = {
  cachedAt: number;
  products: MaterialProduct[];
};

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env &&
    (import.meta as any).env.VITE_FUNCTIONS_BASE_URL
      ? String((import.meta as any).env.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function readCachedCatalog(): CachedCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedCatalog;
    if (!parsed?.cachedAt || !Array.isArray(parsed.products)) return null;
    if (Date.now() - parsed.cachedAt > CATALOG_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedCatalog(products: MaterialProduct[]) {
  const payload: CachedCatalog = {
    cachedAt: Date.now(),
    products,
  };
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

export default function MaterialsView({ user, adminToken }: Props) {
  const [products, setProducts] = useState<MaterialProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pickupNotes, setPickupNotes] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [lastReq, setLastReq] = useState<LastRequest | null>(null);
  const [cacheNote, setCacheNote] = useState("");

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
      onLastRequest: setLastReq,
    });
  }, [adminToken, baseUrl, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");

    if (statusParam === "success") {
      setStatus("Payment received — we will be ready for pickup soon.");
      setCart({});
    } else if (statusParam === "cancel") {
      setStatus("Checkout canceled. Your cart is still here if you want to try again.");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const cached = readCachedCatalog();
    if (cached?.products?.length) {
      setProducts(cached.products);
      const ageMinutes = Math.round((Date.now() - cached.cachedAt) / 60000);
      setCacheNote(`Showing cached catalog (${ageMinutes} min old).`);
    }

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const resp = await client.postJson<ListMaterialsProductsResponse>("listMaterialsProducts", {
          includeInactive: false,
        });
        if (!mounted) return;
        setProducts(resp.products ?? []);
        writeCachedCatalog(resp.products ?? []);
        setCacheNote("");
      } catch (err: any) {
        if (!mounted) return;
        setError(err?.message || String(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [client]);

  const productMap = useMemo(() => {
    const map = new Map<string, MaterialProduct>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((product) => {
      if (product.category) set.add(product.category);
    });
    return ["All", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      if (!matchesCategory) return false;
      if (!term) return true;
      return (
        product.name.toLowerCase().includes(term) ||
        (product.description ?? "").toLowerCase().includes(term)
      );
    });
  }, [category, products, search]);

  const cartLines: CartLine[] = useMemo(() => {
    return Object.entries(cart)
      .map(([productId, quantity]) => {
        const product = productMap.get(productId);
        if (!product) return null;
        return { product, quantity } as CartLine;
      })
      .filter(Boolean) as CartLine[];
  }, [cart, productMap]);

  const subtotalCents = useMemo(() => {
    return cartLines.reduce((total, line) => total + line.product.priceCents * line.quantity, 0);
  }, [cartLines]);

  const canSeed = !!adminToken?.trim();
  const canCheckout = cartLines.length > 0 && !checkoutBusy;

  const updateCart = (productId: string, delta: number, maxAvailable: number | null) => {
    setCart((prev) => {
      const current = prev[productId] ?? 0;
      const next = current + delta;

      if (maxAvailable !== null && next > maxAvailable) {
        setStatus("That item is currently at its inventory limit.");
        return prev;
      }

      if (next <= 0) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }

      return { ...prev, [productId]: next };
    });
  };

  const handleCheckout = async () => {
    if (checkoutBusy) return;
    if (cartLines.length === 0) {
      setStatus("Add at least one item before checkout.");
      return;
    }

    setCheckoutBusy(true);
    setStatus("");

    try {
      const items = cartLines.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
      }));

      const resp = await client.postJson<CreateMaterialsCheckoutSessionResponse>(
        "createMaterialsCheckoutSession",
        {
          items,
          pickupNotes: pickupNotes.trim() || null,
        }
      );

      if (!resp.checkoutUrl) {
        setStatus("Checkout session created, but no URL was returned.");
        return;
      }

      window.location.assign(resp.checkoutUrl);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleSeedCatalog = async () => {
    if (seedBusy) return;
    setSeedBusy(true);
    setStatus("");

    try {
      const resp = await client.postJson<SeedMaterialsCatalogResponse>("seedMaterialsCatalog", {
        force: false,
      });
      setStatus(`Sample catalog seeded (${resp.created} new, ${resp.updated} updated).`);
      const refreshed = await client.postJson<ListMaterialsProductsResponse>(
        "listMaterialsProducts",
        { includeInactive: false }
      );
      setProducts(refreshed.products ?? []);
      writeCachedCatalog(refreshed.products ?? []);
      setCacheNote("");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="page materials-page">
      <div className="page-header">
        <div>
          <h1>Materials & supplies</h1>
          <p className="page-subtitle">
            Pickup-only supplies for the work you are already doing. Take what you need today, and
            keep your studio momentum steady.
          </p>
        </div>
      </div>

      <section className="card card-3d materials-banner">
        <div>
          <div className="card-title">Pickup-only checkout</div>
          <p className="materials-copy">
            Stripe handles payment and taxes. We will prep your supplies for pickup at the studio — no
            shipping, no pressure.
          </p>
        </div>
        <div className="materials-banner-meta">
          <div>
            <span className="summary-label">Pickup window</span>
            <span className="summary-value">1–2 business days</span>
          </div>
          <div>
            <span className="summary-label">Status</span>
            <span className="summary-value">{status || "Ready when you are"}</span>
          </div>
        </div>
      </section>

      <section className="materials-toolbar">
        <div className="materials-search">
          <label htmlFor="materials-search">Search</label>
          <input
            id="materials-search"
            type="text"
            value={search}
            placeholder="Clay bodies, wax resist, studio add-ons..."
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="materials-filters">
          {categories.map((item) => (
            <button
              key={item}
              className={`materials-chip ${category === item ? "active" : ""}`}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="materials-actions">
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            Refresh catalog
          </button>
          {products.length === 0 && canSeed ? (
            <button className="btn btn-primary" onClick={handleSeedCatalog} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed sample catalog"}
            </button>
          ) : null}
        </div>
        {cacheNote ? <div className="materials-cache-note">{cacheNote}</div> : null}
      </section>

      <div className="materials-layout">
        <section className="materials-list">
          {loading ? <div className="materials-loading">Loading catalog...</div> : null}
          {error ? <div className="alert inline-alert">{error}</div> : null}

          {!loading && filtered.length === 0 ? (
            <div className="card card-3d materials-empty">
              <div className="card-title">Catalog is empty</div>
              <p className="materials-copy">
                We are still loading supplies. If you are on staff, seed the sample catalog to get
                started.
              </p>
            </div>
          ) : null}

          <div className="materials-grid">
            {filtered.map((product) => {
              const available = product.trackInventory
                ? product.inventoryAvailable ?? 0
                : null;
              const inCart = cart[product.id] ?? 0;
              const limited = available !== null && available <= 5;
              const disabled = available !== null && available <= 0;

              return (
                <div key={product.id} className="card card-3d product-card">
                  <div className="product-header">
                    <div>
                      <div className="product-title">{product.name}</div>
                      {product.category ? (
                        <div className="product-category">{product.category}</div>
                      ) : null}
                    </div>
                    <div className="product-price">{formatCents(product.priceCents)}</div>
                  </div>
                  {product.description ? (
                    <p className="materials-copy">{product.description}</p>
                  ) : null}
                  {product.trackInventory ? (
                    <div className={`inventory-badge ${disabled ? "empty" : ""}`}>
                      {disabled
                        ? "Out of stock"
                        : limited
                        ? `Only ${available} left`
                        : `${available} available`}
                    </div>
                  ) : (
                    <div className="inventory-badge soft">Stock flexible</div>
                  )}
                  <div className="product-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(product.id, -1, available)}
                      disabled={inCart <= 0}
                    >
                      −
                    </button>
                    <span className="product-qty">{inCart}</span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(product.id, 1, available)}
                      disabled={disabled}
                    >
                      +
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => updateCart(product.id, 1, available)}
                      disabled={disabled}
                    >
                      Add to cart
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="card card-3d materials-cart">
          <div className="card-title">Your cart</div>
          {cartLines.length === 0 ? (
            <p className="materials-copy">No items yet. Add what you need to get started.</p>
          ) : (
            <div className="cart-lines">
              {cartLines.map((line) => (
                <div key={line.product.id} className="cart-line">
                  <div>
                    <div className="cart-title">{line.product.name}</div>
                    <div className="cart-meta">
                      {line.quantity} × {formatCents(line.product.priceCents)}
                    </div>
                  </div>
                  <div className="cart-controls">
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(line.product.id, -1, line.product.inventoryAvailable ?? null)}
                    >
                      −
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(line.product.id, 1, line.product.inventoryAvailable ?? null)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="cart-summary">
            <div>
              <span className="summary-label">Subtotal</span>
              <span className="summary-value">{formatCents(subtotalCents)}</span>
            </div>
            <div>
              <span className="summary-label">Taxes</span>
              <span className="summary-value">Calculated at checkout</span>
            </div>
          </div>

          <label className="materials-notes">
            Pickup notes (optional)
            <textarea
              value={pickupNotes}
              onChange={(event) => setPickupNotes(event.target.value)}
              placeholder="Let us know about timing or substitutions."
            />
          </label>

          {status ? <div className="notice inline-alert">{status}</div> : null}

          <button className="btn btn-primary" onClick={handleCheckout} disabled={!canCheckout}>
            {checkoutBusy ? "Starting checkout..." : "Checkout (Stripe)"}
          </button>

          <button className="btn btn-ghost" onClick={() => setCart({})} disabled={cartLines.length === 0}>
            Clear cart items
          </button>
        </aside>
      </div>

      <section className="card card-3d materials-help">
        <div className="card-title">Need something special?</div>
        <p className="materials-copy">
          If you cannot find the clay body or tool you need, send a note to the studio. We will try to
          source it for you.
        </p>
      </section>

      <TroubleshootingPanel
        lastReq={lastReq}
        curl={client.getLastCurl()}
        onStatus={(msg) => setStatus(msg)}
      />
    </div>
  );
}
