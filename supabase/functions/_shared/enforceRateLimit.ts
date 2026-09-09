import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json } from "./http.ts";
import { rateLimits, type RateLimitedRoute } from "./rateLimits.ts";

// Returns a ready-to-return 429 Response if the limit is hit, or null if
// the caller should proceed - callers do `const limited = await
// enforceRateLimit(...); if (limited) return limited;`.
export async function enforceRateLimit(
  db: SupabaseClient,
  req: Request,
  route: RateLimitedRoute,
  identifier: string,
): Promise<Response | null> {
  const { limit, windowSeconds } = rateLimits[route];

  const { data, error } = await db
    .rpc("check_rate_limit", {
      p_route: route,
      p_identifier: identifier,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    .single();

  if (error) throw error;

  const result = data as { allowed: boolean; retry_after_seconds: number };
  if (!result.allowed) {
    return json(
      req,
      { error: "Too many attempts. Try again later." },
      429,
      { "Retry-After": String(result.retry_after_seconds) },
    );
  }

  return null;
}
