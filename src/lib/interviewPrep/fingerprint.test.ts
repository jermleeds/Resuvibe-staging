import { describe, it, expect } from "vitest";
import { sourceFingerprint } from "./fingerprint";

describe("sourceFingerprint", () => {
  it("is stable for identical inputs", () => {
    const a = sourceFingerprint("<p>resume</p>", "job description");
    const b = sourceFingerprint("<p>resume</p>", "job description");
    expect(a).toBe(b);
  });

  it("changes when the resume changes", () => {
    const a = sourceFingerprint("<p>resume v1</p>", "jd");
    const b = sourceFingerprint("<p>resume v2</p>", "jd");
    expect(a).not.toBe(b);
  });

  it("changes when the job description changes", () => {
    const a = sourceFingerprint("<p>resume</p>", "jd v1");
    const b = sourceFingerprint("<p>resume</p>", "jd v2");
    expect(a).not.toBe(b);
  });

  it("does not collide when content shifts across the resume/JD boundary", () => {
    // "ab" + "c" vs "a" + "bc" must not hash the same
    expect(sourceFingerprint("ab", "c")).not.toBe(sourceFingerprint("a", "bc"));
  });

  it("ignores leading/trailing whitespace differences", () => {
    expect(sourceFingerprint("  <p>r</p>  ", "  jd  ")).toBe(
      sourceFingerprint("<p>r</p>", "jd"),
    );
  });
});
