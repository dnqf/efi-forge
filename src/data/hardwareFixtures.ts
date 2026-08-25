import type { CompatibilityStatus, HardwareReport } from "../domain/types";
import { blockedHardware, sampleHardware } from "./sampleHardware";

export interface HardwareFixture {
  id: string;
  label: string;
  purpose: string;
  expectedStatus: CompatibilityStatus;
  report: HardwareReport;
}

const coffeeLakeDesktop: HardwareReport = {
  ...sampleHardware,
  capturedAt: "2026-08-25T11:00:00+08:00",
  system: {
    ...sampleHardware.system,
    manufacturer: "Gigabyte Technology Co., Ltd.",
    productName: "Z390 AORUS PRO WIFI",
  },
  cpu: {
    ...sampleHardware.cpu,
    name: "Intel Core i5-9600K",
    generation: "coffee-lake",
    model: 158,
    cores: 6,
    threads: 6,
  },
  board: {
    vendor: "Gigabyte Technology Co., Ltd.",
    model: "Z390 AORUS PRO WIFI",
    biosVersion: "F12",
  },
  network: [
    {
      id: "network-0",
      name: "Intel Ethernet Connection I219-V",
      vendorId: "8086",
      deviceId: "15BC",
    },
  ],
  audio: [
    {
      id: "audio-0",
      name: "Realtek ALC1220",
      vendorId: "10EC",
      deviceId: "1220",
    },
  ],
};

export const hardwareFixtures: HardwareFixture[] = [
  {
    id: "comet-lake-z490",
    label: "可构建 · Z490 / i7-10700",
    purpose: "验证首批 Comet Lake 台式机构建路径。",
    expectedStatus: "partial",
    report: sampleHardware,
  },
  {
    id: "coffee-lake-z390",
    label: "可构建 · Z390 / i5-9600K",
    purpose: "验证 Coffee Lake 与 SSDT-PMC 规则。",
    expectedStatus: "partial",
    report: coffeeLakeDesktop,
  },
  {
    id: "blocked-nvidia-pm981",
    label: "应阻止 · NVIDIA / PM981",
    purpose: "验证已知不兼容 GPU 和存储不会生成方案。",
    expectedStatus: "blocked",
    report: blockedHardware,
  },
];
