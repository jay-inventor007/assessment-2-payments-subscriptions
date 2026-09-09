import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface VerifiedTransaction {
  status: string;
  amount: number;
  currency: string;
  customer: { customer_code: string; email: string };
  authorization?: { authorization_code: string; reusable: boolean };
}

function calculatePeriodEnd(plan: string | undefined): string {
  const now = new Date();
  if (plan === "yearly") now.setFullYear(now.getFullYear() + 1);
  else now.setMonth(now.getMonth() + 1);
  return now.toISOString();
}

// Called from both verify-payment (the return-view path) and the webhook -
// whichever gets here first does the real work; the other is a no-op. That
// race is exactly why this checks for an existing "fulfilled" row before
// doing anything, rather than assuming only one caller will ever run this.
export async function fulfillPayment(
  db: SupabaseClient,
  reference: string,
  verified: VerifiedTransaction,
): Promise<{ granted: boolean; reason?: string }> {
  const { data: initiatedLog, error: findError } = await db
    .from("payment_log")
    .select("user_id, subscription_id, amount, metadata")
    .eq("paystack_reference", reference)
    .eq("stage", "initiated")
    .maybeSingle();
  if (findError) throw findError;

  if (!initiatedLog) {
    return { granted: false, reason: "No matching initiated payment found for this reference" };
  }

  const { user_id: userId, subscription_id: subscriptionId, amount: expectedAmount, metadata } =
    initiatedLog;

  if (verified.status !== "success") {
    await db.from("payment_log").insert({
      user_id: userId,
      subscription_id: subscriptionId,
      stage: "failed",
      amount: verified.amount,
      currency: verified.currency,
      paystack_reference: reference,
      description: `Verification returned status "${verified.status}"`,
    });
    return { granted: false, reason: `Transaction status was "${verified.status}"` };
  }

  // Never trust the amount paid without checking it against what we
  // actually asked for - a mismatched amount here means something is
  // wrong regardless of what Paystack claims succeeded.
  if (verified.amount !== expectedAmount) {
    await db.from("payment_log").insert({
      user_id: userId,
      subscription_id: subscriptionId,
      stage: "failed",
      amount: verified.amount,
      currency: verified.currency,
      paystack_reference: reference,
      description: `Amount mismatch: expected ${expectedAmount}, got ${verified.amount}`,
    });
    return { granted: false, reason: "Amount mismatch" };
  }

  const { data: existingFulfillment, error: fulfilledCheckError } = await db
    .from("payment_log")
    .select("id")
    .eq("paystack_reference", reference)
    .eq("stage", "fulfilled")
    .maybeSingle();
  if (fulfilledCheckError) throw fulfilledCheckError;

  if (existingFulfillment) {
    return { granted: true, reason: "Already fulfilled" };
  }

  await db.from("payment_log").insert({
    user_id: userId,
    subscription_id: subscriptionId,
    stage: "verified",
    amount: verified.amount,
    currency: verified.currency,
    paystack_reference: reference,
  });

  const plan = (metadata as { plan?: string } | null)?.plan;

  const { error: updateError } = await db
    .from("subscriptions")
    .update({
      plan: plan ?? "monthly",
      status: "active",
      paystack_customer_code: verified.customer.customer_code,
      authorization_code: verified.authorization?.authorization_code,
      authorization_email: verified.customer.email,
      current_period_start: new Date().toISOString(),
      current_period_end: calculatePeriodEnd(plan),
      pending_plan_change: null,
      // A fresh grant means any earlier cancellation is no longer the
      // current story - leaving it would make an actively-paying
      // subscriber's billing page show a stale cancellation reason.
      cancellation_reason: null,
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId);
  if (updateError) throw updateError;

  await db.from("payment_log").insert({
    user_id: userId,
    subscription_id: subscriptionId,
    stage: "fulfilled",
    amount: verified.amount,
    currency: verified.currency,
    paystack_reference: reference,
    description: `Subscription activated on ${plan ?? "monthly"} plan`,
  });

  return { granted: true };
}
