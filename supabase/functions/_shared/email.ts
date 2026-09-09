// Falls back to logging instead of sending when BREVO_API_KEY isn't set,
// so the whole signup/verify/reset flow is testable end-to-end before
// anyone has created an email-provider account. Set the real key with
// `npx supabase secrets set BREVO_API_KEY=...` when ready to send for real.
//
// Uses Brevo's HTTP API rather than their SMTP relay: a raw SMTP socket
// connection from this Edge Function returned a 503 before our code even
// ran (Supabase's gateway failing ahead of the function, per
// `x-served-by: base/server` instead of `supabase-edge-runtime` on the
// response) - this platform is built around HTTP(S) `fetch()`, not
// arbitrary outbound TCP, so the HTTP API is the approach that actually
// works here, not just the simpler one.
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  const apiKey = Deno.env.get("BREVO_API_KEY");

  if (!apiKey) {
    console.log(`[email:dev-fallback] to=${to} subject="${subject}"\n${body}`);
    return;
  }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: Deno.env.get("EMAIL_FROM") ?? "no-reply@example.com" },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status} ${await response.text()}`);
  }
}
