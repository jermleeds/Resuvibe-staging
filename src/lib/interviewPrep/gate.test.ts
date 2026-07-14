import { describe, it, expect } from "vitest";
import { interviewPrepLock } from "./gate";

describe("interviewPrepLock", () => {
  it("locks the feature when the application has no generated resume", () => {
    const lock = interviewPrepLock({ resume_html: null });
    expect(lock.locked).toBe(true);
    expect(lock.reason).toMatch(/resume/i);
  });

  it("locks when resume_html is an empty string", () => {
    expect(interviewPrepLock({ resume_html: "" }).locked).toBe(true);
  });

  it("unlocks once a resume has been generated", () => {
    const lock = interviewPrepLock({ resume_html: "<p>resume</p>" });
    expect(lock.locked).toBe(false);
    expect(lock.reason).toBeNull();
  });
});
