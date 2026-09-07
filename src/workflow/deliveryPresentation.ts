export const deliveryPresentation = {
  initialGuideOpen: true,
  safetyBoundary: "每一步都在新目录中进行；遇到硬件警告仍可继续，涉及结构损坏或数据风险才会停止。",
} as const;

export function continuationPresentation(structuralFailure: boolean) {
  return structuralFailure
    ? { canContinue: false, role: "alert" as const, label: "结构或组件完整性失败" }
    : { canContinue: true, role: "status" as const, label: "实验模式仍可继续" };
}

export function failedVerificationPresentation(stageLabel: string): string {
  return `证据与当前 EFI 精确绑定，但记录结果为失败：${stageLabel}。保留当前 EFI，可修正问题后重新导入新的精确绑定记录。`;
}
