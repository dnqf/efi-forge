import componentLock from "../data/components.lock.json";
import type {
  BuildPlan,
  CompatibilityReport,
  EfiBuildManifest,
  HardwareReport,
  LockedComponent,
  MacOSVersion,
} from "../domain/types";

interface ComponentLockFile {
  schemaVersion: 1;
  generatedAt: string;
  components: LockedComponent[];
}

const lock = componentLock as ComponentLockFile;

function hardwareKey(report: HardwareReport): string {
  const deviceKey = (category: string, device: HardwareReport["gpus"][number]) =>
    [
      category,
      device.vendorId || "unknown",
      device.deviceId || "unknown",
      device.subsystemId ?? "unknown",
      device.classCode ?? "unknown",
      device.identitySource ?? "legacy-report",
    ].join(":");
  const deviceKeys = (category: string, devices: HardwareReport["gpus"]) =>
    devices.map((device) => deviceKey(category, device)).sort();

  return [
    report.system.kind,
    report.system.manufacturer ?? "unknown",
    report.system.productName ?? "unknown",
    report.system.machineType ?? "unknown-machine-type",
    report.cpu.vendor,
    report.cpu.generation,
    report.cpu.family,
    report.cpu.model,
    report.cpu.cores,
    report.board.vendor,
    report.board.model,
    report.board.biosVersion || "unknown-bios",
    report.board.biosDate ?? "unknown-bios-date",
    ...deviceKeys("gpu", report.gpus),
    ...deviceKeys("network", report.network),
    ...deviceKeys("audio", report.audio),
    ...deviceKeys("storage", report.storage),
  ]
    .join("|")
    .toLowerCase();
}

function requestedFilesFor(plan: BuildPlan): Set<string> {
  const requestedFiles = new Set([
    "OpenCore.efi",
    ...plan.drivers,
    ...plan.components,
    ...plan.acpi,
  ]);
  if (plan.platform === "amd-zen") requestedFiles.add("AMD-Vanilla-patches.plist");

  return requestedFiles;
}

function lockedComponentsFor(requestedFiles: Set<string>): LockedComponent[] {
  return lock.components.filter((component) =>
    component.provides.some((file) => requestedFiles.has(file)),
  );
}

export function createEfiManifest(
  hardware: HardwareReport,
  targetMacOS: MacOSVersion,
  compatibility: CompatibilityReport,
  plan: BuildPlan | null,
): EfiBuildManifest | null {
  if (!plan || !compatibility.canContinue) return null;

  const requestedFiles = requestedFilesFor(plan);
  const components = lockedComponentsFor(requestedFiles);
  const providedFiles = new Set(components.flatMap((component) => component.provides));
  const missingLockedFiles = [...requestedFiles]
    .filter((file) => !providedFiles.has(file))
    .sort();
  const invalidLockedComponents = components
    .filter((component) => !/^[a-f0-9]{64}$/.test(component.sha256) || component.size <= 0)
    .map((component) => component.name)
    .sort();
  const allComponentsLocked = missingLockedFiles.length === 0
    && invalidLockedComponents.length === 0;
  const blockedCount = compatibility.findings.filter(
    (finding) => finding.status === "blocked",
  ).length;
  const warningCount = compatibility.findings.filter(
    (finding) => finding.status !== "supported",
  ).length;

  return {
    schemaVersion: 1,
    targetMacOS,
    hardwareKey: hardwareKey(hardware),
    sourceReportCapturedAt: hardware.capturedAt,
    profile: plan.profile,
    platform: plan.platform,
    cpuCoreCount: plan.cpuCoreCount,
    chipset: plan.chipset,
    smbiosModel: plan.smbiosModel,
    igpuPlatformId: plan.igpuPlatformId,
    bootArgs: [...plan.bootArgs],
    setupVirtualMap: plan.setupVirtualMap,
    autoConfigSupported: plan.autoConfigSupported,
    components,
    acpi: [...plan.acpi].sort(),
    drivers: [...plan.drivers].sort(),
    notes: [...plan.notes],
    verificationStage: "candidate",
    checks: [
      {
        id: "compatibility.no-blockers",
        label: "硬件兼容性评估",
        status: warningCount === 0 ? "passed" : "warning",
        detail:
          warningCount === 0
            ? `${compatibility.findings.length} 个检查点，覆盖率 ${compatibility.coverage}%。`
            : `${warningCount} 个非完整支持结论（其中 ${blockedCount} 个明确高风险）；允许实验继续，但不作为工具推荐。`,
      },
      {
        id: "components.sha256-locked",
        label: "官方组件版本与哈希已锁定",
        status: allComponentsLocked ? "passed" : "failed",
        detail: missingLockedFiles.length > 0
          ? `组件锁缺少计划资源：${missingLockedFiles.join("、")}。构建必须停止。`
          : invalidLockedComponents.length > 0
            ? `组件锁包含无效哈希或文件大小：${invalidLockedComponents.join("、")}。构建必须停止。`
          : `${components.length} 个官方 Release 资产进入构建清单。`,
      },
      {
        id: "config.ocvalidate",
        label: "config.plist 通过 ocvalidate",
        status: "pending",
        detail: "等待离线 EFI 组装器生成 config.plist 后执行。",
      },
      {
        id: "boot.external-machine",
        label: "外部支持机完成启动验证",
        status: "pending",
        detail: "候选清单不能替代 OpenCore、Recovery 和安装实测。",
      },
    ],
  };
}

export function serializeEfiManifest(manifest: EfiBuildManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
