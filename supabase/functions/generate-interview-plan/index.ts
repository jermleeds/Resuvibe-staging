import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import {
  sourceFingerprint,
  callGateway,
  extractJson,
  logInterviewUsage,
} from "../_shared/interviewShared.ts";

/**
 * Generates (and caches per application) the role-aware interview plan: role
 * type, 4–6 competencies each with a predictive modality, and one question per
 * competency. Grounded in the tailored resume + JD + cover letter. Returns the
 * cache when source_fingerprint matches; regenerates (stale: true) when the
 * resume/JD changed.
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ success: false, error: "AI not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ success: false, error: "Unauthorized" }, 401);

    const { applicationId } = await req.json();
    if (!applicationId) return json({ success: false, error: "applicationId required" }, 400);

    const { data: appRow } = await userClient
      .from("job_applications")
      .select("id, resume_html, job_description_markdown, cover_letter, jd_intelligence, job_title")
      .eq("id", applicationId)
      .maybeSingle();
    if (!appRow) return json({ success: false, error: "Application not found" }, 404);
    if (!appRow.resume_html) {
      return json({ success: false, error: "Generate a resume for this application first" }, 400);
    }

    const jd = appRow.job_description_markdown || "";
    const fingerprint = sourceFingerprint(appRow.resume_html, jd);
    const service = createClient(supabaseUrl, serviceKey);

    // Cache check — only the ACTIVE question set.
    const { data: cached } = await service
      .from("interview_questions")
      .select("*")
      .eq("application_id", applicationId)
      .eq("is_active", true)
      .order("order_index", { ascending: true });

    const cacheFresh =
      cached && cached.length > 0 && cached.every((q) => q.source_fingerprint === fingerprint);

    if (cacheFresh) {
      return json({
        success: true,
        roleType: appRow.job_title || "the role",
        competencies: [...new Set(cached!.map((q) => q.competency))],
        questions: cached!.map(mapQuestion),
        stale: false,
      });
    }

    // (Re)generate.
    const system = `You are an expert interview coach. Given a candidate's tailored resume and the job description, design a role-appropriate mock interview.

Return ONLY JSON of this exact shape:
{
  "roleType": "<short role label, e.g. 'Technical Program Manager'>",
  "questions": [
    {
      "competency": "<competency being assessed>",
      "modality": "behavioral | situational | cognitive-task",
      "leadershipPrinciple": null,
      "question": "<one interview question tailored to the resume + JD>",
      "rubricAnchors": { "1": "<weak answer>", "3": "<adequate>", "5": "<excellent>" }
    }
  ]
}

Rules:
- Extract 4–6 core competencies from the JD; produce exactly one question per competency (max 6).
- Choose the most PREDICTIVE modality per competency for THIS role: TPM/Manager → situational for coordination/leadership; Designer/Architect → cognitive-task for design/systems thinking; ICs → behavioral for past examples.
- Ground questions in specifics from the candidate's resume (probe real claims), not generic prompts.
- leadershipPrinciple may be null unless the JD is clearly Amazon-style.`;

    const userPrompt = `JOB TITLE: ${appRow.job_title || "(unknown)"}

JOB DESCRIPTION:
${jd.slice(0, 8000)}

CANDIDATE RESUME (tailored to this job):
${htmlToText(appRow.resume_html).slice(0, 6000)}

${appRow.cover_letter ? `COVER LETTER:\n${String(appRow.cover_letter).slice(0, 2000)}` : ""}`;

    const ai = await callGateway(LOVABLE_API_KEY, system, userPrompt);
    const parsed = extractJson<{ roleType?: string; questions?: any[] }>(ai.text);
    const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 6) : [];
    if (questions.length === 0) throw new Error("Model returned no questions");

    // Deactivate the stale set (do NOT delete — historical turns reference these
    // rows; deleting would cascade/orphan them). A fresh active set is inserted.
    await service
      .from("interview_questions")
      .update({ is_active: false })
      .eq("application_id", applicationId)
      .eq("is_active", true);
    const rows = questions.map((q, i) => ({
      application_id: applicationId,
      user_id: user.id,
      question: String(q.question ?? ""),
      competency: String(q.competency ?? "General"),
      modality: ["behavioral", "situational", "cognitive-task", "work-sample"].includes(q.modality)
        ? q.modality
        : "behavioral",
      leadership_principle: q.leadershipPrinciple ?? null,
      rubric_anchors: q.rubricAnchors ?? {},
      order_index: i,
      source_fingerprint: fingerprint,
    }));
    const { data: inserted, error: insErr } = await service
      .from("interview_questions")
      .insert(rows)
      .select("*")
      .order("order_index", { ascending: true });
    if (insErr) throw new Error(insErr.message);

    await logInterviewUsage(service, {
      userId: user.id,
      edgeFunction: "generate-interview-plan",
      assetType: "interview-plan",
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
    });

    return json({
      success: true,
      roleType: parsed.roleType || appRow.job_title || "the role",
      competencies: [...new Set(inserted!.map((q) => q.competency))],
      questions: inserted!.map(mapQuestion),
      stale: !!(cached && cached.length > 0), // there was an older plan we replaced
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

function mapQuestion(q: Record<string, unknown>) {
  return {
    id: q.id,
    competency: q.competency,
    modality: q.modality,
    leadershipPrinciple: q.leadership_principle ?? null,
    question: q.question,
    orderIndex: q.order_index,
  };
}

/** Minimal HTML → text for prompt grounding (no DOM in Deno). */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
