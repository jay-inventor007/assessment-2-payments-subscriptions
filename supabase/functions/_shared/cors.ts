// Comma-separated list of origins allowed to call these functions with
// credentials, e.g. "http://localhost:5173,https://yourapp.example.com".
// Set with `npx supabase secrets set ALLOWED_ORIGIN=...`; falls back to the
// Vite dev server origin so local development works with zero setup.
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

export function corsHeaders(requestOrigin: string | null): HeadersInit {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
