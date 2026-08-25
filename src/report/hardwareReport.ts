import type { HardwareReport, PciDevice } from "../domain/types";

const reportKinds = ["desktop", "laptop"] as const;
const firmwareKinds = ["uefi", "legacy"] as const;
const cpuVendors = ["intel", "amd", "unknown"] as const;

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 必须是 JSON 对象。`);
  }
  return value as JsonObject;
}

function stringAt(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${path} 必须是${allowEmpty ? "字符串" : "非空字符串"}。`);
  }
  return value.trim();
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringAt(value, path);
}

function integerAt(value: unknown, path: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new Error(`${path} 必须是大于或等于 ${minimum} 的整数。`);
  }
  return value as number;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值。`);
  return value;
}

function enumAt<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(`${path} 必须是 ${options.join(" / ")} 之一。`);
  }
  return value as T;
}

function stringArrayAt(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是字符串数组。`);
  return value.map((item, index) => stringAt(item, `${path}[${index}]`));
}

function pciIdAt(value: unknown, path: string): string {
  const id = stringAt(value, path, true).toUpperCase();
  if (id !== "" && !/^[0-9A-F]{4}$/.test(id)) {
    throw new Error(`${path} 必须为空或四位十六进制 ID。`);
  }
  return id;
}

function subsystemIdAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = stringAt(value, path).toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(id)) {
    throw new Error(`${path} 必须是八位十六进制 Subsystem ID。`);
  }
  return id;
}

function pciDevicesAt(value: unknown, path: string): PciDevice[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是设备数组。`);

  return value.map((item, index) => {
    const device = objectAt(item, `${path}[${index}]`);
    return {
      id: stringAt(device.id, `${path}[${index}].id`),
      name: stringAt(device.name, `${path}[${index}].name`),
      vendorId: pciIdAt(device.vendorId, `${path}[${index}].vendorId`),
      deviceId: pciIdAt(device.deviceId, `${path}[${index}].deviceId`),
      subsystemId: subsystemIdAt(device.subsystemId, `${path}[${index}].subsystemId`),
    };
  });
}

export function parseHardwareReport(value: unknown): HardwareReport {
  const root = objectAt(value, "硬件报告");
  if (root.schemaVersion !== 1) throw new Error("只支持 schemaVersion 为 1 的硬件报告。");

  const capturedAt = stringAt(root.capturedAt, "capturedAt");
  if (Number.isNaN(Date.parse(capturedAt))) throw new Error("capturedAt 必须是有效日期时间。");

  const system = objectAt(root.system, "system");
  const cpu = objectAt(root.cpu, "cpu");
  const board = objectAt(root.board, "board");

  return {
    schemaVersion: 1,
    capturedAt,
    system: {
      kind: enumAt(system.kind, reportKinds, "system.kind"),
      firmware: enumAt(system.firmware, firmwareKinds, "system.firmware"),
      secureBoot: booleanAt(system.secureBoot, "system.secureBoot"),
      manufacturer: optionalStringAt(system.manufacturer, "system.manufacturer"),
      productName: optionalStringAt(system.productName, "system.productName"),
    },
    cpu: {
      vendor: enumAt(cpu.vendor, cpuVendors, "cpu.vendor"),
      name: stringAt(cpu.name, "cpu.name"),
      generation: stringAt(cpu.generation, "cpu.generation"),
      family: integerAt(cpu.family, "cpu.family"),
      model: integerAt(cpu.model, "cpu.model"),
      cores: integerAt(cpu.cores, "cpu.cores", 1),
      threads: integerAt(cpu.threads, "cpu.threads", 1),
      features: stringArrayAt(cpu.features, "cpu.features"),
    },
    board: {
      vendor: stringAt(board.vendor, "board.vendor"),
      model: stringAt(board.model, "board.model"),
      biosVersion: stringAt(board.biosVersion, "board.biosVersion", true),
    },
    gpus: pciDevicesAt(root.gpus, "gpus"),
    network: pciDevicesAt(root.network, "network"),
    audio: pciDevicesAt(root.audio, "audio"),
    storage: pciDevicesAt(root.storage, "storage"),
  };
}

export function serializeHardwareReport(report: HardwareReport): string {
  return `${JSON.stringify(parseHardwareReport(report), null, 2)}\n`;
}

export function hardwareReportFileName(report: HardwareReport): string {
  const machine = `${report.board.vendor}-${report.board.model}`
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `efi-forge-report-${machine || "machine"}.json`;
}
