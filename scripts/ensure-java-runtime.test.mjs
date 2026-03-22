import test from "node:test";
import assert from "node:assert/strict";

import { getJavaExecutableName, normalizePlatformFor } from "./ensure-java-runtime.mjs";

test("normalizePlatformFor supports Windows mappings", () => {
  assert.deepEqual(normalizePlatformFor("win32", "x64"), {
    arch: "x64",
    os: "windows",
  });
});

test("getJavaExecutableName uses java.exe on Windows", () => {
  assert.equal(getJavaExecutableName("win32"), "java.exe");
  assert.equal(getJavaExecutableName("linux"), "java");
});
