import { describe, expect, it } from "vitest";
import type { MaterialProduct } from "../api/portalContracts";
import { groupMaterialsProducts, sortMaterialsGroups } from "./materialsCatalog";

function product(
  id: string,
  name: string,
  category: string,
  priceCents: number,
  imageUrl: string | null = null
): MaterialProduct {
  return {
    id,
    name,
    category,
    priceCents,
    currency: "USD",
    stripePriceId: null,
    imageUrl,
    trackInventory: false,
    active: true,
  };
}

describe("materialsCatalog helpers", () => {
  it("groups variants under a shared storefront card and keeps the first available image", () => {
    const groups = groupMaterialsProducts([
      product("bmix-50", "B-Mix - 50 lb", "Clays", 4600),
      product("tool-1", "Needle Tool", "Tools", 800),
      product("bmix-25", "B-Mix - 25 lb", "Clays", 2800, "https://img.example/bmix.jpg"),
    ]);

    expect(groups.map((group) => group.name)).toEqual(["B-Mix", "Needle Tool"]);
    expect(groups[0]?.imageUrl).toBe("https://img.example/bmix.jpg");
    expect(groups[0]?.variants.map((variant) => variant.label)).toEqual(["25 lb", "50 lb"]);
  });

  it("sorts storefront groups by price and name when requested", () => {
    const groups = groupMaterialsProducts([
      product("wax", "Wax Resist", "Finishing", 1200),
      product("day-pass", "Studio Day Pass", "Studio Access", 4000),
      product("needle", "Needle Tool", "Tools", 800),
    ]);

    expect(sortMaterialsGroups(groups, "priceLow").map((group) => group.name)).toEqual([
      "Needle Tool",
      "Wax Resist",
      "Studio Day Pass",
    ]);
    expect(sortMaterialsGroups(groups, "name").map((group) => group.name)).toEqual([
      "Needle Tool",
      "Studio Day Pass",
      "Wax Resist",
    ]);
  });
});
