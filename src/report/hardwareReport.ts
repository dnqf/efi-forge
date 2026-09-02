import type { HardwareEvidence, HardwareReport, PciDevice } from "../domain/types";

const reportKinds = ["desktop", "laptop"] as const;
const firmwareKinds = ["uefi", "legacy"] as const;
const cpuVendors = ["intel", "amd", "unknown"] as const;
const identitySources = ["direct-pci", "parent-pci", "name-only"] as const;
const storageModes = ["ahci", "raid-vmd", "unknown"] as const;

type JsonObject = Record<string, unknown>;

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 必须是 JSON 对象。`);
  }
  return value as JsonObject;
}

function stringAt(value: unknown, path: string, allowEmpty = false, maximum = 512): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${path} 必须是${allowEmpty ? "字符串" : "非空字符串"}。`);
  }
  const normalized = value.trim();
  if (
    normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)
  ) {
    throw new Error(`${path} 包含控制字符或内容过长。`);
  }
  return normalized;
}

function optionalStringAt(value: unknown, path: string, maximum = 512): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return stringAt(value, path, false, maximum);
}

function machineTypeAt(value: unknown, path: string): string | undefined {
  const machineType = optionalStringAt(value, path)?.toUpperCase();
  if (machineType && !/^[0-9A-Z]{4}$/.test(machineType)) {
    throw new Error(`${path} 必须是四位字母数字机型码。`);
  }
  return machineType;
}

function integerAt(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${path} 必须是 ${minimum} 到 ${maximum} 之间的整数。`);
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
  if (value.length > 64) throw new Error(`${path} 最多包含 64 项。`);
  const strings = value.map((item, index) => stringAt(item, `${path}[${index}]`, false, 128));
  return [...new Set(strings)];
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

function classCodeAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const code = stringAt(value, path).toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) {
    throw new Error(`${path} 必须是六位十六进制 PCI Class Code。`);
  }
  return code;
}

function revisionIdAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const id = stringAt(value, path).toUpperCase();
  if (!/^[0-9A-F]{2}$/.test(id)) {
    throw new Error(`${path} 必须是两位十六进制 Revision ID。`);
  }
  return id;
}

function biosDateAt(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = stringAt(value, path);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
  if (
    !match
    || !parsed
    || parsed.getUTCFullYear() !== Number(match[1])
    || parsed.getUTCMonth() !== Number(match[2]) - 1
    || parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`${path} 必须是 YYYY-MM-DD 日期。`);
  }
  return date;
}

function pciDevicesAt(value: unknown, path: string): PciDevice[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是设备数组。`);
  if (value.length > 256) throw new Error(`${path} 最多包含 256 个设备。`);

  const ids = new Set<string>();

  return value.map((item, index) => {
    const device = objectAt(item, `${path}[${index}]`);
    const id = stringAt(device.id, `${path}[${index}].id`, false, 128);
    if (ids.has(id)) throw new Error(`${path} 包含重复设备 ID：${id}。`);
    ids.add(id);
    return {
      id,
      name: stringAt(device.name, `${path}[${index}].name`),
      vendorId: pciIdAt(device.vendorId, `${path}[${index}].vendorId`),
      deviceId: pciIdAt(device.deviceId, `${path}[${index}].deviceId`),
      subsystemId: subsystemIdAt(device.subsystemId, `${path}[${index}].subsystemId`),
      subsystemVendorId: device.subsystemVendorId === undefined
        ? undefined
        : pciIdAt(device.subsystemVendorId, `${path}[${index}].subsystemVendorId`),
      subsystemDeviceId: device.subsystemDeviceId === undefined
        ? undefined
        : pciIdAt(device.subsystemDeviceId, `${path}[${index}].subsystemDeviceId`),
      revisionId: revisionIdAt(device.revisionId, `${path}[${index}].revisionId`),
      classCode: classCodeAt(device.classCode, `${path}[${index}].classCode`),
      parentVendorId: device.parentVendorId === undefined
        ? undefined
        : pciIdAt(device.parentVendorId, `${path}[${index}].parentVendorId`),
      parentDeviceId: device.parentDeviceId === undefined
        ? undefined
        : pciIdAt(device.parentDeviceId, `${path}[${index}].parentDeviceId`),
      parentClassCode: classCodeAt(
        device.parentClassCode,
        `${path}[${index}].parentClassCode`,
      ),
      identitySource:
        device.identitySource === undefined
          ? undefined
          : enumAt(device.identitySource, identitySources, `${path}[${index}].identitySource`),
    };
  });
}

function hardwareEvidenceAt(value: unknown, path: string): HardwareEvidence {
  const evidence = objectAt(value, path);
  const laptop = objectAt(evidence.laptop, `${path}.laptop`);
  const chipsetDevices = evidence.chipset === undefined
    ? []
    : pciDevicesAt([evidence.chipset], `${path}.chipset`);

  return {
    storageMode: enumAt(evidence.storageMode, storageModes, `${path}.storageMode`),
    chipset: chipsetDevices[0],
    storageControllers: pciDevicesAt(evidence.storageControllers, `${path}.storageControllers`),
    usbControllers: pciDevicesAt(evidence.usbControllers, `${path}.usbControllers`),
    thunderboltControllers: pciDevicesAt(
      evidence.thunderboltControllers,
      `${path}.thunderboltControllers`,
    ),
    bluetooth: pciDevicesAt(evidence.bluetooth, `${path}.bluetooth`),
    inputControllers: pciDevicesAt(evidence.inputControllers, `${path}.inputControllers`),
    laptop: {
      batteryDetected: booleanAt(laptop.batteryDetected, `${path}.laptop.batteryDetected`),
      i2cDetected: booleanAt(laptop.i2cDetected, `${path}.laptop.i2cDetected`),
      ps2Detected: booleanAt(laptop.ps2Detected, `${path}.laptop.ps2Detected`),
      intelSstDetected: booleanAt(laptop.intelSstDetected, `${path}.laptop.intelSstDetected`),
      cameraDetected: booleanAt(laptop.cameraDetected, `${path}.laptop.cameraDetected`),
      fingerprintDetected: booleanAt(laptop.fingerprintDetected, `${path}.laptop.fingerprintDetected`),
      cardReaderDetected: booleanAt(laptop.cardReaderDetected, `${path}.laptop.cardReaderDetected`),
    },
  };
}

export function parseHardwareReport(value: unknown): HardwareReport {
  const root = objectAt(value, "硬件报告");
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) {
    throw new Error("只支持 schemaVersion 为 1 或 2 的硬件报告。");
  }

  const capturedAt = stringAt(root.capturedAt, "capturedAt", false, 64);
  const capturedTime = Date.parse(capturedAt);
  if (!Number.isFinite(capturedTime) || capturedTime > Date.now() + 24 * 60 * 60 * 1000) {
    throw new Error("capturedAt 必须是有效且没有明显晚于当前时间的日期时间。");
  }

  const system = objectAt(root.system, "system");
  const cpu = objectAt(root.cpu, "cpu");
  const board = objectAt(root.board, "board");

  const cores = integerAt(cpu.cores, "cpu.cores", 1, 1024);
  const threads = integerAt(cpu.threads, "cpu.threads", 1, 4096);
  if (threads < cores) throw new Error("CPU 线程数不能小于核心数。");

  return {
    schemaVersion: root.schemaVersion,
    capturedAt,
    system: {
      kind: enumAt(system.kind, reportKinds, "system.kind"),
      firmware: enumAt(system.firmware, firmwareKinds, "system.firmware"),
      secureBoot: booleanAt(system.secureBoot, "system.secureBoot"),
      manufacturer: optionalStringAt(system.manufacturer, "system.manufacturer", 256),
      productName: optionalStringAt(system.productName, "system.productName", 256),
      machineType: machineTypeAt(system.machineType, "system.machineType"),
    },
    cpu: {
      vendor: enumAt(cpu.vendor, cpuVendors, "cpu.vendor"),
      name: stringAt(cpu.name, "cpu.name", false, 256),
      generation: stringAt(cpu.generation, "cpu.generation", false, 64),
      family: integerAt(cpu.family, "cpu.family", 0, 65_535),
      model: integerAt(cpu.model, "cpu.model", 0, 65_535),
      cores,
      threads,
      features: stringArrayAt(cpu.features, "cpu.features"),
    },
    board: {
      vendor: stringAt(board.vendor, "board.vendor", false, 256),
      model: stringAt(board.model, "board.model", false, 256),
      biosVersion: stringAt(board.biosVersion, "board.biosVersion", true, 256),
      biosDate: biosDateAt(board.biosDate, "board.biosDate"),
    },
    gpus: pciDevicesAt(root.gpus, "gpus"),
    network: pciDevicesAt(root.network, "network"),
    audio: pciDevicesAt(root.audio, "audio"),
    storage: pciDevicesAt(root.storage, "storage"),
    evidence: root.schemaVersion === 2
      ? hardwareEvidenceAt(root.evidence, "evidence")
      : undefined,
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
    .toLowerCase()
    .slice(0, 96)
    .replace(/-+$/g, "");
  return `efi-forge-report-${machine || "machine"}.json`;
}
