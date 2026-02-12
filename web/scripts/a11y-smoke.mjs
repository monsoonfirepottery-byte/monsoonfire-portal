import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function run() {
  const appTsx = read("src/App.tsx");
  const communityTsx = read("src/views/CommunityView.tsx");

  // App shell bypass + nav semantics
  assertIncludes(appTsx, 'className="skip-link"', "Missing skip link in App shell.");
  assertIncludes(appTsx, 'href="#main-content"', "Skip link does not target #main-content.");
  assertIncludes(appTsx, '<main id="main-content"', "Main landmark id is missing.");
  assertIncludes(appTsx, 'aria-controls="portal-sidebar-nav"', "Mobile nav missing aria-controls.");
  assertIncludes(appTsx, "aria-expanded={mobileNavOpen}", "Mobile nav missing aria-expanded binding.");
  assertIncludes(appTsx, 'case "dashboard"', "Dashboard route mapping missing.");
  assertIncludes(appTsx, 'case "kilnLaunch"', "Ware check-in route mapping missing.");
  assertIncludes(appTsx, 'case "kiln"', "Firings route mapping missing.");
  assertIncludes(appTsx, 'case "support"', "Support route mapping missing.");
  assertIncludes(appTsx, 'case "staff"', "Staff route mapping missing.");
  assertIncludes(appTsx, "<SignedOutView", "Signed-out auth flow mapping missing.");

  // Community reporting modal status semantics
  assertIncludes(
    communityTsx,
    'role={reportStatusIsError ? "alert" : "status"}',
    "Community report status live-region semantics missing."
  );
  assertIncludes(
    communityTsx,
    'role={appealStatusIsError ? "alert" : "status"}',
    "Community appeal status live-region semantics missing."
  );

  console.log("Portal accessibility smoke checks passed.");
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
