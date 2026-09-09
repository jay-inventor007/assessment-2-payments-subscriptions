import { createServiceClient } from "../_shared/db.ts";
import { hmacSha512Hex } from "../_shared/webhookSignature.ts";
import { fulfillPayment } from "../_shared/fulfillPayment.ts";
import { recordSubscriptionCode } from "../_shared/recordSubscriptionCode.ts";

// No CORS handling here on purpose - Paystack calls this server-to-server,
// a browser never does, so there's no preflight to answer.
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  const secretKey = Deno.env.get("PAYSTACK_SECRET_KEY")!;

  const expectedSignature = await hmacSha512Hex(secretKey, rawBody);
  if (!signature || expectedSignature !== signature) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const db = createServiceClient();

  const providerReference: string =
    event.data?.reference ?? event.data?.subscription_code ?? crypto.randomUUID();

  // The unique constraint on (event_type, provider_reference) is the
  // idempotency mechanism itself: a redelivered webhook hits this insert a
  // second time, gets rejected by the database, and is treated as already
  // handled - not re-processed, but still acknowledged with a 200 so
  // Paystack doesn't keep retrying a delivery that did in fact arrive.
  const { error: insertError } = await db.from("webhook_events").insert({
    event_type: event.event,
    provider_reference: providerReference,
    payload: event,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return new Response(JSON.stringify({ message: "Already processed" }), { status: 200 });
    }
    throw insertError;
  }

  if (event.event === "charge.success") {
    await fulfillPayment(db, event.data.reference, {
      status: "success",
      amount: event.data.amount,
      currency: event.data.currency,
      customer: event.data.customer,
      authorization: event.data.authorization,
    });
  }

  if (event.event === "subscription.create") {
    await recordSubscriptionCode(db, event.data.subscription_code);
  }

  await db
    .from("webhook_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_type", event.event)
    .eq("provider_reference", providerReference);

  return new Response(JSON.stringify({ message: "ok" }), { status: 200 });
});
