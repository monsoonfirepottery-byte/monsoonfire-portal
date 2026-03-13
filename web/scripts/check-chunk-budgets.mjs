import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const assetsDir = resolve(here, "../dist/assets");

const budgets = [
  { prefix: "vendor-react-", maxBytes: 210_000 },
  { prefix: "vendor-firebase-firestore-", maxBytes: 210_000 },
  { prefix: "vendor-firebase-auth-", maxBytes: 90_000 },
  { prefix: "vendor-firebase-core-", maxBytes: 80_000 },
  // Member reservations stays lazy-loaded, but it now carries booking feedback and inventory-aware UI.
  { prefix: "StudioReservationsView-", maxBytes: 40_000 },
  // Ware check-in remains its own lazy route after the reservation flow split.
  { prefix: "WareCheckInView-", maxBytes: 100_000 },
  // Staff stays lazy-loaded, but it now carries a broader operator workspace surface.
  { prefix: "StaffView-", maxBytes: 360_000 },
  // Current app shell carries route wiring and shared runtime used across most views.
  { prefix: "index-", maxBytes: 110_000 },
];
const requiredRouteChunks = [
  "DashboardView-",
  "StudioReservationsView-",
  "WareCheckInView-",
  "KilnLaunchView-",
  "KilnScheduleView-",
  "MyPiecesView-",
  "MessagesView-",
  "MaterialsView-",
  "EventsView-",
  "ProfileView-",
  "StaffView-",
];
// Total budgets re-baselined after the reservations/ware-check-in split and the new studio booking UI.
// Keep modest headroom so bundle regressions still fail quickly.
const MAX_TOTAL_JS_BYTES = 1_625_000;
const MAX_TOTAL_CSS_BYTES = 260_000;

const files = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
const failures = [];

for (const budget of budgets) {
  const match = files.find((name) => name.startsWith(budget.prefix));
  if (!match) {
    failures.push(`${budget.prefix} missing in dist/assets`);
    continue;
  }
  const size = statSync(resolve(assetsDir, match)).size;
  if (size > budget.maxBytes) {
    failures.push(`${match}: ${size} bytes exceeds ${budget.maxBytes} bytes`);
  }
}

for (const prefix of requiredRouteChunks) {
  const present = files.some((name) => name.startsWith(prefix));
  if (!present) {
    failures.push(`Missing route chunk for prefix "${prefix}"`);
  }
}

const allJs = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
const totalJsBytes = allJs.reduce((sum, name) => sum + statSync(resolve(assetsDir, name)).size, 0);
if (totalJsBytes > MAX_TOTAL_JS_BYTES) {
  failures.push(`Total JS size ${totalJsBytes} exceeds ${MAX_TOTAL_JS_BYTES} bytes`);
}

const allCss = readdirSync(assetsDir).filter((name) => name.endsWith(".css"));
const totalCssBytes = allCss.reduce(
  (sum, name) => sum + statSync(resolve(assetsDir, name)).size,
  0
);
if (totalCssBytes > MAX_TOTAL_CSS_BYTES) {
  failures.push(`Total CSS size ${totalCssBytes} exceeds ${MAX_TOTAL_CSS_BYTES} bytes`);
}

if (failures.length) {
  console.error("Chunk budget failures:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nRemediation playbook:");
  console.error("1) Confirm route remains lazily imported from App shell.");
  console.error("2) Split heavy route-only dependencies behind dynamic imports.");
  console.error("3) Re-run `npm --prefix web run build && npm --prefix web run perf:chunks`.");
  process.exit(1);
}

console.log("Chunk budgets passed.");
