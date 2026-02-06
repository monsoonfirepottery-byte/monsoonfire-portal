import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAX_IMAGE_BYTES = 500_000;
const LEGACY_HEAVY_IMAGES = [
  "kiln-isometric.png",
  "kiln-rentals-kilns.png",
  "kiln-rentals-checkin.png",
  "kiln-rentals-flow.png",
];

const here = fileURLToPath(new URL(".", import.meta.url));
const assetsDir = resolve(here, "../../assets");

describe("asset budget", () => {
  it("keeps source image assets under 500KB", () => {
    const entries = readdirSync(assetsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(png|jpe?g|webp|avif)$/i.test(name));

    const oversized = entries
      .map((name) => ({ name, size: statSync(resolve(assetsDir, name)).size }))
      .filter((entry) => entry.size > MAX_IMAGE_BYTES);

    expect(oversized).toEqual([]);
  });

  it("does not reintroduce legacy oversized kiln PNGs", () => {
    const entries = new Set(readdirSync(assetsDir));
    for (const name of LEGACY_HEAVY_IMAGES) {
      expect(entries.has(name)).toBe(false);
    }
  });
});
