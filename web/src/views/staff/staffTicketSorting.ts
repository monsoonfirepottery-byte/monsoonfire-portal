export type TicketSortKey = "severity" | "updated_desc" | "updated_asc" | "state" | "artist" | "email" | "heat";

type SortableTicket = {
  ticketId: string;
  displayName: string;
  email: string | null;
  status: string;
  billingStatus: string;
  noticeStatus: string;
  heatLabel: string;
  updatedAt: string | null;
  createdAt: string | null;
};

function text(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

function timestamp(ticket: SortableTicket): number {
  const value = Date.parse(ticket.updatedAt ?? ticket.createdAt ?? "");
  return Number.isFinite(value) ? value : 0;
}

function stateLabel(ticket: SortableTicket): string {
  return `${ticket.status} ${ticket.billingStatus} ${ticket.noticeStatus}`;
}

export function sortFiringTickets<T extends SortableTicket>(
  tickets: T[],
  sortBy: TicketSortKey,
  severityFor: (ticket: T) => number,
): T[] {
  return [...tickets].sort((left, right) => {
    let comparison = 0;
    if (sortBy === "severity") comparison = severityFor(left) - severityFor(right);
    if (sortBy === "updated_desc") comparison = timestamp(right) - timestamp(left);
    if (sortBy === "updated_asc") comparison = timestamp(left) - timestamp(right);
    if (sortBy === "state") comparison = text(stateLabel(left)).localeCompare(text(stateLabel(right)));
    if (sortBy === "artist") comparison = text(left.displayName).localeCompare(text(right.displayName));
    if (sortBy === "email") comparison = text(left.email).localeCompare(text(right.email));
    if (sortBy === "heat") comparison = text(left.heatLabel).localeCompare(text(right.heatLabel));
    return comparison || text(left.ticketId).localeCompare(text(right.ticketId));
  });
}
