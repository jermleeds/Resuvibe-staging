import type { TurnAttempt } from "./types";

/**
 * The best-attempt bookkeeping that decides which attempt "counts" for each
 * question. The highest-scoring attempt wins; ties break toward the later
 * attempt (the user's most recent effort at their peak). Mirrors the
 * `is_counted` recomputation done server-side in `score-interview-answer`.
 */
export function countedAttemptIds(turns: TurnAttempt[]): Set<string> {
  const bestByQuestion = new Map<string, TurnAttempt>();
  for (const t of turns) {
    const current = bestByQuestion.get(t.questionId);
    if (
      !current ||
      t.score > current.score ||
      (t.score === current.score && t.attemptNumber > current.attemptNumber)
    ) {
      bestByQuestion.set(t.questionId, t);
    }
  }
  return new Set([...bestByQuestion.values()].map((t) => t.id));
}

/**
 * Overall interview score = the mean of each question's best attempt, rounded
 * to the nearest integer. 0 when there are no attempts.
 */
export function overallScore(turns: TurnAttempt[]): number {
  const bestByQuestion = new Map<string, number>();
  for (const t of turns) {
    const current = bestByQuestion.get(t.questionId);
    if (current === undefined || t.score > current) {
      bestByQuestion.set(t.questionId, t.score);
    }
  }
  if (bestByQuestion.size === 0) return 0;
  const sum = [...bestByQuestion.values()].reduce((a, b) => a + b, 0);
  return Math.round(sum / bestByQuestion.size);
}
