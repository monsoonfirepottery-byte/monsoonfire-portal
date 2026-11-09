import type { FiringTicket } from "./FiringPickupBillingModule";

export type FiringTicketContact = { ticketId: string; displayName: string; email: string };

/** Ticket rows are source records, not proof that two people share an identity. */
export function firingTicketContacts(tickets: FiringTicket[], search: string): FiringTicketContact[] {
  const needle = search.trim().toLowerCase();
  return tickets.flatMap((ticket) => {
    const email = ticket.email?.trim() ?? "";
    const displayName = ticket.displayName?.trim() || "Unnamed contact";
    if (ticket.deletedAt || !/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/.test(email)) return [];
    if (needle && !displayName.toLowerCase().includes(needle) && !email.toLowerCase().includes(needle)) return [];
    return [{ ticketId: ticket.ticketId, displayName, email }];
  });
}
