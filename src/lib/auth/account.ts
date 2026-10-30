// The account id for an email, computed in the browser: the same value as
// accountAddress in account.server.ts (tested to agree), so the Share sheet
// can tell which listed builder is you.

export async function accountAddressOf(email: string): Promise<string> {
  const data = new TextEncoder().encode(`devstation-account:${email.trim().toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex.slice(0, 40)}`;
}
