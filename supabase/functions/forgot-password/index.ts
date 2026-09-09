import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { forgotPasswordSchema } from "../../../shared/validation.ts";
import { randomToken, sha256Hex } from "../_shared/tokens.ts";
import { sendEmail } from "../_shared/email.ts";

const RESET_TOKEN_LIFETIME_MINUTES = 30;
const GENERIC_MESSAGE = { message: "If that account exists, a password reset link has been sent." };

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const parsed = forgotPasswordSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const db = createServiceClient();

  const limited = await enforceRateLimit(db, req, "forgot-password", email);
  if (limited) return limited;

  const { data: user, error } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (error) throw error;

  if (user) {
    await db.from("password_reset_tokens").delete().eq("user_id", user.id).is("consumed_at", null);

    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_LIFETIME_MINUTES * 60_000).toISOString();
    const { error: tokenError } = await db
      .from("password_reset_tokens")
      .insert({ user_id: user.id, token_hash: tokenHash, expires_at: expiresAt });
    if (tokenError) throw tokenError;

    const resetUrl = `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/reset-password?token=${token}`;
    await sendEmail(
      email,
      "Reset your password",
      `Reset your password: ${resetUrl}\nThis link expires in ${RESET_TOKEN_LIFETIME_MINUTES} minutes.`,
    );
  }

  // Same response whether or not the email has an account - see
  // resend-verification for the same reasoning.
  return json(req, GENERIC_MESSAGE, 200);
});
