import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { enforceRateLimit } from "../_shared/enforceRateLimit.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { checkoutSchema } from "../../../shared/validation.ts";
import { plans } from "../_shared/plans.ts";
import { paystackRequest } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();

  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  // Keyed by user id, not IP - this route can only be reached by an
  // authenticated user, so the account itself is the meaningful identifier.
  const limited = await enforceRateLimit(db, req, "checkout-init", user.id);
  if (limited) return limited;

  const parsed = checkoutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const plan = plans[parsed.data.plan];
  const reference = crypto.randomUUID();

  const { data: transaction, error: initError } = await (async () => {
    try {
      const data = await paystackRequest<{ authorization_url: string; access_code: string }>(
        "/transaction/initialize",
        {
          method: "POST",
          body: {
            email: user.email,
            amount: plan.amount,
            currency: plan.currency,
            reference,
            plan: plan.paystackPlanCode,
            callback_url: `${Deno.env.get("FRONTEND_URL") ?? "http://localhost:5173"}/checkout/return`,
          },
        },
      );
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  })();

  // Get or create this user's subscription row - every user has exactly
  // one, created lazily on their first checkout attempt.
  const { data: subscription, error: subError } = await db
    .from("subscriptions")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (subError) throw subError;

  let subscriptionId = subscription?.id;
  if (!subscriptionId) {
    const { data: existing, error: fetchError } = await db
      .from("subscriptions")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (fetchError) throw fetchError;
    subscriptionId = existing.id;
  }

  const { error: logError } = await db.from("payment_log").insert({
    user_id: user.id,
    subscription_id: subscriptionId,
    stage: initError ? "failed" : "initiated",
    amount: plan.amount,
    currency: plan.currency,
    paystack_reference: reference,
    description: `Checkout initiated for ${parsed.data.plan} plan`,
    metadata: { plan: parsed.data.plan },
  });
  if (logError) throw logError;

  if (initError || !transaction) {
    console.error("Paystack initialize failed", initError);
    return json(req, { error: "Could not start checkout. Try again shortly." }, 502);
  }

  return json(req, { authorizationUrl: transaction.authorization_url, reference }, 200);
});
