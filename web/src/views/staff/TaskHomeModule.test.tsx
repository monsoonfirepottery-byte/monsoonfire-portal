// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskHomeModule, { type StaffTaskHomeLane } from "./TaskHomeModule";

describe("studio overview", () => {
  afterEach(cleanup);
  it("opens the selected area directly", () => {
    const onAction = vi.fn();
    const lanes: StaffTaskHomeLane[] = [{ id: "floor", title: "Floor", subtitle: "", cards: [
      { id: "firings", eyebrow: "", title: "Firings", badge: "2 active", tone: "watch", summary: "Two firings underway.", metrics: [{ label: "Active", value: "2" }], actions: [] },
    ] }];
    render(<TaskHomeModule title="" summary="" clickBudgetNote="" attentionItems={[]} lanes={lanes} moreActions={[]} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Kiln schedule: 2 active" }));
    expect(onAction).toHaveBeenCalledWith("kilnSchedule");
    fireEvent.click(document.querySelector(".staff-studio-marker-intake")!);
    expect(onAction).toHaveBeenCalledWith("pathfinder");
  });
  it("uses a view transition for navigation and cleans up after it finishes", async () => {
    const onAction = vi.fn();
    const start = vi.fn((callback: () => void) => { callback(); return { finished: Promise.resolve() }; });
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    try {
      render(<TaskHomeModule title="" summary="" clickBudgetNote="" attentionItems={[]} lanes={[]} moreActions={[]} onAction={onAction} />);
      fireEvent.click(document.querySelector(".staff-studio-marker-kiln")!);
      expect(start).toHaveBeenCalledTimes(1);
      expect(onAction).toHaveBeenCalledWith("kilnSchedule");
      await Promise.resolve();
      expect(document.documentElement.classList.contains("staff-studio-transition")).toBe(false);
    } finally {
      delete (document as Partial<Document>).startViewTransition;
    }
  });
  it("opens directly when reduced motion is requested", () => {
    const onAction = vi.fn();
    const start = vi.fn();
    Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    try {
      render(<TaskHomeModule title="" summary="" clickBudgetNote="" attentionItems={[]} lanes={[]} moreActions={[]} onAction={onAction} />);
      fireEvent.click(document.querySelector(".staff-studio-marker-kiln")!);
      expect(onAction).toHaveBeenCalledWith("kilnSchedule");
      expect(start).not.toHaveBeenCalled();
    } finally {
      delete (document as Partial<Document>).startViewTransition;
      vi.unstubAllGlobals();
    }
  });
});



