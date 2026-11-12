/** A single mailbox only; reject header delimiters and encoded control characters. */
export function contactEmailAddress(value: string): string | null {
  if (Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const email = value.trim();
  if (email.length > 254 || /[%,;?&#<>]/.test(email)) return null;
  if (!/^[A-Za-z0-9.!#$'*+/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") || domain.split(".").some((part) => part.length > 63)) return null;
  return email;
}
