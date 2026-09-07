import type { HardwareReport, PciDevice } from "../domain/types";
import { parseHardwareReport } from "../report/hardwareReport";

export type OverrideBaseSource = "scanned" | "imported";
export type OverrideDeviceCategory = "gpus" | "network" | "audio" | "storage";

export interface HardwareOverrideDraft {
  manufacturer: string;
  productName: string;
  machineType: string;
  boardVendor: string;
  boardModel: string;
  biosVersion: string;
  devicesJson: Record<OverrideDeviceCategory, string>;
}

export const emptyHardwareOverrideDraft = (): HardwareOverrideDraft => ({
  manufacturer: "",
  productName: "",
  machineType: "",
  boardVendor: "",
  boardModel: "",
  biosVersion: "",
  devicesJson: { gpus: "", network: "", audio: "", storage: "" },
});

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function manualDevices(value: string, category: OverrideDeviceCategory): PciDevice[] | undefined {
  if (!value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${category} 必须是有效的 JSON 设备数组。`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${category} 必须是 JSON 设备数组。`);
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${category}[${index}] 必须是设备对象。`);
    }
    return { ...(item as PciDevice), identitySource: "user-provided" };
  });
}

export function applyHardwareOverrides(
  base: HardwareReport,
  draft: HardwareOverrideDraft,
  baseSource: OverrideBaseSource,
): HardwareReport {
  const manualFields: string[] = [];
  const field = (path: string, value: string, fallback: string | undefined) => {
    const applied = optional(value);
    if (applied !== undefined) manualFields.push(path);
    return applied ?? fallback;
  };
  const deviceOverrides = (Object.keys(draft.devicesJson) as OverrideDeviceCategory[])
    .map((category) => [category, manualDevices(draft.devicesJson[category], category)] as const);
  for (const [category, devices] of deviceOverrides) {
    if (devices !== undefined) manualFields.push(category);
  }
  const candidate: HardwareReport = {
    ...base,
    system: {
      ...base.system,
      manufacturer: field("system.manufacturer", draft.manufacturer, base.system.manufacturer),
      productName: field("system.productName", draft.productName, base.system.productName),
      machineType: field("system.machineType", draft.machineType, base.system.machineType),
    },
    board: {
      ...base.board,
      vendor: field("board.vendor", draft.boardVendor, base.board.vendor) ?? base.board.vendor,
      model: field("board.model", draft.boardModel, base.board.model) ?? base.board.model,
      biosVersion: field("board.biosVersion", draft.biosVersion, base.board.biosVersion) ?? base.board.biosVersion,
    },
    provenance: {
      baseSource,
      manualFields: [...new Set([...(base.provenance?.manualFields ?? []), ...manualFields])].sort(),
    },
  };
  for (const [category, devices] of deviceOverrides) {
    if (devices !== undefined) candidate[category] = devices;
  }
  if (manualFields.length === 0) throw new Error("请至少填写一项手工补充内容。");
  return parseHardwareReport(candidate);
}

export function hasManualHardwareOverrides(report: HardwareReport): boolean {
  return Boolean(report.provenance?.manualFields.length);
}
