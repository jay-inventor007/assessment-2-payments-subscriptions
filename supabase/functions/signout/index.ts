import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { readSessionToken, buildExpiredSessionCookie } from "../_shared/cookies.ts";
import { sha256Hex } from "../_shared/tokens.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  const token = readSessionToken(req);
  if (token) {
    const db = createServiceClient();
    const tokenHash = await sha256Hex(token);
    const { error } = await db.from("sessions").delete().eq("token_hash", tokenHash);
    if (error) throw error;
  }

  return json(req, { message: "Signed out." }, 200, { "Set-Cookie": buildExpiredSessionCookie() });
});
