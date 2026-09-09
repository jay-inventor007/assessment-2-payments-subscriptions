import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { readSessionToken, buildExpiredSessionCookie } from "../_shared/cookies.ts";
import { sha256Hex } from "../_shared/tokens.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const token = readSessionToken(req);
  if (!token) return json(req, { error: "Not signed in" }, 401);

  const db = createServiceClient();
  const tokenHash = await sha256Hex(token);

  const { data: session, error } = await db
    .from("sessions")
    .select("expires_at, revoked_at, users(email)")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;

  const isValid = session && !session.revoked_at && new Date(session.expires_at) > new Date();
  if (!isValid) {
    return json(req, { error: "Session expired" }, 401, { "Set-Cookie": buildExpiredSessionCookie() });
  }

  const user = session.users as unknown as { email: string };
  return json(req, { email: user.email }, 200);
});
