import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { paystackRequest } from "./paystack.ts";
import { plans, type PaidPlan } from "./plans.ts";

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string | null;
  pending_plan_change: string | null;
  authorization_code: string | null;
  authorization_email: string | null;
  paystack_customer_code: string | null;
  paystack_email_token: string | null;
}

function calculatePeriodEnd(plan: PaidPlan): Date {
  const now = new Date();
  if (plan === "yearly") return new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// A scheduled downgrade doesn't apply itself in the background - there's
// no cron job in this slice (see PLAN.md / DOCUMENTATION.md Section 7).
// Instead, whichever request reads this subscription next after
// current_period_end has passed is the one that applies it, right before
// returning the (now up to date) status. This is a deliberate
// simplification: it means the switch only actually happens once someone
// looks at billing-status again after the date, not automatically the
// instant the period ends.
export async function applyPendingPlanChangeIfDue(
  db: SupabaseClient,
  subscription: SubscriptionRow,
): Promise<SubscriptionRow> {
  if (!subscription.pending_plan_change) return subscription;
  if (!subscription.current_period_end) return subscription;
  if (new Date(subscription.current_period_end) > new Date()) return subscription;

  const targetPlan = subscription.pending_plan_change as PaidPlan;
  const planConfig = plans[targetPlan];
  const reference = crypto.randomUUID();

  await db.from("payment_log").insert({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    stage: "initiated",
    amount: planConfig.amount,
    currency: planConfig.currency,
    paystack_reference: reference,
    description: `Applying scheduled downgrade to ${targetPlan}`,
  });

  let charge: { status: string };
  try {
    charge = await paystackRequest<{ status: string }>("/transaction/charge_authorization", {
      method: "POST",
      body: {
        authorization_code: subscription.authorization_code,
        email: subscription.authorization_email,
        amount: planConfig.amount,
        currency: planConfig.currency,
        reference,
      },
    });
  } catch (error) {
    console.error("Scheduled plan change charge failed", error);
    await db.from("payment_log").insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      stage: "failed",
      amount: planConfig.amount,
      currency: planConfig.currency,
      paystack_reference: reference,
      description: "charge_authorization call failed while applying scheduled plan change",
    });
    await db.from("subscriptions").update({ status: "past_due" }).eq("id", subscription.id);
    return { ...subscription, status: "past_due" };
  }

  if (charge.status !== "success") {
    await db.from("payment_log").insert({
      user_id: subscription.user_id,
      subscription_id: subscription.id,
      stage: "failed",
      amount: planConfig.amount,
      currency: planConfig.currency,
      paystack_reference: reference,
      description: `Scheduled plan change charge returned status "${charge.status}"`,
    });
    await db.from("subscriptions").update({ status: "past_due" }).eq("id", subscription.id);
    return { ...subscription, status: "past_due" };
  }

  await db.from("payment_log").insert({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    stage: "verified",
    amount: planConfig.amount,
    currency: planConfig.currency,
    paystack_reference: reference,
  });

  const created = await paystackRequest<{ subscription_code?: string; email_token?: string }>(
    "/subscription",
    {
      method: "POST",
      body: {
        customer: subscription.paystack_customer_code,
        plan: planConfig.paystackPlanCode,
        authorization: subscription.authorization_code,
      },
    },
  );

  const now = new Date();
  const periodEnd = calculatePeriodEnd(targetPlan);

  const { data: updated, error: updateError } = await db
    .from("subscriptions")
    .update({
      plan: targetPlan,
      status: "active",
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      pending_plan_change: null,
      paystack_subscription_code: created.subscription_code ?? null,
      paystack_email_token: created.email_token ?? subscription.paystack_email_token,
      updated_at: now.toISOString(),
    })
    .eq("id", subscription.id)
    .select()
    .single();
  if (updateError) throw updateError;

  await db.from("payment_log").insert({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    stage: "fulfilled",
    amount: planConfig.amount,
    currency: planConfig.currency,
    paystack_reference: reference,
    description: `Scheduled downgrade applied: now on the ${targetPlan} plan`,
  });

  return updated as SubscriptionRow;
}
