import type {
  HardwareReport,
  MacOSVersion,
  ThinkPadAssessment,
  ThinkPadModelProfile,
  ThinkPadSupportTier,
  ThinkPadVariantCheck,
} from "../domain/types";
import { thinkPadCatalog } from "./catalog";

const unsupportedLaptopGenerations = new Set([
  "tiger-lake",
  "alder-lake",
  "raptor-lake",
  "meteor-lake",
]);

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[-_]+/g, " ");
}
function aliasMatches(productName: string, alias: string): boolean {
  const escaped = normalized(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(productName);
}

function findProfile(report: HardwareReport): {
  profile?: ThinkPadModelProfile;
  match: ThinkPadAssessment["match"];
} {
  const machineType = normalized(report.system.machineType);
  if (machineType) {
    const match = thinkPadCatalog.find((profile) => profile.machineTypes.includes(machineType));
    if (match) return { profile: match, match: "machine-type" };
  }

  const productName = normalized(report.system.productName);
  const match = thinkPadCatalog.find((profile) =>
    profile.aliases.some((alias) => aliasMatches(productName, alias)),
  );
  return match ? { profile: match, match: "product-name" } : { match: "none" };
}

function hasWireless(report: HardwareReport): boolean {
  return report.network.some((device) =>
    /wireless|wi[ -]?fi|wlan|802\.11|airport|centrino/i.test(device.name),
  );
}

function statusFor(condition: boolean, fallback: "warning" | "unknown"): ThinkPadVariantCheck["status"] {
  return condition ? "passed" : fallback;
}

function determineTier(
  report: HardwareReport,
  targetMacOS: MacOSVersion,
  profile: ThinkPadModelProfile | undefined,
): ThinkPadSupportTier {
  if (report.cpu.vendor === "amd" || unsupportedLaptopGenerations.has(report.cpu.generation)) {
    return "unsupported-generation";
  }
  if (!profile) return "research-only";
  if (!profile.cpuGenerations.includes(report.cpu.generation)) return "research-only";
  if (!profile.targetMacOS.includes(targetMacOS)) return "research-only";
  return profile.tier;
}

export function assessThinkPad(
  report: HardwareReport,
  targetMacOS: MacOSVersion,
): ThinkPadAssessment | null {
  const { profile, match } = findProfile(report);
  const manufacturer = normalized(report.system.manufacturer || report.board.vendor);
  const productName = normalized(report.system.productName);
  const detected =
    productName.includes("THINKPAD") ||
    (manufacturer.includes("LENOVO") && (Boolean(profile) || report.system.kind === "laptop"));
  if (!detected) return null;

  const tier = determineTier(report, targetMacOS, profile);
  const hasIntelGpu = report.gpus.some((device) => device.vendorId === "8086");
  const discreteGpus = report.gpus.filter((device) => device.vendorId === "10DE" || device.vendorId === "1002");
  const riskyStorage = report.storage.filter((device) =>
    /PM981|PM991|MICRON 2200|2200S|SK\s+HYNIX\s+PC711|HYNIX\s+PC711|OPTANE|3D\s+XPOINT/i.test(device.name),
  );
  const generationMatches = profile?.cpuGenerations.includes(report.cpu.generation) ?? false;
  const checks: ThinkPadVariantCheck[] = [
    {
      id: "identity",
      label: "机型身份",
      status: profile ? (match === "machine-type" ? "passed" : "warning") : "unknown",
      detail: profile
        ? `${profile.label} · ${report.system.machineType ? `机型码 ${report.system.machineType}` : "未取得四位机型码"}`
        : "目录中没有精确型号；允许继续使用用户 EFI 或组件工作台。",
    },
    {
      id: "cpu",
      label: "CPU 代际",
      status: statusFor(generationMatches, "warning"),
      detail: generationMatches
        ? `${report.cpu.generation} 与候选系列相符。`
        : `${report.cpu.generation} 未与该系列候选建立一致性证据。`,
    },
    {
      id: "graphics",
      label: "核显 / 独显",
      status: hasIntelGpu && discreteGpus.length === 0 ? "passed" : "warning",
      detail: discreteGpus.length > 0
        ? `检测到 ${discreteGpus.map((device) => device.name).join("、")}；不能照搬无独显 EFI。`
        : hasIntelGpu
          ? "检测到 Intel 核显，仍需核对平台 ID、屏幕与接口。"
          : "没有取得受支持核显的明确 PCI 身份。",
    },
    {
      id: "wireless",
      label: "无线 / 蓝牙",
      status: hasWireless(report) ? "warning" : "unknown",
      detail: hasWireless(report)
        ? "已发现无线设备；必须按精确芯片和 macOS 版本选择驱动。"
        : "未识别无线设备，不能假定社区方案中的网卡与本机一致。",
    },
    {
      id: "storage",
      label: "NVMe / SATA",
      status: riskyStorage.length > 0 ? "warning" : report.storage.length > 0 ? "passed" : "unknown",
      detail: riskyStorage.length > 0
        ? `发现高风险存储：${riskyStorage.map((device) => device.name).join("、")}。建议更换安装目标。`
        : report.storage.length > 0
          ? "已取得存储型号；最终仍以安装器识别和实机测试为准。"
          : "未取得存储型号。",
    },
    {
      id: "firmware",
      label: "BIOS / UEFI",
      status: report.system.firmware === "uefi" && !report.system.secureBoot ? "passed" : "warning",
      detail: report.system.firmware !== "uefi"
        ? "当前不是 UEFI 启动模式。"
        : report.system.secureBoot
          ? "Secure Boot 已开启；实验安装前需要按指南核对。"
          : `UEFI + Secure Boot 关闭 · BIOS ${report.board.biosVersion || "版本未知"}`,
    },
  ];

  const warnings = [
    ...(profile?.notes ?? []),
    ...(match !== "machine-type" ? ["未命中四位机型码，不能把同系列名称当作精确匹配。"] : []),
    ...(generationMatches ? [] : ["CPU 代际与目录候选不一致，社区 EFI 只能作为组件参考。"]),
    ...(discreteGpus.length > 0 ? ["检测到独显；默认不得启用来自无独显机型的显卡注入。"] : []),
    ...(riskyStorage.length > 0 ? ["高风险 NVMe 不应作为推荐安装目标。"] : []),
  ];

  const summary = profile
    ? `已定位到 ${profile.label}，但仍按 CPU、显卡、无线、存储和 BIOS 分支校验。`
    : "已识别为 Lenovo ThinkPad，但当前目录没有精确型号；不会阻止继续。";
  const route = tier === "guided-candidate"
    ? "优先导入同机型候选 EFI，再通过完整整包合并或组件工作台逐项替换。"
    : tier === "legacy-patch-required"
      ? "先导入同代 EFI 作为参考；新系统还需要 OCLP/核显补丁与真机验证。"
      : tier === "unsupported-generation"
        ? "当前代际不进入自动推荐；仅允许用户 EFI 研究路径，并保留全部风险警告。"
        : "进入研究路径：用户可导入整包或组件，但工具不会把它标为精确推荐。";

  return {
    detected,
    match: profile ? match : "family-only",
    profile,
    tier,
    title: profile?.label ?? "未收录的 ThinkPad",
    summary,
    route,
    checks,
    warnings,
  };
}
