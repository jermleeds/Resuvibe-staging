import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tabs, TabsList } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { InterviewPrepTabTrigger } from "./InterviewPrepTabTrigger";
import { INTERVIEW_PREP_LOCK_REASON } from "@/lib/interviewPrep/gate";

function renderTrigger(resume_html: string | null) {
  return render(
    <TooltipProvider>
      <Tabs value="resume">
        <TabsList>
          <InterviewPrepTabTrigger app={{ resume_html }} />
        </TabsList>
      </Tabs>
    </TooltipProvider>,
  );
}

describe("InterviewPrepTabTrigger", () => {
  it("always renders the Interview Prep label (visible link)", () => {
    renderTrigger(null);
    expect(screen.getByText("Interview Prep")).toBeInTheDocument();
  });

  it("is disabled and explains the prerequisite when no resume exists", () => {
    renderTrigger(null);
    const btn = screen.getByText("Interview Prep").closest("button");
    expect(btn).toBeDisabled();
    // Accessible, testable prerequisite message (fallback for the visual tooltip).
    expect(screen.getByLabelText(INTERVIEW_PREP_LOCK_REASON)).toBeInTheDocument();
  });

  it("is enabled once a resume has been generated", () => {
    renderTrigger("<p>resume</p>");
    const btn = screen.getByText("Interview Prep").closest("button");
    expect(btn).not.toBeDisabled();
  });
});
