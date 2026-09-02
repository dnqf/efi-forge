import type { BuildPlan, CompatibilityReport, HardwareReport } from "../domain/types";

export type BuildReadinessMode = "auto-candidate" | "manual-components";
export type BuildRouteId = "project-candidate" | "user-efi" | "component-merge";
export type BuildRouteStatus = "ready" | "available" | "manual" | "blocked";

export interface BuildRoute {
  id: BuildRouteId;
  title: string;
  status: BuildRouteStatus;
  summary: string;
  nextAction: string;
}

export interface HardwareEvidenceGap {
  id: string;
  label: string;
  detail: string;
  nextAction: string;
  priority: "important" | "useful";
}

export interface BuildReadiness {
  mode: BuildReadinessMode;
  canContinue: boolean;
  headline: string;
  notice: string;
  blockingReason?: string;
  routes: BuildRoute[];
  evidenceGaps: HardwareEvidenceGap[];
  riskSummary: {
    highRisk: number;
    unknown: number;
  };
}

const genericIdentityValues = new Set([
  "",
  "DEFAULT STRING",
  "NOT APPLICABLE",
  "NOT SPECIFIED",
  "SYSTEM PRODUCT NAME",
  "TO BE FILLED BY O.E.M.",
  "UNKNOWN",
]);

function identityMissing(value: string | undefined): boolean {
  return genericIdentityValues.has((value ?? "").trim().toUpperCase());
}

function collectEvidenceGaps(hardware: HardwareReport): HardwareEvidenceGap[] {
  const gaps: HardwareEvidenceGap[] = [];

  if (identityMissing(hardware.system.manufacturer) || identityMissing(hardware.system.productName)) {
    gaps.push({
      id: "system-model",
      label: "整机厂商或完整型号不足",
      detail: "社区机型候选与 OEM 变体判断会变弱，但不会阻止继续。",
      nextAction: "从机身铭牌、系统信息或厂商支持页补充完整型号。",
      priority: "important",
    });
  }

  if (identityMissing(hardware.board.vendor) || identityMissing(hardware.board.model)) {
    gaps.push({
      id: "board-model",
      label: "主板型号不足",
      detail: "芯片组和零售主板自动模板可能无法可靠选择。",
      nextAction: "核对主板丝印、Windows 系统信息或厂商 BIOS 页面。",
      priority: "important",
    });
  }

  if (identityMissing(hardware.board.biosVersion)) {
    gaps.push({
      id: "bios-version",
      label: "BIOS 版本缺失",
      detail: "同型号不同 BIOS 的 ACPI 与固件行为可能不同。",
      nextAction: "在 BIOS 首页或 Windows 系统信息中记录版本号。",
      priority: "important",
    });
  }

  if (!hardware.board.biosDate) {
    gaps.push({
      id: "bios-date",
      label: "BIOS 日期缺失",
      detail: "旧平台与部分 AMD 固件分支只能保守判断。",
      nextAction: "补充 YYYY-MM-DD 格式的 BIOS 日期；暂不补也可以继续。",
      priority: "useful",
    });
  }

  const isThinkPad = `${hardware.system.manufacturer ?? ""} ${hardware.system.productName ?? ""}`
    .toUpperCase()
    .includes("THINKPAD");
  if (hardware.system.kind === "laptop" && isThinkPad && !hardware.system.machineType) {
    gaps.push({
      id: "thinkpad-machine-type",
      label: "ThinkPad 四位机型码缺失",
      detail: "相邻型号常有屏幕、触控板、无线网卡或 ACPI 变体。",
      nextAction: "从底壳标签或 BIOS 补充 Type，例如 20L5；不补也保留手动路径。",
      priority: "important",
    });
  }

  const deviceGroups = [
    ["gpu", "显卡", hardware.gpus],
    ["network", "网络设备", hardware.network],
    ["audio", "音频设备", hardware.audio],
    ["storage", "存储设备", hardware.storage],
  ] as const;

  for (const [id, label, devices] of deviceGroups) {
    if (devices.length === 0) {
      gaps.push({
        id: `${id}-empty`,
        label: `未取得${label}`,
        detail: `工具无法对${label}建立设备级规则证据。`,
        nextAction: "可继续进入组装，并在目标机补扫或手动核对 PCI 信息。",
        priority: id === "gpu" ? "important" : "useful",
      });
    }
  }

  const devices = deviceGroups.flatMap(([, , group]) => [...group]);
  const weakIdentityCount = devices.filter(
    (device) => !device.vendorId || !device.deviceId || device.identitySource === "name-only",
  ).length;
  if (weakIdentityCount > 0) {
    gaps.push({
      id: "pci-identity",
      label: `${weakIdentityCount} 个设备缺少直接 PCI 身份`,
      detail: "仅凭名称可能误判同名设备或 USB 子设备。",
      nextAction: "优先补充 Vendor ID、Device ID 与直接/父 PCI 来源。",
      priority: "important",
    });
  }

  const missingSubsystemCount = devices.filter((device) => !device.subsystemId).length;
  if (missingSubsystemCount > 0) {
    gaps.push({
      id: "pci-subsystem",
      label: `${missingSubsystemCount} 个设备缺少 Subsystem ID`,
      detail: "同芯片不同板卡/OEM 变体的区分能力会降低。",
      nextAction: "必要时补充八位 Subsystem ID；常见设备可先按现有线索继续。",
      priority: "useful",
    });
  }

  return gaps.sort((left, right) => {
    const priority = { important: 0, useful: 1 } as const;
    return priority[left.priority] - priority[right.priority];
  });
}

export function assessBuildReadiness(
  hardware: HardwareReport,
  report: CompatibilityReport,
  plan: BuildPlan | null,
  options: { softwareIntegrityFailure?: boolean } = {},
): BuildReadiness {
  const automaticCandidate = Boolean(plan?.autoConfigSupported);
  const blockedByIntegrity = Boolean(options.softwareIntegrityFailure);
  const highRisk = report.findings.filter((finding) => finding.status === "blocked").length;
  const unknown = report.findings.filter((finding) => finding.status === "unknown").length;
  const routes: BuildRoute[] = [
    {
      id: "project-candidate",
      title: automaticCandidate ? "项目候选 EFI" : "官方组件暂存包",
      status: automaticCandidate ? "ready" : "manual",
      summary: automaticCandidate
        ? "使用审核范围内的平台模板与哈希锁定组件生成候选结构。"
        : "导出固定版本、已校验的 OpenCore 与组件；config.plist 需要人工完善。",
      nextAction: automaticCandidate
        ? "进入组装后生成新目录，并运行结构检查与同版本 ocvalidate。"
        : "进入组装取得组件和清单，再按硬件证据手动配置或选择用户 EFI。",
    },
    {
      id: "user-efi",
      title: "使用你已有的完整 EFI",
      status: "available",
      summary: "只读检查完整 EFI，不因型号未收录而拒绝导入。",
      nextAction: "在组装页选择完整 EFI；结构损坏会停止，硬件警告只会保留。",
    },
    {
      id: "component-merge",
      title: "按组件补充或替换",
      status: "available",
      summary: "逐项选择 Kext、AML 和 UEFI Driver，冲突项不会静默覆盖。",
      nextAction: "先扫描用户组件，再明确选择保留、替换、停用或实验启用。",
    },
  ];

  if (blockedByIntegrity) {
    for (const route of routes) route.status = "blocked";
  }

  return {
    mode: automaticCandidate ? "auto-candidate" : "manual-components",
    canContinue: report.canContinue && plan !== null && !blockedByIntegrity,
    headline: blockedByIntegrity
      ? "组件结构或完整性检查失败，已停止生成"
      : automaticCandidate
        ? "可生成项目候选，同时保留用户 EFI 路径"
        : "没有自动配置模板，仍可进入手动组装",
    notice: `规则识别度 ${report.coverage}% 只表示已有规则命中了多少检查对象，不等于安装成功率或实机验证结论。`,
    blockingReason: blockedByIntegrity
      ? "EFI 构建结构或完整性检查失败（包括锁定组件校验）。修复软件清单后才能继续。"
      : undefined,
    routes,
    evidenceGaps: collectEvidenceGaps(hardware),
    riskSummary: { highRisk, unknown },
  };
}
