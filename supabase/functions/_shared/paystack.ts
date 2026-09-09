const PAYSTACK_BASE_URL = "https://api.paystack.co";

// Paystack's own convention: HTTP status can be 200 even when the
// underlying operation failed (e.g. Verify Transaction on a failed
// payment) - json.status is the actual success flag. This throws only on
// an outright API-level failure (bad request, auth, etc); callers that
// care about a specific outcome (a transaction's own status, a charge's
// own status) still need to inspect the returned data themselves.
export async function paystackRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${Deno.env.get("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json",
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = await response.json();
  if (!json.status) {
    throw new Error(`Paystack error: ${json.message}`);
  }
  return json.data as T;
}
