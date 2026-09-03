import { describe, expect, it } from "vitest";
import {
  createEfiManifest,
  createHardwareFingerprint,
  serializeEfiManifest,
} from "./createEfiManifest";
import { blockedHardware, sampleHardware } from "../data/sampleHardware";
import { hardwareFixtures } from "../data/hardwareFixtures";
import { compatibilityRules } from "../data/rules";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";

describe("EFI build manifest", () => {
  it("creates a deterministic candidate with locked official components", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, compatibility);
    const first = createEfiManifest(sampleHardware, "14", compatibility, plan);
    const second = createEfiManifest(sampleHardware, "14", compatibility, plan);

    expect(first).not.toBeNull();
    expect(serializeEfiManifest(first!)).toBe(serializeEfiManifest(second!));
    expect(first?.components.find((component) => component.id === "opencore")?.version).toBe(
      "1.0.7",
    );
    expect(first?.components.every((component) => component.sha256.length === 64)).toBe(true);
    expect(first?.checks.find((check) => check.id === "config.ocvalidate")?.status).toBe(
      "pending",
    );
    expect(first?.checks.find((check) => check.id === "compatibility.no-blockers")?.status).toBe(
      "warning",
    );
    expect(first?.checks.find((check) => check.id === "boot.external-machine")?.label).toBe(
      "目标电脑完成启动验证",
    );
  });

  it("separates manifests with different subsystem evidence", () => {
    const firstHardware = {
      ...sampleHardware,
      gpus: [
        {
          ...sampleHardware.gpus[0],
          subsystemId: "12341043",
          classCode: "030000",
          identitySource: "direct-pci" as const,
        },
      ],
    };
    const secondHardware = {
      ...firstHardware,
      gpus: [{ ...firstHardware.gpus[0], subsystemId: "56781458" }],
    };
    const firstCompatibility = evaluateCompatibility(firstHardware, "14", compatibilityRules);
    const secondCompatibility = evaluateCompatibility(secondHardware, "14", compatibilityRules);
    const first = createEfiManifest(
      firstHardware,
      "14",
      firstCompatibility,
      createBuildPlan(firstHardware, firstCompatibility),
    );
    const second = createEfiManifest(
      secondHardware,
      "14",
      secondCompatibility,
      createBuildPlan(secondHardware, secondCompatibility),
    );

    expect(first?.hardwareKey).not.toBe(second?.hardwareKey);
    expect(first?.hardwareKey).toMatch(/^hardware-fingerprint-v2:[0-9a-f]{64}$/);
  });

  it("binds schema v2 manifests to firmware, controller and laptop evidence", () => {
    const firstHardware = {
      ...sampleHardware,
      schemaVersion: 2 as const,
      evidence: {
        storageMode: "raid-vmd" as const,
        chipset: {
          id: "chipset-0",
          name: "Intel Z490 LPC Controller",
          vendorId: "8086",
          deviceId: "0685",
        },
        storageControllers: [{
          id: "storage-controller-0",
          name: "Intel VMD Controller",
          vendorId: "8086",
          deviceId: "9A0B",
          classCode: "010400",
        }],
        usbControllers: [],
        thunderboltControllers: [],
        bluetooth: [],
        inputControllers: [],
        laptop: {
          batteryDetected: false,
          i2cDetected: false,
          ps2Detected: false,
          intelSstDetected: false,
          cameraDetected: false,
          fingerprintDetected: false,
          cardReaderDetected: false,
        },
      },
    };
    const secondHardware = {
      ...firstHardware,
      system: { ...firstHardware.system, secureBoot: true },
      evidence: {
        ...firstHardware.evidence,
        storageMode: "ahci" as const,
        storageControllers: [{
          ...firstHardware.evidence.storageControllers[0],
          deviceId: "A282",
        }],
      },
    };
    const firstCompatibility = evaluateCompatibility(firstHardware, "14", compatibilityRules);
    const secondCompatibility = evaluateCompatibility(secondHardware, "14", compatibilityRules);
    const first = createEfiManifest(
      firstHardware,
      "14",
      firstCompatibility,
      createBuildPlan(firstHardware, firstCompatibility),
    );
    const second = createEfiManifest(
      secondHardware,
      "14",
      secondCompatibility,
      createBuildPlan(secondHardware, secondCompatibility),
    );

    expect(first?.hardwareKey).not.toBe(second?.hardwareKey);
    expect(first?.hardwareKey).toMatch(/^hardware-fingerprint-v2:[0-9a-f]{64}$/);
    expect(second?.hardwareKey).toMatch(/^hardware-fingerprint-v2:[0-9a-f]{64}$/);
  });

  it("keeps the fingerprint stable when scan order, temporary IDs and PCI display names change", () => {
    const first = {
      ...sampleHardware,
      gpus: [
        { ...sampleHardware.gpus[0], id: "gpu-0", name: "AMD Radeon RX 580" },
        { ...sampleHardware.gpus[0], id: "gpu-1", name: "Microsoft Basic Display Adapter", deviceId: "67DF" },
      ],
    };
    const second = {
      ...first,
      gpus: [
        { ...first.gpus[1], id: "display-17", name: "Radeon RX 580 Series" },
        { ...first.gpus[0], id: "display-03", name: "Radeon RX 580 Series" },
      ],
    };

    expect(createHardwareFingerprint(first)).toBe(createHardwareFingerprint(second));
    expect(createHardwareFingerprint(first)).toHaveLength(88);
    expect(createHardwareFingerprint(first)).not.toContain("radeon");
  });

  it("uses a normalized device name only when PCI identity is unavailable", () => {
    const first = {
      ...sampleHardware,
      audio: [{ ...sampleHardware.audio[0], id: "audio-0", vendorId: "", deviceId: "", name: "USB   Audio" }],
    };
    const equivalent = {
      ...first,
      audio: [{ ...first.audio[0], id: "audio-99", name: "  usb audio  " }],
    };
    const different = {
      ...first,
      audio: [{ ...first.audio[0], id: "audio-1", name: "Realtek Audio" }],
    };

    expect(createHardwareFingerprint(first)).toBe(createHardwareFingerprint(equivalent));
    expect(createHardwareFingerprint(first)).not.toBe(createHardwareFingerprint(different));
  });

  it("exports high-risk hardware as a warned experimental manifest", () => {
    const compatibility = evaluateCompatibility(blockedHardware, "14", compatibilityRules);
    const plan = createBuildPlan(blockedHardware, compatibility);

    const manifest = createEfiManifest(blockedHardware, "14", compatibility, plan);

    expect(manifest).not.toBeNull();
    expect(manifest?.checks.find((check) => check.id === "compatibility.no-blockers")?.status).toBe(
      "warning",
    );
    expect(manifest?.checks.some((check) => check.status === "failed")).toBe(false);
  });

  it("locks all AMD one-click resources when the platform is Ryzen", () => {
    const hardware = {
      ...sampleHardware,
      cpu: {
        ...sampleHardware.cpu,
        vendor: "amd" as const,
        generation: "zen-3",
        name: "AMD Ryzen 5 5600X",
        cores: 6,
      },
      board: { vendor: "JGINYUE", model: "B450M GAMING", biosVersion: "5.17" },
      gpus: [
        { id: "gpu", name: "NVIDIA GeForce RTX 3070", vendorId: "10DE", deviceId: "249D" },
      ],
      network: [
        { id: "lan", name: "Realtek 2.5GbE", vendorId: "10EC", deviceId: "8125" },
      ],
    };
    const compatibility = evaluateCompatibility(hardware, "14", compatibilityRules);
    const manifest = createEfiManifest(
      hardware,
      "14",
      compatibility,
      createBuildPlan(hardware, compatibility),
    );

    expect(manifest?.autoConfigSupported).toBe(true);
    expect(manifest?.components.map((component) => component.id)).toEqual(
      expect.arrayContaining([
        "opencore",
        "apple-mce-reporter-disabler",
        "lucy-rtl8125",
        "amd-vanilla-patches",
        "dortania-ssdt-ec-usbx-desktop",
      ]),
    );
  });

  it("locks all Comet Lake Z490 ACPI resources", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const manifest = createEfiManifest(
      sampleHardware,
      "14",
      compatibility,
      createBuildPlan(sampleHardware, compatibility),
    );

    expect(manifest?.autoConfigSupported).toBe(true);
    expect(manifest?.intelClockMode).toBe("awac");
    expect(manifest?.checks.find((check) => check.id === "acpi.clock-evidence")?.status).toBe(
      "pending",
    );
    expect(manifest?.components.map((component) => component.id)).toEqual(
      expect.arrayContaining([
        "dortania-ssdt-plug-drtnia",
        "dortania-ssdt-ec-usbx-desktop",
        "dortania-ssdt-awac",
        "dortania-ssdt-rhub",
      ]),
    );
  });

  it("records a manual Intel clock path without locking or advertising AWAC auto config", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const intelClockEvidence = {
      sourceName: "DSDT.aml",
      signature: "DSDT",
      oemId: "ASUS",
      oemTableId: "PRIMEZ49",
      revision: 2,
      length: 2048,
      sha256: "a".repeat(64),
      hasAwacDeviceId: true,
      hasLegacyRtcId: false,
      hasStasSymbol: false,
      suggestedMode: "manual" as const,
      confidence: "possible-clue" as const,
      reasons: ["找到 AWAC，但缺少 RTC/STAS 组合线索。"],
      warnings: ["只检查字节令牌。"],
    };
    const manifest = createEfiManifest(
      sampleHardware,
      "14",
      compatibility,
      createBuildPlan(sampleHardware, compatibility, {
        intelClockMode: "manual",
        intelClockEvidence,
      }),
    );

    expect(manifest?.intelClockMode).toBe("manual");
    expect(manifest?.intelClockEvidence).toEqual(intelClockEvidence);
    expect(manifest?.autoConfigSupported).toBe(false);
    expect(manifest?.acpi).not.toContain("SSDT-AWAC.aml");
    expect(manifest?.notes.join(" ")).toContain("DSDT 静态证据 aaaaaaaaaaaa…");
    expect(manifest?.checks.find((check) => check.id === "acpi.clock-evidence")?.status).toBe(
      "warning",
    );
    expect(manifest?.components.map((component) => component.id)).not.toContain(
      "dortania-ssdt-awac",
    );
  });

  it("locks USBToolBox only when the user selects a custom UTBMap", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const manifest = createEfiManifest(
      sampleHardware,
      "14",
      compatibility,
      createBuildPlan(sampleHardware, compatibility, { customUsbMapIncluded: true }),
    );

    expect(manifest?.components.map((component) => component.id)).toContain("usb-tool-box");
    expect(manifest?.notes.join(" ")).toContain("codeless UTBMap.kext");
  });

  it("fails the component gate when a planned file is absent from the lock", () => {
    const compatibility = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, compatibility);
    expect(plan).not.toBeNull();

    const manifest = createEfiManifest(sampleHardware, "14", compatibility, {
      ...plan!,
      components: [...plan!.components, "MissingFromLock.kext"],
    });

    const componentGate = manifest?.checks.find(
      (check) => check.id === "components.sha256-locked",
    );
    expect(componentGate?.status).toBe("failed");
    expect(componentGate?.detail).toContain("MissingFromLock.kext");
  });

  it("binds manifests to the OEM machine type and BIOS date", () => {
    const firstHardware = {
      ...sampleHardware,
      system: { ...sampleHardware.system, machineType: "20L5" },
      board: { ...sampleHardware.board, biosDate: "2025-01-01" },
    };
    const secondHardware = {
      ...firstHardware,
      system: { ...firstHardware.system, machineType: "20L6" },
      board: { ...firstHardware.board, biosDate: "2025-02-01" },
    };
    const firstCompatibility = evaluateCompatibility(firstHardware, "14", compatibilityRules);
    const secondCompatibility = evaluateCompatibility(secondHardware, "14", compatibilityRules);
    const first = createEfiManifest(
      firstHardware,
      "14",
      firstCompatibility,
      createBuildPlan(firstHardware, firstCompatibility),
    );
    const second = createEfiManifest(
      secondHardware,
      "14",
      secondCompatibility,
      createBuildPlan(secondHardware, secondCompatibility),
    );

    expect(first?.hardwareKey).not.toBe(second?.hardwareKey);
    expect(first?.hardwareKey).toMatch(/^hardware-fingerprint-v2:[0-9a-f]{64}$/);
    expect(second?.hardwareKey).toMatch(/^hardware-fingerprint-v2:[0-9a-f]{64}$/);
  });

  it.each(hardwareFixtures)("keeps every fixture build plan fully covered: $id", ({ report }) => {
    const compatibility = evaluateCompatibility(report, "14", compatibilityRules);
    const manifest = createEfiManifest(
      report,
      "14",
      compatibility,
      createBuildPlan(report, compatibility),
    );

    expect(manifest?.checks.find(
      (check) => check.id === "components.sha256-locked",
    )?.status).toBe("passed");
  });
});
