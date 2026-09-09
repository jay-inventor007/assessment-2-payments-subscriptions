import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json, getClientIp } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { resetPasswordSchema } from "../../../shared/validation.ts";
import { sha256Hex } from "../_shared/tokens.ts";
import { hashPassword } from "../_shared/password.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();

  // Keyed by IP rather than the token: the token itself is 32 random bytes,
  // large enough that brute-forcing it isn't a realistic threat regardless
  // of rate limiting, so this is ordinary abuse hygiene rather than the
  // main defense.
  const limited = await enforceRateLimit(db, req, "reset-password", getClientIp(req));
  if (limited) return limited;

  const parsed = resetPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const tokenHash = await sha256Hex(parsed.data.token);

  const { data: tokenRow, error: tokenError } = await db
    .from("password_reset_tokens")
    .select("id, user_id")
    .eq("token_hash", tokenHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (tokenError) throw tokenError;
  if (!tokenRow) return json(req, { error: "This reset link is invalid or has expired." }, 400);

  const passwordHash = await hashPassword(parsed.data.password);

  const { error: updateError } = await db
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("id", tokenRow.user_id);
  if (updateError) throw updateError;

  const { error: consumeError } = await db
    .from("password_reset_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", tokenRow.id);
  if (consumeError) throw consumeError;

  // A changed password should end every existing session, not just close
  // the loop on this reset - otherwise a session an attacker already had
  // survives the reset that was meant to lock them out.
  const { error: revokeError } = await db.from("sessions").delete().eq("user_id", tokenRow.user_id);
  if (revokeError) throw revokeError;

  return json(req, { message: "Password updated. You can now sign in." }, 200);
});
