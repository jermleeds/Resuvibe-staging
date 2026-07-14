/**
 * Shared types for the Interview Prep feature (client side).
 *
 * These mirror the Postgres schema in
 * `supabase/migrations/*_interview_prep.sql` and the edge-function contracts in
 * `docs/features/resuvibe-integration/04-feature-architecture.md`. Kept as plain
 * TypeScript (no Zod) to match the host codebase's convention.
 */

export type Modality = "behavioral" | "situational" | "cognitive-task";

export type Tier = "free" | "paid";

/** Row shape from `user_entitlements` (server-only table), camelCased for the client. */
export interface Entitlement {
  subscriptionTier: Tier;
  /** null = the free trial has not been claimed yet. */
  trialUsedAt: string | null;
  /** The single application the free trial is bound to, once claimed. */
  trialApplicationId: string | null;
}

export interface InterviewQuestion {
  id: string;
  competency: string;
  modality: Modality;
  /** Amazon LP framing is optional — null for non-LP roles. */
  leadershipPrinciple: string | null;
  question: string;
  orderIndex: number;
}

export interface FeedbackDimension {
  name: string;
  score: number; // 1..5
  quality: string;
  feedback: string;
}

export interface Feedback {
  modality: Modality;
  overallScore: number; // 0..100
  dimensions: FeedbackDimension[];
  suggestions: string[];
  confidenceNote?: string;
}

/** One attempt at a question. A question with k retries has k TurnAttempt rows. */
export interface TurnAttempt {
  id: string;
  questionId: string;
  orderIndex: number; // question position within the interview
  attemptNumber: number; // 1..k
  answerText: string;
  score: number; // 0..100
}

export type InterviewStatus = "initial" | "inProgress" | "complete" | "error";

export interface InterviewState {
  status: InterviewStatus;
  questions: InterviewQuestion[];
  currentIndex: number;
  attempts: TurnAttempt[];
  /** Feedback for the just-scored attempt; drives the FeedbackCard + its two CTAs. */
  currentFeedback: Feedback | null;
  /** True after ANSWER_SCORED until the user picks Try Again or Next Question. */
  awaitingChoice: boolean;
  error?: string;
}

export type InterviewEvent =
  | { type: "START"; questions: InterviewQuestion[] }
  | { type: "ANSWER_SCORED"; attempt: TurnAttempt; feedback: Feedback }
  | { type: "RETRY_QUESTION" }
  | { type: "NEXT_QUESTION" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" }
  | {
      type: "INIT_FROM_SNAPSHOT";
      questions: InterviewQuestion[];
      attempts: TurnAttempt[];
      currentIndex: number;
    };
