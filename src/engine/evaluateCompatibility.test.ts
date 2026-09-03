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
    expect(report.modules.map((module) => module.id)).toEqual([
      "platform",
      "graphics",
      "ethernet",
      "wireless",
      "bluetooth",
      "audio",
      "storage",
      "usb",
      "laptop-input",
      "battery",
      "backlight",
      "sleep",
      "thunderbolt",
      "camera",
      "fingerprint",
      "card-reader",
    ]);
    expect(report.modules.find((module) => module.id === "usb")?.status).toBe("partial");
  });

  it("uses schema v2 evidence without converting Windows clues into support claims", () => {
    const hardware = {
      ...sampleHardware,
      schemaVersion: 2 as const,
      system: { ...sampleHardware.system, kind: "laptop" as const },
      storage: [{
        id: "storage-generic",
        name: "Generic solid state disk",
        vendorId: "",
        deviceId: "",
      }],
      evidence: {
        storageMode: "raid-vmd" as const,
        storageControllers: [{
          id: "storage-controller-0",
          name: "Intel VMD Controller",
          vendorId: "8086",
          deviceId: "9A0B",
          classCode: "010802",
        }],
        usbControllers: [{
          id: "usb-controller-0",
          name: "Intel xHCI Controller",
          vendorId: "8086",
          deviceId: "A36D",
          classCode: "0C0330",
        }],
        thunderboltControllers: [],
        bluetooth: [{
          id: "bluetooth-0",
          name: "Intel Wireless Bluetooth",
          vendorId: "8086",
          deviceId: "2723",
          identitySource: "parent-pci" as const,
        }],
        inputControllers: [{
          id: "input-controller-0",
          name: "Intel Serial IO I2C Host Controller",
          vendorId: "8086",
          deviceId: "A368",
        }],
        laptop: {
          batteryDetected: true,
          i2cDetected: true,
          ps2Detected: false,
          intelSstDetected: true,
          cameraDetected: true,
          fingerprintDetected: true,
          cardReaderDetected: false,
        },
      },
    };

    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.canContinue).toBe(true);
    expect(report.modules.find((module) => module.id === "bluetooth")?.status).toBe("partial");
    expect(report.modules.find((module) => module.id === "laptop-input")?.status).toBe("partial");
    expect(report.modules.find((module) => module.id === "battery")?.status).toBe("partial");
    expect(report.modules.find((module) => module.id === "fingerprint")?.status).toBe("partial");
    expect(report.modules.find((module) => module.id === "fingerprint")?.summary).toContain("通常不支持");
    expect(plan?.components).toContain("NVMeFix.kext");
    expect(plan?.notes.join(" ")).toContain("VMD/RST/RAID");
    expect(plan?.autoConfigSupported).toBe(false);
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

  it("keeps missing device categories visible in coverage without blocking user choice", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [],
      network: [],
      audio: [],
      storage: [],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: "gpu-missing", status: "blocked" }),
      expect.objectContaining({ subjectId: "network-missing", status: "unknown" }),
      expect.objectContaining({ subjectId: "audio-missing", status: "unknown" }),
      expect.objectContaining({ subjectId: "storage-missing", status: "unknown" }),
    ]));
    expect(report.coverage).toBeLessThan(100);
    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
  });

  it.each([
    ["NVIDIA GeForce GTX 1080", "1B80"],
    ["NVIDIA GeForce GT 710", "128B"],
    ["NVIDIA GeForce RTX 5090", "2B85"],
  ])("classifies %s as unsupported for the selected modern macOS targets", (name, deviceId) => {
    const hardware = {
      ...sampleHardware,
      gpus: [{ id: "gpu-nvidia", name, vendorId: "10DE", deviceId }],
    };

    const report = evaluateCompatibility(hardware, "15", compatibilityRules);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-nvidia")).toEqual(
      expect.objectContaining({ status: "blocked", ruleId: "gpu.nvidia.modern-macos.blocked" }),
    );
    expect(report.canContinue).toBe(true);
  });

  it("routes an AMD Vega APU to the explicit NootedRed manual path", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [{ id: "gpu-vega-apu", name: "AMD Radeon(TM) Vega 8 Graphics", vendorId: "1002", deviceId: "15D8" }],
    };

    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-vega-apu")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "gpu.amd.vega-apu.partial" }),
    );
    expect(report.canContinue).toBe(true);
    expect(plan?.components).not.toContain("NootedRed.kext");
  });

  it("routes post-Comet-Lake Intel CPUs to a manual spoofing path instead of an unknown CPU", () => {
    const hardware = {
      ...sampleHardware,
      cpu: {
        ...sampleHardware.cpu,
        name: "Intel Core i7-14700K",
        generation: "raptor-lake-refresh",
      },
    };

    const report = evaluateCompatibility(hardware, "15", compatibilityRules);
    const finding = report.findings.find((item) => item.subjectId === "cpu");

    expect(finding).toEqual(expect.objectContaining({
      status: "partial",
      ruleId: "cpu.intel.post-comet.manual",
    }));
    expect(report.canContinue).toBe(true);
  });

  it("keeps macOS Tahoe available as a manual research target without pretending auto-config support", () => {
    const hardware = {
      ...sampleHardware,
      network: [
        { id: "network-tahoe-intel", name: "Intel(R) Wireless-AC 9560", vendorId: "8086", deviceId: "A370" },
      ],
    };
    const report = evaluateCompatibility(hardware, "26", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
    expect(plan?.autoConfigSupported).toBe(false);
    expect(plan?.notes.join(" ")).toContain("Tahoe 26 当前只开放手动研究路径");
    expect(report.findings.find((finding) => finding.subjectId === "audio-0")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "audio.realtek.tahoe.manual" }),
    );
    expect(report.findings.find((finding) => finding.subjectId === "network-tahoe-intel")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "network.intel.wireless-tahoe.manual" }),
    );
    expect(plan?.components).not.toContain("AppleALC.kext");
  });

  it("routes identified Intel and AMD graphics through Tahoe-specific manual review instead of unknown hardware", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        {
          id: "gpu-tahoe-amd",
          name: "AMD Radeon RX 6600 XT",
          vendorId: "1002",
          deviceId: "73FF",
        },
      ],
    };

    const report = evaluateCompatibility(hardware, "26", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "cpu")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "cpu.tahoe.manual-known" }),
    );
    expect(report.findings.find((finding) => finding.subjectId === "gpu-tahoe-amd")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "gpu.tahoe.intel-amd.manual" }),
    );
    expect(report.canContinue).toBe(true);
    expect(report.recommended).toBe(false);
    expect(plan?.autoConfigSupported).toBe(false);
  });

  it("keeps explicitly unsupported modern AMD graphics blocked on Tahoe", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        {
          id: "gpu-tahoe-unsupported",
          name: "AMD Radeon RX 7900 XTX",
          vendorId: "1002",
          deviceId: "744C",
        },
      ],
    };

    const report = evaluateCompatibility(hardware, "26", compatibilityRules);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-tahoe-unsupported")).toEqual(
      expect.objectContaining({ status: "blocked", ruleId: "gpu.amd.modern-unsupported.blocked" }),
    );
    expect(report.canContinue).toBe(true);
  });

  it("does not imply an SMBIOS recommendation on a manual-only platform", () => {
    const hardware = {
      ...sampleHardware,
      system: { ...sampleHardware.system, kind: "laptop" as const },
      cpu: {
        ...sampleHardware.cpu,
        name: "Intel Core i5-8250U",
        generation: "kaby-lake-r",
      },
      board: { vendor: "LENOVO", model: "20L5", biosVersion: "N24ET74W" },
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.canContinue).toBe(true);
    expect(plan?.autoConfigSupported).toBe(false);
    expect(plan?.smbiosModel).toBe("manual-selection-required");
    expect(plan?.notes.join(" ")).toContain("不会预填 SMBIOS 机型");
  });

  it("creates a platform-specific component and ACPI plan", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, report);

    expect(plan?.profile).toBe("comet-lake-Z490-desktop");
    expect(plan?.components).toContain("IntelMausi.kext");
    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.intelClockMode).toBe("awac");
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

  it("keeps the mixed-GPU decision user-selectable", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        ...sampleHardware.gpus,
        { id: "gpu-rtx", name: "NVIDIA GeForce RTX 3070", vendorId: "10DE", deviceId: "2484" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const graphics = report.modules.find((module) => module.id === "graphics");

    expect(graphics?.choices.map((choice) => choice.id)).toEqual([
      "disable-unsupported-gpu",
      "preserve-all-gpus",
    ]);
    expect(createBuildPlan(hardware, report)?.bootArgs).toContain("-wegnoegpu");
    const preservePlan = createBuildPlan(hardware, report, { unsupportedGpuMode: "preserve" });
    expect(preservePlan?.bootArgs).not.toContain("-wegnoegpu");
    expect(preservePlan?.notes.join(" ")).toContain("已按用户选择保留全部显卡");
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

  it.each([
    ["B550", ["SSDT-EC-USBX-DESKTOP.aml", "SSDT-CPUR.aml"], false],
    ["A520", ["SSDT-EC-USBX-DESKTOP.aml", "SSDT-CPUR.aml"], false],
    ["X570", ["SSDT-EC-USBX-DESKTOP.aml"], false],
    ["X470", ["SSDT-EC-USBX-DESKTOP.aml"], true],
  ])("opens reviewed AMD %s automatic config with chipset-specific defaults", (chipset, acpi, setupVirtualMap) => {
    const hardware = {
      ...ryzenB450Hardware,
      board: { ...ryzenB450Hardware.board, model: `${chipset} TEST BOARD` },
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.chipset).toBe(chipset);
    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.acpi).toEqual(acpi);
    expect(plan?.setupVirtualMap).toBe(setupVirtualMap);
  });

  it("preserves the user's AMD SetupVirtualMap BIOS choice", () => {
    const report = evaluateCompatibility(ryzenB450Hardware, "14", compatibilityRules);
    const plan = createBuildPlan(ryzenB450Hardware, report, { amdSetupVirtualMap: false });

    expect(plan?.setupVirtualMap).toBe(false);
    expect(plan?.notes.join(" ")).toContain("已按用户选择关闭 SetupVirtualMap");
  });

  it.each(["B450", "X470"])(
    "uses Q4 2020 as a conservative %s BIOS risk proxy for SetupVirtualMap",
    (chipset) => {
      const hardware = {
        ...ryzenB450Hardware,
        board: {
          ...ryzenB450Hardware.board,
          model: `${chipset} TEST BOARD`,
          biosDate: "2020-12-18",
        },
      };
      const plan = createBuildPlan(
        hardware,
        evaluateCompatibility(hardware, "14", compatibilityRules),
      );

      expect(plan?.setupVirtualMap).toBe(false);
      expect(plan?.notes.join(" ")).toContain("BIOS 日期 2020-12-18");
      expect(plan?.notes.join(" ")).toContain("固件风险代理");
    },
  );

  it("does not treat an earlier 2020 B450 BIOS as the late-2020 risk proxy", () => {
    const hardware = {
      ...ryzenB450Hardware,
      board: { ...ryzenB450Hardware.board, biosDate: "2020-08-31" },
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.setupVirtualMap).toBe(true);
    expect(plan?.notes.join(" ")).not.toContain("固件风险代理");
  });

  it("lets the user's AMD memory-map choice override a recent BIOS risk default", () => {
    const hardware = {
      ...ryzenB450Hardware,
      board: { ...ryzenB450Hardware.board, biosDate: "2022-03-18" },
    };
    const plan = createBuildPlan(
      hardware,
      evaluateCompatibility(hardware, "14", compatibilityRules),
      { amdSetupVirtualMap: true },
    );

    expect(plan?.setupVirtualMap).toBe(true);
    expect(plan?.notes.join(" ")).toContain("已按用户选择开启 SetupVirtualMap");
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

  it("allows an Intel user to select a manual RTC0/SSDTTime path without being blocked", () => {
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
    const compatibility = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, compatibility, { intelClockMode: "manual" });

    expect(compatibility.canContinue).toBe(true);
    expect(plan?.autoConfigSupported).toBe(false);
    expect(plan?.intelClockMode).toBe("manual");
    expect(plan?.acpi).not.toContain("SSDT-AWAC.aml");
    expect(plan?.notes.join(" ")).toContain("手动 RTC0/SSDTTime");
  });

  it("records an explicit Intel AWAC choice while keeping automatic config available", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, compatibility, { intelClockMode: "awac" });

    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.intelClockMode).toBe("awac");
    expect(plan?.acpi).toContain("SSDT-AWAC.aml");
    expect(plan?.notes.join(" ")).toContain("已按用户选择加入预编译 SSDT-AWAC");
  });

  it("does not add the ASUS-only RHUB SSDT to an MSI Z490 board", () => {
    const hardware = {
      ...sampleHardware,
      system: { ...sampleHardware.system, manufacturer: "Micro-Star International" },
      board: {
        vendor: "Micro-Star International",
        model: "MPG Z490 GAMING EDGE",
        biosVersion: "1.D0",
      },
    };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));

    expect(plan?.autoConfigSupported).toBe(true);
    expect(plan?.acpi).toContain("SSDT-AWAC.aml");
    expect(plan?.acpi).not.toContain("SSDT-RHUB.aml");
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

  it("does not offer a global disable switch when supported and blocked external GPUs coexist", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        { id: "gpu-rx580", name: "AMD Radeon RX 580", vendorId: "1002", deviceId: "67DF" },
        { id: "gpu-rtx", name: "NVIDIA GeForce RTX 3070", vendorId: "10DE", deviceId: "2484" },
      ],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);
    const graphics = report.modules.find((module) => module.id === "graphics");

    expect(graphics?.choices).toEqual([]);
    expect(graphics?.summary).toContain("设备级人工方案");
    expect(plan?.bootArgs).not.toContain("-wegnoegpu");
    expect(plan?.notes.join(" ")).toContain("不会加入全局 -wegnoegpu");
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

  it("does not confuse a Lexa RX 550 with native Baffin Polaris", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [{ id: "gpu-rx550-lexa", name: "AMD Radeon RX 550", vendorId: "1002", deviceId: "699F" }],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-rx550-lexa")).toEqual(
      expect.objectContaining({ status: "blocked", ruleId: "gpu.amd.lexa-rx550.blocked" }),
    );
    expect(report.canContinue).toBe(true);
  });

  it("uses registry priority instead of array order for overlapping GPU rules", () => {
    const hardware = {
      ...sampleHardware,
      gpus: [
        {
          id: "gpu-overlap",
          name: "AMD Radeon RX 580 2048SP",
          vendorId: "1002",
          deviceId: "6FDF",
        },
      ],
    };
    const reversedRules = [...compatibilityRules].reverse();

    const report = evaluateCompatibility(hardware, "14", reversedRules);

    expect(report.findings.find((finding) => finding.subjectId === "gpu-overlap")?.ruleId).toBe(
      "gpu.amd.polaris-2048sp.blocked",
    );
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

  it("warns about the SK hynix PC711 laptop NVMe controller", () => {
    const hardware = {
      ...sampleHardware,
      storage: [
        { id: "storage-pc711", name: "SK hynix PC711 NVMe 512GB", vendorId: "", deviceId: "" },
      ],
    };

    const report = evaluateCompatibility(hardware, "14", compatibilityRules);

    expect(report.findings.find((finding) => finding.subjectId === "storage-pc711")).toEqual(
      expect.objectContaining({ status: "blocked", ruleId: "storage.skhynix.pc711.blocked" }),
    );
    expect(report.canContinue).toBe(true);
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

  it("identifies common Intel Wi-Fi by PCI ID without enabling two competing stacks", () => {
    const hardware = {
      ...sampleHardware,
      network: [{ id: "network-ax200", name: "Network Controller", vendorId: "8086", deviceId: "2723" }],
    };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    const plan = createBuildPlan(hardware, report);

    expect(report.findings.find((finding) => finding.subjectId === "network-ax200")).toEqual(
      expect.objectContaining({ status: "partial", ruleId: "network.intel.wireless-exact" }),
    );
    expect(plan?.components).not.toContain("itlwm.kext");
    expect(plan?.components).not.toContain("AirportItlwm.kext");
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
