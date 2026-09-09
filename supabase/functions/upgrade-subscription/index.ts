import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { paystackRequest } from "../_shared/paystack.ts";
import { plans } from "../_shared/plans.ts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();
  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  const { data: subscription, error: fetchError } = await db
    .from("subscriptions")
    .select(
      "id, plan, current_period_start, current_period_end, authorization_code, authorization_email, paystack_customer_code, paystack_subscription_code, paystack_email_token",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchError) throw fetchError;

  if (!subscription || subscription.plan !== "monthly") {
    return json(req, { error: "Only a monthly subscription can be upgraded to yearly." }, 400);
  }
  if (!subscription.authorization_code || !subscription.current_period_start) {
    return json(req, { error: "No active subscription to upgrade." }, 400);
  }

  const now = new Date();
  const periodStart = new Date(subscription.current_period_start);
  const periodEnd = new Date(subscription.current_period_end);

  const totalPeriodDays = (periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY;
  const daysRemaining = Math.max(0, (periodEnd.getTime() - now.getTime()) / MS_PER_DAY);
  const creditFraction = totalPeriodDays > 0 ? daysRemaining / totalPeriodDays : 0;

  const monthlyAmount = plans.monthly.amount;
  const yearlyAmount = plans.yearly.amount;
  const credit = Math.round(monthlyAmount * creditFraction);
  const amountToCharge = Math.max(0, yearlyAmount - credit);

  const reference = crypto.randomUUID();

  await db.from("payment_log").insert({
    user_id: user.id,
    subscription_id: subscription.id,
    stage: "initiated",
    amount: amountToCharge,
    currency: plans.yearly.currency,
    paystack_reference: reference,
    description: "Upgrade to yearly, prorated",
    metadata: {
      plan: "yearly",
      upgrade: true,
      daysRemaining: Math.round(daysRemaining * 100) / 100,
      totalPeriodDays: Math.round(totalPeriodDays * 100) / 100,
      credit,
      monthlyAmount,
      yearlyAmount,
    },
  });

  if (amountToCharge > 0) {
    let charge: { status: string };
    try {
      charge = await paystackRequest<{ status: string }>("/transaction/charge_authorization", {
        method: "POST",
        body: {
          authorization_code: subscription.authorization_code,
          email: subscription.authorization_email,
          amount: amountToCharge,
          currency: plans.yearly.currency,
          reference,
        },
      });
    } catch (error) {
      console.error("Upgrade charge failed", error);
      await db.from("payment_log").insert({
        user_id: user.id,
        subscription_id: subscription.id,
        stage: "failed",
        amount: amountToCharge,
        currency: plans.yearly.currency,
        paystack_reference: reference,
        description: "Upgrade charge_authorization call failed",
      });
      return json(req, { error: "Could not charge the card on file. Try again shortly." }, 502);
    }

    if (charge.status !== "success") {
      await db.from("payment_log").insert({
        user_id: user.id,
        subscription_id: subscription.id,
        stage: "failed",
        amount: amountToCharge,
        currency: plans.yearly.currency,
        paystack_reference: reference,
        description: `Upgrade charge returned status "${charge.status}"`,
      });
      return json(req, { error: `Payment did not complete (status: ${charge.status}).` }, 402);
    }
  }

  await db.from("payment_log").insert({
    user_id: user.id,
    subscription_id: subscription.id,
    stage: "verified",
    amount: amountToCharge,
    currency: plans.yearly.currency,
    paystack_reference: reference,
  });

  // Disabling the old subscription stops it from ever trying to renew on
  // the monthly plan again; a fresh subscription on the new plan replaces
  // it, since there's no "change this subscription's plan" call to use
  // instead (see PLAN.md).
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
      console.error("Disabling old subscription failed (continuing anyway)", error);
    }
  }

  const created = await paystackRequest<{ subscription_code?: string; email_token?: string }>(
    "/subscription",
    {
      method: "POST",
      body: {
        customer: subscription.paystack_customer_code,
        plan: plans.yearly.paystackPlanCode,
        authorization: subscription.authorization_code,
      },
    },
  );

  await db
    .from("subscriptions")
    .update({
      plan: "yearly",
      status: "active",
      current_period_start: now.toISOString(),
      current_period_end: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString(),
      paystack_subscription_code: created.subscription_code ?? null,
      paystack_email_token: created.email_token ?? subscription.paystack_email_token,
      pending_plan_change: null,
      updated_at: now.toISOString(),
    })
    .eq("id", subscription.id);

  await db.from("payment_log").insert({
    user_id: user.id,
    subscription_id: subscription.id,
    stage: "fulfilled",
    amount: amountToCharge,
    currency: plans.yearly.currency,
    paystack_reference: reference,
    description: `Upgraded to yearly plan, charged ${amountToCharge} after a ${credit} credit for ${Math.round(daysRemaining)} unused day(s)`,
  });

  return json(req, { plan: "yearly", amountCharged: amountToCharge, credit, daysRemaining }, 200);
});
