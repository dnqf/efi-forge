import type { CompatibilityFinding, CompatibilityStatus } from "../domain/types";

export type WorkflowStep = 1 | 2 | 3 | 4;

export const workflowStepCopy: ReadonlyArray<{
  id: WorkflowStep;
  title: string;
}> = [
  { id: 1, title: "取得硬件报告" },
  { id: 2, title: "看懂兼容风险" },
  { id: 3, title: "组装与校验 EFI" },
  { id: 4, title: "复制并启动测试" },
];

export interface CompatibilityDigest {
  supported: number;
  attention: number;
  highRisk: number;
  unknown: number;
  topActions: CompatibilityFinding[];
}

export interface WorkflowAvailability {
  hardwareInputReady: boolean;
  fixturePreview: boolean;
  manifestReady: boolean;
  efiReady: boolean;
}

export function canVisitWorkflowStep(
  step: WorkflowStep,
  availability: WorkflowAvailability,
): boolean {
  if (step === 1) return true;
  if (step === 2) return availability.hardwareInputReady || availability.fixturePreview;
  if (step === 3) return availability.hardwareInputReady && availability.manifestReady;
  return availability.efiReady;
}

const attentionPriority: Record<CompatibilityStatus, number> = {
  blocked: 0,
  partial: 1,
  unknown: 2,
  supported: 3,
};

export function summarizeCompatibility(findings: CompatibilityFinding[]): CompatibilityDigest {
  const supported = findings.filter((finding) => finding.status === "supported").length;
  const highRisk = findings.filter((finding) => finding.status === "blocked").length;
  const unknown = findings.filter((finding) => finding.status === "unknown").length;
  const attention = findings.length - supported;
  const topActions = findings
    .filter((finding) => finding.status !== "supported")
    .sort((left, right) => attentionPriority[left.status] - attentionPriority[right.status])
    .slice(0, 3);

  return { supported, attention, highRisk, unknown, topActions };
}
