/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import type { MaterialProduct } from "../api/portalContracts";
import MaterialsView from "./MaterialsView";

const { loadMaterialsCatalogMock, readCachedMaterialsCatalogMock, postJsonMock } = vi.hoisted(() => ({
  loadMaterialsCatalogMock: vi.fn<(options: unknown) => Promise<unknown>>(),
  readCachedMaterialsCatalogMock: vi.fn<() => unknown>(),
  postJsonMock: vi.fn<(fn: string, payload?: unknown) => Promise<unknown>>(),
}));

vi.mock("../api/functionsClient", () => ({
  createFunctionsClient: () => ({
    postJson: postJsonMock,
  }),
}));

vi.mock("../utils/functionsBaseUrl", () => ({
  resolveFunctionsBaseUrl: () => "https://functions.example.test",
}));

vi.mock("../firebase", () => ({
  db: { name: "mock-db" },
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
  serverTimestamp: vi.fn(() => "server-ts"),
  setDoc: vi.fn(async () => undefined),
}));

vi.mock("./materialsCatalog", async () => {
  const actual = await vi.importActual<typeof import("./materialsCatalog")>("./materialsCatalog");
  return {
    ...actual,
    loadMaterialsCatalog: loadMaterialsCatalogMock,
    readCachedMaterialsCatalog: readCachedMaterialsCatalogMock,
  };
});

function createUser(uid = "user-1"): User {
  return {
    uid,
    getIdToken: vi.fn(async () => "id-token"),
  } as User;
}

function createProduct(
  id: string,
  name: string,
  category: string,
  priceCents: number
): MaterialProduct {
  return {
    id,
    name,
    category,
    priceCents,
    currency: "USD",
    stripePriceId: `price_${id}`,
    imageUrl: null,
    trackInventory: false,
    active: true,
  };
}

beforeEach(() => {
  loadMaterialsCatalogMock.mockReset();
  readCachedMaterialsCatalogMock.mockReset();
  postJsonMock.mockReset();
  postJsonMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MaterialsView storefront loading", () => {
  it("shows cached products immediately and refreshes in place when cache is stale", async () => {
    const cachedProduct = createProduct("cached-clay", "Cached Clay", "Clays", 3200);
    const freshProduct = createProduct("fresh-clay", "Fresh Clay", "Clays", 3400);

    readCachedMaterialsCatalogMock.mockImplementation(() => ({
      products: [cachedProduct],
      cachedAt: Date.now() - 12 * 60_000,
      fetchedAtIso: "2026-03-12T09:00:00.000Z",
      catalogUpdatedAtIso: "2026-03-12T08:58:00.000Z",
      ageMs: 12 * 60_000,
      ageMinutes: 12,
      isFresh: false,
    }));
    loadMaterialsCatalogMock.mockResolvedValue({
      products: [freshProduct],
      source: "network",
      cachedAt: Date.now(),
      fetchedAtIso: "2026-03-12T09:12:00.000Z",
      catalogUpdatedAtIso: "2026-03-12T09:11:00.000Z",
      ageMs: 0,
      ageMinutes: 0,
      isFresh: true,
    });

    render(<MaterialsView user={createUser()} isStaff={false} />);

    expect(screen.getAllByText("Cached Clay").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText(/Refreshing catalog/i)).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getAllByText("Fresh Clay").length).toBeGreaterThan(0);
    });
  });

  it("refreshes in place and preserves current search text", async () => {
    const clayProduct = createProduct("bmix", "B-Mix - 25 lb", "Clays", 2800);

    readCachedMaterialsCatalogMock.mockImplementation(() => ({
      products: [clayProduct],
      cachedAt: Date.now(),
      fetchedAtIso: "2026-03-12T09:12:00.000Z",
      catalogUpdatedAtIso: "2026-03-12T09:11:00.000Z",
      ageMs: 0,
      ageMinutes: 0,
      isFresh: true,
    }));
    loadMaterialsCatalogMock.mockResolvedValue({
      products: [clayProduct],
      source: "network",
      cachedAt: Date.now(),
      fetchedAtIso: "2026-03-12T09:13:00.000Z",
      catalogUpdatedAtIso: "2026-03-12T09:13:00.000Z",
      ageMs: 0,
      ageMinutes: 0,
      isFresh: true,
    });

    render(<MaterialsView user={createUser()} isStaff={false} />);

    const search = screen.getByLabelText("Search") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "b-mix" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh catalog" }));

    await waitFor(() => {
      expect(loadMaterialsCatalogMock).toHaveBeenCalledWith(
        expect.objectContaining({ forceRefresh: true })
      );
    });
    expect(search.value).toBe("b-mix");
  });
});
