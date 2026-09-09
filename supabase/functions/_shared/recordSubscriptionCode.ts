import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { paystackRequest } from "./paystack.ts";

interface SubscriptionDetail {
  subscription_code: string;
  email_token: string;
  customer: { email: string };
}

// subscription.create fires once per new subscription (both the initial
// "attach plan to transaction" auto-subscribe, and our own explicit
// upgrade/downgrade Create Subscription calls). Its code and email_token
// are what disabling a subscription later requires - captured here since
// the initial auto-subscribe flow never returns them directly to us.
export async function recordSubscriptionCode(
  db: SupabaseClient,
  subscriptionCode: string,
): Promise<void> {
  const detail = await paystackRequest<SubscriptionDetail>(`/subscription/${subscriptionCode}`);

  const { data: user, error: userError } = await db
    .from("users")
    .select("id")
    .eq("email", detail.customer.email)
    .maybeSingle();
  if (userError) throw userError;
  if (!user) return;

  await db
    .from("subscriptions")
    .update({
      paystack_subscription_code: detail.subscription_code,
      paystack_email_token: detail.email_token,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);
}
