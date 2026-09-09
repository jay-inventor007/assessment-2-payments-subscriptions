import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { verifyEmailSchema } from "../../../shared/validation.ts";
import { randomToken, sha256Hex } from "../_shared/tokens.ts";
import { buildSessionCookie } from "../_shared/cookies.ts";

const SESSION_LIFETIME_DAYS = 7;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const parsed = verifyEmailSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const db = createServiceClient();

  const limited = await enforceRateLimit(db, req, "verify-email", email);
  if (limited) return limited;

  const { data: user, error: userError } = await db
    .from("users")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return json(req, { error: "Invalid or expired code" }, 400);

  const { data: codeRow, error: codeError } = await db
    .from("verification_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code", parsed.data.code)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (codeError) throw codeError;
  if (!codeRow) return json(req, { error: "Invalid or expired code" }, 400);

  const { error: consumeError } = await db
    .from("verification_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", codeRow.id);
  if (consumeError) throw consumeError;

  const { error: verifyError } = await db
    .from("users")
    .update({ email_verified_at: new Date().toISOString() })
    .eq("id", user.id);
  if (verifyError) throw verifyError;

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_DAYS * 24 * 60 * 60_000).toISOString();
  const { error: sessionError } = await db
    .from("sessions")
    .insert({ token_hash: tokenHash, user_id: user.id, expires_at: expiresAt });
  if (sessionError) throw sessionError;

  return json(req, { email: user.email }, 200, { "Set-Cookie": buildSessionCookie(token) });
});
