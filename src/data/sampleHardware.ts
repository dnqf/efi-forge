import type { HardwareReport } from "../domain/types";

export const sampleHardware: HardwareReport = {
  schemaVersion: 1,
  capturedAt: "2026-08-25T10:30:00+08:00",
  system: {
    kind: "desktop",
    firmware: "uefi",
    secureBoot: false,
    manufacturer: "ASUSTeK COMPUTER INC.",
    productName: "PRIME Z490-P",
  },
  cpu: {
    vendor: "intel",
    name: "Intel Core i7-10700",
    generation: "comet-lake",
    family: 6,
    model: 165,
    cores: 8,
    threads: 16,
    features: ["sse4.2", "avx", "avx2"],
  },
  board: {
    vendor: "ASUSTeK COMPUTER INC.",
    model: "PRIME Z490-P",
    biosVersion: "1621",
  },
  gpus: [
    {
      id: "gpu-0",
      name: "Intel UHD Graphics 630",
      vendorId: "8086",
      deviceId: "9BC5",
    },
  ],
  network: [
    {
      id: "network-0",
      name: "Intel Ethernet Connection I219-V",
      vendorId: "8086",
      deviceId: "0D4D",
    },
  ],
  audio: [
    {
      id: "audio-0",
      name: "Realtek ALC887",
      vendorId: "10EC",
      deviceId: "0887",
    },
  ],
  storage: [
    {
      id: "storage-0",
      name: "Samsung SSD 970 EVO Plus",
      vendorId: "144D",
      deviceId: "A808",
    },
  ],
};

export const blockedHardware: HardwareReport = {
  ...sampleHardware,
  gpus: [
    {
      id: "gpu-0",
      name: "NVIDIA GeForce RTX 2060",
      vendorId: "10DE",
      deviceId: "1F08",
    },
  ],
  storage: [
    {
      id: "storage-0",
      name: "Samsung PM981 NVMe",
      vendorId: "144D",
      deviceId: "A808",
    },
  ],
};
