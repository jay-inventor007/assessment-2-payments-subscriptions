import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { readSessionToken } from "./cookies.ts";
import { sha256Hex } from "./tokens.ts";

// Same check as the me function, factored out so every payment route can
// require a signed-in user without duplicating the session lookup.
export async function requireSession(
  req: Request,
  db: SupabaseClient,
): Promise<{ id: string; email: string } | null> {
  const token = readSessionToken(req);
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const { data: session, error } = await db
    .from("sessions")
    .select("user_id, expires_at, revoked_at, users(id, email)")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;

  const isValid = session && !session.revoked_at && new Date(session.expires_at) > new Date();
  if (!isValid) return null;

  return session.users as unknown as { id: string; email: string };
}
