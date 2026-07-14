-- Interview Prep feature (MVP core loop).
-- New tables hang off job_applications + auth.users, all RLS-scoped by user_id.
-- Entitlement lives in its own SERVER-ONLY table (read-own, no client writes) so
-- the free-tier gate cannot be bypassed by a client-side profile upsert.
-- generation_usage gains token/cost columns so retry economics are measurable.

-- ── user_entitlements ─────────────────────────────────────────────────────────
-- One row per user. Written ONLY by the service role (edge functions / future
-- billing webhook). The free trial is one Application's worth of prep, bound to
-- trial_application_id once claimed.
CREATE TABLE public.user_entitlements (
  user_id               uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_tier     text        NOT NULL DEFAULT 'free',
  trial_used_at         timestamptz,                          -- null = trial unclaimed
  trial_application_id  uuid        REFERENCES public.job_applications(id) ON DELETE SET NULL,
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_entitlements_tier_check CHECK (subscription_tier IN ('free', 'paid'))
);

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;

-- Users may READ their own entitlement (to render proceed vs. paywall).
CREATE POLICY "Users read own entitlement"
  ON public.user_entitlements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- NO INSERT/UPDATE/DELETE policies for authenticated → with RLS enabled, the
-- client cannot write entitlement state at all. The service role bypasses RLS
-- and is the sole writer (start-interview-session claims the trial atomically;
-- billing flips subscription_tier later).

-- ── interview_questions ───────────────────────────────────────────────────────
-- Cached per application. Regenerated when source_fingerprint (hash of
-- resume_html + JD) changes.
CREATE TABLE public.interview_questions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid        NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question              text        NOT NULL,
  competency            text        NOT NULL,
  modality              text        NOT NULL DEFAULT 'behavioral',
  leadership_principle  text,                                 -- nullable (non-LP roles)
  rubric_anchors        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  order_index           integer     NOT NULL,
  source_fingerprint    text        NOT NULL,
  -- Question sets are VERSIONED, never deleted: when the resume/JD fingerprint
  -- changes, the old set is deactivated (is_active = false) and a new active set
  -- is inserted. Prior questions stay so historical turns keep resolving.
  is_active             boolean     NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interview_questions_modality_check
    CHECK (modality IN ('behavioral', 'situational', 'cognitive-task', 'work-sample'))
);

ALTER TABLE public.interview_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own interview questions"
  ON public.interview_questions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- Writes via service role only.

CREATE INDEX interview_questions_application_idx ON public.interview_questions (application_id);
CREATE INDEX interview_questions_active_idx ON public.interview_questions (application_id, is_active);

-- ── interview_sessions ────────────────────────────────────────────────────────
CREATE TABLE public.interview_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid        NOT NULL REFERENCES public.job_applications(id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'inProgress',
  role_type      text,
  overall_score  numeric     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,

  CONSTRAINT interview_sessions_status_check CHECK (status IN ('inProgress', 'complete'))
);

ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own interview sessions"
  ON public.interview_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- Writes via service role only.

CREATE INDEX interview_sessions_application_idx ON public.interview_sessions (application_id);
CREATE INDEX interview_sessions_user_idx        ON public.interview_sessions (user_id);

-- ── interview_turns ───────────────────────────────────────────────────────────
-- One row PER ATTEMPT (a question with k retries has k rows). Exactly one attempt
-- per question carries is_counted = true (the best-scoring one).
CREATE TABLE public.interview_turns (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     uuid        NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  -- question_id is nullable + SET NULL (never CASCADE): a turn survives even if
  -- its question row is ever removed. question_text is denormalized so a turn is
  -- self-contained for history.
  question_id    uuid        REFERENCES public.interview_questions(id) ON DELETE SET NULL,
  question_text  text        NOT NULL DEFAULT '',
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_index    integer     NOT NULL,
  attempt_number integer     NOT NULL,
  answer_text    text        NOT NULL,
  feedback       jsonb,
  dimensions     jsonb,
  score          numeric     NOT NULL DEFAULT 0,
  is_counted     boolean     NOT NULL DEFAULT false,
  prior_turn_id  uuid        REFERENCES public.interview_turns(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own interview turns"
  ON public.interview_turns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
-- Writes via service role only.

CREATE INDEX interview_turns_session_idx ON public.interview_turns (session_id);

-- ── generation_usage: token/cost columns ─────────────────────────────────────
-- Superset migration on the shared host usage table so AI cost (incl. retry
-- spend on the free trial) is measurable, not just call-counted.
ALTER TABLE public.generation_usage
  ADD COLUMN IF NOT EXISTS input_tokens  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost          numeric NOT NULL DEFAULT 0;
