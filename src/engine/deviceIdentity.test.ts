import { describe, expect, it } from "vitest";
import { ethernetPciIdentities, intelWirelessDeviceIds } from "../data/networkIdentities";
import { compatibilityRules } from "../data/rules";
import type { PciDevice } from "../domain/types";
import { classifyNetworkDevice } from "./deviceIdentity";

const device = (overrides: Partial<PciDevice>): PciDevice => ({
  id: "network-test",
  name: "Network Controller",
  vendorId: "",
  deviceId: "",
  ...overrides,
});

describe("shared device identity classification", () => {
  it("keeps exact classification identities backed by existing network rules", () => {
    for (const identity of ethernetPciIdentities) {
      const [vendorId, deviceId] = identity.split(":");
      expect(compatibilityRules.some((rule) =>
        rule.category === "network"
        && rule.selector.vendorIds?.includes(vendorId)
        && rule.selector.deviceIds?.includes(deviceId))).toBe(true);
    }
    for (const deviceId of intelWirelessDeviceIds) {
      expect(compatibilityRules.some((rule) =>
        rule.category === "network"
        && rule.selector.vendorIds?.includes("8086")
        && rule.selector.deviceIds?.includes(deviceId))).toBe(true);
    }
  });

  it("uses an existing direct Intel wireless PCI identity before the display name", () => {
    expect(classifyNetworkDevice(device({ vendorId: "8086", deviceId: "2723" }))).toEqual({
      kind: "wireless",
      evidence: "direct-pci",
    });
  });

  it("uses an existing direct ethernet PCI identity before a misleading Wi-Fi name", () => {
    expect(classifyNetworkDevice(device({
      name: "Intel Wi-Fi Adapter",
      vendorId: "8086",
      deviceId: "1539",
      identitySource: "direct-pci",
    }))).toEqual({ kind: "ethernet", evidence: "direct-pci" });
  });

  it("keeps parent PCI and contradictory name-only identities out of exact matching", () => {
    expect(classifyNetworkDevice(device({
      vendorId: "8086",
      deviceId: "2723",
      identitySource: "parent-pci",
    }))).toEqual({ kind: "unknown", evidence: "parent-pci" });
    expect(classifyNetworkDevice(device({
      vendorId: "8086",
      deviceId: "2723",
      identitySource: "name-only",
    }))).toEqual({ kind: "unknown", evidence: "unknown" });
  });

  it("labels an unknown Wi-Fi name as a fallback clue and leaves generic devices unknown", () => {
    expect(classifyNetworkDevice(device({
      name: "Acme Wi-Fi Adapter",
      vendorId: "FFFF",
      deviceId: "0001",
    }))).toEqual({ kind: "wireless", evidence: "name-fallback" });
    expect(classifyNetworkDevice(device({ vendorId: "FFFF", deviceId: "0001" }))).toEqual({
      kind: "unknown",
      evidence: "unknown",
    });
  });
});
