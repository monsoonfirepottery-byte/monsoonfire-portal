import assert from "node:assert/strict";
import test from "node:test";

import { inspectPortalFirebaseErrorText } from "./portal-firebase-ops-toolbox.mjs";

test("inspectPortalFirebaseErrorText flags missing index signatures", () => {
  const findings = inspectPortalFirebaseErrorText(
    "9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/..."
  );

  assert.equal(findings.some((finding) => finding.code === "firestore-index-required"), true);
});

test("inspectPortalFirebaseErrorText flags undefined Firestore write hints", () => {
  const findings = inspectPortalFirebaseErrorText(
    "Firestore write failed because payload included undefined kilnName on batch document."
  );

  assert.equal(findings.some((finding) => finding.code === "firestore-undefined-write"), true);
});
