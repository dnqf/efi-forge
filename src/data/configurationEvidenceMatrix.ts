import type { HardwareReport } from "../domain/types";
import { sampleHardware } from "./sampleHardware";

export type EvidenceMatrixVariant = "positive" | "missing" | "near-negative";

export interface ConfigurationEvidenceCase {
  id: string;
  source: "synthetic";
  scenario: string;
  variant: EvidenceMatrixVariant;
  report: HardwareReport;
  expected: {
    canContinue: true;
    autoConfig: boolean;
    requiredRuleIds?: string[];
    forbiddenRuleIds?: string[];
    requiredBootArgs?: string[];
    forbiddenBootArgs?: string[];
    requiredNotes?: string[];
  };
}

const pci = (id: string, name: string, vendorId: string, deviceId: string) => ({
  id, name, vendorId, deviceId, identitySource: "direct-pci" as const,
});

const seed = (
  scenario: string,
  report: HardwareReport,
  expected: ConfigurationEvidenceCase["expected"][],
  variants: Partial<Record<"missing" | "near-negative", HardwareReport>> = {},
): ConfigurationEvidenceCase[] => {
  const missing: HardwareReport = variants.missing ?? {
    ...report,
    board: { vendor: "unknown", model: "unknown", biosVersion: "unknown" },
    gpus: [], network: [], audio: [], storage: [], evidence: undefined,
  };
  const near: HardwareReport = variants["near-negative"] ?? {
    ...report,
    board: { ...report.board, model: "near-match-without-reviewed-chipset" },
    gpus: report.gpus.map((device) => ({ ...device, identitySource: "parent-pci" })),
    network: report.network.map((device) => ({ ...device, identitySource: "name-only" })),
    audio: report.audio.map((device) => ({ ...device, identitySource: "parent-pci" })),
    storage: report.storage.map((device) => ({ ...device, identitySource: "name-only" })),
  };
  return (["positive", "missing", "near-negative"] as const).map((variant, index) => ({
    id: `matrix.${scenario}.${variant}`,
    source: "synthetic",
    scenario,
    variant,
    report: [report, missing, near][index],
    expected: expected[index],
  }));
};

const coffeeUnknownBoard: HardwareReport = {
  ...sampleHardware,
  cpu: { ...sampleHardware.cpu, generation: "coffee-lake", name: "Intel Core i5-9600K" },
  board: { vendor: "OEM", model: "UNKNOWN", biosVersion: "synthetic" },
};
const amdB550: HardwareReport = {
  ...sampleHardware,
  cpu: { ...sampleHardware.cpu, vendor: "amd", generation: "zen-3", name: "AMD Ryzen 5", cores: 6 },
  board: { vendor: "Generic", model: "B550 synthetic", biosVersion: "synthetic", biosDate: "2021-01-01" },
  gpus: [pci("gpu-amd", "AMD Radeon RX 580", "1002", "67DF")],
};
const laptop: HardwareReport = {
  ...sampleHardware,
  system: { ...sampleHardware.system, kind: "laptop", productName: "Synthetic Laptop" },
};
const mixedGpu: HardwareReport = {
  ...sampleHardware,
  gpus: [...sampleHardware.gpus, pci("gpu-amd", "AMD Radeon RX 580", "1002", "67DF"), pci("gpu-nvidia", "NVIDIA GeForce RTX 3070", "10DE", "2484")],
};
const thinkPadUnknown: HardwareReport = {
  ...laptop,
  system: { ...laptop.system, manufacturer: "LENOVO", productName: "ThinkPad X999", machineType: "ZZZZ" },
};
const legacy: HardwareReport = {
  ...sampleHardware,
  system: { ...sampleHardware.system, firmware: "legacy" },
  cpu: { ...sampleHardware.cpu, generation: "haswell", features: ["sse4.2"] },
};
const wireless: HardwareReport = {
  ...sampleHardware,
  network: [pci("wifi", "Intel Wi-Fi 6 AX200", "8086", "2723")],
};
const parentDevices: HardwareReport = {
  ...sampleHardware,
  network: [{ ...pci("usb-network", "USB Wi-Fi", "8086", "2723"), identitySource: "parent-pci" }],
  audio: [{ ...pci("usb-audio", "USB Realtek ALC", "10EC", "0887"), identitySource: "parent-pci" }],
};
const raidStorage: HardwareReport = {
  ...sampleHardware,
  evidence: {
    storageMode: "raid-vmd", storageControllers: [pci("vmd", "Intel VMD", "8086", "467F")],
    usbControllers: [], thunderboltControllers: [], bluetooth: [], inputControllers: [],
    laptop: { batteryDetected: false, i2cDetected: false, ps2Detected: false, intelSstDetected: false, cameraDetected: false, fingerprintDetected: false, cardReaderDetected: false },
  },
};
const sataStorage: HardwareReport = {
  ...sampleHardware,
  storage: [pci("sata", "SATA SSD", "1B4B", "9230")],
  evidence: {
    storageMode: "ahci", storageControllers: [pci("ahci", "SATA AHCI Controller", "1B4B", "9230")],
    usbControllers: [], thunderboltControllers: [], bluetooth: [], inputControllers: [],
    laptop: { batteryDetected: false, i2cDetected: false, ps2Detected: false, intelSstDetected: false, cameraDetected: false, fingerprintDetected: false, cardReaderDetected: false },
  },
};
const multiStorage: HardwareReport = {
  ...raidStorage,
  storage: [sataStorage.storage[0], pci("nvme", "Generic NVMe SSD", "1D0F", "8061")],
};
const userProvided: HardwareReport = {
  ...sampleHardware,
  provenance: { baseSource: "scanned", manualFields: ["network"] },
  network: [{ ...pci("manual-net", "Intel I225", "8086", "15F3"), identitySource: "user-provided" }],
};

export const configurationEvidenceMatrix: ConfigurationEvidenceCase[] = [
  ...seed("comet-renamed-igpu", { ...sampleHardware, gpus: [{ ...sampleHardware.gpus[0], name: "Microsoft Basic Display Adapter" }] }, [
    { canContinue: true, autoConfig: true, requiredRuleIds: ["gpu.intel.uhd630"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["gpu.intel.uhd630"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["gpu.intel.uhd630"] },
  ]),
  ...seed("coffee-unknown-board", coffeeUnknownBoard, Array(3).fill({ canContinue: true, autoConfig: false })),
  ...seed("amd-b450-b550-bios", amdB550, [
    { canContinue: true, autoConfig: true, requiredRuleIds: ["cpu.amd.zen"] },
    { canContinue: true, autoConfig: false, requiredRuleIds: ["cpu.amd.zen"] },
    { canContinue: true, autoConfig: false, requiredRuleIds: ["cpu.amd.zen"] },
  ]),
  ...seed("laptop-desktop-chipset-boundary", laptop, Array(3).fill({ canContinue: true, autoConfig: false })),
  ...seed("mixed-supported-and-risk-gpu", mixedGpu, [
    { canContinue: true, autoConfig: true, requiredRuleIds: ["gpu.amd.polaris.native", "gpu.nvidia.turing.blocked"], forbiddenBootArgs: ["-wegnoegpu"] },
    { canContinue: true, autoConfig: false, forbiddenBootArgs: ["-wegnoegpu"] },
    { canContinue: true, autoConfig: false, forbiddenBootArgs: ["-wegnoegpu"] },
  ]),
  ...seed("thinkpad-family-and-machine-type", thinkPadUnknown, Array(3).fill({ canContinue: true, autoConfig: false })),
  ...seed("legacy-and-old-instruction-set", legacy, Array(3).fill({ canContinue: true, autoConfig: false })),
  ...seed("wireless-interface-identity", wireless, [
    { canContinue: true, autoConfig: true, requiredRuleIds: ["network.intel.wireless-exact"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["network.intel.wireless-exact"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["network.intel.wireless-exact"] },
  ]),
  ...seed("usb-parent-controller-identity", parentDevices, [
    { canContinue: true, autoConfig: true, forbiddenRuleIds: ["network.intel.wireless-exact", "audio.realtek.applealc-candidate"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["network.intel.wireless-exact", "audio.realtek.applealc-candidate"] },
    { canContinue: true, autoConfig: false, forbiddenRuleIds: ["network.intel.wireless-exact", "audio.realtek.applealc-candidate"] },
  ]),
  ...seed("sata-nvme-vmd-mode", raidStorage, [
    { canContinue: true, autoConfig: true },
    { canContinue: true, autoConfig: true },
    { canContinue: true, autoConfig: true },
  ], { missing: sataStorage, "near-negative": multiStorage }),
  ...seed("user-component-or-efi-source", userProvided, [
    { canContinue: true, autoConfig: true, requiredNotes: ["user-provided"], forbiddenBootArgs: ["e1000=0"] },
    { canContinue: true, autoConfig: false },
    { canContinue: true, autoConfig: false },
  ]),
  ...seed("verification-binding-after-config-change", sampleHardware, [
    { canContinue: true, autoConfig: true }, { canContinue: true, autoConfig: false }, { canContinue: true, autoConfig: false },
  ]),
];
