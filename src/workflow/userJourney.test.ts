import { describe, expect, it } from "vitest";
import type { CompatibilityFinding } from "../domain/types";
import { canVisitWorkflowStep, summarizeCompatibility, workflowStepCopy } from "./userJourney";

function finding(status: CompatibilityFinding["status"], subjectId: string): CompatibilityFinding {
  return {
    action: `${subjectId} action`,
    category: "gpu",
    message: `${subjectId} message`,
    operations: [],
    ruleId: `${subjectId}.rule`,
    status,
    subject: subjectId,
    subjectId,
  };
}

describe("user journey", () => {
  it("keeps the four user-facing stages in a stable order", () => {
    expect(workflowStepCopy.map((step) => step.id)).toEqual([1, 2, 3, 4]);
  });

  it("puts high-risk and calibration actions before unknown coverage", () => {
    const digest = summarizeCompatibility([
      finding("unknown", "unknown"),
      finding("supported", "supported"),
      finding("partial", "partial"),
      finding("blocked", "blocked"),
    ]);

    expect(digest).toMatchObject({ supported: 1, attention: 3, highRisk: 1, unknown: 1 });
    expect(digest.topActions.map((item) => item.subjectId)).toEqual(["blocked", "partial", "unknown"]);
  });

  it("allows preview reports to explain compatibility but never enter assembly", () => {
    const preview = {
      efiReady: false,
      fixturePreview: true,
      hardwareInputReady: false,
      manifestReady: true,
    };

    expect(canVisitWorkflowStep(1, preview)).toBe(true);
    expect(canVisitWorkflowStep(2, preview)).toBe(true);
    expect(canVisitWorkflowStep(3, preview)).toBe(false);
    expect(canVisitWorkflowStep(4, preview)).toBe(false);
  });

  it("opens later stages only when their concrete artifact is ready", () => {
    const ready = {
      efiReady: true,
      fixturePreview: false,
      hardwareInputReady: true,
      manifestReady: true,
    };

    expect(workflowStepCopy.map((step) => canVisitWorkflowStep(step.id, ready))).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });
});
