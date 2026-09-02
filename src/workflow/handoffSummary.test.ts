import { describe, expect, it } from "vitest";
import { compatibilityRules } from "../data/rules";
import { sampleHardware } from "../data/sampleHardware";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { createHandoffSummary, serializeHandoffSummary } from "./handoffSummary";

describe("EFI handoff summary", () => {
  it("exports a deterministic support summary without local paths or identity secrets", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, report)!;
    const summary = createHandoffSummary({
      appVersion: "0.1.12",
      hardware: sampleHardware,
      report,
      reportSource: "native",
      targetMacOS: "14",
      plan,
      efiSource: "generated",
      validation: {
        rootPath: "C:\\Users\\someone\\secret\\EFI",
        valid: true,
        errors: [],
        warnings: ["local warning containing C:\\private"],
        validationLevel: "ocvalidate-passed",
        configSha256: "a".repeat(64),
      },
    });
    const json = serializeHandoffSummary(summary);

    expect(serializeHandoffSummary(summary)).toBe(json);
    expect(json).not.toContain("someone");
    expect(json).not.toContain("C:\\\\private");
    expect(summary.efi.configSha256).toHaveLength(64);
    expect(summary.boundaries).toContain("规则识别度不是安装成功率。");
  });
});
