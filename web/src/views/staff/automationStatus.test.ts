import { describe, expect, it } from "vitest";
import { parseAutomationStatus } from "./automationStatus";

const now = Date.parse("2026-11-08T17:00:00Z");
const fresh = {
  version: 1, generatedAtMs: now - 60_000, issues: [],
  workflows: [{
    key: "prodSmoke", label: "Production Smoke", workflowFile: "portal-prod-smoke.yml",
    outputHint: "", runUrl: "https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/1",
    status: "completed", conclusion: "failure", createdAtMs: now - 120_000,
  }],
};

describe("shared automation status", () => {
  it("keeps a recent failed check actionable", () => {
    const result = parseAutomationStatus(fresh, now);
    expect(result.error).toBe("");
    expect(result.workflows[0]).toMatchObject({ conclusion: "failure", isStale: false });
  });

  it("keeps a stale snapshot readable without presenting its checks as current", () => {
    const result = parseAutomationStatus({ ...fresh, generatedAtMs: now - 66 * 60_000 }, now);
    expect(result.error).toContain("out of date");
    expect(result.workflows[0]).toMatchObject({ conclusion: "failure", isStale: true });
  });

  it("rejects a missing queue and strips links outside the repository", () => {
    expect(() => parseAutomationStatus({ ...fresh, workflows: [] }, now)).toThrow();
    const result = parseAutomationStatus({
      ...fresh, workflows: [{ ...fresh.workflows[0], runUrl: "https://untrusted.example/run" }],
    }, now);
    expect(result.workflows[0]?.runUrl).toBe("");
  });
});
