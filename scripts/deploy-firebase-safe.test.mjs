import assert from "node:assert/strict";
import test from "node:test";

import {
  detectFirebaseApiKeyFailureSignature,
  inspectFirebaseBuildArtifacts,
  looksLikeFirebaseApiKey,
  parseJsonObjectFromMixedOutput,
  resolveFirebaseWebApiKey,
} from "./deploy-firebase-safe.mjs";

const SAMPLE_KEY = "AIzaSyC0dexValidExample_123456789";

test("looksLikeFirebaseApiKey validates expected key format", () => {
  assert.equal(looksLikeFirebaseApiKey(SAMPLE_KEY), true);
  assert.equal(looksLikeFirebaseApiKey("not-a-key"), false);
});

test("detectFirebaseApiKeyFailureSignature finds missing key signature", () => {
  const signature = detectFirebaseApiKeyFailureSignature(
    "Missing VITE_FIREBASE_API_KEY. Set it in web/.env.local for local dev and GitHub secrets for CI deploy builds."
  );
  assert.deepEqual(signature, {
    code: "missing_vite_firebase_api_key",
    message: "Frontend build/runtime is missing VITE_FIREBASE_API_KEY.",
  });
});

test("detectFirebaseApiKeyFailureSignature finds invalid API key signature", () => {
  const signature = detectFirebaseApiKeyFailureSignature(
    "{\"error\":{\"status\":\"INVALID_ARGUMENT\",\"message\":\"API key not valid. Please pass a valid API key.\",\"details\":[{\"reason\":\"API_KEY_INVALID\"}]}}"
  );
  assert.deepEqual(signature, {
    code: "firebase_api_key_invalid",
    message: "Firebase Identity Toolkit rejected the API key as invalid.",
  });
});

test("inspectFirebaseBuildArtifacts blocks placeholder tokens", () => {
  const result = inspectFirebaseBuildArtifacts([
    {
      path: "/tmp/index.js",
      content: "const apiKey='MISSING_VITE_FIREBASE_API_KEY';",
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "firebase_api_key_placeholder_token_detected");
});

test("inspectFirebaseBuildArtifacts blocks missing embedded key", () => {
  const result = inspectFirebaseBuildArtifacts([
    {
      path: "/tmp/index.js",
      content: "console.log('bundle');",
    },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "firebase_api_key_not_embedded");
});

test("inspectFirebaseBuildArtifacts passes when key is embedded", () => {
  const result = inspectFirebaseBuildArtifacts([
    {
      path: "/tmp/index.js",
      content: `const ENV={VITE_FIREBASE_API_KEY:"${SAMPLE_KEY}"};`,
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.code, "firebase_api_key_embedded");
});

test("inspectFirebaseBuildArtifacts allows fallback token when key is embedded", () => {
  const result = inspectFirebaseBuildArtifacts([
    {
      path: "/tmp/index.js",
      content: `const ENV={VITE_FIREBASE_API_KEY:"${SAMPLE_KEY}"};const x="MISSING_VITE_FIREBASE_API_KEY";`,
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.code, "firebase_api_key_embedded_with_fallback_token");
});

test("parseJsonObjectFromMixedOutput tolerates prefixed logs", () => {
  const parsed = parseJsonObjectFromMixedOutput("noise...\n{\"apiKey\":\"abc\"}\nmore-noise");
  assert.deepEqual(parsed, { apiKey: "abc" });
});

test("resolveFirebaseWebApiKey prioritizes VITE env key", () => {
  const result = resolveFirebaseWebApiKey({
    project: "monsoonfire-portal",
    env: {
      VITE_FIREBASE_API_KEY: SAMPLE_KEY,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "VITE_FIREBASE_API_KEY");
});
