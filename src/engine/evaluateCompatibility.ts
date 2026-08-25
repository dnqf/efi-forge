import type {
  CompatibilityFinding,
  CompatibilityReport,
  CompatibilityRule,
  CompatibilityStatus,
  DeviceCategory,
  HardwareReport,
  MacOSVersion,
  PciDevice,
  RuleSelector,
} from "../domain/types";

interface Subject {
  id: string;
  name: string;
  category: DeviceCategory;
  value?: string;
  device?: PciDevice;
}

const criticalCategories = new Set<DeviceCategory>(["firmware", "cpu", "gpu"]);

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(value: string, candidates: string[]): boolean {
  const normalized = normalize(value);
  return candidates.some((candidate) => normalized.includes(normalize(candidate)));
}

function matchesSelector(subject: Subject, selector: RuleSelector): boolean {
  if (selector.values && !selector.values.some((value) => normalize(value) === normalize(subject.value ?? ""))) {
    return false;
  }

  if (
    selector.vendorIds &&
    !selector.vendorIds.some(
      (vendorId) => normalize(vendorId) === normalize(subject.device?.vendorId ?? ""),
    )
  ) {
    return false;
  }

  if (
    selector.deviceIds &&
    !selector.deviceIds.some(
      (deviceId) => normalize(deviceId) === normalize(subject.device?.deviceId ?? ""),
    )
  ) {
    return false;
  }

  if (selector.nameIncludes && !includesAny(subject.name, selector.nameIncludes)) {
    return false;
  }

  return true;
}

function hardwareSubjects(report: HardwareReport): Subject[] {
  const pciSubjects = (
    category: "gpu" | "network" | "audio" | "storage",
    devices: PciDevice[],
  ): Subject[] =>
    devices.map((device) => ({
      id: device.id,
      name: device.name,
      category,
      device,
    }));

  return [
    {
      id: "firmware",
      name: report.system.firmware === "uefi" ? "64 位 UEFI" : "Legacy BIOS",
      category: "firmware",
      value: report.system.firmware,
    },
    {
      id: "cpu",
      name: report.cpu.name,
      category: "cpu",
      value: report.cpu.generation,
    },
    {
      id: "board",
      name: `${report.board.vendor} ${report.board.model}`,
      category: "board",
      value: report.board.model,
    },
    ...pciSubjects("gpu", report.gpus),
    ...pciSubjects("network", report.network),
    ...pciSubjects("audio", report.audio),
    ...pciSubjects("storage", report.storage),
  ];
}

function unknownFinding(subject: Subject): CompatibilityFinding {
  const isCritical = criticalCategories.has(subject.category);

  return {
    subjectId: subject.id,
    subject: subject.name,
    category: subject.category,
    status: isCritical ? "blocked" : "unknown",
    ruleId: isCritical ? "system.unknown-critical" : "system.no-matching-rule",
    message: isCritical
      ? "关键硬件没有命中已审核规则，将降低可信度并进入实验模式。"
      : "当前规则库尚未覆盖该设备。",
    action: isCritical
      ? "建议补充精确硬件信息；仍可继续生成实验方案。"
      : "保留设备信息并提交匿名规则样本。",
  };
}

function overallStatus(findings: CompatibilityFinding[]): CompatibilityStatus {
  if (findings.some((finding) => finding.status === "blocked")) return "blocked";
  if (findings.some((finding) => finding.status === "partial" || finding.status === "unknown")) {
    return "partial";
  }
  return "supported";
}

export function evaluateCompatibility(
  hardware: HardwareReport,
  targetMacOS: MacOSVersion,
  rules: CompatibilityRule[],
): CompatibilityReport {
  const subjects = hardwareSubjects(hardware);
  let matched = 0;

  const findings = subjects.map((subject): CompatibilityFinding => {
    const rule = rules.find(
      (candidate) =>
        candidate.category === subject.category &&
        candidate.macOS.includes(targetMacOS) &&
        matchesSelector(subject, candidate.selector),
    );

    if (!rule) return unknownFinding(subject);
    matched += 1;

    return {
      subjectId: subject.id,
      subject: subject.name,
      category: subject.category,
      status: rule.status,
      ruleId: rule.id,
      message: rule.message,
      action: rule.action,
      source: rule.source,
    };
  });

  const status = overallStatus(findings);
  const coverage = Math.round((matched / subjects.length) * 100);
  const confidence = status === "blocked" ? "D" : status === "supported" ? "B" : "C";

  return {
    targetMacOS,
    status,
    confidence,
    coverage,
    findings,
    canContinue: true,
    recommended: status !== "blocked",
  };
}
