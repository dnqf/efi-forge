import { ethernetPciIdentities, intelWirelessDeviceIds } from "../data/networkIdentities";
import type { DeviceCategory, PciDevice } from "../domain/types";

export type DeviceClassificationEvidence =
  | "direct-pci"
  | "parent-pci"
  | "name-fallback"
  | "unknown";

export interface NetworkDeviceClassification {
  kind: "wireless" | "ethernet" | "unknown";
  evidence: DeviceClassificationEvidence;
}

const wirelessDeviceIds = new Set<string>(intelWirelessDeviceIds);
const ethernetIdentities = new Set<string>(ethernetPciIdentities);

function normalizedPciId(value: string): string {
  return value.trim().toUpperCase();
}

export function hasDirectPciIdentity(device: PciDevice): boolean {
  if (
    device.identitySource === "parent-pci"
    || device.identitySource === "name-only"
    || device.identitySource === "user-provided"
  ) {
    return false;
  }
  return /^[0-9A-F]{4}$/.test(normalizedPciId(device.vendorId))
    && /^[0-9A-F]{4}$/.test(normalizedPciId(device.deviceId));
}

export function classifyNetworkDevice(device: PciDevice): NetworkDeviceClassification {
  if (hasDirectPciIdentity(device)) {
    const vendorId = normalizedPciId(device.vendorId);
    const deviceId = normalizedPciId(device.deviceId);
    if (vendorId === "8086" && wirelessDeviceIds.has(deviceId)) {
      return { kind: "wireless", evidence: "direct-pci" };
    }
    if (ethernetIdentities.has(`${vendorId}:${deviceId}`)) {
      return { kind: "ethernet", evidence: "direct-pci" };
    }
  }

  if (device.identitySource === "parent-pci") {
    return { kind: "unknown", evidence: "parent-pci" };
  }

  if (/wireless|wi[ -]?fi|wlan|802\.11|airport|centrino/i.test(device.name)) {
    return { kind: "wireless", evidence: "name-fallback" };
  }
  if (/ethernet|\bgbe\b|gigabit|2\.5gbe|i21[19]|i22[56]|rtl81(?:11|25|68)/i.test(device.name)) {
    return { kind: "ethernet", evidence: "name-fallback" };
  }
  return { kind: "unknown", evidence: "unknown" };
}

// Fixed identities already used by the project's Comet Lake fixture. Unknown
// devices keep their reported name; this is not a universal GPU support list.
export function canonicalDeviceName(device: PciDevice, category: DeviceCategory): string {
  if (category === "gpu"
    && hasDirectPciIdentity(device)
    && normalizedPciId(device.vendorId) === "8086"
    && normalizedPciId(device.deviceId) === "9BC5") {
    return "Intel UHD Graphics 630";
  }
  if (category === "network") {
    const classification = classifyNetworkDevice(device);
    if (classification.evidence === "direct-pci") {
      return classification.kind === "wireless"
        ? "Intel Wireless Network Controller"
        : "Known Ethernet Controller";
    }
  }
  return device.name;
}

export function isDesktopUhd630(device: PciDevice): boolean {
  return hasDirectPciIdentity(device)
    && normalizedPciId(device.vendorId) === "8086"
    && canonicalDeviceName(device, "gpu").toUpperCase().includes("UHD GRAPHICS 630");
}
