import type { CompatibilityStatus, HardwareReport } from "../domain/types";
import { blockedHardware, sampleHardware } from "./sampleHardware";

export interface HardwareFixture {
  id: string;
  label: string;
  purpose: string;
  expectedStatus: CompatibilityStatus;
  expectedAutomaticPath: boolean;
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

const thinkPadT480: HardwareReport = {
  ...sampleHardware,
  capturedAt: "2026-08-27T10:00:00+08:00",
  system: {
    kind: "laptop",
    firmware: "uefi",
    secureBoot: false,
    manufacturer: "LENOVO",
    productName: "ThinkPad T480",
    machineType: "20L5",
  },
  cpu: {
    ...sampleHardware.cpu,
    name: "Intel Core i5-8350U",
    generation: "kaby-lake-r",
    model: 142,
    cores: 4,
    threads: 8,
  },
  board: {
    vendor: "LENOVO",
    model: "20L5",
    biosVersion: "N24ET76W (1.51)",
  },
  gpus: [
    {
      id: "gpu-0",
      name: "Intel UHD Graphics 620",
      vendorId: "8086",
      deviceId: "5917",
      identitySource: "direct-pci",
    },
  ],
  network: [
    {
      id: "network-0",
      name: "Intel Ethernet Connection I219-LM",
      vendorId: "8086",
      deviceId: "15D7",
      identitySource: "direct-pci",
    },
    {
      id: "network-1",
      name: "Intel Dual Band Wireless-AC 8265",
      vendorId: "8086",
      deviceId: "24FD",
      identitySource: "direct-pci",
    },
  ],
  audio: [
    {
      id: "audio-0",
      name: "Realtek ALC257",
      vendorId: "10EC",
      deviceId: "0257",
      identitySource: "parent-pci",
    },
  ],
  storage: [
    {
      id: "storage-0",
      name: "WD Blue SN570 NVMe",
      vendorId: "15B7",
      deviceId: "501A",
      identitySource: "parent-pci",
    },
  ],
};

const thinkPadT490: HardwareReport = {
  ...thinkPadT480,
  capturedAt: "2026-08-27T10:10:00+08:00",
  system: {
    ...thinkPadT480.system,
    productName: "ThinkPad T490",
    machineType: "20N2",
  },
  cpu: {
    ...thinkPadT480.cpu,
    name: "Intel Core i5-8265U",
  },
  board: {
    vendor: "LENOVO",
    model: "20N2",
    biosVersion: "N2IET98W (1.76)",
  },
};

const thinkPadT430: HardwareReport = {
  ...thinkPadT480,
  capturedAt: "2026-08-27T10:20:00+08:00",
  system: {
    ...thinkPadT480.system,
    productName: "ThinkPad T430",
    machineType: "2349",
  },
  cpu: {
    ...thinkPadT480.cpu,
    name: "Intel Core i5-3320M",
    generation: "ivy-bridge",
    family: 6,
    model: 58,
    cores: 2,
    threads: 4,
  },
  board: {
    vendor: "LENOVO",
    model: "2349",
    biosVersion: "G1ETC2WW (2.82)",
  },
  gpus: [{
    id: "gpu-0",
    name: "Intel HD Graphics 4000",
    vendorId: "8086",
    deviceId: "0166",
    identitySource: "direct-pci",
  }],
  network: [{
    id: "network-0",
    name: "Intel 82579LM Gigabit Network Connection",
    vendorId: "8086",
    deviceId: "1502",
    identitySource: "direct-pci",
  }],
  audio: [{
    id: "audio-0",
    name: "Realtek ALC3202",
    vendorId: "10EC",
    deviceId: "0269",
    identitySource: "parent-pci",
  }],
};

const asusZ490: HardwareReport = {
  ...sampleHardware,
  capturedAt: "2026-08-27T10:30:00+08:00",
  system: {
    ...sampleHardware.system,
    manufacturer: "ASUSTeK COMPUTER INC.",
    productName: "PRIME Z490-P",
  },
  board: {
    vendor: "ASUSTeK COMPUTER INC.",
    model: "PRIME Z490-P",
    biosVersion: "1621",
  },
};

const dellOptiPlex7060: HardwareReport = {
  ...coffeeLakeDesktop,
  capturedAt: "2026-08-27T10:40:00+08:00",
  system: {
    ...coffeeLakeDesktop.system,
    manufacturer: "Dell Inc.",
    productName: "OptiPlex 7060",
  },
  board: {
    vendor: "Dell Inc.",
    model: "0C96W1",
    biosVersion: "1.30.0",
  },
  gpus: [{
    id: "gpu-0",
    name: "Intel UHD Graphics 630",
    vendorId: "8086",
    deviceId: "3E92",
    identitySource: "direct-pci",
  }],
};

const mixedCometLakeGraphics: HardwareReport = {
  ...sampleHardware,
  capturedAt: "2026-09-02T01:00:00+08:00",
  gpus: [
    ...sampleHardware.gpus,
    {
      id: "gpu-1",
      name: "NVIDIA GeForce RTX 3070",
      vendorId: "10DE",
      deviceId: "2484",
      identitySource: "direct-pci",
    },
  ],
};

const amdVegaLaptop: HardwareReport = {
  ...sampleHardware,
  capturedAt: "2026-09-02T01:10:00+08:00",
  system: {
    kind: "laptop",
    firmware: "uefi",
    secureBoot: false,
    manufacturer: "LENOVO",
    productName: "ThinkPad T14 Gen 1",
    machineType: "20UD",
  },
  cpu: {
    vendor: "amd",
    name: "AMD Ryzen 7 PRO 4750U",
    generation: "zen-2",
    family: 23,
    model: 96,
    cores: 8,
    threads: 16,
    features: ["sse4.2", "avx", "avx2"],
  },
  board: {
    vendor: "LENOVO",
    model: "20UD",
    biosVersion: "R1BET76W",
  },
  gpus: [{
    id: "gpu-0",
    name: "AMD Radeon Vega 7 Graphics",
    vendorId: "1002",
    deviceId: "1636",
    identitySource: "direct-pci",
  }],
};

export const hardwareFixtures: HardwareFixture[] = [
  {
    id: "thinkpad-t480-20l5",
    label: "ThinkPad 专项 · T480 / 20L5",
    purpose: "验证四位机型码、UHD 620、Intel 无线与笔记本专项路由。",
    expectedStatus: "partial",
    expectedAutomaticPath: false,
    report: thinkPadT480,
  },
  {
    id: "thinkpad-t490-20n2",
    label: "ThinkPad 专项 · T490 / 20N2",
    purpose: "验证新一代 T 系列四位机型码与相邻型号不会串配。",
    expectedStatus: "partial",
    expectedAutomaticPath: false,
    report: thinkPadT490,
  },
  {
    id: "thinkpad-t430-2349",
    label: "旧平台研究 · T430 / 2349",
    purpose: "验证 Ivy Bridge 在 Sonoma 下明确标记高风险、保留研究入口，同时不开放自动配置。",
    expectedStatus: "blocked",
    expectedAutomaticPath: false,
    report: thinkPadT430,
  },
  {
    id: "comet-lake-z490",
    label: "可构建 · Z490 / i7-10700",
    purpose: "验证首批 Comet Lake 台式机构建路径。",
    expectedStatus: "partial",
    expectedAutomaticPath: true,
    report: sampleHardware,
  },
  {
    id: "coffee-lake-z390",
    label: "可构建 · Z390 / i5-9600K",
    purpose: "验证 Coffee Lake 与 SSDT-PMC 规则。",
    expectedStatus: "partial",
    expectedAutomaticPath: true,
    report: coffeeLakeDesktop,
  },
  {
    id: "asus-comet-lake-z490",
    label: "常见主板 · ASUS Z490 / i7-10700",
    purpose: "验证常见 ASUS Z490 厂商别名与 Comet Lake 自动配置路由。",
    expectedStatus: "partial",
    expectedAutomaticPath: true,
    report: asusZ490,
  },
  {
    id: "dell-optiplex-7060",
    label: "品牌台式机 · Dell OptiPlex 7060",
    purpose: "验证 OEM Coffee Lake 台式机保持实验继续权，不误套零售主板自动配置。",
    expectedStatus: "partial",
    expectedAutomaticPath: false,
    report: dellOptiPlex7060,
  },
  {
    id: "mixed-comet-rtx3070",
    label: "混搭显卡 · UHD 630 / RTX 3070",
    purpose: "验证受支持核显与不受支持独显并存时保留选择，并默认生成可撤销的禁用独显参数。",
    expectedStatus: "blocked",
    expectedAutomaticPath: true,
    report: mixedCometLakeGraphics,
  },
  {
    id: "thinkpad-t14-amd-vega",
    label: "AMD 笔记本研究 · T14 Gen 1 / Vega",
    purpose: "验证 AMD 笔记本与 Vega APU 进入 NootedRed 人工研究路径，不误套 AMD 台式机模板。",
    expectedStatus: "partial",
    expectedAutomaticPath: false,
    report: amdVegaLaptop,
  },
  {
    id: "blocked-nvidia-pm981",
    label: "高风险警告 · NVIDIA / PM981",
    purpose: "验证已知不兼容 GPU 和存储会降低可信度并保留实验继续权。",
    expectedStatus: "blocked",
    expectedAutomaticPath: true,
    report: blockedHardware,
  },
];
