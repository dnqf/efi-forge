import type { ThinkPadModelProfile } from "../domain/types";

const dortaniaLimits = {
  label: "Dortania · Hardware Limitations",
  url: "https://dortania.github.io/OpenCore-Install-Guide/macos-limits.html",
  kind: "opencore-guide" as const,
};

const dortaniaVentura = {
  label: "Dortania · macOS Ventura notes",
  url: "https://dortania.github.io/OpenCore-Install-Guide/extras/ventura.html",
  kind: "opencore-guide" as const,
};

/**
 * This is a routing catalog, not a bundled-EFI allowlist. Community repositories are
 * evidence that a hardware family has been explored; they are never downloaded or
 * marked as verified by this table.
 */
export const thinkPadCatalog: ThinkPadModelProfile[] = [
  {
    id: "ivy-classic",
    label: "ThinkPad X230 / T430 系列",
    aliases: ["X230", "T430", "T430S", "T530", "W530"],
    machineTypes: [],
    cpuGenerations: ["ivy-bridge"],
    tier: "legacy-patch-required",
    targetMacOS: ["13", "14"],
    notes: ["Ventura / Sonoma 需要旧显卡补丁路径", "仅 Intel HD 4000 路线；NVIDIA 独显应禁用"],
    sources: [
      {
        label: "X230-Hackintosh",
        url: "https://github.com/banhbaoxamlan/X230-Hackintosh",
        kind: "community-repository",
      },
      {
        label: "T430-Hackintosh-OpenCore",
        url: "https://github.com/jozews321/T430-Hackintosh-Opencore",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
  {
    id: "haswell-40",
    label: "ThinkPad T440 / X240 / W54x 系列",
    aliases: ["T440", "T440P", "T440S", "X240", "W540", "W541", "X1 CARBON 2ND", "X1C2"],
    machineTypes: [],
    cpuGenerations: ["haswell"],
    tier: "legacy-patch-required",
    targetMacOS: ["13", "14", "15"],
    notes: ["Haswell 核显在 Ventura 起不再原生支持", "触控板、双电池和独显必须按变体核对"],
    sources: [
      {
        label: "t440p-oc",
        url: "https://github.com/valnoxy/t440p-oc",
        kind: "community-repository",
      },
      dortaniaVentura,
    ],
  },
  {
    id: "broadwell-50",
    label: "ThinkPad T450 / X250 / X1C3 系列",
    aliases: ["T450", "T450S", "T550", "W550S", "X250", "X1 CARBON 3RD", "X1C3"],
    machineTypes: [],
    cpuGenerations: ["broadwell"],
    tier: "legacy-patch-required",
    targetMacOS: ["13", "14", "15"],
    notes: ["Broadwell 核显在 Ventura 起需要补丁", "Wi-Fi、触屏、扩展坞和双电池存在分支"],
    sources: [
      {
        label: "T450/T450s OpenCore guide",
        url: "https://github.com/racka98/Lenovo-Thinkpad-T450-T450s-Hackintosh-Guide-Opencore",
        kind: "community-repository",
      },
      dortaniaVentura,
    ],
  },
  {
    id: "skylake-60",
    label: "ThinkPad T460 / X260 / X1C4 系列",
    aliases: ["T460", "T460P", "T460S", "T560", "E560", "X260", "X1 CARBON 4TH", "X1C4"],
    machineTypes: [],
    cpuGenerations: ["skylake"],
    tier: "legacy-patch-required",
    targetMacOS: ["13", "14", "15"],
    notes: ["Skylake 在新系统通常需要伪装为 Kaby Lake", "DSDT 设备命名、核显平台 ID 与 USB 映射不可照搬"],
    sources: [
      {
        label: "T460 macOS OpenCore",
        url: "https://github.com/junaedahmed/Lenovo-T460-macOS-OpenCore",
        kind: "community-repository",
      },
      {
        label: "T460s macOS OpenCore",
        url: "https://github.com/simprecicchiani/ThinkPad-T460s-macOS-OpenCore",
        kind: "community-repository",
      },
      dortaniaVentura,
    ],
  },
  {
    id: "workstation-p50",
    label: "ThinkPad P50",
    aliases: ["P50"],
    machineTypes: ["20EN"],
    cpuGenerations: ["skylake"],
    tier: "research-only",
    targetMacOS: ["13", "14", "15"],
    notes: ["移动工作站的 NVIDIA 独显、雷电和多硬盘组合必须逐机处理"],
    sources: [
      {
        label: "P50 OpenCore guide",
        url: "https://github.com/midi1996/P50-opencore-hackintosh",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
  {
    id: "kaby-70",
    label: "ThinkPad T470 / X270 / X1C5 系列",
    aliases: ["T470", "T470P", "T470S", "T570", "X270", "X1 CARBON 5TH", "X1C5"],
    machineTypes: ["20HE"],
    cpuGenerations: ["kaby-lake", "skylake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["同型号可能是 6 代或 7 代 CPU，必须以扫描结果为准", "触屏、USB-C 和无线网卡需要单独分支"],
    sources: [
      {
        label: "ThinkPad T470 OpenCore",
        url: "https://github.com/MultimediaLucario/Lenovo-ThinkPad-T470",
        kind: "community-repository",
      },
      {
        label: "X270 Hackintosh",
        url: "https://github.com/x7a/X270-Hackintosh",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
  {
    id: "workstation-p51",
    label: "ThinkPad P51",
    aliases: ["P51"],
    machineTypes: [],
    cpuGenerations: ["kaby-lake"],
    tier: "research-only",
    targetMacOS: ["13", "14", "15"],
    notes: ["移动工作站独显通常需要禁用，触控板和雷电配置不能从 P50 直接继承"],
    sources: [
      {
        label: "P51 OpenCore Hackintosh",
        url: "https://github.com/AndyTQ/Thinkpad-P51-Opencore-Hackintosh",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
  {
    id: "coffee-80",
    label: "ThinkPad T480 / T580 / X280",
    aliases: ["T480", "T580", "X280"],
    machineTypes: ["20L5", "20L6", "20L9", "20LA", "20KE", "20KF"],
    cpuGenerations: ["coffee-lake", "kaby-lake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["T480 存在 7 代与 8 代 CPU 变体", "必须检查 MX150、触屏、无线网卡和 NVMe 型号"],
    sources: [
      {
        label: "Lenovo PSREF · T480",
        url: "https://psref.lenovo.com/Product/ThinkPad_T480",
        kind: "lenovo-psref",
      },
      {
        label: "t480-oc",
        url: "https://github.com/valnoxy/t480-oc",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
  {
    id: "coffee-80s",
    label: "ThinkPad T480s",
    aliases: ["T480S"],
    machineTypes: ["20L7", "20L8"],
    cpuGenerations: ["coffee-lake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["T480 与 T480s 的 ACPI、端口和电池结构不可直接互换"],
    sources: [
      {
        label: "Lenovo PSREF · T480s",
        url: "https://psref.lenovo.com/WDProduct/ThinkPad/ThinkPad_T480s?tab=model",
        kind: "lenovo-psref",
      },
      {
        label: "T480s Hackintosh",
        url: "https://github.com/felikafelix/Hackintosh-Thinkpad-T480s",
        kind: "community-repository",
      },
    ],
  },
  {
    id: "x1c6",
    label: "ThinkPad X1 Carbon Gen 6",
    aliases: ["X1 CARBON 6TH", "X1 CARBON GEN 6", "X1C6"],
    machineTypes: ["20KG", "20KH"],
    cpuGenerations: ["coffee-lake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["HDR/WQHD、触屏、WWAN 与无线网卡需要按实际变体处理"],
    sources: [
      {
        label: "Lenovo PSREF · X1 Carbon Gen 6",
        url: "https://psref.lenovo.com/Product/thinkpad_x1_carbon_6th_gen",
        kind: "lenovo-psref",
      },
      {
        label: "X1C6 Hackintosh",
        url: "https://github.com/zhtengw/EFI-for-X1C6-hackintosh",
        kind: "community-repository",
      },
    ],
  },
  {
    id: "whiskey-90",
    label: "ThinkPad T490 / T590 / X390",
    aliases: ["T490", "T490S", "T590", "X390"],
    machineTypes: ["20N2", "20N3", "20NX", "20NY", "20Q0", "20Q1"],
    cpuGenerations: ["coffee-lake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["机型码不同会影响 USB Map", "Sequoia 下 Intel 无线方案与蓝牙能力需要单独核对"],
    sources: [
      {
        label: "Lenovo PSREF · T490",
        url: "https://psref.lenovo.com/Product/ThinkPad_T490",
        kind: "lenovo-psref",
      },
      {
        label: "T490 OpenCore",
        url: "https://github.com/5T33Z0/Thinkpad-T490-Hackintosh-OpenCore",
        kind: "community-repository",
      },
    ],
  },
  {
    id: "x1c7",
    label: "ThinkPad X1 Carbon Gen 7",
    aliases: ["X1 CARBON 7TH", "X1 CARBON GEN 7", "X1C7"],
    machineTypes: ["20QD", "20QE"],
    cpuGenerations: ["coffee-lake"],
    tier: "guided-candidate",
    targetMacOS: ["13", "14", "15"],
    notes: ["4K/触屏面板、不同声卡路径与无线网卡要逐项核对"],
    sources: [
      {
        label: "Lenovo PSREF · X1 Carbon Gen 7",
        url: "https://psref.lenovo.com/Product/Laptops_ThinkPad/ThinkPad_X1_Carbon_7th_Gen?MT=20QD",
        kind: "lenovo-psref",
      },
      {
        label: "X1C7 Hackintosh",
        url: "https://github.com/aidanchandra/x1c7-hackintosh",
        kind: "community-repository",
      },
    ],
  },
  {
    id: "comet-gen1",
    label: "ThinkPad X1C8 / T14 Gen 1 Intel / X13 Gen 1 Intel",
    aliases: [
      "X1 CARBON 8TH",
      "X1 CARBON GEN 8",
      "X1C8",
      "T14 GEN 1",
      "T14S GEN 1",
      "X13 GEN 1",
      "P14S GEN 1",
    ],
    machineTypes: ["20U9"],
    cpuGenerations: ["comet-lake"],
    tier: "research-only",
    targetMacOS: ["13", "14", "15"],
    notes: ["只有命中精确机型码且组件一致时才适合复用候选", "不要与 AMD 版 T14/X13 混用"],
    sources: [
      {
        label: "X1C8 Hackintosh",
        url: "https://github.com/HJebbour/ThinkPad-X1C8-Hackintosh",
        kind: "community-repository",
      },
      dortaniaLimits,
    ],
  },
];
