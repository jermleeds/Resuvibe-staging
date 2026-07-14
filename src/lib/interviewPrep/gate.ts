/**
 * The UI prerequisite gate for Interview Prep. The tab is always visible but
 * stays inactive until the application has a generated resume (`resume_html`).
 * Because resume generation requires the JD, an unlocked tab guarantees both
 * the JD and the tailored resume exist — the grounding contract Interview Prep
 * depends on.
 */
export const INTERVIEW_PREP_LOCK_REASON =
  "Generate a resume for this application to unlock Interview Prep.";

export function interviewPrepLock(app: { resume_html: string | null }): {
  locked: boolean;
  reason: string | null;
} {
  const hasResume = !!app.resume_html && app.resume_html.trim().length > 0;
  return hasResume
    ? { locked: false, reason: null }
    : { locked: true, reason: INTERVIEW_PREP_LOCK_REASON };
}
