/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FunctionsClient } from "../../api/functionsClient";
import PolicyModule from "./PolicyModule";
import StaffWorkspaceNav from "./StaffWorkspaceNav";

afterEach(cleanup);

describe("staff administration", () => {
  it("opens administration destinations without a second disclosure", () => {
    const onNavigate = vi.fn();
    render(<StaffWorkspaceNav active="today" onNavigate={onNavigate} onHome={() => {}} onMessages={() => {}} onReservations={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    const nav = screen.getByRole("navigation", { name: "Administration" });
    expect(nav.closest("details")).toBeNull();
    fireEvent.click(within(nav).getByRole("button", { name: "Policies & integrations" }));
    expect(onNavigate).toHaveBeenCalledWith("policyAgentOps");
  });

  it("shows unknown safety posture instead of a healthy default while loading", () => {
    const client = { postJson: () => new Promise(() => {}) } as unknown as FunctionsClient;
    render(<PolicyModule client={client} active disabled={false} />);
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.getByText("Safety posture unavailable until controls load.")).toBeTruthy();
    expect(screen.queryByText("Safety controls are active and auto-flagging is enabled.")).toBeNull();
  });

  it("prevents safety updates when settings cannot be loaded", async () => {
    const postJson = vi.fn(async (endpoint: string) => {
      if (endpoint === "staffGetCommunitySafetyConfig") throw new Error("Unavailable");
      return { ok: true, policies: [] };
    });
    render(<PolicyModule client={{ postJson } as unknown as FunctionsClient} active disabled={false} />);
    expect(await screen.findByText("Refresh policy to load all safety settings before changing them.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save safety controls" });
    expect(save.closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(save);
    expect(postJson.mock.calls.some(([endpoint]) => endpoint === "staffUpdateCommunitySafetyConfig")).toBe(false);
  });

  it("enables safety controls after a complete successful load", async () => {
    const postJson = vi.fn(async (endpoint: string) => {
      if (endpoint === "staffGetCommunitySafetyConfig") return { ok: true, config: { enabled: true, publishKillSwitch: false, autoFlagEnabled: true, highSeverityThreshold: 70, mediumSeverityThreshold: 30, blockedTerms: [], blockedUrlHosts: [] } };
      return { ok: true, policies: [] };
    });
    render(<PolicyModule client={{ postJson } as unknown as FunctionsClient} active disabled={false} />);
    await screen.findByText("Safety controls are active and auto-flagging is enabled.");
    expect(screen.getByRole("button", { name: "Save safety controls" }).closest("fieldset")?.disabled).toBe(false);
  });

  it("keeps safety controls locked when the server returns incomplete settings", async () => {
    const postJson = vi.fn(async (endpoint: string) => endpoint === "staffGetCommunitySafetyConfig"
      ? { ok: true, config: { enabled: true, publishKillSwitch: false, autoFlagEnabled: true } }
      : { ok: true, policies: [] });
    render(<PolicyModule client={{ postJson } as unknown as FunctionsClient} active disabled={false} />);
    await screen.findByText("Status unavailable · review controls");
    expect(screen.queryByText("Safety controls are active and auto-flagging is enabled.")).toBeNull();
    const save = screen.getByRole("button", { name: "Save safety controls" });
    expect(save.closest("fieldset")?.disabled).toBe(true);
    fireEvent.click(save);
    expect(postJson.mock.calls.some(([endpoint]) => endpoint === "staffUpdateCommunitySafetyConfig")).toBe(false);
  });

  it("shows the published policy and actual safety warning", async () => {
    const client = { postJson: async (endpoint: string) => {
      if (endpoint === "getModerationPolicyCurrent") return { policy: null };
      if (endpoint === "listModerationPolicies") return { activeVersion: "v1", policies: [] };
      return { ok: true, config: { enabled: true, publishKillSwitch: true, autoFlagEnabled: true, highSeverityThreshold: 70, mediumSeverityThreshold: 30, blockedTerms: [], blockedUrlHosts: [] } };
    } } as unknown as FunctionsClient;
    render(<PolicyModule client={client} active disabled={false} />);
    expect(await screen.findByText("Version v1")).toBeTruthy();
    expect(screen.getAllByText(/Publish kill switch is active/).length).toBeGreaterThan(0);
  });
});
