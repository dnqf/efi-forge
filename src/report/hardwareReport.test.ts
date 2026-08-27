import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import {
  hardwareReportFileName,
  parseHardwareReport,
  serializeHardwareReport,
} from "./hardwareReport";

describe("hardware report interchange", () => {
  it("round-trips a valid report through the privacy whitelist", () => {
    const imported = parseHardwareReport({
      ...sampleHardware,
      userName: "must-not-survive",
      board: { ...sampleHardware.board, serialNumber: "must-not-survive" },
    });

    expect(imported).toEqual(sampleHardware);
    expect(serializeHardwareReport(imported)).not.toContain("serialNumber");
    expect(serializeHardwareReport(imported)).not.toContain("userName");
  });

  it("rejects unsupported schemas and malformed PCI IDs", () => {
    expect(() => parseHardwareReport({ ...sampleHardware, schemaVersion: 2 })).toThrow(
      "schemaVersion",
    );
    expect(() =>
      parseHardwareReport({
        ...sampleHardware,
        gpus: [{ ...sampleHardware.gpus[0], vendorId: "NVIDIA" }],
      }),
    ).toThrow("十六进制");
    expect(() =>
      parseHardwareReport({
        ...sampleHardware,
        gpus: [{ ...sampleHardware.gpus[0], classCode: "DISPLAY" }],
      }),
    ).toThrow("Class Code");
  });

  it("keeps normalized evidence while removing raw device paths", () => {
    const report = parseHardwareReport({
      ...sampleHardware,
      board: { ...sampleHardware.board, biosDate: "2024-03-15" },
      storage: [
        {
          ...sampleHardware.storage[0],
          vendorId: "144D",
          deviceId: "A808",
          subsystemId: "A801144D",
          classCode: "010802",
          identitySource: "parent-pci",
          pnpDeviceId: "SCSI\\DISK&VEN_NVME&PROD_PRIVATE-SERIAL",
        },
      ],
    });

    expect(report.board.biosDate).toBe("2024-03-15");
    expect(report.storage[0]).toEqual(
      expect.objectContaining({
        vendorId: "144D",
        deviceId: "A808",
        subsystemId: "A801144D",
        classCode: "010802",
        identitySource: "parent-pci",
      }),
    );
    expect(serializeHardwareReport(report)).not.toContain("pnpDeviceId");
    expect(serializeHardwareReport(report)).not.toContain("PRIVATE-SERIAL");
  });

  it("keeps a non-unique Lenovo machine type but rejects serial-like values", () => {
    const report = parseHardwareReport({
      ...sampleHardware,
      system: { ...sampleHardware.system, machineType: "20l5" },
    });
    expect(report.system.machineType).toBe("20L5");
    expect(() =>
      parseHardwareReport({
        ...sampleHardware,
        system: { ...sampleHardware.system, machineType: "20L5001ABC" },
      }),
    ).toThrow("四位");
  });

  it("creates a filesystem-safe export name", () => {
    expect(hardwareReportFileName(sampleHardware)).toBe(
      "efi-forge-report-asustek-computer-inc-prime-z490-p.json",
    );
  });
});
