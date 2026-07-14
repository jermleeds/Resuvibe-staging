import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";

/**
 * Entitlement gate + session creation for Interview Prep.
 *
 * Authoritative, server-side, service-role. Rule: the free trial is one
 * Application's worth of prep. For a free user with an unclaimed trial we claim
 * it ATOMICALLY (a single conditional UPDATE) — closing the read-then-write race
 * so a free user can never get more than one free interview. Out of entitlement
 * returns { allowed: false, code: "upgrade_required" } (house convention: a 200
 * body flag rather than an HTTP error code).
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
    if (!authHeader) return json({ success: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const { applicationId } = await req.json();
    if (!applicationId) return json({ success: false, error: "applicationId required" }, 400);

    // Verify the application is the user's and has a resume (grounding prerequisite).
    const { data: appRow } = await userClient
      .from("job_applications")
      .select("id, resume_html")
      .eq("id", applicationId)
      .maybeSingle();
    if (!appRow) return json({ success: false, error: "Application not found" }, 404);
    if (!appRow.resume_html) {
      return json({ success: false, error: "Generate a resume for this application first" }, 400);
    }

    const service = createClient(supabaseUrl, serviceKey);

    // Ensure an entitlement row exists (defaults to free / unclaimed).
    await service
      .from("user_entitlements")
      .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: ent } = await service
      .from("user_entitlements")
      .select("subscription_tier, trial_used_at, trial_application_id")
      .eq("user_id", user.id)
      .single();

    let allowed = false;
    if (ent?.subscription_tier === "paid") {
      allowed = true;
    } else if (ent?.trial_used_at == null) {
      // Atomic claim: only succeeds if still unclaimed (race-safe).
      const { data: claimed } = await service
        .from("user_entitlements")
        .update({
          trial_used_at: new Date().toISOString(),
          trial_application_id: applicationId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("subscription_tier", "free")
        .is("trial_used_at", null)
        .select("trial_application_id");
      if (claimed && claimed.length > 0) {
        allowed = true;
      } else {
        // Lost the race — re-read and allow only if it landed on THIS application.
        const { data: reread } = await service
          .from("user_entitlements")
          .select("trial_application_id")
          .eq("user_id", user.id)
          .single();
        allowed = reread?.trial_application_id === applicationId;
      }
    } else if (ent?.trial_application_id === applicationId) {
      allowed = true;
    }

    if (!allowed) return json({ allowed: false, code: "upgrade_required" });

    const { data: session, error: sessionErr } = await service
      .from("interview_sessions")
      .insert({ application_id: applicationId, user_id: user.id, status: "inProgress" })
      .select("id")
      .single();
    if (sessionErr || !session) throw new Error(sessionErr?.message || "Could not create session");

    return json({ allowed: true, sessionId: session.id });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
