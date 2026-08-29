import type { HardwareReportSource } from "../domain/types";

export function canBuildFromHardwareSource(source: HardwareReportSource): boolean {
  return source === "native" || source === "imported";
}
