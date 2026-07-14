import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { makeCorsHeaders } from "../_shared/cors.ts";
import { callGateway, extractJson, logInterviewUsage } from "../_shared/interviewShared.ts";

/**
 * Scores one answer attempt against its question's modality rubric, persists the
 * turn, and recomputes which attempt "counts" for that question (best score,
 * ties → later attempt). Improvement-aware: on a retry the prior attempt + its
 * feedback are given to the model so it can recognize the improvement.
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

    const { sessionId, questionId, answerText, attemptNumber, priorTurnId } = await req.json();
    if (!sessionId || !questionId || !answerText) {
      return json({ success: false, error: "sessionId, questionId, answerText required" }, 400);
    }

    // RLS-scoped reads confirm ownership.
    const { data: session } = await userClient
      .from("interview_sessions")
      .select("id, application_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return json({ success: false, error: "Session not found" }, 404);

    const { data: question } = await userClient
      .from("interview_questions")
      .select("id, question, competency, modality, order_index")
      .eq("id", questionId)
      .maybeSingle();
    if (!question) return json({ success: false, error: "Question not found" }, 404);

    const service = createClient(supabaseUrl, serviceKey);

    let priorContext = "";
    if (priorTurnId) {
      const { data: prior } = await service
        .from("interview_turns")
        .select("answer_text, feedback")
        .eq("id", priorTurnId)
        .maybeSingle();
      if (prior) {
        priorContext = `\n\nThis is a RETRY. The candidate's PREVIOUS answer was:\n"${prior.answer_text}"\nPrevious feedback: ${JSON.stringify(prior.feedback)}\nAssess whether the new answer improves on it, and acknowledge genuine improvement.`;
      }
    }

    const system = `You are an expert interviewer scoring a candidate's answer for a "${question.modality}" competency question. Return ONLY JSON:
{
  "overallScore": <0-100>,
  "modality": "${question.modality}",
  "dimensions": [ { "name": "<dimension>", "score": <1-5>, "quality": "weak|fair|good|strong|excellent", "feedback": "<specific, actionable>" } ],
  "suggestions": ["<concrete improvement>", "..."]
}
Score against the ${question.modality} rubric. Be specific and constructive; reference what the candidate actually said.`;

    const userPrompt = `QUESTION (${question.competency}): ${question.question}

CANDIDATE ANSWER:
${String(answerText).slice(0, 4000)}${priorContext}`;

    const ai = await callGateway(LOVABLE_API_KEY, system, userPrompt);
    const fb = extractJson<{
      overallScore?: number;
      modality?: string;
      dimensions?: unknown[];
      suggestions?: unknown[];
    }>(ai.text);
    const score = clamp(Number(fb.overallScore ?? 0), 0, 100);
    const feedback = {
      modality: question.modality,
      overallScore: score,
      dimensions: Array.isArray(fb.dimensions) ? fb.dimensions : [],
      suggestions: Array.isArray(fb.suggestions) ? fb.suggestions : [],
    };

    // Persist the attempt.
    const { data: turn, error: turnErr } = await service
      .from("interview_turns")
      .insert({
        session_id: sessionId,
        question_id: questionId,
        question_text: question.question,
        user_id: user.id,
        order_index: question.order_index,
        attempt_number: attemptNumber ?? 1,
        answer_text: answerText,
        feedback,
        dimensions: feedback.dimensions,
        score,
        is_counted: false,
        prior_turn_id: priorTurnId ?? null,
      })
      .select("id")
      .single();
    if (turnErr || !turn) throw new Error(turnErr?.message || "Could not save turn");

    // Recompute best-attempt for this question (highest score; tie → later attempt).
    const { data: attempts } = await service
      .from("interview_turns")
      .select("id, score, attempt_number")
      .eq("session_id", sessionId)
      .eq("question_id", questionId);
    if (attempts && attempts.length > 0) {
      const best = attempts.reduce((a, b) =>
        b.score > a.score || (b.score === a.score && b.attempt_number > a.attempt_number) ? b : a,
      );
      await service.from("interview_turns").update({ is_counted: false })
        .eq("session_id", sessionId).eq("question_id", questionId);
      await service.from("interview_turns").update({ is_counted: true }).eq("id", best.id);
    }

    // Update the session's overall score from counted best attempts.
    const { data: counted } = await service
      .from("interview_turns")
      .select("score")
      .eq("session_id", sessionId)
      .eq("is_counted", true);
    if (counted && counted.length > 0) {
      const overall = Math.round(counted.reduce((s, t) => s + Number(t.score), 0) / counted.length);
      await service.from("interview_sessions").update({ overall_score: overall }).eq("id", sessionId);
    }

    // Informational: is this the last question of the plan?
    const { count: total } = await service
      .from("interview_questions")
      .select("*", { count: "exact", head: true })
      .eq("application_id", session.application_id);
    const isComplete = (question.order_index ?? 0) + 1 >= (total ?? 0);

    await logInterviewUsage(service, {
      userId: user.id,
      edgeFunction: "score-interview-answer",
      assetType: "interview-scoring",
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
    });

    return json({
      success: true,
      turn: {
        id: turn.id,
        questionId,
        orderIndex: question.order_index,
        attemptNumber: attemptNumber ?? 1,
        answerText,
        score,
      },
      feedback,
      isComplete,
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : 0));
}
