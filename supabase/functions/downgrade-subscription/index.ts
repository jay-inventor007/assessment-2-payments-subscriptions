import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { paystackRequest } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();
  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  const { data: subscription, error } = await db
    .from("subscriptions")
    .select("id, plan, current_period_end, paystack_subscription_code, paystack_email_token")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  if (!subscription || subscription.plan !== "yearly") {
    return json(req, { error: "Only a yearly subscription can be downgraded to monthly." }, 400);
  }

  // Critical: without this, Paystack would just auto-renew the yearly
  // subscription at the old price when the period ends, which is the
  // opposite of what downgrading means. Disabling it now stops that,
  // while current_period_end (unchanged) still keeps access until the
  // period the user already paid for actually ends.
  if (subscription.paystack_subscription_code && subscription.paystack_email_token) {
    try {
      await paystackRequest("/subscription/disable", {
        method: "POST",
        body: {
          code: subscription.paystack_subscription_code,
          token: subscription.paystack_email_token,
        },
      });
    } catch (error) {
      console.error("Disabling subscription for downgrade failed", error);
      return json(req, { error: "Could not schedule the downgrade right now. Try again shortly." }, 502);
    }
  }

  // The actual switch to the monthly plan (a fresh charge + a new
  // subscription) happens lazily, applied by billing-status the next time
  // it's called after current_period_end passes - see
  // _shared/applyPendingPlanChange.ts and PLAN.md for why this is a
  // check-on-access design rather than a background scheduled job.
  const { error: updateError } = await db
    .from("subscriptions")
    .update({ pending_plan_change: "monthly", updated_at: new Date().toISOString() })
    .eq("id", subscription.id);
  if (updateError) throw updateError;

  return json(
    req,
    {
      message: "Downgrade to monthly scheduled for the end of the current period.",
      effectiveFrom: subscription.current_period_end,
    },
    200,
  );
});
