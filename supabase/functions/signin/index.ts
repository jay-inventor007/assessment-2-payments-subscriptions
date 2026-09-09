import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json, getClientIp } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { signInSchema } from "../../../shared/validation.ts";
import { verifyPassword } from "../_shared/password.ts";
import { randomToken, sha256Hex } from "../_shared/tokens.ts";
import { buildSessionCookie } from "../_shared/cookies.ts";

const SESSION_LIFETIME_DAYS = 7;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();

  const limited = await enforceRateLimit(db, req, "signin", getClientIp(req));
  if (limited) return limited;

  const parsed = signInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();

  const { data: user, error } = await db
    .from("users")
    .select("id, email, password_hash, email_verified_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;

  // Runs even when no user was found, comparing against a dummy hash, so
  // the response takes the same time either way and can't be used to
  // confirm which emails have accounts.
  const passwordMatches = await verifyPassword(parsed.data.password, user?.password_hash ?? null);

  if (!user || !passwordMatches) {
    return json(req, { error: "Invalid email or password" }, 401);
  }

  if (!user.email_verified_at) {
    return json(req, { error: "Verify your email before signing in." }, 403);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 60 * 60_000).toISOString();

  const { error: sessionError } = await db
    .from("sessions")
    .insert({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt });
  if (sessionError) throw sessionError;

  return json(req, { email: user.email }, 200, { "Set-Cookie": buildSessionCookie(token) });
});
