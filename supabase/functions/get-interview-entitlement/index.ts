import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";

/**
 * READ-ONLY entitlement snapshot for the Interview Prep tab. Claims nothing and
 * creates no session — the free trial is only spent when the user commits via
 * start-interview-session. Reads the caller's own row through RLS (read-own
 * policy on user_entitlements); a missing row means a fresh free/unclaimed user.
 */
Deno.serve(async (req) => {
  const corsHeaders = makeCorsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: ent } = await userClient
      .from("user_entitlements")
      .select("subscription_tier, trial_used_at, trial_application_id")
      .eq("user_id", user.id)
      .maybeSingle();

    return json({
      subscriptionTier: ent?.subscription_tier === "paid" ? "paid" : "free",
      trialUsedAt: ent?.trial_used_at ?? null,
      trialApplicationId: ent?.trial_application_id ?? null,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
