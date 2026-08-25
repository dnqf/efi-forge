import { describe, expect, it } from "vitest";
import { blockedHardware, sampleHardware } from "../data/sampleHardware";
import { compatibilityRules } from "../data/rules";
import { createBuildPlan } from "./createBuildPlan";
import { evaluateCompatibility } from "./evaluateCompatibility";

describe("compatibility engine", () => {
  const ryzenB450Hardware = {
    ...sampleHardware,
    cpu: {
      ...sampleHardware.cpu,
      vendor: "amd" as const,
      name: "AMD Ryzen 5 5600X 6-Core Processor",
      generation: "zen-3",
      family: 25,
      cores: 6,
      threads: 12,
    },
    board: { vendor: "JGINYUE", model: "B450M GAMING", biosVersion: "5.17" },
    gpus: [
      {
        id: "gpu-rtx3070",
        name: "NVIDIA GeForce RTX 3070",
        vendorId: "10DE",
        deviceId: "249D",
      },
    ],
    network: [
      {
        id: "network-rtl8125",
        name: "Realtek Gaming 2.5GbE Family Controller",
        vendorId: "10EC",
        deviceId: "8125",
      },
    ],
  };
  it("produces a traceable buildable report for the supported sample", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);

    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(true);
    expect(report.status).toBe("partial");
    expect(report.coverage).toBe(86);
    expect(report.findings.find((finding) => finding.subjectId === "cpu")?.ruleId).toBe(
      "cpu.intel.comet-lake",
    );
  });

  it("warns about known unsupported graphics and risky storage without removing choice", () => {
    const report = evaluateCompatibility(blockedHardware, "14", compatibilityRules);

    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
    expect(report.confidence).toBe("D");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "gpu.nvidia.turing.blocked" }),
        expect.objectContaining({ ruleId: "storage.samsung.pm98x.blocked" }),
      ]),
    );
  });

  it("moves unknown critical hardware into experimental mode", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        {
          id: "gpu-unknown",
          name: "Mystery Graphics Adapter",
          vendorId: "FFFF",
          deviceId: "0001",
        },
      ],
    };
    const report = evaluateCompatibility(hardware, "15", compatibilityRules);

    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
    expect(report.findings.find((finding) => finding.subjectId === "gpu-unknown")?.ruleId).toBe(
      "system.unknown-critical",
    );
  });

  it("creates a platform-specific component and ACPI plan", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, report);

    expect(plan?.profile).toBe("comet-lake-Z490-desktop");
    expect(plan?.components).toContain("IntelMausi.kext");
    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.smbiosModel).toBe("iMac20,1");
    expect(plan?.igpuPlatformId).toBe("07009B3E");
    expect(plan?.acpi).toEqual([
      "SSDT-PLUG-DRTNIA.aml",
      "SSDT-EC-USBX-DESKTOP.aml",
      "SSDT-AWAC.aml",
      "SSDT-RHUB.aml",
    ]);
    expect(plan?.acpi).toContain("SSDT-RHUB.aml");
  });

  it("creates an explicitly experimental plan for high-risk hardware", () => {
    const report = evaluateCompatibility(blockedHardware, "14", compatibilityRules);

    const plan = createBuildPlan(blockedHardware, report);

    expect(plan).not.toBeNull();
    expect(plan?.notes[0]).toContain("实验模式");
    expect(plan?.notes.join(" ")).toContain("NVIDIA GeForce RTX 2060");
  });

  it("builds Ryzen B450 without Intel-only SSDTs and preserves experimental GPU choice", () => {
    const report = evaluateCompatibility(ryzenB450Hardware, "14", compatibilityRules);
    const plan = createBuildPlan(ryzenB450Hardware, report);

    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
    expect(plan?.platform).toBe("amd-zen");
    expect(plan?.cpuCoreCount).toBe(6);
    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.acpi).toEqual(["SSDT-EC-USBX-DESKTOP.aml"]);
    expect(plan?.acpi).not.toEqual(expect.arrayContaining(["SSDT-PLUG.aml", "SSDT-AWAC.aml"]));
    expect(plan?.components).toContain("LucyRTL8125Ethernet.kext");
    expect(plan?.components).not.toContain("WhateverGreen.kext");
  });

  it("preserves the user's AMD SetupVirtualMap BIOS choice", () => {
    const report = evaluateCompatibility(ryzenB450Hardware, "14", compatibilityRules);
    const plan = createBuildPlan(ryzenB450Hardware, report, { amdSetupVirtualMap: false });

    expect(plan?.setupVirtualMap).toBe(false);
    expect(plan?.notes.join(" ")).toContain("已按用户选择关闭 SetupVirtualMap");
  });

  it("creates a locked Coffee Lake Z390 plan with PMC and iMac19,1", () => {
    const hardware = {
      ...sampleHardware,
      cpu: {
        ...sampleHardware.cpu,
        name: "Intel Core i7-9700K",
        generation: "coffee-lake",
        cores: 8,
        threads: 8,
      },
      board: { vendor: "Gigabyte Technology Co., Ltd.", model: "Z390 AORUS PRO", biosVersion: "F12" },
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.chipset).toBe("Z390");
    expect(plan?.smbiosModel).toBe("iMac19,1");
    expect(plan?.acpi).toEqual([
      "SSDT-PLUG-DRTNIA.aml",
      "SSDT-EC-USBX-DESKTOP.aml",
      "SSDT-AWAC.aml",
      "SSDT-PMC.aml",
    ]);
  });

  it("keeps Coffee Lake Z370 manual because AWAC versus RTC cannot be inferred", () => {
    const hardware = {
      ...sampleHardware,
      cpu: { ...sampleHardware.cpu, generation: "coffee-lake", name: "Intel Core i7-8700K" },
      board: { vendor: "ASUSTeK", model: "ROG STRIX Z370-E", biosVersion: "3004" },
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.chipset).toBe("Z370");
    expect(plan?.autoConfigSupported).toBe(false);
    expect(plan?.acpi).toEqual(["SSDT-PLUG-DRTNIA.aml", "SSDT-EC-USBX-DESKTOP.aml"]);
  });

  it("uses PCI ID to keep a native RX 580 enabled without Navi boot args", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        ...sampleHardware.gpus,
        { id: "gpu-rx580", name: "AMD Radeon RX 580", vendorId: "1002", deviceId: "67DF" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-rx580")?.ruleId).toBe(
      "gpu.amd.polaris.native",
    );
    expect(plan?.components).toContain("WhateverGreen.kext");
    expect(plan?.bootArgs).not.toContain("-wegnoegpu");
    expect(plan?.bootArgs).not.toContain("agdpmod=pikera");
  });

  it("distinguishes the unsupported RX 580 2048SP PCI ID", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        ...sampleHardware.gpus,
        { id: "gpu-rx580-sp", name: "AMD Radeon RX 580 2048SP", vendorId: "1002", deviceId: "6FDF" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-rx580-sp")?.ruleId).toBe(
      "gpu.amd.polaris-2048sp.blocked",
    );
    expect(plan?.bootArgs).toContain("-wegnoegpu");
  });

  it("does not disable an unknown external GPU without an explicit blocked rule", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        ...sampleHardware.gpus,
        { id: "gpu-unknown-amd", name: "AMD Engineering Sample", vendorId: "1002", deviceId: "FFFF" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-unknown-amd")?.ruleId).toBe(
      "system.unknown-critical",
    );
    expect(plan?.bootArgs).not.toContain("-wegnoegpu");
  });

  it("detects risky NVMe models even when Windows provides no PCI vendor ID", () => {
    const hardware = {
      ...sampleHardware,
      storage: [
        { id: "storage-pm991", name: "SAMSUNG MZVLQ512HALU-00000 PM991", vendorId: "", deviceId: "" },
        { id: "storage-2200s", name: "Micron 2200S NVMe 512GB", vendorId: "", deviceId: "" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);

    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subjectId: "storage-pm991", ruleId: "storage.samsung.pm98x.blocked" }),
        expect.objectContaining({ subjectId: "storage-2200s", ruleId: "storage.micron.2200s.blocked" }),
      ]),
    );
  });

  it("marks I225 as partial and keeps the documented Gigabyte fallback explicit", () => {
    const hardware = {
      ...sampleHardware,
      board: { ...sampleHardware.board, vendor: "Gigabyte Technology Co., Ltd." },
      network: [
        { id: "network-i225", name: "Intel Ethernet Controller I225-V", vendorId: "8086", deviceId: "15F3" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "network-i225")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "network.intel.i225.partial" }),
    );
    expect(plan?.bootArgs).toContain("e1000=0");
    expect(plan?.notes.join(" ")).toContain("Recovery 网络");
  });

  it("locks the common RTL8111 driver by exact PCI ID", () => {
    const hardware = {
      ...sampleHardware,
      network: [
        { id: "network-rtl8111", name: "Realtek PCIe GbE Family Controller", vendorId: "10EC", deviceId: "8168" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "network-rtl8111")?.ruleId).toBe(
      "network.realtek.rtl8111",
    );
    expect(plan?.components).toContain("RealtekRTL8111.kext");
  });

  it("keeps I211 user-selectable without silently adding an unversioned AppleIGB", () => {
    const hardware = {
      ...sampleHardware,
      network: [
        { id: "network-i211", name: "Intel I211 Gigabit Network Connection", vendorId: "8086", deviceId: "1539" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "network-i211")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "network.intel.i211.partial" }),
    );
    expect(plan?.components).not.toContain("AppleIGB.kext");
  });

  it("adds locked NVMeFix for detected NVMe storage while preserving model risk warnings", () => {
    const hardware = {
      ...sampleHardware,
      storage: [
        { id: "storage-nvme", name: "WD Blue SN570 NVMe SSD", vendorId: "15B7", deviceId: "5017" },
      ],
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.components).toContain("NVMeFix.kext");
    expect(plan?.notes.join(" ")).toContain("不能修复所有不兼容 SSD");
  });
});
