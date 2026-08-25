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
  });

  it("creates a filesystem-safe export name", () => {
    expect(hardwareReportFileName(sampleHardware)).toBe(
      "efi-forge-report-asustek-computer-inc-prime-z490-p.json",
    );
  });
});
