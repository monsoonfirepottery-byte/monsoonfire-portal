import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import type {
  CreateMaterialsCheckoutSessionResponse,
  MaterialProduct,
  SeedMaterialsCatalogResponse,
} from "../api/portalContracts";
import { createFunctionsClient } from "../api/functionsClient";
import { db } from "../firebase";
import { formatCents } from "../utils/format";
import { resolveFunctionsBaseUrl } from "../utils/functionsBaseUrl";
import { toVoidHandler } from "../utils/toVoidHandler";
import {
  checkoutErrorMessage,
  isConnectivityError,
  serviceOfflineMessage,
} from "../utils/userFacingErrors";
import {
  filterMaterialsGroups,
  groupMaterialsProducts,
  loadMaterialsCatalog,
  readCachedMaterialsCatalog,
  slugify,
  sortMaterialsGroups,
  type MaterialsCatalogLoadResult,
  type MaterialsCatalogSort,
} from "./materialsCatalog";
import "./MaterialsView.css";

type Props = {
  user: User;
  adminToken?: string;
  isStaff: boolean;
};

type CartLine = {
  product: MaterialProduct;
  quantity: number;
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

function formatRelativeCatalogTime(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  const deltaMs = Date.now() - parsed.getTime();
  if (Math.abs(deltaMs) < 45_000) return "Updated just now";

  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;

  return `Updated ${parsed.toLocaleString()}`;
}

function formatSavedCatalogAge(cachedAt: number | null) {
  if (!cachedAt || !Number.isFinite(cachedAt)) return "";
  const deltaMs = Math.max(Date.now() - cachedAt, 0);
  if (deltaMs < 45_000) return "Saved just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `Saved ${minutes} min ago`;
  return `Saved ${new Date(cachedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function getCatalogNote({
  source,
  refreshing,
  fetchedAtIso,
  catalogUpdatedAtIso,
  cachedAt,
}: {
  source: MaterialsCatalogLoadResult["source"] | null;
  refreshing: boolean;
  fetchedAtIso: string | null;
  catalogUpdatedAtIso: string | null;
  cachedAt: number | null;
}) {
  const updatedLabel = formatRelativeCatalogTime(catalogUpdatedAtIso ?? fetchedAtIso);
  if (refreshing) {
    return updatedLabel ? `${updatedLabel}. Refreshing catalog...` : "Refreshing catalog...";
  }
  if (source === "firestore_fallback") {
    return updatedLabel
      ? `${updatedLabel}. Local fallback mode while functions auth catches up.`
      : "Loaded from local fallback mode.";
  }
  if (source === "cache") {
    const savedLabel = formatSavedCatalogAge(cachedAt);
    return savedLabel || updatedLabel;
  }
  return updatedLabel;
}

function getResultsLabel(count: number) {
  if (count === 1) return "1 listing";
  return `${count} listings`;
}

function getMobileCartLabel(count: number) {
  if (count === 1) return "1 item";
  return `${count} items`;
}

function resolveProductMediaTone(category: string | null) {
  const tone = slugify(category ?? "studio");
  return `product-media--${tone || "studio"}`;
}

function resolveProductPlaceholderLabel(category: string | null) {
  const normalized = String(category ?? "").trim();
  return normalized || "Studio staple";
}

export default function MaterialsView({ user, adminToken, isStaff }: Props) {
  const initialCachedCatalog = useMemo(() => readCachedMaterialsCatalog(), []);
  const [products, setProducts] = useState<MaterialProduct[]>(() => initialCachedCatalog?.products ?? []);
  const [loading, setLoading] = useState(() => !(initialCachedCatalog?.products?.length));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<MaterialsCatalogSort>("recommended");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pickupNotes, setPickupNotes] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<Record<string, string>>({});
  const [serviceOffline, setServiceOffline] = useState(false);
  const [catalogSource, setCatalogSource] = useState<MaterialsCatalogLoadResult["source"] | null>(
    initialCachedCatalog ? "cache" : null
  );
  const [catalogCachedAt, setCatalogCachedAt] = useState<number | null>(
    initialCachedCatalog?.cachedAt ?? null
  );
  const [catalogFetchedAtIso, setCatalogFetchedAtIso] = useState<string | null>(
    initialCachedCatalog?.fetchedAtIso ?? null
  );
  const [catalogUpdatedAtIso, setCatalogUpdatedAtIso] = useState<string | null>(
    initialCachedCatalog?.catalogUpdatedAtIso ?? null
  );
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const cartRef = useRef<HTMLElement | null>(null);
  const baseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);

  const client = useMemo(() => {
    return createFunctionsClient({
      baseUrl,
      getIdToken: async () => await user.getIdToken(),
      getAdminToken: () => adminToken,
    });
  }, [adminToken, baseUrl, user]);

  const applyCatalogResult = (
    result: MaterialsCatalogLoadResult,
    options: { announceFallback?: boolean } = {}
  ) => {
    setProducts(result.products);
    setCatalogSource(result.source);
    setCatalogCachedAt(result.cachedAt);
    setCatalogFetchedAtIso(result.fetchedAtIso);
    setCatalogUpdatedAtIso(result.catalogUpdatedAtIso);
    setServiceOffline(false);
    setError("");
    if (result.source === "firestore_fallback" && options.announceFallback !== false) {
      setStatus("Store is running in fallback mode while functions auth is unavailable.");
    }
  };

  const refreshCatalog = async ({
    forceRefresh = false,
    announceFallback = true,
  }: {
    forceRefresh?: boolean;
    announceFallback?: boolean;
  } = {}) => {
    const cached = readCachedMaterialsCatalog();
    const hasVisibleCatalog = (cached?.products?.length ?? 0) > 0 || products.length > 0;

    setError("");
    setServiceOffline(false);
    if (hasVisibleCatalog) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await loadMaterialsCatalog({
        user,
        adminToken,
        baseUrl,
        forceRefresh,
      });
      applyCatalogResult(result, { announceFallback });
    } catch (nextError: unknown) {
      if (isConnectivityError(nextError)) {
        setServiceOffline(true);
        setError(serviceOfflineMessage());
      } else {
        setError(getErrorMessage(nextError));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");

    if (statusParam === "success") {
      setStatus("Payment received. We’ll prep your pickup order now.");
      setCart({});
    } else if (statusParam === "cancel") {
      setStatus("Checkout canceled. Your cart is still here if you want to try again.");
    }
  }, []);

  useEffect(() => {
    const cached = readCachedMaterialsCatalog();
    if (cached?.products?.length) {
      setProducts(cached.products);
      setCatalogSource("cache");
      setCatalogCachedAt(cached.cachedAt);
      setCatalogFetchedAtIso(cached.fetchedAtIso ?? null);
      setCatalogUpdatedAtIso(cached.catalogUpdatedAtIso ?? null);
      setLoading(false);
    }

    const shouldRefresh = !cached?.products?.length || !cached.isFresh;
    if (!shouldRefresh) {
      return;
    }

    let canceled = false;
    const run = async () => {
      if (canceled) return;
      setError("");
      setServiceOffline(false);
      if (cached?.products?.length) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const result = await loadMaterialsCatalog({
          user,
          adminToken,
          baseUrl,
        });
        if (canceled) return;
        setProducts(result.products);
        setCatalogSource(result.source);
        setCatalogCachedAt(result.cachedAt);
        setCatalogFetchedAtIso(result.fetchedAtIso);
        setCatalogUpdatedAtIso(result.catalogUpdatedAtIso);
        setServiceOffline(false);
        setError("");
        if (result.source === "firestore_fallback") {
          setStatus("Store is running in fallback mode while functions auth is unavailable.");
        }
      } catch (nextError: unknown) {
        if (canceled) return;
        if (isConnectivityError(nextError)) {
          setServiceOffline(true);
          setError(serviceOfflineMessage());
        } else {
          setError(getErrorMessage(nextError));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [adminToken, baseUrl, user]);

  const groupedProducts = useMemo(() => {
    return groupMaterialsProducts(products);
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    groupedProducts.forEach((group) => {
      if (group.category) set.add(group.category);
    });
    return ["All", ...Array.from(set).sort()];
  }, [groupedProducts]);

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
    return sortMaterialsGroups(
      filterMaterialsGroups(groupedProducts, deferredSearch, category),
      sort
    );
  }, [category, deferredSearch, groupedProducts, sort]);

  const productMap = useMemo(() => {
    const map = new Map<string, MaterialProduct>();
    products.forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      Object.entries(prev).forEach(([productId, quantity]) => {
        if (!productMap.has(productId) || quantity <= 0) {
          changed = true;
          return;
        }
        next[productId] = quantity;
      });
      return changed ? next : prev;
    });
  }, [productMap]);

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

  const cartCount = useMemo(() => {
    return cartLines.reduce((total, line) => total + line.quantity, 0);
  }, [cartLines]);

  const catalogNote = useMemo(() => {
    return getCatalogNote({
      source: catalogSource,
      refreshing,
      fetchedAtIso: catalogFetchedAtIso,
      catalogUpdatedAtIso,
      cachedAt: catalogCachedAt,
    });
  }, [catalogCachedAt, catalogFetchedAtIso, catalogSource, catalogUpdatedAtIso, refreshing]);

  const canSeed = isStaff || !!adminToken?.trim();
  const canCheckout = cartLines.length > 0 && !checkoutBusy;
  const isInitialLoad = loading && products.length === 0;

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

  const scrollToCart = () => {
    cartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    } catch (nextError: unknown) {
      setStatus(checkoutErrorMessage(nextError));
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCheckoutHandlerError = (nextError: unknown) => {
    setStatus(checkoutErrorMessage(nextError));
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
      await refreshCatalog({ forceRefresh: true, announceFallback: false });
    } catch (nextError: unknown) {
      if (!isStaff || !isAuthTokenError(nextError)) {
        setStatus(getErrorMessage(nextError));
        return;
      }

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

        setStatus("Sample catalog seeded via Firestore fallback.");
        await refreshCatalog({ forceRefresh: true, announceFallback: false });
      } catch (fallbackError: unknown) {
        setStatus(getErrorMessage(fallbackError || nextError));
      }
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
        <div className="materials-banner-copy">
          <div className="card-title">Studio pickup, built for quick reorders</div>
          <p className="materials-copy">
            Grab clay, tools, and studio access without leaving the portal. Payment stays secure with
            Stripe, and the studio will prep everything for pickup.
          </p>
        </div>
        <div className="materials-banner-meta">
          <div>
            <span className="summary-label">Pickup window</span>
            <span className="summary-value">1–2 business days</span>
          </div>
          <div>
            <span className="summary-label">How it works</span>
            <span className="summary-value">Pay now, pick up at the studio</span>
          </div>
        </div>
      </section>

      <section className="materials-toolbar">
        {serviceOffline ? <div className="alert inline-alert">{serviceOfflineMessage()}</div> : null}
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
          <button
            className="btn btn-ghost"
            onClick={toVoidHandler(() => refreshCatalog({ forceRefresh: true }))}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? "Refreshing..." : "Refresh catalog"}
          </button>
          {products.length === 0 && canSeed ? (
            <button
              className="btn btn-primary"
              onClick={toVoidHandler(handleSeedCatalog)}
              disabled={seedBusy}
            >
              {seedBusy ? "Seeding..." : "Seed sample catalog"}
            </button>
          ) : null}
        </div>
        {catalogNote ? <div className="materials-cache-note">{catalogNote}</div> : null}
      </section>

      {cartLines.length > 0 ? (
        <button className="materials-mobile-cart-bar" onClick={scrollToCart}>
          <span>{getMobileCartLabel(cartCount)}</span>
          <strong>{formatCents(subtotalCents)}</strong>
          <span>View cart</span>
        </button>
      ) : null}

      <div className="materials-layout">
        <section className="materials-list">
          <div className="materials-results-bar">
            <div className="materials-results-copy">
              <span className="summary-label">Browse</span>
              <strong>{getResultsLabel(filteredGroups.length)}</strong>
              <span className="materials-results-detail">
                {category === "All" ? "All categories" : category}
              </span>
            </div>
            <label className="materials-sort">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as MaterialsCatalogSort)}>
                <option value="recommended">Recommended</option>
                <option value="priceLow">Price low to high</option>
                <option value="priceHigh">Price high to low</option>
                <option value="name">Name A-Z</option>
              </select>
            </label>
          </div>

          {isInitialLoad ? (
            <div className="materials-skeleton-grid" aria-hidden="true">
              <div className="materials-skeleton-card" />
              <div className="materials-skeleton-card" />
              <div className="materials-skeleton-card" />
            </div>
          ) : null}

          {error ? <div className="alert inline-alert">{error}</div> : null}

          {!isInitialLoad && products.length === 0 ? (
            <div className="card card-3d materials-empty">
              <div className="card-title">Catalog is empty</div>
              <p className="materials-copy">
                We are still loading supplies. If you are on staff, seed the sample catalog to get
                started.
              </p>
            </div>
          ) : null}

          {!isInitialLoad && products.length > 0 && filteredGroups.length === 0 ? (
            <div className="card card-3d materials-empty">
              <div className="card-title">No matches yet</div>
              <p className="materials-copy">
                Try a broader search or switch categories to see more studio supplies.
              </p>
            </div>
          ) : null}

          <div className="materials-grid">
            {filteredGroups.map((group) => {
              const selectedId = selectedVariant[group.id] ?? group.variants[0]?.product.id ?? "";
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
              const mediaUrl = selectedProduct.imageUrl ?? group.imageUrl;
              const mediaKey = mediaUrl ? `${group.id}:${selectedProduct.id}` : group.id;
              const showImage = Boolean(mediaUrl) && failedImages[mediaKey] !== true;

              return (
                <div key={group.id} className="card card-3d product-card">
                  <div className={`product-media ${resolveProductMediaTone(group.category)}`}>
                    {showImage ? (
                      <img
                        src={mediaUrl ?? ""}
                        alt={group.name}
                        loading="lazy"
                        onError={() =>
                          setFailedImages((prev) => ({
                            ...prev,
                            [mediaKey]: true,
                          }))
                        }
                      />
                    ) : (
                      <div className="product-placeholder">
                        <span className="product-placeholder-eyebrow">
                          {resolveProductPlaceholderLabel(group.category)}
                        </span>
                        <strong>{selected.label !== "Standard" ? selected.label : group.name}</strong>
                      </div>
                    )}
                  </div>

                  <div className="product-header">
                    <div>
                      <div className="product-title">{group.name}</div>
                      <div className="product-subtitle">
                        {selected.label !== "Standard" ? selected.label : group.category ?? "Studio pickup"}
                      </div>
                      {group.category ? <div className="product-category">{group.category}</div> : null}
                    </div>
                    <div className="product-price">{formatCents(selectedProduct.priceCents)}</div>
                  </div>

                  {group.description ? <p className="materials-copy">{group.description}</p> : null}

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
                      className="btn btn-primary product-add-button"
                      onClick={() => updateCart(selectedProduct.id, 1, available)}
                      disabled={disabled}
                    >
                      {disabled ? "Out of stock" : inCart > 0 ? "Add another" : "Add to cart"}
                    </button>
                    {inCart > 0 ? (
                      <div className="product-stepper" aria-label={`${group.name} quantity in cart`}>
                        <button
                          className="btn btn-ghost"
                          onClick={() => updateCart(selectedProduct.id, -1, available)}
                          disabled={inCart <= 0}
                        >
                          −
                        </button>
                        <span className="product-qty">{inCart} in cart</span>
                        <button
                          className="btn btn-ghost"
                          onClick={() => updateCart(selectedProduct.id, 1, available)}
                          disabled={disabled}
                        >
                          +
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside ref={cartRef} className="card card-3d materials-cart">
          <div className="materials-cart-header">
            <div className="card-title">Your cart</div>
            <div className="materials-cart-count">{getMobileCartLabel(cartCount)}</div>
          </div>

          {status ? <div className="notice inline-alert">{status}</div> : null}

          {cartLines.length === 0 ? (
            <p className="materials-copy">No items yet. Add what you need and we’ll hold your place.</p>
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
              placeholder="Let us know about timing, substitutions, or anything the studio should know."
            />
          </label>

          <button
            className="btn btn-primary"
            onClick={toVoidHandler(handleCheckout, handleCheckoutHandlerError, "materials.checkout")}
            disabled={!canCheckout}
          >
            {checkoutBusy ? "Starting checkout..." : "Continue to secure checkout"}
          </button>

          <button className="btn btn-ghost" onClick={() => setCart({})} disabled={cartLines.length === 0}>
            Clear cart items
          </button>
        </aside>
      </div>

      <section className="card card-3d materials-help">
        <div className="card-title">Need something special?</div>
        <p className="materials-copy">
          If you don’t see the clay body, tool, or add-on you need, send the studio a note and we’ll
          try to source it for you.
        </p>
      </section>
    </div>
  );
}
