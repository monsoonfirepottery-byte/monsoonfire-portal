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
