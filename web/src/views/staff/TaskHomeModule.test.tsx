// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskHomeModule, { type StaffTaskHomeLane } from "./TaskHomeModule";

describe("studio overview", () => {
  it("shows the selected area's status and opens its workflow", () => {
    const onAction = vi.fn();
    const lanes: StaffTaskHomeLane[] = [{ id: "floor", title: "Floor", subtitle: "", cards: [
      { id: "firings", eyebrow: "", title: "Firings", badge: "2 active", tone: "watch", summary: "Two firings underway.", metrics: [{ label: "Active", value: "2" }], actions: [] },
    ] }];
    render(<TaskHomeModule title="" summary="" clickBudgetNote="" attentionItems={[]} lanes={lanes} moreActions={[]} onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Firings: 2 active" }));
    const detail = screen.getByTestId("staff-task-home-card-firings");
    expect(within(detail).getByText("Two firings underway.")).toBeTruthy();
    expect(within(detail).getByText("2 active")).toBeTruthy();
    fireEvent.click(within(detail).getByRole("button", { name: "View firings" }));
    expect(onAction).toHaveBeenCalledWith("firings");
  });
});

