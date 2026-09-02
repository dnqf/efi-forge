import type { HardwareReport } from "../domain/types";

export type MachineRouteId =
  | "diy-desktop"
  | "oem-desktop"
  | "thinkpad"
  | "laptop"
  | "mini-pc"
  | "workstation"
  | "amd-laptop"
  | "legacy";

export interface MachineRoute {
  id: MachineRouteId;
  label: string;
  guidance: string;
}

const legacyGenerations = new Set([
  "sandy-bridge",
  "ivy-bridge",
  "haswell",
  "broadwell",
  "skylake",
]);

export function classifyMachineRoute(report: HardwareReport): MachineRoute {
  const identity = `${report.system.manufacturer ?? ""} ${report.system.productName ?? ""} ${report.board.vendor} ${report.board.model}`;
  if (report.system.firmware === "legacy" || legacyGenerations.has(report.cpu.generation)) {
    return { id: "legacy", label: "旧平台研究", guidance: "保持手动 EFI、旧系统/OCLP 与独立恢复盘路径。" };
  }
  if (/thinkpad/i.test(identity)) {
    return { id: "thinkpad", label: "ThinkPad 专项", guidance: "优先使用四位 Machine Type、BIOS 与变体模块核对。" };
  }
  if (/xeon|threadripper|workstation|precision|thinkstation|\bhp\s+z[248]\d{2}\b/i.test(`${report.cpu.name} ${identity}`)) {
    return { id: "workstation", label: "工作站 / HEDT", guidance: "人工核对多 GPU、PCIe 拓扑、内存映射和 USB/雷电。" };
  }
  if (/\bnuc(?:\b|\d)|mini\s*pc|deskmini|minisforum|beelink/i.test(identity)) {
    return { id: "mini-pc", label: "NUC / 迷你机", guidance: "按板载无线、移动处理器、USB-C 与散热/睡眠逐项核对。" };
  }
  if (report.system.kind === "laptop" && report.cpu.vendor === "amd") {
    return { id: "amd-laptop", label: "AMD 笔记本研究", guidance: "不套用 AMD 台式机模板；核显、睡眠和输入保持人工方案。" };
  }
  if (report.system.kind === "laptop") {
    return { id: "laptop", label: "笔记本模块化", guidance: "按显示、输入、电池、无线、音频和睡眠模块分别验证。" };
  }
  if (/dell|hewlett|\bhp\b|lenovo|acer/i.test(identity)) {
    return { id: "oem-desktop", label: "OEM 台式机", guidance: "不套用零售主板模板；优先核对锁定 BIOS、接口和 OEM ACPI。" };
  }
  return { id: "diy-desktop", label: "DIY 台式机", guidance: "只有审核 CPU/芯片组组合才开放自动候选，其余保留手动组装。" };
}
