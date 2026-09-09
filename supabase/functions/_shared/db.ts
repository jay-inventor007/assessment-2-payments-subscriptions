import { createClient } from "npm:@supabase/supabase-js@2";

// Service role bypasses RLS entirely - safe here because this file only
// ever runs inside Edge Functions (trusted server code), never in the
// browser. The anon key is not used anywhere in this backend.
export function createServiceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}
