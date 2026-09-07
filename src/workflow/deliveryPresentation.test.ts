import { describe, expect, it } from "vitest";
import { artifactAfterMergePreferenceChange } from "./workflowDecisions";
import { continuationPresentation, deliveryPresentation, failedVerificationPresentation } from "./deliveryPresentation";

describe("delivery presentation decisions", () => {
  it("opens first-run guidance by default", () => {
    expect(deliveryPresentation.initialGuideOpen).toBe(true);
  });
  it("allows hardware uncertainty but blocks structural failure", () => {
    expect(continuationPresentation(false)).toEqual({ canContinue: true, role: "status", label: "实验模式仍可继续" });
    expect(continuationPresentation(true)).toEqual({ canContinue: false, role: "alert", label: "结构或组件完整性失败" });
  });
  it("keeps a failed exact verification recoverable", () => {
    expect(failedVerificationPresentation("启动选择器")).toContain("保留当前 EFI");
    expect(failedVerificationPresentation("启动选择器")).toContain("重新导入");
  });
  it("invalidates a merged choice while preserving a valid custom fallback", () => {
    expect(artifactAfterMergePreferenceChange("merged", true)).toBe("custom");
    expect(artifactAfterMergePreferenceChange("merged", false)).toBeNull();
  });
});
