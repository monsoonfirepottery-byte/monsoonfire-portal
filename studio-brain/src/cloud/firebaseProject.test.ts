import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FIREBASE_PROJECT_ID, resolveFirebaseProjectId } from "./firebaseProject";

test("resolveFirebaseProjectId prefers explicit project id", () => {
  const resolved = resolveFirebaseProjectId("custom-project", {
    FIREBASE_PROJECT_ID: "env-project",
  } as NodeJS.ProcessEnv);

  assert.equal(resolved, "custom-project");
});

test("resolveFirebaseProjectId falls back through known env keys", () => {
  const resolved = resolveFirebaseProjectId(undefined, {
    PORTAL_PROJECT_ID: "portal-project",
  } as NodeJS.ProcessEnv);

  assert.equal(resolved, "portal-project");
});

test("resolveFirebaseProjectId reads FIREBASE_CONFIG json when present", () => {
  const resolved = resolveFirebaseProjectId(undefined, {
    FIREBASE_CONFIG: JSON.stringify({ projectId: "firebase-config-project" }),
  } as NodeJS.ProcessEnv);

  assert.equal(resolved, "firebase-config-project");
});

test("resolveFirebaseProjectId falls back to the repo default", () => {
  const resolved = resolveFirebaseProjectId(undefined, {} as NodeJS.ProcessEnv);

  assert.equal(resolved, DEFAULT_FIREBASE_PROJECT_ID);
});
