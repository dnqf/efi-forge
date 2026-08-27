import type {
  CompatibilityFinding,
  CompatibilityStatus,
  HardwareModuleAssessment,
  HardwareReport,
} from "../domain/types";

function aggregate(findings: CompatibilityFinding[]): CompatibilityStatus {
  if (findings.some((finding) => finding.status === "blocked")) return "blocked";
  if (findings.some((finding) => finding.status === "partial" || finding.status === "unknown")) {
    return "partial";
  }
  return findings.length > 0 ? "supported" : "unknown";
}

function evidence(findings: CompatibilityFinding[]): string[] {
  return findings.map((finding) => `${finding.subject} · ${finding.ruleId}`);
}

function isWireless(name: string): boolean {
  return /wireless|wi-?fi|wlan|802\.11|bluetooth/i.test(name);
}

export function evaluateHardwareModules(
  hardware: HardwareReport,
  findings: CompatibilityFinding[],
): HardwareModuleAssessment[] {
  const byCategory = (category: CompatibilityFinding["category"]) =>
    findings.filter((finding) => finding.category === category);
  const networkFindings = byCategory("network");
  const wirelessIds = new Set(
    hardware.network.filter((device) => isWireless(device.name)).map((device) => device.id),
  );
  const wirelessFindings = networkFindings.filter((finding) => wirelessIds.has(finding.subjectId));
  const ethernetFindings = networkFindings.filter((finding) => !wirelessIds.has(finding.subjectId));
  const gpuFindings = byCategory("gpu");
  const hasSupportedGpu = gpuFindings.some((finding) => finding.status === "supported");
  const hasKnownBlockedGpu = gpuFindings.some(
    (finding) => finding.status === "blocked" && !finding.ruleId.startsWith("system."),
  );
  const desktop = hardware.system.kind === "desktop";

  return [
    {
      id: "platform",
      label: "CPU / 芯片组",
      status: aggregate([...byCategory("firmware"), ...byCategory("cpu"), ...byCategory("board")]),
      summary: "决定 OpenCore 基础模板、ACPI 与内核补丁范围。",
      evidence: evidence([...byCategory("firmware"), ...byCategory("cpu"), ...byCategory("board")]),
      choices: [],
    },
    {
      id: "graphics",
      label: "图形与混合显卡",
      status: aggregate(gpuFindings),
      summary: hasSupportedGpu && hasKnownBlockedGpu
        ? "同时存在可用与明确不兼容的显卡，需要用户选择处理方式。"
        : "按每块显卡的 PCI 身份分别判断，不把未知显卡自动禁用。",
      evidence: evidence(gpuFindings),
      choices: hasSupportedGpu && hasKnownBlockedGpu
        ? [
            {
              id: "disable-unsupported-gpu",
              label: "禁用明确不兼容的独显",
              description: "使用受支持显卡或核显输出，并加入对应禁用参数。",
              risk: "recommended",
            },
            {
              id: "preserve-all-gpus",
              label: "保留全部显卡",
              description: "不自动禁用设备，适合用户已有 SSDT/DeviceProperties 的情况。",
              risk: "experimental",
            },
          ]
        : [],
    },
    {
      id: "ethernet",
      label: "有线网络",
      status: aggregate(ethernetFindings),
      summary: "按 PCI ID 选择锁定驱动；未审核驱动只给出手动路径。",
      evidence: evidence(ethernetFindings),
      choices: [],
    },
    {
      id: "wireless",
      label: "无线与蓝牙",
      status: aggregate(wirelessFindings),
      summary: wirelessFindings.length > 0
        ? "已检测无线设备，但仍需按芯片与目标系统选择机场卡方案。"
        : "当前报告没有足够的无线/蓝牙身份，不阻止继续。",
      evidence: evidence(wirelessFindings),
      choices: [],
    },
    {
      id: "audio",
      label: "音频",
      status: aggregate(byCategory("audio")),
      summary: "驱动与 layout-id 分开处理，layout-id 保留安装后校准。",
      evidence: evidence(byCategory("audio")),
      choices: [],
    },
    {
      id: "storage",
      label: "存储",
      status: aggregate(byCategory("storage")),
      summary: "危险控制器或型号降低可信度，但安装目标仍由用户选择。",
      evidence: evidence(byCategory("storage")),
      choices: byCategory("storage").some((finding) => finding.status === "blocked")
        ? [
            {
              id: "alternate-install-target",
              label: "改用其他安装磁盘",
              description: "保留风险磁盘信息，但不把它作为建议安装目标。",
              risk: "recommended",
            },
            {
              id: "continue-risky-storage",
              label: "保留风险磁盘",
              description: "继续生成实验方案；工具不会自动写盘。",
              risk: "experimental",
            },
          ]
        : [],
    },
    {
      id: "usb",
      label: "USB 端口",
      status: "partial",
      summary: "静态扫描不能生成可靠端口映射，可在组装时导入专属 UTBMap。",
      evidence: ["报告未包含逐端口 ACPI 拓扑"],
      choices: [
        {
          id: "map-after-install",
          label: "安装后制作映射",
          description: "先保持 XhciPortLimit 关闭，再制作本机 USB Map。",
          risk: "recommended",
        },
        {
          id: "import-existing-usb-map",
          label: "导入现有 UTBMap",
          description: "仅接收通过安全检查的 codeless UTBMap.kext。",
          risk: "experimental",
        },
      ],
    },
    ...(["laptop-input", "battery", "backlight", "sleep"] as const).map(
      (id): HardwareModuleAssessment => ({
        id,
        label: {
          "laptop-input": "笔记本输入",
          battery: "电池",
          backlight: "背光",
          sleep: "睡眠",
        }[id],
        status: desktop ? "supported" : "unknown",
        summary: desktop
          ? "当前为台式机，该笔记本专属模块不参与自动配置。"
          : "当前扫描不足以安全生成该笔记本专属模块，允许导入用户方案。",
        evidence: [desktop ? "system.kind=desktop" : "缺少专属 ACPI/控制器证据"],
        choices: [],
      }),
    ),
  ];
}
