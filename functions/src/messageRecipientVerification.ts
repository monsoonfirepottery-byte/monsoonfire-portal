export type RecipientStatus = "active" | "disabled" | "not_found";

/** A failed lookup must not be mistaken for a missing or active account. */
export async function verifyMessageRecipient(
  uid: string,
  lookup: (uid: string) => Promise<{ disabled: boolean }>
): Promise<RecipientStatus> {
  try {
    return (await lookup(uid)).disabled ? "disabled" : "active";
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "auth/user-not-found") {
      return "not_found";
    }
    throw error;
  }
}
