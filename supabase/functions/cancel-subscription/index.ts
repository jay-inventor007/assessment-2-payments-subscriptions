import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { cancelSubscriptionSchema } from "../../../shared/validation.ts";
import { paystackRequest } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();
  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  const parsed = cancelSubscriptionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return json(req, { error: "Invalid input", issues: parsed.error.flatten() }, 400);
  }

  const { data: subscription, error: fetchError } = await db
    .from("subscriptions")
    .select("id, plan, paystack_subscription_code, paystack_email_token, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (!subscription || subscription.plan === "free") {
    return json(req, { error: "No active paid subscription to cancel." }, 400);
  }

  if (!subscription.paystack_subscription_code || !subscription.paystack_email_token) {
    // subscription.create webhook hasn't arrived yet - shouldn't normally
    // happen since it fires within seconds of the initial payment, but
    // failing loudly here is better than silently not cancelling anything.
    return json(
      req,
      { error: "Subscription is still being set up. Try again in a moment." },
      409,
    );
  }

  try {
    await paystackRequest("/subscription/disable", {
      method: "POST",
      body: {
        code: subscription.paystack_subscription_code,
        token: subscription.paystack_email_token,
      },
    });
  } catch (error) {
    console.error("Paystack subscription disable failed", error);
    return json(req, { error: "Could not cancel right now. Try again shortly." }, 502);
  }

  // Access is retained until current_period_end - status changes, but that
  // date does not, and entitlement checks read the date, not the status.
  const { error: updateError } = await db
    .from("subscriptions")
    .update({
      status: "non_renewing",
      cancellation_reason: parsed.data.reason ?? null,
      cancelled_at: new Date().toISOString(),
      pending_plan_change: null, // moot once cancelled - there's no next period to apply it to
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);
  if (updateError) throw updateError;

  return json(
    req,
    { message: "Subscription cancelled. Access continues until the current period ends.", accessUntil: subscription.current_period_end },
    200,
  );
});
