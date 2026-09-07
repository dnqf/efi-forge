import { describe, expect, it } from "vitest";
import type { CompatibilityRule } from "../domain/types";
import { compatibilityRuleCases } from "./ruleCases";
import { compatibilityRules } from "./rules";
import { validateCompatibilityRuleCases } from "./validateRuleCases";

describe("executable compatibility rule cases", () => {
  it("parses every audited case and enforces expected and forbidden matches", () => {
    expect(validateCompatibilityRuleCases(compatibilityRules, compatibilityRuleCases)).toEqual([]);
  });

  it("rejects a misspelled rule case reference", () => {
    const ruleId = "network.realtek.rtl8125";
    const rules = compatibilityRules.map((rule): CompatibilityRule =>
      rule.id === ruleId
        ? { ...rule, registry: { ...rule.registry, testSampleIds: ["case.auto.network-rtl8125.typo"] } }
        : rule,
    );
    expect(validateCompatibilityRuleCases(rules, compatibilityRuleCases)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId, message: "规则引用的可执行案例不存在。" }),
      ]),
    );
  });

  it("rejects a deleted case", () => {
    const cases = compatibilityRuleCases.filter(({ id }) => id !== "case.auto.network-rtl8125.direct");
    expect(validateCompatibilityRuleCases(compatibilityRules, cases)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "network.realtek.rtl8125", message: "规则引用的可执行案例不存在。" }),
      ]),
    );
  });

  it("rejects wrong expected and forbidden assertions", () => {
    const base = compatibilityRuleCases.find(({ id }) => id === "case.auto.network-rtl8125.direct")!;
    const cases = compatibilityRuleCases.map((ruleCase) =>
      ruleCase.id === base.id
        ? {
            ...ruleCase,
            expectedRuleIds: ["network.realtek.rtl8111"],
            forbiddenRuleIds: ["network.realtek.rtl8125"],
          }
        : ruleCase,
    );
    const messages = validateCompatibilityRuleCases(compatibilityRules, cases).map(({ message }) => message);
    expect(messages).toEqual(expect.arrayContaining([
      "预期规则没有实际命中。",
      "禁止规则发生了命中。",
    ]));
  });

  it("rejects contradictory expectations and an invalid runtime source", () => {
    const base = compatibilityRuleCases[0];
    const contradictory = {
      ...base,
      source: "unverified-upload",
      forbiddenRuleIds: [base.expectedRuleIds[0]],
    } as unknown as typeof base;
    const messages = validateCompatibilityRuleCases(compatibilityRules, [contradictory])
      .map(({ message }) => message);
    expect(messages).toEqual(expect.arrayContaining([
      "案例来源必须使用允许的来源分类。",
      "同一规则不能同时列为预期和禁止命中。",
    ]));
  });
});
