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
