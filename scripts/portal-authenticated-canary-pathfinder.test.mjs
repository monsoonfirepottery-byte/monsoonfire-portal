import test from "node:test";
import assert from "node:assert/strict";
import { verifyPathfinderHandoff } from "./portal-authenticated-canary.mjs";

function fakePage() {
  const events = [];
  let checked = false;
  return {
    events,
    async waitForURL(predicate) {
      assert.equal(predicate(new URL("https://monsoonfire.com/firing-services/pathfinder/")), true);
      assert.equal(predicate(new URL("https://monsoonfire.com/other")), false);
      events.push("website");
    },
    async goto(url) { events.push(`return:${url}`); },
    getByRole(role, options) {
      const name = String(options.name);
      const control = {
        first() { return this; },
        async waitFor() { events.push(`${role}:${name}`); },
        async check() { checked = true; events.push("select"); },
        async click() { events.push(name.includes("Continue") ? "continue" : "back"); },
        async isChecked() { return checked; },
      };
      return control;
    },
  };
}

test("Pathfinder handoff checks navigation and preserves selection across back", async () => {
  const page = fakePage();
  await verifyPathfinderHandoff(page, "https://portal.example.test", true, async (_page, section, item) => {
    assert.equal(section, "Firing Services");
    assert.equal(item, "Ware Check-in");
  });
  assert.ok(page.events.includes("select"));
  assert.ok(page.events.includes("continue"));
  assert.ok(page.events.includes("back"));
  assert.ok(page.events.includes("return:https://portal.example.test"));
});

test("Pathfinder failure still restores the portal for later checks", async () => {
  const page = fakePage();
  await assert.rejects(verifyPathfinderHandoff(page, "https://portal.example.test", false, async () => { throw new Error("link failed"); }), /link failed/);
  assert.ok(page.events.includes("return:https://portal.example.test"));
});
