import type {
  CompatibilityRule,
  DeviceCategory,
  RuleEvidence,
  RuleRegistryMetadata,
  RuleSelector,
} from "../domain/types";

export type CompatibilityRuleDefinition = Omit<CompatibilityRule, "registry">;

export interface RuleRegistryIssue {
  ruleId: string;
  message: string;
}

function selectorEvidence(category: DeviceCategory, selector: RuleSelector): RuleEvidence[] {
  const evidence: RuleEvidence[] = [];
  if (selector.values) {
    evidence.push(category === "cpu" ? "cpu-generation" : "firmware-mode");
  }
  if (selector.vendorIds) evidence.push("pci-vendor-id");
  if (selector.deviceIds) evidence.push("pci-device-id");
  if (selector.subsystemIds) evidence.push("pci-subsystem-id");
  if (selector.classCodes) evidence.push("pci-class-code");
  if (selector.revisionIds) evidence.push("pci-revision-id");
  if (selector.nameIncludes) evidence.push("device-name");
  return evidence;
}

export function registerCompatibilityRules(
  definitions: CompatibilityRuleDefinition[],
  metadata: Record<string, RuleRegistryMetadata>,
): CompatibilityRule[] {
  return definitions.map((definition) => {
    const registry = metadata[definition.id];
    if (!registry) {
      throw new Error(`规则 ${definition.id} 缺少注册表元数据。`);
    }
    return { ...definition, registry };
  });
}

export function validateCompatibilityRegistry(rules: CompatibilityRule[]): RuleRegistryIssue[] {
  const issues: RuleRegistryIssue[] = [];
  const seenIds = new Set<string>();

  for (const rule of rules) {
    if (seenIds.has(rule.id)) {
      issues.push({ ruleId: rule.id, message: "规则 ID 重复。" });
    }
    seenIds.add(rule.id);

    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(rule.id)) {
      issues.push({ ruleId: rule.id, message: "规则 ID 必须是稳定的小写点号/连字符格式。" });
    }
    if (rule.macOS.length === 0) {
      issues.push({ ruleId: rule.id, message: "没有声明适用的 macOS 版本。" });
    }
    if (!/^https:\/\//.test(rule.source)) {
      issues.push({ ruleId: rule.id, message: "来源必须是 HTTPS 地址。" });
    }
    if (!Number.isInteger(rule.registry.priority) || rule.registry.priority < 0) {
      issues.push({ ruleId: rule.id, message: "优先级必须是非负整数。" });
    }
    if (rule.registry.evidence.length === 0) {
      issues.push({ ruleId: rule.id, message: "没有声明输入证据。" });
    }
    if (rule.registry.testSampleIds.length === 0) {
      issues.push({ ruleId: rule.id, message: "没有绑定测试样本。" });
    }

    const expectedEvidence = selectorEvidence(rule.category, rule.selector);
    for (const evidence of expectedEvidence) {
      if (!rule.registry.evidence.includes(evidence)) {
        issues.push({ ruleId: rule.id, message: `选择器使用了 ${evidence}，但注册表未声明该证据。` });
      }
    }

    for (const operation of rule.registry.operations) {
      if (operation.value.trim().length === 0) {
        issues.push({ ruleId: rule.id, message: `操作 ${operation.type} 的值不能为空。` });
      }
    }
  }

  return issues;
}
