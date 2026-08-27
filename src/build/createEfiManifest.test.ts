import { describe, expect, it } from "vitest";
import { createEfiManifest, serializeEfiManifest } from "./createEfiManifest";
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
    expect(first?.hardwareKey).toContain("12341043");
    expect(first?.hardwareKey).toContain("direct-pci");
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
    expect(manifest?.components.map((component) => component.id)).toEqual(
      expect.arrayContaining([
        "dortania-ssdt-plug-drtnia",
        "dortania-ssdt-ec-usbx-desktop",
        "dortania-ssdt-awac",
        "dortania-ssdt-rhub",
      ]),
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
    expect(first?.hardwareKey).toContain("20l5");
    expect(first?.hardwareKey).toContain("2025-01-01");
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
