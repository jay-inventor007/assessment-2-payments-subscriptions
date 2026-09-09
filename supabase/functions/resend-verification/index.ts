import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { resendVerificationSchema } from "../../../shared/validation.ts";
import { randomVerificationCode } from "../_shared/tokens.ts";
import { sendEmail } from "../_shared/email.ts";

const VERIFICATION_CODE_LIFETIME_MINUTES = 15;
const GENERIC_MESSAGE = {
  message: "If that account exists and needs verification, a new code has been sent.",
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const parsed = resendVerificationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const email = parsed.data.email.trim().toLowerCase();
  const db = createServiceClient();

  // limit: 1, window: 60s in rateLimits.ts - the cooldown itself is just
  // this rate limit with a one-attempt window.
  const limited = await enforceRateLimit(db, req, "resend-verification", email);
  if (limited) return limited;

  const { data: user, error } = await db
    .from("users")
    .select("id, email_verified_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw error;

  if (user && !user.email_verified_at) {
    await db.from("verification_codes").delete().eq("user_id", user.id).is("consumed_at", null);

    const code = randomVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_LIFETIME_MINUTES * 60_000).toISOString();
    const { error: codeError } = await db
      .from("verification_codes")
      .insert({ user_id: user.id, code, expires_at: expiresAt });
    if (codeError) throw codeError;

    await sendEmail(
      email,
      "Your new verification code",
      `Your verification code is ${code}. It expires in ${VERIFICATION_CODE_LIFETIME_MINUTES} minutes.`,
    );
  }

  // Identical response whether the account doesn't exist, is already
  // verified, or genuinely got a new code - otherwise this endpoint could
  // be used to test which emails are registered.
  return json(req, GENERIC_MESSAGE, 200);
});
