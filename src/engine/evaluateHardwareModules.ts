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
  return /wireless|wi-?fi|wlan|802\.11/i.test(name);
}

function clueStatus(present: boolean, desktop: boolean): CompatibilityStatus {
  if (desktop) return "supported";
  return present ? "partial" : "unknown";
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
  const hardwareEvidence = hardware.evidence;
  const bluetoothDevices = hardwareEvidence?.bluetooth ?? [];
  const inputEvidence = hardwareEvidence?.inputControllers ?? [];
  const laptopEvidence = hardwareEvidence?.laptop;

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
      label: "无线网络",
      status: aggregate(wirelessFindings),
      summary: wirelessFindings.length > 0
        ? "已检测无线设备，但仍需按芯片与目标系统选择机场卡方案。"
        : "当前报告没有足够的无线/蓝牙身份，不阻止继续。",
      evidence: evidence(wirelessFindings),
      choices: [],
    },
    {
      id: "bluetooth",
      label: "蓝牙",
      status: bluetoothDevices.length > 0 ? "partial" : "unknown",
      summary: bluetoothDevices.length > 0
        ? "已取得独立蓝牙控制器线索；仍需按 USB 父控制器、芯片和系统版本核对。"
        : "当前报告没有独立蓝牙控制器身份，不阻止继续。",
      evidence: bluetoothDevices.map((device) => `${device.name} · ${device.vendorId || "无 PCI 父身份"}:${device.deviceId || "----"}`),
      choices: [],
    },
    {
      id: "audio",
      label: "音频",
      status: aggregate(byCategory("audio")),
      summary: laptopEvidence?.intelSstDetected
        ? "检测到 Intel SST 线索；内置麦克风可能不能按普通 AppleALC 路径工作，layout-id 仍需逐项校准。"
        : "驱动与 layout-id 分开处理，模拟、HDMI/DP 与麦克风分别保留安装后校准。",
      evidence: evidence(byCategory("audio")),
      choices: [],
    },
    {
      id: "storage",
      label: "存储",
      status: aggregate(byCategory("storage")),
      summary: hardwareEvidence?.storageMode === "raid-vmd"
        ? "检测到 VMD/RST/RAID 控制器线索；安装前需切换或验证 AHCI 路径，安装目标仍由用户选择。"
        : "危险控制器或型号降低可信度，但安装目标仍由用户选择。",
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
      evidence: hardwareEvidence?.usbControllers.length
        ? hardwareEvidence.usbControllers.map((device) => `${device.name} · ${device.vendorId}:${device.deviceId}`)
        : ["报告未包含 USB 控制器或逐端口 ACPI 拓扑"],
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
      (id): HardwareModuleAssessment => {
        const hasClue = id === "laptop-input"
          ? inputEvidence.length > 0 || Boolean(laptopEvidence?.i2cDetected || laptopEvidence?.ps2Detected)
          : id === "battery"
            ? Boolean(laptopEvidence?.batteryDetected)
            : id === "backlight"
              ? hasSupportedGpu
              : Boolean(
                laptopEvidence?.intelSstDetected
                || hardwareEvidence?.thunderboltControllers.length,
              );
        const clueEvidence = id === "laptop-input" && inputEvidence.length > 0
          ? inputEvidence.map((device) => device.name)
          : id === "battery" && laptopEvidence?.batteryDetected
            ? ["Windows 电池设备存在"]
            : id === "backlight" && hasSupportedGpu
              ? ["存在已识别的图形设备；未取得面板 ACPI"]
              : id === "sleep" && hasClue
                ? ["Intel SST 或 Thunderbolt/USB4 线索需纳入睡眠排查"]
                : ["缺少专属 ACPI/控制器证据"];
        return {
        id,
        label: {
          "laptop-input": "笔记本输入",
          battery: "电池",
          backlight: "背光",
          sleep: "睡眠",
        }[id],
        status: clueStatus(hasClue, desktop),
        summary: desktop
          ? "当前为台式机，该笔记本专属模块不参与自动配置。"
          : hasClue
            ? "Windows 扫描取得了设备线索，但仍不足以自动生成 ACPI/Kext；允许继续或导入专属方案。"
            : "当前扫描不足以安全生成该笔记本专属模块，允许导入用户方案。",
        evidence: desktop ? ["system.kind=desktop"] : clueEvidence,
        choices: [],
        };
      },
    ),
    {
      id: "thunderbolt",
      label: "Thunderbolt / USB4",
      status: hardwareEvidence?.thunderboltControllers.length ? "partial" : "unknown",
      summary: hardwareEvidence?.thunderboltControllers.length
        ? "已检测控制器线索；热插拔、睡眠和安全级别仍需实机验证。"
        : "未取得 Thunderbolt/USB4 控制器线索，不阻止继续。",
      evidence: hardwareEvidence?.thunderboltControllers.map((device) => device.name) ?? [],
      choices: [],
    },
    ...(["camera", "fingerprint", "card-reader"] as const).map(
      (id): HardwareModuleAssessment => {
        const detected = id === "camera"
          ? laptopEvidence?.cameraDetected
          : id === "fingerprint"
            ? laptopEvidence?.fingerprintDetected
            : laptopEvidence?.cardReaderDetected;
        const labels = { camera: "摄像头", fingerprint: "指纹", "card-reader": "读卡器" };
        return {
          id,
          label: labels[id],
          status: clueStatus(Boolean(detected), desktop),
          summary: desktop
            ? "当前为台式机，该笔记本附加模块不参与自动配置。"
            : detected
              ? id === "fingerprint"
                ? "检测到指纹设备线索；macOS 通常不支持 PC 指纹模块，不会自动配置。"
                : "检测到设备线索；具体 USB/PCI 身份与 macOS 行为仍需实机核对。"
              : "未取得设备线索，不阻止继续。",
          evidence: detected ? ["Windows PnP 设备线索"] : [],
          choices: [],
        };
      },
    ),
  ];
}
