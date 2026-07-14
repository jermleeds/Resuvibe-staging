import { useEffect, useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Loader2, Lock, RotateCcw, ArrowRight, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  interviewReducer,
  initialState,
} from "@/lib/interviewPrep/interviewMachine";
import { overallScore, countedAttemptIds } from "@/lib/interviewPrep/bestAttempt";
import { decideEntitlement } from "@/lib/interviewPrep/entitlement";
import type { InterviewQuestion } from "@/lib/interviewPrep/types";
import {
  getInterviewEntitlement,
  startInterviewSession,
  generateInterviewPlan,
  scoreInterviewAnswer,
  type InterviewPlan,
} from "@/lib/api/interviewPrep";

type Phase = "loading" | "paywall" | "plan" | "interview" | "complete" | "error";

/**
 * Interview Prep tab. Reached only when the tab is unlocked (a resume exists —
 * enforced by InterviewPrepTabTrigger), so the JD + tailored resume grounding
 * is guaranteed. Server-side entitlement + trial claim happen in
 * start-interview-session; this renders the paywall when the server says the
 * user is out of entitlement.
 */
export function InterviewPrepTab({
  applicationId,
  app,
}: {
  applicationId: string;
  app: { company_name?: string | null };
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [plan, setPlan] = useState<InterviewPlan | null>(null);
  const [state, dispatch] = useReducer(interviewReducer, initialState);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);

  // On open: READ-ONLY entitlement check → plan. No trial is claimed and no
  // session is created here — that only happens when the user clicks "Begin"
  // (so merely opening the tab never spends the free trial).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entitlement = await getInterviewEntitlement();
        if (cancelled) return;
        if (decideEntitlement(entitlement, applicationId).kind === "paywall") {
          setPhase("paywall");
          return;
        }
        const p = await generateInterviewPlan(applicationId);
        if (cancelled) return;
        setPlan(p);
        if (p.stale) {
          toast({
            title: "Questions refreshed",
            description: "Your resume or job description changed, so we regenerated the questions.",
          });
        }
        setPhase("plan");
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Something went wrong.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, toast]);

  // Commit point: claim the trial (server-side, atomic) + create the session,
  // then start the interview. This is where the free trial is actually spent.
  async function handleBegin() {
    if (!plan) return;
    setStarting(true);
    try {
      const session = await startInterviewSession(applicationId);
      if (!session.allowed) {
        setPhase("paywall");
        return;
      }
      setSessionId(session.sessionId ?? null);
      dispatch({ type: "START", questions: plan.questions });
      setPhase("interview");
    } catch (e) {
      toast({
        title: "Couldn't start the interview",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  }

  // Mirror the reducer's completion into the local phase.
  useEffect(() => {
    if (state.status === "complete") setPhase("complete");
  }, [state.status]);

  const currentQuestion: InterviewQuestion | undefined =
    state.questions[state.currentIndex];

  async function handleSubmit() {
    if (!sessionId || !currentQuestion || answer.trim().length === 0) return;
    setSubmitting(true);
    try {
      const priorForQuestion = state.attempts.filter(
        (a) => a.questionId === currentQuestion.id,
      );
      const attemptNumber = priorForQuestion.length + 1;
      const priorTurnId =
        priorForQuestion[priorForQuestion.length - 1]?.id;
      const result = await scoreInterviewAnswer({
        sessionId,
        questionId: currentQuestion.id,
        answerText: answer.trim(),
        attemptNumber,
        priorTurnId,
      });
      dispatch({ type: "ANSWER_SCORED", attempt: result.turn, feedback: result.feedback });
      setAnswer("");
    } catch (e) {
      toast({
        title: "Couldn't score that answer",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing your interview…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-4">
          <p className="text-muted-foreground">{errorMsg}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "paywall") {
    return (
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" /> Interview Prep is a premium feature
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You've used your one free interview. Upgrade to practice unlimited
            role-tailored interviews across all your applications, with instant
            AI feedback on every answer.
          </p>
          <Button disabled title="Billing coming soon">
            <Sparkles className="mr-2 h-4 w-4" /> Upgrade to Premium
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "plan" && plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your interview plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Based on your resume and this job description, we'll ask{" "}
            <strong>{plan.questions.length} questions</strong> tailored to a{" "}
            <strong>{plan.roleType}</strong> role. You can retry any answer to
            improve it — your best attempt is what counts.
          </p>
          {plan.competencies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {plan.competencies.map((c) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              ))}
            </div>
          )}
          <Button onClick={handleBegin} disabled={starting}>
            {starting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…</> : <>Begin interview <ArrowRight className="ml-2 h-4 w-4" /></>}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "complete") {
    const counted = countedAttemptIds(state.attempts);
    const bestByQuestion = state.questions.map((q) => {
      const best = state.attempts.find((a) => counted.has(a.id) && a.questionId === q.id);
      return { q, best };
    });
    return (
      <Card>
        <CardHeader>
          <CardTitle>Interview complete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-3xl font-bold">{overallScore(state.attempts)}<span className="text-lg text-muted-foreground">/100</span></div>
            <p className="text-sm text-muted-foreground">Overall score (best attempt per question)</p>
          </div>
          <div className="space-y-2">
            {bestByQuestion.map(({ q, best }) => (
              <div key={q.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <span className="truncate pr-3">{q.competency}</span>
                <Badge variant={best && best.score >= 70 ? "default" : "secondary"}>
                  {best ? best.score : "—"}
                </Badge>
              </div>
            ))}
          </div>
          <Button variant="outline" onClick={() => { dispatch({ type: "RESET" }); setAnswer(""); setPhase("plan"); }}>
            <RotateCcw className="mr-2 h-4 w-4" /> Practice again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // phase === "interview"
  if (!currentQuestion) return null;
  const progress = ((state.currentIndex + 1) / state.questions.length) * 100;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Question {state.currentIndex + 1} of {state.questions.length}</span>
          <Badge variant="outline">{currentQuestion.modality}</Badge>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{currentQuestion.question}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Assessing: {currentQuestion.competency}
            {currentQuestion.leadershipPrinciple ? ` · ${currentQuestion.leadershipPrinciple}` : ""}
          </p>

          {!state.awaitingChoice ? (
            <>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer…"
                rows={7}
                disabled={submitting}
              />
              <Button onClick={handleSubmit} disabled={submitting || answer.trim().length === 0}>
                {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scoring…</> : "Submit answer"}
              </Button>
            </>
          ) : (
            state.currentFeedback && (
              <div className="space-y-4">
                <FeedbackView feedback={state.currentFeedback} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => dispatch({ type: "RETRY_QUESTION" })}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Try Responding Again
                  </Button>
                  <Button onClick={() => dispatch({ type: "NEXT_QUESTION" })}>
                    Next Question <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FeedbackView({ feedback }: { feedback: import("@/lib/interviewPrep/types").Feedback }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Feedback</span>
        <Badge>{feedback.overallScore}/100</Badge>
      </div>
      {feedback.dimensions.length > 0 && (
        <div className="space-y-1.5">
          {feedback.dimensions.map((d) => (
            <div key={d.name} className="text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground">{d.quality} · {d.score}/5</span>
              </div>
              <p className="text-muted-foreground">{d.feedback}</p>
            </div>
          ))}
        </div>
      )}
      {feedback.suggestions.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-1">
          {feedback.suggestions.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}
