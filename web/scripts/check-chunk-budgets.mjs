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
  { prefix: "ReservationsView-", maxBytes: 45_000 },
  { prefix: "index-", maxBytes: 35_000 },
];
const MAX_TOTAL_JS_BYTES = 900_000;
const MAX_TOTAL_CSS_BYTES = 120_000;

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
  process.exit(1);
}

console.log("Chunk budgets passed.");
