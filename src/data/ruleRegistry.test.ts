import { describe, expect, it } from "vitest";
import type { CompatibilityRule } from "../domain/types";
import { compatibilityRules } from "./rules";
import { validateCompatibilityRegistry } from "./ruleRegistry";

describe("compatibility rule registry", () => {
  it("keeps every production rule traceable and structurally valid", () => {
    expect(validateCompatibilityRegistry(compatibilityRules)).toEqual([]);
  });

  it("rejects missing evidence and test traceability", () => {
    const invalidRule: CompatibilityRule = {
      ...compatibilityRules[0],
      id: "invalid rule id",
      source: "notes-only",
      registry: {
        ...compatibilityRules[0].registry,
        evidence: [],
        testSampleIds: [],
      },
    };

    expect(validateCompatibilityRegistry([invalidRule]).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "规则 ID 必须是稳定的小写点号/连字符格式。",
        "来源必须是 HTTPS 地址。",
        "没有声明输入证据。",
        "没有绑定测试样本。",
      ]),
    );
  });
});
