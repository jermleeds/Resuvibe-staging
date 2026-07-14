import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InterviewPrepTab } from "./InterviewPrepTab";
import * as api from "@/lib/api/interviewPrep";

vi.mock("@/lib/api/interviewPrep", () => ({
  getInterviewEntitlement: vi.fn(),
  startInterviewSession: vi.fn(),
  generateInterviewPlan: vi.fn(),
  scoreInterviewAnswer: vi.fn(),
}));

const planWithOneQuestion = {
  roleType: "Product Manager",
  competencies: ["Ownership"],
  questions: [
    {
      id: "q1",
      competency: "Ownership",
      modality: "behavioral" as const,
      leadershipPrinciple: null,
      question: "Tell me about a time you owned a hard decision.",
      orderIndex: 0,
    },
  ],
  stale: false,
};

const freeUnclaimed = { subscriptionTier: "free" as const, trialUsedAt: null, trialApplicationId: null };
const trialSpentElsewhere = {
  subscriptionTier: "free" as const,
  trialUsedAt: "2026-07-10T00:00:00Z",
  trialApplicationId: "other-app",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InterviewPrepTab", () => {
  it("renders the paywall (and never generates a plan or claims a trial) when out of entitlement", async () => {
    vi.mocked(api.getInterviewEntitlement).mockResolvedValue(trialSpentElsewhere);

    render(<InterviewPrepTab applicationId="app-1" app={{}} />);

    expect(await screen.findByText(/premium feature/i)).toBeInTheDocument();
    expect(api.generateInterviewPlan).not.toHaveBeenCalled();
    expect(api.startInterviewSession).not.toHaveBeenCalled();
  });

  it("shows the plan when entitled — WITHOUT claiming the trial on mount", async () => {
    vi.mocked(api.getInterviewEntitlement).mockResolvedValue(freeUnclaimed);
    vi.mocked(api.generateInterviewPlan).mockResolvedValue(planWithOneQuestion);

    render(<InterviewPrepTab applicationId="app-1" app={{}} />);

    expect(await screen.findByText(/your interview plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /begin interview/i })).toBeInTheDocument();
    // The trial must NOT be consumed just by opening the tab (QA MAJOR-2).
    expect(api.startInterviewSession).not.toHaveBeenCalled();
  });

  it("claims the trial / creates the session only when Begin is clicked, then surfaces both retry CTAs", async () => {
    vi.mocked(api.getInterviewEntitlement).mockResolvedValue(freeUnclaimed);
    vi.mocked(api.generateInterviewPlan).mockResolvedValue(planWithOneQuestion);
    vi.mocked(api.startInterviewSession).mockResolvedValue({ allowed: true, sessionId: "s1" });
    vi.mocked(api.scoreInterviewAnswer).mockResolvedValue({
      turn: { id: "t1", questionId: "q1", orderIndex: 0, attemptNumber: 1, answerText: "a", score: 70 },
      feedback: { modality: "behavioral", overallScore: 70, dimensions: [], suggestions: ["Add metrics."] },
      isComplete: false,
    });

    render(<InterviewPrepTab applicationId="app-1" app={{}} />);

    fireEvent.click(await screen.findByRole("button", { name: /begin interview/i }));
    expect(api.startInterviewSession).toHaveBeenCalledWith("app-1");

    fireEvent.change(await screen.findByPlaceholderText(/type your answer/i), {
      target: { value: "I led a migration under a tight deadline." },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit answer/i }));

    expect(await screen.findByRole("button", { name: /try responding again/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next question/i })).toBeInTheDocument();
  });

  it("paywalls if the trial was lost to a race at Begin", async () => {
    vi.mocked(api.getInterviewEntitlement).mockResolvedValue(freeUnclaimed);
    vi.mocked(api.generateInterviewPlan).mockResolvedValue(planWithOneQuestion);
    vi.mocked(api.startInterviewSession).mockResolvedValue({ allowed: false, code: "upgrade_required" });

    render(<InterviewPrepTab applicationId="app-1" app={{}} />);
    fireEvent.click(await screen.findByRole("button", { name: /begin interview/i }));

    expect(await screen.findByText(/premium feature/i)).toBeInTheDocument();
  });
});
