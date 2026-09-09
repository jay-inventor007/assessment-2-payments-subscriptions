import { createServiceClient } from "../_shared/db.ts";
import { handlePreflight } from "../_shared/cors.ts";
import { json } from "../_shared/http.ts";
import { requireSession } from "../_shared/requireSession.ts";
import { applyPendingPlanChangeIfDue } from "../_shared/applyPendingPlanChange.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json(req, { error: "Method not allowed" }, 405);

  const db = createServiceClient();
  const user = await requireSession(req, db);
  if (!user) return json(req, { error: "Not signed in" }, 401);

  const { data: subscription, error } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;

  if (!subscription) {
    return json(
      req,
      {
        plan: "free",
        status: "active",
        current_period_end: null,
        pending_plan_change: null,
        cancellation_reason: null,
        cancelled_at: null,
      },
      200,
    );
  }

  // Whoever reads billing status next after a scheduled downgrade's period
  // has actually ended is the one that applies it - see
  // _shared/applyPendingPlanChange.ts for why this isn't a background job.
  const current = await applyPendingPlanChangeIfDue(db, subscription);

  return json(
    req,
    {
      plan: current.plan,
      status: current.status,
      current_period_end: current.current_period_end,
      pending_plan_change: current.pending_plan_change,
      cancellation_reason: current.cancellation_reason,
      cancelled_at: current.cancelled_at,
    },
    200,
  );
});
