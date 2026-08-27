import type {
  HardwareReport,
  LegacyFeasibilityAssessment,
  MacOSVersion,
} from "../domain/types";

const automaticGenerations = new Set([
  "coffee-lake",
  "comet-lake",
  "zen-1",
  "zen-2",
  "zen-3",
  "zen-4",
]);

export function evaluateLegacyFeasibility(
  hardware: HardwareReport,
  targetMacOS: MacOSVersion,
): LegacyFeasibilityAssessment {
  const normalizedFeatures = hardware.cpu.features.map((feature) => feature.toLowerCase());
  if (normalizedFeatures.length > 0 && !normalizedFeatures.includes("sse4.2")) {
    return {
      automaticPath: false,
      level: "instruction-set-risk",
      reasons: ["已报告的 CPU 指令集中没有 SSE4.2；不能按现代默认路径生成。"],
      choices: [
        {
          id: "manual-old-cpu-review",
          label: "导出信息并手动研究",
          description: `保留目标 macOS ${targetMacOS}，不自动生成可启动 EFI。`,
          risk: "experimental",
        },
      ],
    };
  }
  if (hardware.system.firmware === "legacy") {
    return {
      automaticPath: false,
      level: "legacy-experimental",
      reasons: ["检测到 Legacy BIOS；OpenDuet/LegacyBoot 必须与现代 UEFI 路径隔离。"],
      choices: [
        {
          id: "switch-to-uefi",
          label: "切换纯 UEFI",
          description: "如果固件支持，这是风险更低的路径。",
          risk: "recommended",
        },
        {
          id: "manual-openduet",
          label: "手动 OpenDuet 实验",
          description: "只导出研究清单，不自动写盘或替换现有引导。",
          risk: "experimental",
        },
      ],
    };
  }
  if (!automaticGenerations.has(hardware.cpu.generation)) {
    return {
      automaticPath: false,
      level: "manual-uefi",
      reasons: ["CPU 代际不在现代自动配置白名单；目标系统与显卡仍需单独核对。"],
      choices: [
        {
          id: "manual-uefi-candidate",
          label: "导出 UEFI 实验清单",
          description: "允许继续使用用户或审核社区配置，不开放自动 config.plist。",
          risk: "experimental",
        },
      ],
    };
  }
  return {
    automaticPath: true,
    level: "modern-uefi",
    reasons: ["满足当前现代 UEFI 路径的基础 CPU/固件条件；仍需模块和真机验证。"],
    choices: [],
  };
}
