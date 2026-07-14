import { supabase } from "@/integrations/supabase/client";
import type {
  Entitlement,
  Feedback,
  InterviewQuestion,
  TurnAttempt,
} from "@/lib/interviewPrep/types";

/**
 * Read-only entitlement snapshot for rendering (paywall vs. proceed). Claims
 * NOTHING — the free trial is only consumed when the user commits via
 * `startInterviewSession`. The client decides with `decideEntitlement`.
 */
export async function getInterviewEntitlement(): Promise<Entitlement> {
  const { data, error } = await supabase.functions.invoke(
    "get-interview-entitlement",
    { body: {} },
  );
  if (error) throw new Error(error.message);
  return {
    subscriptionTier: data?.subscriptionTier === "paid" ? "paid" : "free",
    trialUsedAt: data?.trialUsedAt ?? null,
    trialApplicationId: data?.trialApplicationId ?? null,
  };
}

/**
 * Client wrappers over the Interview Prep edge functions. Follows the house
 * convention (thin invoke wrappers that throw on transport errors and read a
 * success/flag body rather than HTTP status codes for business outcomes).
 */

export interface StartSessionResult {
  /** false → the user is out of entitlement; render the upgrade paywall. */
  allowed: boolean;
  code?: "upgrade_required";
  sessionId?: string;
}

/**
 * Server-authoritative entitlement gate + session creation. For a free user
 * with an unclaimed trial this atomically claims the trial (binding it to this
 * application) and creates the session; when out of entitlement it returns
 * `{ allowed: false, code: "upgrade_required" }`.
 */
export async function startInterviewSession(
  applicationId: string,
): Promise<StartSessionResult> {
  const { data, error } = await supabase.functions.invoke(
    "start-interview-session",
    { body: { applicationId } },
  );
  if (error) throw new Error(error.message);
  return data as StartSessionResult;
}

export interface InterviewPlan {
  roleType: string;
  competencies: string[];
  questions: InterviewQuestion[];
  /** true when the resume/JD changed since the cached plan and it was regenerated. */
  stale: boolean;
}

export async function generateInterviewPlan(
  applicationId: string,
): Promise<InterviewPlan> {
  const { data, error } = await supabase.functions.invoke(
    "generate-interview-plan",
    { body: { applicationId } },
  );
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || "Failed to prepare interview questions");
  return {
    roleType: data.roleType,
    competencies: data.competencies ?? [],
    questions: data.questions as InterviewQuestion[],
    stale: !!data.stale,
  };
}

export interface ScoreAnswerInput {
  sessionId: string;
  questionId: string;
  answerText: string;
  attemptNumber: number;
  priorTurnId?: string;
}

export interface ScoreAnswerResult {
  turn: TurnAttempt;
  feedback: Feedback;
  isComplete: boolean;
}

export async function scoreInterviewAnswer(
  input: ScoreAnswerInput,
): Promise<ScoreAnswerResult> {
  const { data, error } = await supabase.functions.invoke(
    "score-interview-answer",
    { body: input },
  );
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || "Failed to score answer");
  return {
    turn: data.turn as TurnAttempt,
    feedback: data.feedback as Feedback,
    isComplete: !!data.isComplete,
  };
}
