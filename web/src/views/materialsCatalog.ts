import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import type { ListMaterialsProductsResponse, MaterialProduct } from "../api/portalContracts";
import { createFunctionsClient } from "../api/functionsClient";
import { db } from "../firebase";
import { safeStorageReadJson, safeStorageSetItem } from "../lib/safeStorage";
import { resolveFunctionsBaseUrl } from "../utils/functionsBaseUrl";

const CATALOG_CACHE_KEY = "mf_materials_catalog_v1";
export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

const CATEGORY_PRIORITY = [
  "Studio Access",
  "Clays",
  "Tools",
  "Glazes",
  "Finishing",
  "Resources",
];

type CachedCatalog = {
  cachedAt: number;
  fetchedAtIso: string | null;
  catalogUpdatedAtIso: string | null;
  products: MaterialProduct[];
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

export type MaterialsCatalogSnapshot = CachedCatalog & {
  ageMs: number;
  ageMinutes: number;
  isFresh: boolean;
};

export type MaterialsCatalogLoadSource = "cache" | "network" | "firestore_fallback";

export type MaterialsCatalogLoadResult = {
  products: MaterialProduct[];
  source: MaterialsCatalogLoadSource;
  cachedAt: number;
  fetchedAtIso: string | null;
  catalogUpdatedAtIso: string | null;
  ageMs: number;
  ageMinutes: number;
  isFresh: boolean;
};

export type MaterialsCatalogSort = "recommended" | "priceLow" | "priceHigh" | "name";

export type VariantOption = {
  product: MaterialProduct;
  label: string;
};

export type ProductGroup = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  variants: VariantOption[];
};

type LoadMaterialsCatalogOptions = {
  user: User;
  adminToken?: string;
  baseUrl?: string;
  forceRefresh?: boolean;
};

let inFlightCatalogLoad: Promise<MaterialsCatalogLoadResult> | null = null;

function getCategoryPriority(category: string | null | undefined) {
  const normalized = String(category ?? "").trim();
  const index = CATEGORY_PRIORITY.findIndex(
    (entry) => entry.toLowerCase() === normalized.toLowerCase()
  );
  return index >= 0 ? index : CATEGORY_PRIORITY.length;
}

function readCachedCatalogEntry(): CachedCatalog | null {
  const parsed = safeStorageReadJson<CachedCatalog>("localStorage", CATALOG_CACHE_KEY, null);
  if (!parsed || typeof parsed.cachedAt !== "number" || !Array.isArray(parsed.products)) return null;
  return {
    cachedAt: parsed.cachedAt,
    fetchedAtIso: parsed.fetchedAtIso ?? null,
    catalogUpdatedAtIso: parsed.catalogUpdatedAtIso ?? null,
    products: parsed.products,
  };
}

function toSnapshot(entry: CachedCatalog): MaterialsCatalogSnapshot {
  const ageMs = Math.max(Date.now() - entry.cachedAt, 0);
  return {
    cachedAt: entry.cachedAt,
    fetchedAtIso: entry.fetchedAtIso ?? null,
    catalogUpdatedAtIso: entry.catalogUpdatedAtIso ?? null,
    products: entry.products,
    ageMs,
    ageMinutes: Math.max(Math.round(ageMs / 60_000), 0),
    isFresh: ageMs <= CATALOG_CACHE_TTL_MS,
  };
}

function toLoadResult(entry: CachedCatalog, source: MaterialsCatalogLoadSource): MaterialsCatalogLoadResult {
  const snapshot = toSnapshot(entry);
  return {
    ...snapshot,
    source,
  };
}

function writeCachedCatalog(
  products: MaterialProduct[],
  metadata?: Pick<ListMaterialsProductsResponse, "fetchedAtIso" | "catalogUpdatedAtIso">
): MaterialsCatalogLoadResult {
  const payload: CachedCatalog = {
    cachedAt: Date.now(),
    products,
    fetchedAtIso: metadata?.fetchedAtIso ?? null,
    catalogUpdatedAtIso: metadata?.catalogUpdatedAtIso ?? null,
  };
  try {
    safeStorageSetItem("localStorage", CATALOG_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore cache write failures
  }
  return toLoadResult(payload, "network");
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

export function slugify(value: string) {
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

function normalizeProductName(value: string) {
  return value.trim().toLowerCase();
}

export function compareRecommendedMaterials(left: MaterialProduct, right: MaterialProduct) {
  const categoryDelta =
    getCategoryPriority(left.category) - getCategoryPriority(right.category);
  if (categoryDelta !== 0) return categoryDelta;

  const leftVariant = parseVariantName(left.name);
  const rightVariant = parseVariantName(right.name);
  const baseNameDelta = normalizeProductName(leftVariant.baseName).localeCompare(
    normalizeProductName(rightVariant.baseName)
  );
  if (baseNameDelta !== 0) return baseNameDelta;

  return normalizeProductName(leftVariant.variantLabel).localeCompare(
    normalizeProductName(rightVariant.variantLabel)
  );
}

function sortProductsRecommended(products: MaterialProduct[]) {
  return [...products].sort(compareRecommendedMaterials);
}

function readMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const maybe = value as {
      toMillis?: () => number;
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof maybe.toMillis === "function") {
      try {
        const millis = maybe.toMillis();
        return Number.isFinite(millis) ? millis : 0;
      } catch {
        return 0;
      }
    }
    if (typeof maybe.toDate === "function") {
      try {
        const millis = maybe.toDate().getTime();
        return Number.isFinite(millis) ? millis : 0;
      } catch {
        return 0;
      }
    }
    if (typeof maybe.seconds === "number") {
      return Math.round(maybe.seconds * 1000 + (maybe.nanoseconds ?? 0) / 1_000_000);
    }
  }
  return 0;
}

async function fetchCatalogFromApi({
  user,
  adminToken,
  baseUrl = resolveFunctionsBaseUrl(),
}: LoadMaterialsCatalogOptions): Promise<MaterialsCatalogLoadResult> {
  const client = createFunctionsClient({
    baseUrl,
    getIdToken: async () => await user.getIdToken(),
    getAdminToken: () => adminToken,
  });

  try {
    const resp = await client.postJson<ListMaterialsProductsResponse>("listMaterialsProducts", {
      includeInactive: false,
    });
    const products = sortProductsRecommended(Array.isArray(resp.products) ? resp.products : []);
    return writeCachedCatalog(products, resp);
  } catch (error: unknown) {
    if (!isAuthTokenError(error)) {
      throw error;
    }

    const snap = await getDocs(collection(db, "materialsProducts"));
    const fallbackProducts = sortProductsRecommended(
      snap.docs
        .map((docSnap) =>
          normalizeProductFromDoc(docSnap.id, (docSnap.data() as MaterialProductFirestoreDoc) ?? {})
        )
        .filter((product) => product.active)
    );
    const latestUpdatedMs = snap.docs.reduce((maxValue, docSnap) => {
      const data = (docSnap.data() as Record<string, unknown>) ?? {};
      return Math.max(
        maxValue,
        readMillis(data.updatedAt),
        readMillis(data.createdAt)
      );
    }, 0);
    const result = writeCachedCatalog(fallbackProducts, {
      fetchedAtIso: new Date().toISOString(),
      catalogUpdatedAtIso: latestUpdatedMs > 0 ? new Date(latestUpdatedMs).toISOString() : null,
    });
    return {
      ...result,
      source: "firestore_fallback",
    };
  }
}

export function readCachedMaterialsCatalog(): MaterialsCatalogSnapshot | null {
  const cached = readCachedCatalogEntry();
  return cached ? toSnapshot(cached) : null;
}

export async function loadMaterialsCatalog(
  options: LoadMaterialsCatalogOptions
): Promise<MaterialsCatalogLoadResult> {
  const cached = readCachedMaterialsCatalog();
  if (!options.forceRefresh && cached?.isFresh) {
    return {
      ...cached,
      source: "cache",
    };
  }

  if (inFlightCatalogLoad) {
    return inFlightCatalogLoad;
  }

  const run = fetchCatalogFromApi(options).finally(() => {
    if (inFlightCatalogLoad === run) {
      inFlightCatalogLoad = null;
    }
  });
  inFlightCatalogLoad = run;
  return run;
}

export function preloadMaterialsCatalog(options: LoadMaterialsCatalogOptions) {
  return loadMaterialsCatalog(options);
}

function getGroupSortPrice(group: ProductGroup) {
  return group.variants.reduce((lowest, variant) => {
    return Math.min(lowest, variant.product.priceCents);
  }, Number.POSITIVE_INFINITY);
}

export function groupMaterialsProducts(products: MaterialProduct[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  const sortedProducts = sortProductsRecommended(products);

  sortedProducts.forEach((product) => {
    const { baseName, variantLabel } = parseVariantName(product.name);
    const id = slugify(baseName);
    const existing = map.get(id);
    const option: VariantOption = {
      product,
      label: variantLabel || "Standard",
    };

    if (!existing) {
      map.set(id, {
        id,
        name: baseName,
        description: product.description ?? null,
        category: product.category ?? null,
        imageUrl: product.imageUrl ?? null,
        variants: [option],
      });
      return;
    }

    existing.variants.push(option);
    if (!existing.description && product.description) {
      existing.description = product.description;
    }
    if (!existing.imageUrl && product.imageUrl) {
      existing.imageUrl = product.imageUrl;
    }
  });

  return Array.from(map.values()).map((group) => ({
    ...group,
    variants: [...group.variants].sort((left, right) => left.label.localeCompare(right.label)),
  }));
}

export function filterMaterialsGroups(groups: ProductGroup[], search: string, category: string) {
  const term = search.trim().toLowerCase();
  return groups.filter((group) => {
    const matchesCategory = category === "All" || group.category === category;
    if (!matchesCategory) return false;
    if (!term) return true;
    return (
      group.name.toLowerCase().includes(term) ||
      (group.description ?? "").toLowerCase().includes(term) ||
      group.variants.some((variant) => {
        return (
          variant.label.toLowerCase().includes(term) ||
          variant.product.name.toLowerCase().includes(term)
        );
      })
    );
  });
}

export function sortMaterialsGroups(groups: ProductGroup[], sort: MaterialsCatalogSort) {
  const next = [...groups];
  if (sort === "name") {
    return next.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (sort === "priceLow") {
    return next.sort((left, right) => {
      const priceDelta = getGroupSortPrice(left) - getGroupSortPrice(right);
      if (priceDelta !== 0) return priceDelta;
      return left.name.localeCompare(right.name);
    });
  }
  if (sort === "priceHigh") {
    return next.sort((left, right) => {
      const priceDelta = getGroupSortPrice(right) - getGroupSortPrice(left);
      if (priceDelta !== 0) return priceDelta;
      return left.name.localeCompare(right.name);
    });
  }
  return next.sort((left, right) => {
    const categoryDelta =
      getCategoryPriority(left.category) - getCategoryPriority(right.category);
    if (categoryDelta !== 0) return categoryDelta;
    return left.name.localeCompare(right.name);
  });
}
