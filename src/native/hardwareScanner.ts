import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HardwareReport } from "../domain/types";

export function nativeRuntimeAvailable(): boolean {
  return isTauri();
}

export async function scanNativeHardware(): Promise<HardwareReport> {
  if (!nativeRuntimeAvailable()) {
    throw new Error("真实硬件扫描只能在 EFI Forge Windows 桌面程序中运行。");
  }

  return invoke<HardwareReport>("scan_hardware");
}

