import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { paystackRequest } from "../_shared/paystack.ts";
import { fulfillPayment } from "../_shared/fulfillPayment.ts";

interface VerifyResponse {
  status: string;
  amount: number;
  currency: string;
  customer: { customer_code: string; email: string };
  authorization?: { authorization_code: string; reusable: boolean };
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();
  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  const reference = new URL(req.url).searchParams.get("reference");
  if (!reference) return json(req, { error: "Missing reference" }, 400);

  // This is the actual server-side check the brief requires - the return
  // page merely landing here proves nothing on its own, only this call
  // (hitting Paystack directly, not trusting whatever the redirect URL
  // claims) can confirm the payment really happened.
  let transaction: VerifyResponse;
  try {
    transaction = await paystackRequest<VerifyResponse>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
  } catch (error) {
    console.error("Paystack verify failed", error);
    return json(req, { error: "Could not verify payment right now." }, 502);
  }

  const result = await fulfillPayment(db, reference, transaction);

  return json(req, { granted: result.granted, status: transaction.status, reason: result.reason }, 200);
});
