const SESSION_COOKIE_NAME = "session_token";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7; // 7 days

export { SESSION_COOKIE_NAME, SESSION_LIFETIME_SECONDS };

export function buildSessionCookie(token: string): string {
  // HttpOnly: JavaScript never sees the token, so a successful XSS on this
  // app can't just read it out of document.cookie and exfiltrate it.
  // SameSite=Lax + Secure: sent on top-level navigation and on same-site
  // requests, withheld from cross-site POSTs (CSRF-relevant requests),
  // still fine for the plain link-click flows this app uses (email
  // verification links, password reset links).
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
  ].join("; ");
}

export function buildExpiredSessionCookie(): string {
  return [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=0"].join(
    "; ",
  );
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return rest.join("=");
  }
  return null;
}
