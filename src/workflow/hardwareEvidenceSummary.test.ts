import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import { summarizeHardwareEvidence } from "./hardwareEvidenceSummary";

describe("hardware evidence summary", () => {
  it("keeps schema v1 usable while naming its evidence gaps", () => {
    const summary = summarizeHardwareEvidence(sampleHardware);
    expect(summary.level).toBe("basic");
    expect(summary.gaps).toContain("存储与 USB 控制器");
  });

  it("separates wireless, bluetooth and controller evidence", () => {
    const summary = summarizeHardwareEvidence({
      ...sampleHardware,
      schemaVersion: 2,
      system: { ...sampleHardware.system, kind: "laptop" },
      network: [{
        id: "network-wifi",
        name: "Intel Wi-Fi 6 AX200",
        vendorId: "8086",
        deviceId: "2723",
      }],
      evidence: {
        storageMode: "raid-vmd",
        storageControllers: [{
          id: "storage-controller-0",
          name: "Intel VMD Controller",
          vendorId: "8086",
          deviceId: "9A0B",
          classCode: "010400",
        }],
        usbControllers: [{
          id: "usb-controller-0",
          name: "Intel xHCI Controller",
          vendorId: "8086",
          deviceId: "A36D",
          classCode: "0C0330",
        }],
        thunderboltControllers: [],
        bluetooth: [{
          id: "bluetooth-0",
          name: "Intel Wireless Bluetooth",
          vendorId: "8086",
          deviceId: "2723",
          identitySource: "parent-pci",
        }],
        inputControllers: [],
        laptop: {
          batteryDetected: true,
          i2cDetected: true,
          ps2Detected: false,
          intelSstDetected: true,
          cameraDetected: true,
          fingerprintDetected: false,
          cardReaderDetected: false,
        },
      },
    });

    expect(summary.reportVersion).toContain("v2");
    expect(summary.storageMode).toContain("VMD");
    expect(summary.controllerCount).toBe(2);
    expect(summary.wirelessCount).toBe(1);
    expect(summary.bluetoothCount).toBe(1);
    expect(summary.laptopClues).toEqual(expect.arrayContaining(["电池", "I2C", "Intel SST"]));
  });
});
