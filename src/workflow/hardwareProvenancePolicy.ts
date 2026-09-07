import type { HardwareReport, PciDevice } from "../domain/types";

export function isManualHardwareField(report: HardwareReport, path: string): boolean {
  return report.provenance?.manualFields.includes(path) === true;
}

export function canUseFieldForAutomation(report: HardwareReport, path: string): boolean {
  return !isManualHardwareField(report, path);
}

export function canUseDeviceForAutomation(device: PciDevice | undefined): boolean {
  return Boolean(device && device.identitySource !== "user-provided");
}

export function manualDeviceIds(report: HardwareReport): Set<string> {
  return new Set(
    [...report.gpus, ...report.network, ...report.audio, ...report.storage]
      .filter((device) => !canUseDeviceForAutomation(device))
      .map((device) => device.id),
  );
}
