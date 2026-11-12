const hasControlCharacter = (value: string) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
});

export function stripeContactQuery(search: string): string {
  const value = search.trim();
  if (value.length < 3 || value.length > 100 || /[\\"]/u.test(value) || hasControlCharacter(value)) {
    throw new Error("Enter 3 to 100 characters without quotes or control characters.");
  }
  return `name~"${value}" OR email~"${value}"`;
}

export function stripeContactRows(customers: Array<{ id: string; name?: string | null; email?: string | null }>) {
  return customers.map((customer) => {
    const email = customer.email?.trim() ?? "";
    return { id: customer.id, displayName: customer.name?.trim() || "Unnamed contact", email: hasControlCharacter(email) ? "" : email };
  });
}

/** Checkout is queried only by one complete mailbox, never by a free-form search expression. */
export function stripeGuestEmail(value: string): string | null {
  if (hasControlCharacter(value)) return null;
  const email = value.trim();
  if (email.length > 254 || /[%,;?&#<>]/u.test(email)) return null;
  if (!/^[A-Za-z0-9.!#$'*+/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/u.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || domain.split(".").some((part) => part.length > 63)) return null;
  return email;
}

export function stripeGuestRows(sessions: Array<{ id: string; customer: unknown; customer_details: { email?: string | null; name?: string | null } | null }>, email: string) {
  return sessions.flatMap((session) => {
    const address = stripeGuestEmail(session.customer_details?.email ?? "");
    if (session.customer || !address || address.toLowerCase() !== email.toLowerCase()) return [];
    return [{ id: session.id, displayName: session.customer_details?.name?.trim() || "Unnamed guest", email: address }];
  });
}

type GuestSession = { id: string; customer: unknown; customer_details: { email?: string | null; name?: string | null } | null };

export function stripeGuestNameQuery(value: string): string | null {
  const search = value.trim().normalize("NFKC").toLowerCase();
  if (search.length < 3 || search.length > 100 || hasControlCharacter(search)) return null;
  return search;
}

/** Scan bounded pages, advancing by the unfiltered Stripe cursor even for empty matches. */
export async function scanStripeGuestNames(
  list: (startingAfter?: string) => Promise<{ data: GuestSession[]; has_more: boolean }>,
  search: string,
  startingAfter?: string
) {
  const query = stripeGuestNameQuery(search);
  if (!query) throw new Error("Invalid guest name search");
  const contacts: Array<{ id: string; displayName: string; email: string }> = [];
  let scanned = 0;
  let cursor = startingAfter;
  let hasMore = true;
  for (let page = 0; page < 3 && hasMore; page += 1) {
    const result = await list(cursor);
    scanned += result.data.length;
    for (const session of result.data) {
      const displayName = session.customer_details?.name?.trim() ?? "";
      if (session.customer || !displayName || hasControlCharacter(displayName) || !displayName.normalize("NFKC").toLowerCase().includes(query)) continue;
      contacts.push({ id: session.id, displayName, email: stripeGuestEmail(session.customer_details?.email ?? "") ?? "" });
    }
    hasMore = result.has_more;
    const next = result.data[result.data.length - 1]?.id;
    if (hasMore && (!next || next === cursor)) throw new Error("Invalid Stripe pagination");
    cursor = next;
  }
  return { contacts, scanned, hasMore, nextPage: hasMore ? cursor ?? null : null };
}
