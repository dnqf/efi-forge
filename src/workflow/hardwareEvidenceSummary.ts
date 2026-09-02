import type { HardwareReport } from "../domain/types";

export interface HardwareEvidenceSummary {
  reportVersion: string;
  level: "basic" | "controller-aware";
  storageMode: string;
  chipset: string;
  controllerCount: number;
  wirelessCount: number;
  bluetoothCount: number;
  laptopClues: string[];
  gaps: string[];
}

function wirelessCount(report: HardwareReport): number {
  return report.network.filter((device) => /wireless|wi-?fi|wlan|802\.11/i.test(device.name)).length;
}

export function summarizeHardwareEvidence(report: HardwareReport): HardwareEvidenceSummary {
  const evidence = report.evidence;
  if (!evidence) {
    return {
      reportVersion: "v1 · 基础身份",
      level: "basic",
      storageMode: "未扫描控制器模式",
      chipset: "仅有主板名称线索",
      controllerCount: 0,
      wirelessCount: wirelessCount(report),
      bluetoothCount: 0,
      laptopClues: [],
      gaps: ["芯片组/父 PCI", "存储与 USB 控制器", "独立蓝牙", "笔记本 PnP 线索"],
    };
  }

  const laptopClues = [
    evidence.laptop.batteryDetected ? "电池" : null,
    evidence.laptop.i2cDetected ? "I2C" : null,
    evidence.laptop.ps2Detected ? "PS/2" : null,
    evidence.laptop.intelSstDetected ? "Intel SST" : null,
    evidence.laptop.cameraDetected ? "摄像头" : null,
    evidence.laptop.fingerprintDetected ? "指纹" : null,
    evidence.laptop.cardReaderDetected ? "读卡器" : null,
  ].filter((item): item is string => item !== null);
  const gaps = [
    !evidence.chipset ? "芯片组 PCI 身份" : null,
    evidence.storageControllers.length === 0 ? "存储控制器" : null,
    evidence.usbControllers.length === 0 ? "USB xHCI 控制器" : null,
    report.system.kind === "laptop" && evidence.inputControllers.length === 0
      ? "键盘/触控板控制器"
      : null,
  ].filter((item): item is string => item !== null);

  return {
    reportVersion: "v2 · 控制器证据",
    level: "controller-aware",
    storageMode: evidence.storageMode === "raid-vmd"
      ? "VMD / RST / RAID 线索"
      : evidence.storageMode === "ahci"
        ? "AHCI 线索"
        : "控制器模式未知",
    chipset: evidence.chipset
      ? `${evidence.chipset.name} · ${evidence.chipset.vendorId}:${evidence.chipset.deviceId}`
      : "未取得芯片组 PCI 身份",
    controllerCount: evidence.storageControllers.length
      + evidence.usbControllers.length
      + evidence.thunderboltControllers.length,
    wirelessCount: wirelessCount(report),
    bluetoothCount: evidence.bluetooth.length,
    laptopClues,
    gaps,
  };
}
