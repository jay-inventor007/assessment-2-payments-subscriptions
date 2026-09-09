import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json, getClientIp } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { signUpSchema } from "../../../shared/validation.ts";
import { hashPassword } from "../_shared/password.ts";
import { randomVerificationCode } from "../_shared/tokens.ts";
import { sendEmail } from "../_shared/email.ts";

const VERIFICATION_CODE_LIFETIME_MINUTES = 15;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();

  const limited = await enforceRateLimit(db, req, "signup", getClientIp(req));
  if (limited) return limited;

  const parsed = signUpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);

  const userId = await upsertUnverifiedUser(db, email, passwordHash);
  if (userId === "already-verified") {
    return json(req, { error: "An account with this email already exists." }, 409);
  }

  // Old codes are invalidated on every signup attempt (fresh or repeated),
  // so a stale code from an earlier attempt can't still be typed in later.
  await db.from("verification_codes").delete().eq("user_id", userId).is("consumed_at", null);

  const code = randomVerificationCode();
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_LIFETIME_MINUTES * 60_000).toISOString();
  const { error: codeError } = await db
    .from("verification_codes")
    .insert({ user_id: userId, code, expires_at: expiresAt });
  if (codeError) throw codeError;

  await sendEmail(
    email,
    "Verify your email",
    `Your verification code is ${code}. It expires in ${VERIFICATION_CODE_LIFETIME_MINUTES} minutes.`,
  );

  return json(req, { email }, 201);
});

// Makes signup idempotent on email: a brand new address gets a new row: a
// second submission for the same unverified address updates that same row
// instead of erroring or duplicating it, so double-clicking submit (or a
// retried request) still produces exactly one account.
async function upsertUnverifiedUser(
  db: SupabaseClient,
  email: string,
  passwordHash: string,
): Promise<string | "already-verified"> {
  const { data: existing, error: lookupError } = await db
    .from("users")
    .select("id, email_verified_at")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    if (existing.email_verified_at) return "already-verified";
    const { error } = await db.from("users").update({ password_hash: passwordHash }).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }

  const { data: inserted, error: insertError } = await db
    .from("users")
    .insert({ email, password_hash: passwordHash })
    .select("id")
    .single();

  if (!insertError) return inserted.id;

  // Postgres unique_violation: another request for this email won the race
  // between the lookup above and this insert. Fall back to the same update
  // path rather than surfacing a 500 to whichever request lost the race.
  if (insertError.code !== "23505") throw insertError;

  const { data: raced, error: racedError } = await db
    .from("users")
    .select("id, email_verified_at")
    .eq("email", email)
    .single();
  if (racedError) throw racedError;
  if (raced.email_verified_at) return "already-verified";

  const { error: updateError } = await db
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", raced.id);
  if (updateError) throw updateError;
  return raced.id;
}
