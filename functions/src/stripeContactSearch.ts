export function stripeContactQuery(search: string): string {
  const value = search.trim();
  if (value.length < 3 || value.length > 100 || /[\x00-\x1f\x7f\\"]/u.test(value)) {
    throw new Error("Enter 3 to 100 characters without quotes or control characters.");
  }
  return `name~"${value}" OR email~"${value}"`;
}

export function stripeContactRows(customers: Array<{ id: string; name?: string | null; email?: string | null }>) {
  return customers.flatMap((customer) => {
    const email = customer.email?.trim() ?? "";
    if (!email || /[\x00-\x1f\x7f]/u.test(email)) return [];
    return [{ id: customer.id, displayName: customer.name?.trim() || "Unnamed contact", email }];
  });
}
