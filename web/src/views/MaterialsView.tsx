import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import type {
  CreateMaterialsCheckoutSessionResponse,
  ListMaterialsProductsResponse,
  MaterialProduct,
  SeedMaterialsCatalogResponse,
} from "../api/portalContracts";
import { createFunctionsClient } from "../api/functionsClient";
import { db } from "../firebase";
import { toVoidHandler } from "../utils/toVoidHandler";
import { formatCents } from "../utils/format";
import { safeStorageReadJson, safeStorageSetItem } from "../lib/safeStorage";
import {
  checkoutErrorMessage,
  isConnectivityError,
  serviceOfflineMessage,
} from "../utils/userFacingErrors";
import "./MaterialsView.css";

const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
type ImportMetaEnvShape = { VITE_FUNCTIONS_BASE_URL?: string };
const ENV = (import.meta.env ?? {}) as ImportMetaEnvShape;
const CATALOG_CACHE_KEY = "mf_materials_catalog_v1";
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
};

type CartLine = {
  product: MaterialProduct;
  quantity: number;
};

type CachedCatalog = {
  cachedAt: number;
  products: MaterialProduct[];
};

type VariantOption = {
  product: MaterialProduct;
  label: string;
};

type ProductGroup = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  variants: VariantOption[];
};

type MaterialProductFirestoreDoc = {
  name?: string;
  description?: string | null;
  category?: string | null;
  sku?: string | null;
  priceCents?: number;
  currency?: string;
  stripePriceId?: string | null;
  imageUrl?: string | null;
  trackInventory?: boolean;
  inventoryOnHand?: number | null;
  inventoryReserved?: number | null;
  active?: boolean;
};

const LOCAL_SEED_PRODUCTS: Array<{
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  trackInventory: boolean;
}> = [
  {
    sku: "DAY_PASS",
    name: "Day Pass",
    description:
      "Reserve your creative time in our fully equipped west-side studio. Full access to workspace, tools, wheels, glazes, and materials.",
    category: "Studio Access",
    priceCents: 4000,
    trackInventory: false,
  },
  {
    sku: "LAGUNA_BMIX_5_25",
    name: "Laguna WC-401 B-Mix Cone 5/6 (25 lb)",
    description: "Wet clay direct from Laguna in a 25 lb bag.",
    category: "Clays",
    priceCents: 4000,
    trackInventory: false,
  },
  {
    sku: "TOOL_KIT_BASIC",
    name: "Studio Starter Tool Kit",
    description: "Needle, rib, sponge, trim tool, and loop set.",
    category: "Tools",
    priceCents: 2800,
    trackInventory: true,
  },
];

function resolveFunctionsBaseUrl() {
  const env =
    typeof import.meta !== "undefined" && ENV.VITE_FUNCTIONS_BASE_URL
      ? String(ENV.VITE_FUNCTIONS_BASE_URL)
      : "";
  return env || DEFAULT_FUNCTIONS_BASE_URL;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAuthTokenError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("invalid authorization token") ||
    message.includes("unauthenticated") ||
    message.includes("unauthorized")
  );
}

function readCachedCatalog(): CachedCatalog | null {
  const parsed = safeStorageReadJson<CachedCatalog>("localStorage", CATALOG_CACHE_KEY, null);
  if (!parsed || !parsed.cachedAt || !Array.isArray(parsed.products)) return null;
  if (Date.now() - parsed.cachedAt > CATALOG_CACHE_TTL_MS) return null;
  return parsed;
}

function writeCachedCatalog(products: MaterialProduct[]) {
  const payload: CachedCatalog = {
    cachedAt: Date.now(),
    products,
  };
  try {
    safeStorageSetItem("localStorage", CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
}

function parseVariantName(name: string) {
  const dashIndex = name.lastIndexOf(" - ");
  if (dashIndex > 0) {
    return {
      baseName: name.slice(0, dashIndex).trim(),
      variantLabel: name.slice(dashIndex + 3).trim(),
    };
  }

  const match = name.match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return { baseName: match[1].trim(), variantLabel: match[2].trim() };
  }

  return { baseName: name.trim(), variantLabel: "" };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeProductFromDoc(id: string, data: MaterialProductFirestoreDoc): MaterialProduct {
  const trackInventory = data.trackInventory === true;
  const inventoryOnHand = trackInventory ? Number(data.inventoryOnHand ?? 0) : null;
  const inventoryReserved = trackInventory ? Number(data.inventoryReserved ?? 0) : null;
  const inventoryAvailable =
    trackInventory && inventoryOnHand !== null && inventoryReserved !== null
      ? Math.max(inventoryOnHand - inventoryReserved, 0)
      : null;

  return {
    id,
    name: String(data.name ?? "").trim(),
    description: data.description ?? null,
    category: data.category ?? null,
    sku: data.sku ?? null,
    priceCents: Number(data.priceCents ?? 0),
    currency: String(data.currency ?? "USD").toUpperCase(),
    stripePriceId: data.stripePriceId ?? null,
    imageUrl: data.imageUrl ?? null,
    trackInventory,
    inventoryOnHand,
    inventoryReserved,
    inventoryAvailable,
    active: data.active !== false,
  };
}

export default function MaterialsView({ user, adminToken, isStaff }: Props) {
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
  const [cacheNote, setCacheNote] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [serviceOffline, setServiceOffline] = useState(false);

  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
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
      setServiceOffline(false);

      try {
        const resp = await client.postJson<ListMaterialsProductsResponse>("listMaterialsProducts", {
          includeInactive: false,
        });
        if (!mounted) return;
        setProducts(resp.products ?? []);
        writeCachedCatalog(resp.products ?? []);
        setCacheNote("");
      } catch (error: unknown) {
        if (!mounted) return;
        if (isConnectivityError(error)) {
          setServiceOffline(true);
          setError(serviceOfflineMessage());
          return;
        }
        if (isAuthTokenError(error)) {
          try {
            const snap = await getDocs(collection(db, "materialsProducts"));
            if (!mounted) return;
            const fallbackProducts = snap.docs
              .map((docSnap) =>
                normalizeProductFromDoc(
                  docSnap.id,
                  (docSnap.data() as MaterialProductFirestoreDoc) ?? {}
                )
              )
              .filter((product) => product.active);
            setProducts(fallbackProducts);
            writeCachedCatalog(fallbackProducts);
            setCacheNote("Loaded from Firestore fallback (local functions auth mismatch).");
            setStatus("Store is running in fallback mode while functions auth is unavailable.");
            setError("");
            return;
          } catch {
            // fall through to standard error handling
          }
        }
        setError(getErrorMessage(error));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
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

  const groupedProducts = useMemo(() => {
    const map = new Map<string, ProductGroup>();
    products.forEach((product) => {
      const { baseName, variantLabel } = parseVariantName(product.name);
      const id = slugify(baseName);
      const existing = map.get(id);
      const variantLabelFinal = variantLabel || "Standard";
      const option: VariantOption = {
        product,
        label: variantLabelFinal,
      };

      if (!existing) {
        map.set(id, {
          id,
          name: baseName,
          description: product.description ?? null,
          category: product.category ?? null,
          variants: [option],
        });
      } else {
        existing.variants.push(option);
        if (!existing.description && product.description) {
          existing.description = product.description;
        }
      }
    });

    return Array.from(map.values()).map((group) => ({
      ...group,
      variants: group.variants.sort((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [products]);

  useEffect(() => {
    setSelectedVariant((prev) => {
      let changed = false;
      const next = { ...prev };
      groupedProducts.forEach((group) => {
        const currentId = next[group.id];
        const hasCurrent = group.variants.some((variant) => variant.product.id === currentId);
        if (!hasCurrent) {
          next[group.id] = group.variants[0]?.product.id ?? "";
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [groupedProducts]);

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groupedProducts.filter((group) => {
      const matchesCategory = category === "All" || group.category === category;
      if (!matchesCategory) return false;
      if (!term) return true;
      return (
        group.name.toLowerCase().includes(term) ||
        (group.description ?? "").toLowerCase().includes(term) ||
        group.variants.some((variant) => {
          const label = variant.label.toLowerCase();
          const name = variant.product.name.toLowerCase();
          return label.includes(term) || name.includes(term);
        })
      );
    });
  }, [category, groupedProducts, search]);

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

  const canSeed = isStaff || !!adminToken?.trim();
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
    } catch (error: unknown) {
      setStatus(checkoutErrorMessage(error));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCheckoutHandlerError = (error: unknown) => {
    setStatus(checkoutErrorMessage(error));
    setCheckoutBusy(false);
  };

  const handleSeedCatalog = async () => {
    if (seedBusy) return;
    setSeedBusy(true);
    setStatus("");

    try {
      const resp = await client.postJson<SeedMaterialsCatalogResponse>("seedMaterialsCatalog", {
        force: true,
        acknowledge: "ALLOW_NON_DEV_SAMPLE_SEEDING",
        reason: "materials_view_staff_seed",
      });
      setStatus(`Sample catalog seeded (${resp.created} new, ${resp.updated} updated).`);
      const refreshed = await client.postJson<ListMaterialsProductsResponse>(
        "listMaterialsProducts",
        { includeInactive: false }
      );
      setProducts(refreshed.products ?? []);
      writeCachedCatalog(refreshed.products ?? []);
      setCacheNote("");
    } catch (error: unknown) {
      if (isAuthTokenError(error) && isStaff) {
        try {
          for (const product of LOCAL_SEED_PRODUCTS) {
            const id = slugify(product.sku);
            await setDoc(
              doc(db, "materialsProducts", id),
              {
                sku: product.sku,
                name: product.name,
                description: product.description,
                category: product.category,
                priceCents: product.priceCents,
                currency: "USD",
                stripePriceId: null,
                imageUrl: null,
                trackInventory: product.trackInventory,
                inventoryOnHand: product.trackInventory ? 30 : 0,
                inventoryReserved: 0,
                active: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }

          const snap = await getDocs(collection(db, "materialsProducts"));
          const fallbackProducts = snap.docs
            .map((docSnap) =>
              normalizeProductFromDoc(
                docSnap.id,
                (docSnap.data() as MaterialProductFirestoreDoc) ?? {}
              )
            )
            .filter((product) => product.active);
          setProducts(fallbackProducts);
          writeCachedCatalog(fallbackProducts);
          setCacheNote("Seeded via Firestore fallback.");
          setStatus("Sample catalog seeded via Firestore fallback.");
          setError("");
          return;
        } catch (fallbackError: unknown) {
          setStatus(getErrorMessage(fallbackError));
          return;
        }
      }

      setStatus(getErrorMessage(error));
    } finally {
      setSeedBusy(false);
    }
  };

  return (
    <div className="page materials-page">
      <div className="page-header">
        <div>
          <h1>Store</h1>
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
        {serviceOffline ? (
          <div className="alert inline-alert">
            {serviceOfflineMessage()}
          </div>
        ) : null}
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
            <button className="btn btn-primary" onClick={toVoidHandler(handleSeedCatalog)} disabled={seedBusy}>
              {seedBusy ? "Seeding..." : "Seed sample catalog"}
            </button>
          ) : null}
        </div>
        {cacheNote ? <div className="materials-cache-note">{cacheNote}</div> : null}
      </section>

      <div className="materials-layout">
        <section className="materials-list">
          {loading ? (
            <div className="materials-skeleton-grid" aria-hidden="true">
              <div className="materials-skeleton-card" />
              <div className="materials-skeleton-card" />
              <div className="materials-skeleton-card" />
            </div>
          ) : null}
          {error ? <div className="alert inline-alert">{error}</div> : null}

          {!loading && filteredGroups.length === 0 ? (
            <div className="card card-3d materials-empty">
              <div className="card-title">Catalog is empty</div>
              <p className="materials-copy">
                We are still loading supplies. If you are on staff, seed the sample catalog to get
                started.
              </p>
            </div>
          ) : null}

          <div className="materials-grid">
            {filteredGroups.map((group) => {
              const selectedId =
                selectedVariant[group.id] ?? group.variants[0]?.product.id ?? "";
              const selected =
                group.variants.find((variant) => variant.product.id === selectedId) ??
                group.variants[0];
              const selectedProduct = selected?.product;
              if (!selectedProduct) return null;

              const available = selectedProduct.trackInventory
                ? selectedProduct.inventoryAvailable ?? 0
                : null;
              const inCart = cart[selectedProduct.id] ?? 0;
              const limited = available !== null && available <= 5;
              const disabled = available !== null && available <= 0;

              return (
                <div key={group.id} className="card card-3d product-card">
                  <div className="product-header">
                    <div>
                      <div className="product-title">{group.name}</div>
                      {group.category ? (
                        <div className="product-category">{group.category}</div>
                      ) : null}
                    </div>
                    <div className="product-price">
                      {formatCents(selectedProduct.priceCents)}
                    </div>
                  </div>
                  {group.description ? (
                    <p className="materials-copy">{group.description}</p>
                  ) : null}
                  {group.variants.length > 1 ? (
                    <div className="product-variants">
                      <div className="variant-label">Sizes & options</div>
                      <div className="variant-row">
                        {group.variants.map((variant) => {
                          const active = variant.product.id === selectedId;
                          return (
                            <button
                              key={variant.product.id}
                              className={`variant-chip ${active ? "active" : ""}`}
                              onClick={() =>
                                setSelectedVariant((prev) => ({
                                  ...prev,
                                  [group.id]: variant.product.id,
                                }))
                              }
                            >
                              {variant.label}
                              <span className="variant-price">
                                {formatCents(variant.product.priceCents)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {selectedProduct.trackInventory ? (
                    <div className={`inventory-badge ${disabled ? "empty" : ""}`}>
                      {disabled
                        ? "Out of stock"
                        : limited
                        ? `Only ${available} left`
                        : `${available} available`}
                    </div>
                  ) : null}
                  <div className="product-actions">
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(selectedProduct.id, -1, available)}
                      disabled={inCart <= 0}
                    >
                      −
                    </button>
                    <span className="product-qty">{inCart}</span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => updateCart(selectedProduct.id, 1, available)}
                      disabled={disabled}
                    >
                      +
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => updateCart(selectedProduct.id, 1, available)}
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

          <button
            className="btn btn-primary"
            onClick={toVoidHandler(handleCheckout, handleCheckoutHandlerError, "materials.checkout")}
            disabled={!canCheckout}
          >
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

    </div>
  );
}
