import type {
  BuildPlan,
  BuildPreferences,
  CompatibilityReport,
  HardwareReport,
} from "../domain/types";

const coffeeAutoChipsets = ["B360", "B365", "H310", "H370", "Z390"];
const cometAutoChipsets = ["B460", "Z490"];
const amdAutoChipsets = ["A520", "B450", "B550", "X470", "X570"];
const amdCpuDefinitionChipsets = ["A520", "B550"];
const amdDefaultDisabledVirtualMapChipsets = ["A520", "B550", "X570"];

function detectChipset(boardModel: string): string {
  const normalized = boardModel.toUpperCase();
  return [...coffeeAutoChipsets, ...cometAutoChipsets, ...amdAutoChipsets, "Z370", "H470", "H410"]
    .find((chipset) => normalized.includes(chipset)) ?? "unknown";
}

export function createBuildPlan(
  hardware: HardwareReport,
  report: CompatibilityReport,
  preferences: BuildPreferences = {},
): BuildPlan | null {
  if (!report.canContinue) return null;

  const components = new Set(["Lilu.kext", "VirtualSMC.kext"]);
  const notes = ["从匹配版本的 OpenCore Sample.plist 开始生成配置。"];
  const bootArgs = ["-v", "debug=0x100", "keepsyms=1"];
  const riskyFindings = report.findings.filter((finding) => finding.status === "blocked");

  for (const operation of report.findings.flatMap((finding) => finding.operations)) {
    if (operation.type === "add-component") components.add(operation.value);
    if (operation.type === "add-boot-arg" && !bootArgs.includes(operation.value)) {
      bootArgs.push(operation.value);
    }
    if (operation.type === "add-note") notes.push(operation.value);
  }

  if (preferences.customUsbMapIncluded) {
    components.add("USBToolBox.kext");
    notes.push("将导入用户选择的 codeless UTBMap.kext，并在新暂存目录中与锁定版 USBToolBox 配对。 ");
  }

  if (riskyFindings.length > 0) {
    notes.unshift(`实验模式：存在 ${riskyFindings.length} 个高风险硬件结论，工具不会替用户作出最终选择。`);
    notes.push(...riskyFindings.map((finding) => `${finding.subject}：${finding.message}`));
  }

  const supportedGpuIds = new Set(
    report.findings
      .filter((finding) => finding.category === "gpu" && finding.status === "supported")
      .map((finding) => finding.subjectId),
  );
  const blockedGpuIds = new Set(
    report.findings
      .filter(
        (finding) =>
          finding.category === "gpu" &&
          finding.status === "blocked" &&
          !finding.ruleId.startsWith("system."),
      )
      .map((finding) => finding.subjectId),
  );
  const hasI225 = hardware.network.some((device) => device.name.toUpperCase().includes("I225"));
  if (hasI225) {
    notes.push("I225 在 macOS 13+ 需要按主板验证 DEXT/VT-d 或旧 Kext 回退；不能仅凭扫描保证 Recovery 网络可用。 ");
    if (hardware.board.vendor.toLowerCase().includes("gigabyte")) bootArgs.push("e1000=0");
  }
  if (hardware.network.some((device) => device.name.toUpperCase().includes("I226"))) {
    notes.push("I226 通常需要 AppleIGC；当前不自动加入未经过本工具实机验证的网络驱动。 ");
  }

  if (
    hardware.network.some(
      (device) =>
        device.vendorId.toUpperCase() === "8086" && device.deviceId.toUpperCase() === "1539",
    )
  ) {
    notes.push("Intel I211 保留为实验网络方案；当前不自动加入没有可锁定正式 Release 的 AppleIGB。 ");
  }

  const hasNvme = hardware.storage.some((device) => device.name.toUpperCase().includes("NVME"));
  if (hasNvme) {
    components.add("NVMeFix.kext");
    notes.push("检测到 NVMe，加入 NVMeFix 改善第三方控制器电源管理；它不能修复所有不兼容 SSD。 ");
  }

  const isAmdZen = hardware.cpu.vendor === "amd" && hardware.cpu.generation.startsWith("zen-");
  const isCoffee = hardware.cpu.vendor === "intel" && hardware.cpu.generation === "coffee-lake";
  const isComet = hardware.cpu.vendor === "intel" && hardware.cpu.generation === "comet-lake";
  const chipset = detectChipset(hardware.board.model);
  const platform: BuildPlan["platform"] = isAmdZen
    ? "amd-zen"
    : isCoffee
      ? "intel-coffee-lake"
      : isComet
        ? "intel-comet-lake"
        : "unknown";

  const acpi: string[] = [];
  if (isAmdZen) {
    acpi.push("SSDT-EC-USBX-DESKTOP.aml");
    if (amdCpuDefinitionChipsets.includes(chipset)) acpi.push("SSDT-CPUR.aml");
  } else if (isCoffee || isComet) {
    acpi.push("SSDT-PLUG-DRTNIA.aml", "SSDT-EC-USBX-DESKTOP.aml");
    if (isComet || coffeeAutoChipsets.includes(chipset)) acpi.push("SSDT-AWAC.aml");
    if (isCoffee && coffeeAutoChipsets.includes(chipset)) acpi.push("SSDT-PMC.aml");
    if (
      isComet &&
      ["asus", "micro-star", "msi"].some((vendor) => hardware.board.vendor.toLowerCase().includes(vendor))
    ) {
      acpi.push("SSDT-RHUB.aml");
    }
  }

  if (isAmdZen) {
    components.add("AppleMCEReporterDisabler.kext");
    notes.push(
      `AMD Vanilla 核心补丁将按 ${hardware.cpu.cores} 个物理核心自动写入。`,
      "macOS 13 及以上使用 MacPro7,1 时加入 AppleMCEReporterDisabler。",
      amdCpuDefinitionChipsets.includes(chipset)
        ? `${chipset} 按官方指南加入 SSDT-CPUR；不加入 Intel SSDT-PLUG/AWAC。`
        : `${chipset} 不加入仅供 B550/A520 使用的 SSDT-CPUR，也不加入 Intel SSDT-PLUG/AWAC。`,
    );
  }

  const intelIgpu = hardware.gpus.find(
    (device) => device.vendorId.toUpperCase() === "8086" && device.name.toUpperCase().includes("UHD GRAPHICS 630"),
  );
  const supportedExternalGpu = hardware.gpus.some(
    (device) => device.vendorId.toUpperCase() !== "8086" && supportedGpuIds.has(device.id),
  );
  const blockedExternalGpu = hardware.gpus.some(
    (device) => device.vendorId.toUpperCase() !== "8086" && blockedGpuIds.has(device.id),
  );
  const igpuPlatformId = intelIgpu
    ? supportedExternalGpu
      ? isComet
        ? "0300C89B"
        : "0300913E"
      : "07009B3E"
    : undefined;
  if (
    intelIgpu &&
    blockedExternalGpu &&
    !supportedExternalGpu &&
    preferences.unsupportedGpuMode !== "preserve"
  ) {
    bootArgs.push("-wegnoegpu");
    notes.push("检测到可用 UHD 630 与明确不受支持的独显，将默认禁用独显并由核显输出。 ");
  } else if (blockedExternalGpu && preferences.unsupportedGpuMode === "preserve") {
    notes.push("已按用户选择保留全部显卡；不会自动加入禁用独显参数，已有 SSDT/DeviceProperties 需由用户自行核对。");
  }
  const supportedAmdChipset = isAmdZen && amdAutoChipsets.includes(chipset);
  const supportedIntelChipset =
    (isCoffee && coffeeAutoChipsets.includes(chipset)) ||
    (isComet && cometAutoChipsets.includes(chipset));
  const autoConfigSupported =
    hardware.system.kind === "desktop" &&
    hardware.system.firmware === "uefi" &&
    (supportedAmdChipset || supportedIntelChipset);

  if ((isCoffee || isComet) && !supportedIntelChipset) {
    notes.push(`主板芯片组 ${chipset} 尚不能可靠决定 AWAC/RTC/PMC 组合，因此保留导出但不自动生成 config.plist。`);
  }
  if ((isCoffee || isComet) && acpi.includes("SSDT-AWAC.aml")) {
    notes.push(
      "当前使用适合多数 300/400 系主板的预编译 SSDT-AWAC；若 DSDT 没有可重新启用的 Legacy RTC，应使用 SSDTTime 生成专属 RTC0 后导入自有 EFI。",
    );
  }
  if (!autoConfigSupported) {
    notes.push("当前平台仍可导出组件，但尚未开放自动 config.plist，避免把未验证模板伪装成一键配置。 ");
  }

  const smbiosModel = isAmdZen
    ? "MacPro7,1"
    : isCoffee
      ? "iMac19,1"
      : isComet && hardware.cpu.cores >= 10
        ? "iMac20,2"
        : "iMac20,1";
  const defaultAmdSetupVirtualMap = !amdDefaultDisabledVirtualMapChipsets.includes(chipset);
  const setupVirtualMap = isAmdZen
    ? (preferences.amdSetupVirtualMap ?? defaultAmdSetupVirtualMap)
    : undefined;
  if (isAmdZen) {
    const setupVirtualMapChoice = preferences.amdSetupVirtualMap === undefined ? "芯片组默认" : "用户选择";
    notes.push(
      setupVirtualMap
        ? `已按${setupVirtualMapChoice}开启 SetupVirtualMap；${chipset} 如在早期启动失败，可回到组装页关闭后重新生成。`
        : `已按${setupVirtualMapChoice}关闭 SetupVirtualMap；${chipset} 属于官方指南提示可能需要关闭的平台，仍可由用户切换。`,
    );
  }
  notes.push(
    preferences.customUsbMapIncluded
      ? "已选择专属 USB Map；XhciPortLimit 仍保持关闭。"
      : "USB 端口映射不能由静态硬件扫描可靠生成；XhciPortLimit 保持关闭，安装后需要制作专属 USB Map。",
    "Realtek 声卡 layout-id 在首次安装后校准。",
    "SMBIOS 身份在本机最终构建时生成。 ",
  );

  return {
    platform,
    profile: `${isAmdZen ? "amd-zen" : hardware.cpu.generation}-${chipset}-${hardware.system.kind}`,
    cpuCoreCount: hardware.cpu.cores,
    chipset,
    smbiosModel,
    igpuPlatformId,
    bootArgs,
    setupVirtualMap,
    autoConfigSupported,
    components: [...components],
    acpi,
    drivers: ["OpenRuntime.efi", "OpenHfsPlus.efi"],
    notes,
  };
}
