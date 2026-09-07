import type { CompatibilityRule } from "../domain/types";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { parseHardwareReport } from "../report/hardwareReport";
import type { CompatibilityRuleCase } from "./ruleCases";

export interface RuleCaseIssue {
  caseId?: string;
  ruleId?: string;
  message: string;
}

export function validateCompatibilityRuleCases(
  rules: CompatibilityRule[],
  cases: CompatibilityRuleCase[],
): RuleCaseIssue[] {
  const issues: RuleCaseIssue[] = [];
  const ruleIds = new Set(rules.map((rule) => rule.id));
  const caseById = new Map<string, CompatibilityRuleCase>();

  for (const ruleCase of cases) {
    if (caseById.has(ruleCase.id)) {
      issues.push({ caseId: ruleCase.id, message: "案例 ID 重复。" });
    }
    caseById.set(ruleCase.id, ruleCase);
    if (!/^case\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(ruleCase.id)) {
      issues.push({ caseId: ruleCase.id, message: "案例 ID 必须使用稳定的 case. 小写点号/连字符格式。" });
    }
    if (!["synthetic", "user-redacted", "real-machine-feedback"].includes(ruleCase.source)) {
      issues.push({ caseId: ruleCase.id, message: "案例来源必须使用允许的来源分类。" });
    }

    const forbiddenRuleIds = new Set(ruleCase.forbiddenRuleIds ?? []);
    for (const ruleId of ruleCase.expectedRuleIds) {
      if (forbiddenRuleIds.has(ruleId)) {
        issues.push({ caseId: ruleCase.id, ruleId, message: "同一规则不能同时列为预期和禁止命中。" });
      }
    }

    for (const ruleId of [...ruleCase.expectedRuleIds, ...(ruleCase.forbiddenRuleIds ?? [])]) {
      if (!ruleIds.has(ruleId)) {
        issues.push({ caseId: ruleCase.id, ruleId, message: "案例引用的规则不存在。" });
      }
    }

    try {
      const report = evaluateCompatibility(
        parseHardwareReport(ruleCase.input),
        ruleCase.targetMacOS,
        rules,
      );
      const matched = new Set(report.findings.map((finding) => finding.ruleId));
      for (const ruleId of ruleCase.expectedRuleIds) {
        if (ruleIds.has(ruleId) && !matched.has(ruleId)) {
          issues.push({ caseId: ruleCase.id, ruleId, message: "预期规则没有实际命中。" });
        }
      }
      for (const ruleId of ruleCase.forbiddenRuleIds ?? []) {
        if (ruleIds.has(ruleId) && matched.has(ruleId)) {
          issues.push({ caseId: ruleCase.id, ruleId, message: "禁止规则发生了命中。" });
        }
      }
    } catch (error) {
      issues.push({
        caseId: ruleCase.id,
        message: `案例硬件输入无法解析：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  for (const rule of rules) {
    if (!rule.registry.testSampleIds.some((caseId) => caseId.startsWith("case."))) continue;
    for (const caseId of rule.registry.testSampleIds) {
      const ruleCase = caseById.get(caseId);
      if (!ruleCase) {
        issues.push({ ruleId: rule.id, caseId, message: "规则引用的可执行案例不存在。" });
      } else if (!ruleCase.expectedRuleIds.includes(rule.id)) {
        issues.push({ ruleId: rule.id, caseId, message: "规则引用的案例没有把该规则列为预期命中。" });
      }
    }
    if (!rule.registry.testSampleIds.some((caseId) => caseById.has(caseId))) {
      issues.push({ ruleId: rule.id, message: "已迁移规则没有绑定可执行案例。" });
    }
  }

  return issues;
}
