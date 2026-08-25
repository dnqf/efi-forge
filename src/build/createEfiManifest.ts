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
  return [
    report.system.kind,
    report.cpu.generation,
    report.board.vendor,
    report.board.model,
    ...report.gpus.map((device) => `${device.vendorId}:${device.deviceId}`),
    ...report.network.map((device) => `${device.vendorId}:${device.deviceId}`),
  ]
    .join("|")
    .toLowerCase();
}

function lockedComponentsFor(plan: BuildPlan): LockedComponent[] {
  const requestedFiles = new Set([
    "OpenCore.efi",
    ...plan.drivers,
    ...plan.components,
    ...plan.acpi,
  ]);
  if (plan.platform === "amd-zen") requestedFiles.add("AMD-Vanilla-patches.plist");

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

  const components = lockedComponentsFor(plan);
  const allComponentsLocked = components.every(
    (component) => /^[a-f0-9]{64}$/.test(component.sha256) && component.size > 0,
  );
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
        detail: `${components.length} 个官方 Release 资产进入构建清单。`,
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
