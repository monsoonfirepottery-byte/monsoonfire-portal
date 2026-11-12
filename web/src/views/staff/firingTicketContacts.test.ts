import { describe, expect, it } from "vitest";
import type { FiringTicket } from "./FiringPickupBillingModule";
import { firingTicketContacts } from "./firingTicketContacts";

describe("firing ticket contact sources", () => {
  it("filters by name or email without merging ambiguous records", () => {
    const rows = [
      { ticketId: "1", displayName: "Alex", email: "alex@example.org" },
      { ticketId: "2", displayName: "Alex", email: "alex@example.org" },
      { ticketId: "3", displayName: "Deleted", email: "a@example.org", deletedAt: "yesterday" },
      { ticketId: "4", displayName: "Unsafe", email: "a@example.org\r\nBcc:b@example.org" },
    ] as FiringTicket[];
    expect(firingTicketContacts(rows, "alex").map((row) => row.ticketId)).toEqual(["1", "2"]);
    expect(firingTicketContacts(rows, "example.org").map((row) => row.ticketId)).toEqual(["1", "2"]);
    expect(firingTicketContacts(rows, "missing")).toEqual([]);
  });
});
