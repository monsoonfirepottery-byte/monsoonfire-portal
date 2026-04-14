/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PlaceholderView from "./PlaceholderView";

describe("PlaceholderView", () => {
  it("renders guided recovery actions instead of generic coming-soon copy", () => {
    render(<PlaceholderView title="Example area" subtitle="Fallback state" />);

    expect(
      screen.getByText(/This area is not ready for live studio work yet\./i),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return to dashboard" }).getAttribute("href")).toBe("/");
    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe(
      "mailto:support@monsoonfire.com",
    );
  });
});
