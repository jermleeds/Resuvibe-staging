import { describe, it, expect } from "vitest";
import { interviewReducer, initialState } from "./interviewMachine";
import type { InterviewQuestion, InterviewState, Feedback, TurnAttempt } from "./types";

const q = (id: string, orderIndex: number): InterviewQuestion => ({
  id,
  orderIndex,
  competency: "Ownership",
  modality: "behavioral",
  leadershipPrinciple: null,
  question: `Question ${id}`,
});

const questions = [q("qa", 0), q("qb", 1)];

const feedback: Feedback = {
  modality: "behavioral",
  overallScore: 70,
  dimensions: [],
  suggestions: [],
};

const attempt = (over: Partial<TurnAttempt>): TurnAttempt => ({
  id: "t1",
  questionId: "qa",
  orderIndex: 0,
  attemptNumber: 1,
  answerText: "ans",
  score: 70,
  ...over,
});

const started = (): InterviewState =>
  interviewReducer(initialState, { type: "START", questions });

describe("interviewReducer", () => {
  it("starts an interview on the first question", () => {
    const s = started();
    expect(s.status).toBe("inProgress");
    expect(s.currentIndex).toBe(0);
    expect(s.questions).toHaveLength(2);
    expect(s.awaitingChoice).toBe(false);
  });

  it("records a scored attempt and awaits the retry/next choice", () => {
    const s = interviewReducer(started(), {
      type: "ANSWER_SCORED",
      attempt: attempt({}),
      feedback,
    });
    expect(s.attempts).toHaveLength(1);
    expect(s.currentFeedback).toEqual(feedback);
    expect(s.awaitingChoice).toBe(true);
    expect(s.currentIndex).toBe(0); // still on the same question
  });

  it("RETRY_QUESTION stays on the same question and clears the awaiting/feedback state", () => {
    let s = interviewReducer(started(), { type: "ANSWER_SCORED", attempt: attempt({}), feedback });
    s = interviewReducer(s, { type: "RETRY_QUESTION" });
    expect(s.currentIndex).toBe(0);
    expect(s.awaitingChoice).toBe(false);
    expect(s.currentFeedback).toBeNull();
    expect(s.attempts).toHaveLength(1); // prior attempt retained for improvement-aware scoring
  });

  it("NEXT_QUESTION advances to the next question", () => {
    let s = interviewReducer(started(), { type: "ANSWER_SCORED", attempt: attempt({}), feedback });
    s = interviewReducer(s, { type: "NEXT_QUESTION" });
    expect(s.currentIndex).toBe(1);
    expect(s.status).toBe("inProgress");
    expect(s.awaitingChoice).toBe(false);
    expect(s.currentFeedback).toBeNull();
  });

  it("NEXT_QUESTION on the last question completes the interview", () => {
    let s = started();
    // answer + advance q0 -> q1
    s = interviewReducer(s, { type: "ANSWER_SCORED", attempt: attempt({}), feedback });
    s = interviewReducer(s, { type: "NEXT_QUESTION" });
    // answer + advance q1 -> complete
    s = interviewReducer(s, {
      type: "ANSWER_SCORED",
      attempt: attempt({ id: "t2", questionId: "qb", orderIndex: 1 }),
      feedback,
    });
    s = interviewReducer(s, { type: "NEXT_QUESTION" });
    expect(s.status).toBe("complete");
  });

  it("ERROR moves to the error state with a message", () => {
    const s = interviewReducer(started(), { type: "ERROR", message: "boom" });
    expect(s.status).toBe("error");
    expect(s.error).toBe("boom");
  });

  it("INIT_FROM_SNAPSHOT rehydrates an interrupted session (resumability)", () => {
    const s = interviewReducer(initialState, {
      type: "INIT_FROM_SNAPSHOT",
      questions,
      attempts: [attempt({})],
      currentIndex: 1,
    });
    expect(s.status).toBe("inProgress");
    expect(s.currentIndex).toBe(1);
    expect(s.attempts).toHaveLength(1);
    expect(s.awaitingChoice).toBe(false);
  });
});
