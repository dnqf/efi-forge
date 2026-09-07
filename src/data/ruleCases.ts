import type { HardwareReport, MacOSVersion } from "../domain/types";
import { sampleHardware } from "./sampleHardware";

export type RuleCaseSource = "synthetic" | "user-redacted" | "real-machine-feedback";

export interface CompatibilityRuleCase {
  id: string;
  source: RuleCaseSource;
  targetMacOS: MacOSVersion;
  input: unknown;
  expectedRuleIds: string[];
  forbiddenRuleIds?: string[];
}

const reportWith = (overrides: Partial<HardwareReport>): HardwareReport => ({
  ...sampleHardware,
  capturedAt: "2026-09-07T00:00:00.000Z",
  ...overrides,
});

const pci = (
  id: string,
  name: string,
  vendorId: string,
  deviceId: string,
  identitySource: "direct-pci" | "parent-pci" | "name-only" = "direct-pci",
) => ({ id, name, vendorId, deviceId, identitySource });

/**
 * Executable rule cases are intentionally separate from whole-machine UI fixtures.
 * Every case added locally is synthetic unless its provenance is independently recorded.
 */
export const compatibilityRuleCases: CompatibilityRuleCase[] = [
  {
    id: "case.matrix.firmware-legacy.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ system: { ...sampleHardware.system, firmware: "legacy" } }),
    expectedRuleIds: ["firmware.legacy.blocked"],
    forbiddenRuleIds: ["firmware.uefi.required"],
  },
  {
    id: "case.matrix.cpu-coffee.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ cpu: { ...sampleHardware.cpu, generation: "coffee-lake" } }),
    expectedRuleIds: ["cpu.intel.coffee-lake"],
    forbiddenRuleIds: ["cpu.intel.comet-lake"],
  },
  {
    id: "case.matrix.cpu-comet.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ cpu: { ...sampleHardware.cpu, generation: "comet-lake" } }),
    expectedRuleIds: ["cpu.intel.comet-lake"],
    forbiddenRuleIds: ["cpu.intel.coffee-lake"],
  },
  {
    id: "case.matrix.cpu-amd-zen.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({
      cpu: { ...sampleHardware.cpu, vendor: "amd", generation: "zen-3", name: "AMD Ryzen synthetic" },
    }),
    expectedRuleIds: ["cpu.amd.zen"],
  },
  {
    id: "case.matrix.gpu-nvidia.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "NVIDIA GeForce RTX 3070", "10DE", "2484")] }),
    expectedRuleIds: ["gpu.nvidia.turing.blocked"],
    forbiddenRuleIds: ["gpu.nvidia.modern-macos.blocked"],
  },
  {
    id: "case.matrix.gpu-nvidia-generic.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "NVIDIA GeForce GTX 1080", "10DE", "1B80")] }),
    expectedRuleIds: ["gpu.nvidia.modern-macos.blocked"],
  },
  {
    id: "case.matrix.wireless-direct.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ network: [pci("net-case", "Generic network controller", "8086", "2723")] }),
    expectedRuleIds: ["network.intel.wireless-exact"],
  },
  {
    id: "case.matrix.storage-600p.positive",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ storage: [pci("storage-case", "Intel SSDPEKKW NVMe", "8086", "F1A5")] }),
    expectedRuleIds: ["storage.intel.600p.partial"],
  },
  {
    id: "case.matrix.identity-missing.near",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({
      gpus: [pci("gpu-case", "NVIDIA GeForce RTX 3070", "", "", "name-only")],
      network: [pci("net-case", "Intel Wi-Fi 6 AX200", "", "", "parent-pci")],
      storage: [pci("storage-case", "Intel SSD 660p", "", "", "name-only")],
    }),
    expectedRuleIds: [],
    forbiddenRuleIds: [
      "gpu.nvidia.turing.blocked",
      "gpu.nvidia.modern-macos.blocked",
      "network.intel.wireless-exact",
      "storage.intel.600p.partial",
    ],
  },
  {
    id: "case.auto.intel-uhd630.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "Intel UHD Graphics 630", "8086", "9BC5")] }),
    expectedRuleIds: ["gpu.intel.uhd630"],
  },
  {
    id: "case.auto.intel-uhd620.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({
      system: { ...sampleHardware.system, kind: "laptop" },
      gpus: [pci("gpu-case", "Intel UHD Graphics 620", "8086", "5917")],
    }),
    expectedRuleIds: ["gpu.intel.hd-uhd620-laptop"],
  },
  {
    id: "case.auto.amd-polaris.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "AMD Radeon RX 580", "1002", "67DF")] }),
    expectedRuleIds: ["gpu.amd.polaris.native"],
    forbiddenRuleIds: ["gpu.amd.polaris-2048sp.blocked"],
  },
  {
    id: "case.auto.amd-navi.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "AMD Radeon RX 6800", "1002", "73BF")] }),
    expectedRuleIds: ["gpu.amd.navi-native"],
  },
  {
    id: "case.auto.network-i219.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ network: [pci("net-case", "Intel Ethernet Connection I219-V", "8086", "0D4D")] }),
    expectedRuleIds: ["network.intel.i219"],
  },
  {
    id: "case.auto.network-rtl8125.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ network: [pci("net-case", "Generic Ethernet Controller", "10EC", "8125")] }),
    expectedRuleIds: ["network.realtek.rtl8125"],
    forbiddenRuleIds: ["network.realtek.rtl8111"],
  },
  {
    id: "case.auto.network-rtl8111.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ network: [pci("net-case", "Generic Ethernet Controller", "10EC", "8168")] }),
    expectedRuleIds: ["network.realtek.rtl8111"],
    forbiddenRuleIds: ["network.realtek.rtl8125"],
  },
  {
    id: "case.auto.audio-alc.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ audio: [pci("audio-case", "Realtek ALC1220", "10EC", "1220")] }),
    expectedRuleIds: ["audio.realtek.applealc-candidate"],
  },
  {
    id: "case.risk.rx580-2048sp.direct",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [pci("gpu-case", "AMD Radeon RX 580 2048SP", "1002", "6FDF")] }),
    expectedRuleIds: ["gpu.amd.polaris-2048sp.blocked"],
    forbiddenRuleIds: ["gpu.amd.polaris.native"],
  },
  {
    id: "case.risk.pm981.name",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ storage: [pci("storage-case", "Samsung PM981 NVMe", "144D", "A808")] }),
    expectedRuleIds: ["storage.samsung.pm98x.blocked"],
  },
  {
    id: "case.near.storage-intel-660p",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ storage: [pci("storage-case", "Intel SSD 660p", "8086", "F1A8")] }),
    expectedRuleIds: [],
    forbiddenRuleIds: ["storage.intel.600p.partial"],
  },
  {
    id: "case.identity.parent-and-name-only",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({
      gpus: [pci("gpu-parent", "Intel UHD Graphics 630", "8086", "9BC5", "parent-pci")],
      network: [pci("net-name", "Realtek RTL8125 Gaming Ethernet", "10EC", "8125", "name-only")],
      audio: [pci("audio-parent", "Realtek ALC1220", "10EC", "1220", "parent-pci")],
    }),
    expectedRuleIds: [],
    forbiddenRuleIds: [
      "gpu.intel.uhd630",
      "network.realtek.rtl8125",
      "audio.realtek.applealc-candidate",
    ],
  },
  {
    id: "case.identity.missing-devices",
    source: "synthetic",
    targetMacOS: "14",
    input: reportWith({ gpus: [], network: [], audio: [] }),
    expectedRuleIds: [],
    forbiddenRuleIds: [
      "gpu.intel.uhd630",
      "gpu.intel.hd-uhd620-laptop",
      "gpu.amd.polaris.native",
      "gpu.amd.navi-native",
      "network.intel.i219",
      "network.realtek.rtl8125",
      "network.realtek.rtl8111",
      "audio.realtek.applealc-candidate",
    ],
  },
];
