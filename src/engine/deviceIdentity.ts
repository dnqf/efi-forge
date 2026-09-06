import type { PciDevice } from "../domain/types";

// Fixed identities already used by the project's Comet Lake fixture. Unknown
// devices keep their reported name; this is not a universal GPU support list.
export function canonicalDeviceName(device: PciDevice): string {
  if (device.identitySource !== "parent-pci"
    && device.vendorId.toUpperCase() === "8086"
    && device.deviceId.toUpperCase() === "9BC5") {
    return "Intel UHD Graphics 630";
  }
  return device.name;
}

export function isDesktopUhd630(device: PciDevice): boolean {
  return device.identitySource !== "parent-pci"
    && device.vendorId.toUpperCase() === "8086"
    && canonicalDeviceName(device).toUpperCase().includes("UHD GRAPHICS 630");
}
