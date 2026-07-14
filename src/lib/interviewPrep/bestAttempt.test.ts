import { describe, it, expect } from "vitest";
import { countedAttemptIds, overallScore } from "./bestAttempt";
import type { TurnAttempt } from "./types";

const turn = (over: Partial<TurnAttempt>): TurnAttempt => ({
  id: over.id ?? `${over.questionId}-${over.attemptNumber}`,
  questionId: "q1",
  orderIndex: 0,
  attemptNumber: 1,
  answerText: "answer",
  score: 50,
  ...over,
});

describe("countedAttemptIds", () => {
  it("counts the single attempt when a question has one", () => {
    const turns = [turn({ questionId: "q1", attemptNumber: 1, score: 60 })];
    expect(countedAttemptIds(turns)).toEqual(new Set(["q1-1"]));
  });

  it("counts the highest-scoring attempt per question (best attempt)", () => {
    const turns = [
      turn({ questionId: "q1", attemptNumber: 1, score: 40 }),
      turn({ questionId: "q1", attemptNumber: 2, score: 75 }),
      turn({ questionId: "q1", attemptNumber: 3, score: 55 }),
    ];
    expect(countedAttemptIds(turns)).toEqual(new Set(["q1-2"]));
  });

  it("breaks ties toward the later attempt", () => {
    const turns = [
      turn({ questionId: "q1", attemptNumber: 1, score: 70 }),
      turn({ questionId: "q1", attemptNumber: 2, score: 70 }),
    ];
    expect(countedAttemptIds(turns)).toEqual(new Set(["q1-2"]));
  });

  it("counts the best attempt independently for each question", () => {
    const turns = [
      turn({ questionId: "q1", attemptNumber: 1, score: 40 }),
      turn({ questionId: "q1", attemptNumber: 2, score: 80 }),
      turn({ questionId: "q2", attemptNumber: 1, score: 30 }),
    ];
    expect(countedAttemptIds(turns)).toEqual(new Set(["q1-2", "q2-1"]));
  });
});

describe("overallScore", () => {
  it("averages the best attempt of each question, rounded", () => {
    const turns = [
      turn({ questionId: "q1", attemptNumber: 1, score: 40 }),
      turn({ questionId: "q1", attemptNumber: 2, score: 80 }), // best q1 = 80
      turn({ questionId: "q2", attemptNumber: 1, score: 55 }), // best q2 = 55
    ];
    // (80 + 55) / 2 = 67.5 -> 68
    expect(overallScore(turns)).toBe(68);
  });

  it("is 0 when there are no attempts", () => {
    expect(overallScore([])).toBe(0);
  });
});
