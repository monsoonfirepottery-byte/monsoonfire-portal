/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SignedOutView from "./SignedOutView";

afterEach(() => {
  cleanup();
});

function renderSignedOutView() {
  const props = {
    onProviderSignIn: vi.fn(),
    onEmailPassword: vi.fn(),
    onEmailLink: vi.fn(),
    onCompleteEmailLink: vi.fn(),
    emailLinkPending: false,
    status: "",
    busy: false,
  };

  render(<SignedOutView {...props} />);
  return props;
}

describe("SignedOutView", () => {
  it("submits email password auth through a form", () => {
    const props = renderSignedOutView();
    const passwordInput = screen.getByLabelText("Password");
    const form = passwordInput.closest("form");

    expect(form).toBeTruthy();

    fireEvent.change(within(form as HTMLFormElement).getByLabelText("Email"), {
      target: { value: " member@example.com " },
    });
    fireEvent.change(passwordInput, {
      target: { value: "studio-secret" },
    });
    fireEvent.submit(form as HTMLFormElement);

    expect(props.onEmailPassword).toHaveBeenCalledWith(
      "member@example.com",
      "studio-secret",
      "signin"
    );
  });

  it("submits the sign-in link request through a form", () => {
    const props = renderSignedOutView();
    const submitButton = screen.getByRole("button", { name: "Email me a sign-in link" });
    const form = submitButton.closest("form");

    expect(form).toBeTruthy();

    fireEvent.change(within(form as HTMLFormElement).getByLabelText("Email for link"), {
      target: { value: " kiln@example.com " },
    });
    fireEvent.submit(form as HTMLFormElement);

    expect(props.onEmailLink).toHaveBeenCalledWith("kiln@example.com");
  });
});
