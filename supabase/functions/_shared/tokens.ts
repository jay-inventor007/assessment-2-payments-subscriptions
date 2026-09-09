function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// High-entropy opaque token for sessions and password resets - 32 random
// bytes, never guessable, so the only way to obtain one is to have been
// handed it directly (via the Set-Cookie header or the reset email).
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

// Only the hash of a session/reset token is ever stored (see the migration
// for why); this is what both sides of that comparison run through.
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Deliberately low-entropy and human-typeable: this is read off an email
// and keyed in by hand, unlike the tokens above.
export function randomVerificationCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}
