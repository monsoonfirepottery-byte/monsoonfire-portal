/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import StaffCreateFiringTicket from "./StaffCreateFiringTicket";
import type { FunctionsClient } from "../../api/functionsClient";

afterEach(() => { cleanup(); sessionStorage.clear(); });

it("links a reviewed portal check-in and carries its saved requests", async () => {
  const postJson = vi.fn(async (name: string) => name === "staffGetFiringTicketCreationOptions" ? {
    ok: true, data: { people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }], firings: [], limits: { users: 1, profiles: 0, firings: 0 } },
  } : name === "staffGetFiringTicketClientHistory" ? { ok: true, data: { tickets: [], truncated: false, emailAvailable: true, reservations: [{ reservationId: "res-1", status: "REQUESTED", intakeMode: "WHOLE_KILN", firingType: "glaze", estimatedHalfShelves: 2, createdAt: "2026-10-29", privateRequested: true, rushRequested: true, communitySharingAllowed: false }] } }
    : { ok: true, data: { ticketId: "MF-LINKED", duplicate: false } });
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  await actor.selectOptions(await screen.findByLabelText(/Link an existing portal check-in/i), "res-1");
  expect((screen.getByLabelText("Space") as HTMLSelectElement).value).toBe("large");
  expect((screen.getByRole("checkbox", { name: /Fire tonight/i }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: /Fire tonight/i }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  await actor.click(screen.getByRole("button", { name: "Save firing ticket" }));
  await waitFor(() => expect(postJson).toHaveBeenCalledWith("staffCreateFiringTicket", expect.objectContaining({ reservationId: "res-1", reviewedExistingTicketsAndPayments: true })));
});

it("requires a client, an unloaded firing, and a review before submitting", async () => {
  const postJson = vi.fn(async (name: string) => name === "staffGetFiringTicketCreationOptions" ? {
    ok: true, data: {
      people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }],
      firings: [{ id: "f1", title: "Kiln A", startAt: "2026-10-01", unloadedAt: "2026-10-02", status: "complete" }],
      limits: { users: 1, profiles: 0, firings: 1 },
    },
  } : name === "staffGetFiringTicketClientHistory" ? { ok: true, data: {
    tickets: [{ ticketId: "MF-OLD", ownerUid: "u1", email: "artist@example.com", displayName: "Example Artist", firingId: "", status: "ready_for_pickup", billingStatus: "paid", createdAt: null }],
    truncated: false, emailAvailable: true,
  } } : { ok: true, data: { ticketId: "MF-NEW", duplicate: false } });
  const client = { postJson } as unknown as FunctionsClient;
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={client} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  expect(await screen.findByText(/MF-OLD.*paid/)).toBeTruthy();
  await actor.selectOptions(screen.getByLabelText("Work stage"), "already_unloaded");
  await actor.selectOptions(screen.getByLabelText("Completed firing"), "f1");
  expect((screen.getByRole("button", { name: "Save firing ticket" }) as HTMLButtonElement).disabled).toBe(true);
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  await actor.click(screen.getByRole("button", { name: "Save firing ticket" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("MF-NEW"));
  expect(postJson).toHaveBeenCalledWith("staffCreateFiringTicket", expect.objectContaining({
    ownerUid: "u1", stage: "already_unloaded", firingId: "f1", spaceId: "large", firingType: "glaze",
    reviewedExistingTicketsAndPayments: true,
  }));
});

it("prevents saving when the client's history is incomplete", async () => {
  const postJson = vi.fn(async (name: string) => name === "staffGetFiringTicketCreationOptions" ? {
    ok: true, data: { people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }], firings: [], limits: { users: 1, profiles: 0, firings: 0 } },
  } : { ok: true, data: { tickets: [], truncated: true, emailAvailable: true } });
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  expect(await screen.findByText(/Ticket history is incomplete/)).toBeTruthy();
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  expect((screen.getByRole("button", { name: "Save firing ticket" }) as HTMLButtonElement).disabled).toBe(true);
  expect(postJson).not.toHaveBeenCalledWith("staffCreateFiringTicket", expect.anything());
});

it("prevents saving if the client's history cannot be loaded", async () => {
  const postJson = vi.fn(async (name: string) => {
    if (name === "staffGetFiringTicketCreationOptions") return {
      ok: true, data: { people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }], firings: [], limits: { users: 1, profiles: 0, firings: 0 } },
    };
    throw new Error("History unavailable");
  });
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  expect((await screen.findByRole("alert")).textContent).toContain("History unavailable");
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  expect((screen.getByRole("button", { name: "Save firing ticket" }) as HTMLButtonElement).disabled).toBe(true);
});

it("records an evidenced studio firing when there is no portal firing", async () => {
  const postJson = vi.fn(async (name: string) => name === "staffGetFiringTicketCreationOptions" ? {
    ok: true, data: { people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }], firings: [], limits: { users: 1, profiles: 0, firings: 0 } },
  } : name === "staffGetFiringTicketClientHistory" ? { ok: true, data: { tickets: [], truncated: false, emailAvailable: true } }
    : { ok: true, data: { ticketId: "MF-MANUAL", duplicate: false } });
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  await screen.findByText("No matching tickets found.");
  await actor.selectOptions(screen.getByLabelText("Work stage"), "already_unloaded");
  await actor.selectOptions(screen.getByLabelText("Firing record"), "studio_record");
  await actor.type(screen.getByLabelText("Firing date"), "2026-10-28");
  await actor.type(screen.getByLabelText("Kiln"), "Studio kiln");
  await actor.type(screen.getByLabelText("How was the firing verified?"), "Kiln log");
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  await actor.click(screen.getByRole("button", { name: "Save firing ticket" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("MF-MANUAL"));
  expect(postJson).toHaveBeenCalledWith("staffCreateFiringTicket", expect.objectContaining({
    firingId: null, manualFiring: { date: "2026-10-28", kiln: "Studio kiln", evidence: "Kiln log" },
  }));
});

it("retries the same request without allowing changes after an uncertain save", async () => {
  let saves = 0;
  const postJson = vi.fn(async (name: string, _payload?: unknown) => {
    if (name === "staffGetFiringTicketCreationOptions") return { ok: true, data: {
      people: [{ uid: "u1", displayName: "Example Artist", email: "artist@example.com" }], firings: [], limits: { users: 1, profiles: 0, firings: 0 },
    } };
    if (name === "staffGetFiringTicketClientHistory") return { ok: true, data: { tickets: [], truncated: false, emailAvailable: true } };
    saves += 1;
    if (saves === 1) throw new Error("Connection lost");
    return { ok: true, data: { ticketId: "MF-RETRIED", duplicate: true } };
  });
  const actor = userEvent.setup();
  const view = render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  await actor.type(await screen.findByLabelText("Find client"), "Example");
  await actor.selectOptions(screen.getByLabelText("Client"), "u1");
  await screen.findByText("No matching tickets found.");
  await actor.click(screen.getByRole("checkbox", { name: /I reviewed this client/i }));
  await actor.click(screen.getByRole("button", { name: "Save firing ticket" }));
  expect(await screen.findByText(/save result could not be confirmed/i)).toBeTruthy();
  expect(screen.getByLabelText("Space").matches(":disabled")).toBe(true);
  view.unmount();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={() => {}} />);
  expect(await screen.findByRole("button", { name: "Retry same request" })).toBeTruthy();
  expect(postJson.mock.calls.filter((call) => call[0] === "staffCreateFiringTicket")).toHaveLength(1);
  await actor.click(screen.getByRole("button", { name: "Retry same request" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("MF-RETRIED"));
  const requests = postJson.mock.calls.filter((call) => call[0] === "staffCreateFiringTicket");
  expect(requests).toHaveLength(2);
  expect(requests[0][1]).toEqual(requests[1][1]);
  expect(sessionStorage.getItem("mf:staff-ticket-pending:staff-test")).toBeNull();
});

it("keeps recovery scoped to the staff account and does not submit automatically", async () => {
  sessionStorage.setItem("mf:staff-ticket-pending:staff-a", JSON.stringify({
    clientRequestId: "pending-id", ownerUid: "artist-a", heatId: "mid", spaceId: "large", firingType: "glaze",
    stage: "new_dropoff", firingId: null, manualFiring: null, reviewedExistingTicketsAndPayments: true, note: "",
  }));
  const postJson = vi.fn(async (_name: string) => ({ ok: true, data: { people: [], firings: [], limits: { users: 0, profiles: 0, firings: 0 } } }));
  const client = { postJson } as unknown as FunctionsClient;
  const other = render(<StaffCreateFiringTicket client={client} staffUid="staff-b" onClose={() => {}} />);
  await screen.findByLabelText("Find client");
  expect(screen.queryByRole("button", { name: "Retry same request" })).toBeNull();
  other.unmount();
  render(<StaffCreateFiringTicket client={client} staffUid="staff-a" onClose={() => {}} />);
  expect(await screen.findByRole("button", { name: "Retry same request" })).toBeTruthy();
  expect(postJson.mock.calls.every((call) => call[0] !== "staffCreateFiringTicket")).toBe(true);
});

it("fails closed for unreadable recovery data until staff explicitly clears it", async () => {
  sessionStorage.setItem("mf:staff-ticket-pending:staff-test", "{broken");
  const postJson = vi.fn(async (_name: string) => ({ ok: true, data: { people: [], firings: [], limits: { users: 0, profiles: 0, firings: 0 } } }));
  const onClose = vi.fn();
  const actor = userEvent.setup();
  render(<StaffCreateFiringTicket client={{ postJson } as unknown as FunctionsClient} staffUid="staff-test" onClose={onClose} />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/recovery is unavailable/i);
  expect((await screen.findByLabelText("Find client")).matches(":disabled")).toBe(true);
  await actor.click(screen.getByRole("button", { name: "I checked the ticket list; clear pending request" }));
  expect(sessionStorage.getItem("mf:staff-ticket-pending:staff-test")).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(postJson.mock.calls.every((call) => call[0] !== "staffCreateFiringTicket")).toBe(true);
});
