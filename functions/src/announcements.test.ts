import test from "node:test";
import assert from "node:assert/strict";

import { buildQaAnnouncementCleanupRange } from "./announcements";

test("qa announcement cleanup range matches the fixture id prefix", () => {
  assert.deepEqual(buildQaAnnouncementCleanupRange(), {
    startAt: "qa-fixture-studio-update-",
    endBefore: "qa-fixture-studio-update-\uf8ff",
  });
});

test("qa announcement cleanup range can target the legacy qa id prefix", () => {
  assert.deepEqual(buildQaAnnouncementCleanupRange("qa-studio-update-"), {
    startAt: "qa-studio-update-",
    endBefore: "qa-studio-update-\uf8ff",
  });
});
