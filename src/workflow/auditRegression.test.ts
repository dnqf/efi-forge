import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import { compatibilityRules } from "../data/rules";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { createBuildPlan } from "../engine/createBuildPlan";
import { createHardwareFingerprint } from "../build/createEfiManifest";
import { initializeVerificationObservations } from "../feedback/verificationEvidence";

describe("cross-layer audit regressions", () => {
  it("keeps instruction-set risks manual without blocking user continuation", () => {
    const hardware = { ...sampleHardware, cpu: { ...sampleHardware.cpu, features: ["sse2"] } };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    expect(report.canContinue).toBe(true);
    expect(report.feasibility.automaticPath).toBe(false);
    expect(createBuildPlan(hardware, report)?.autoConfigSupported).toBe(false);
  });

  it("does not select desktop-specific firmware for AMD laptops", () => {
    const hardware = { ...sampleHardware, system: { ...sampleHardware.system, kind: "laptop" as const },
      cpu: { ...sampleHardware.cpu, vendor: "amd" as const, generation: "zen-3" } };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));
    expect(plan?.platform).toBe("unknown");
    expect(plan?.acpi).toEqual([]);
    expect(plan?.components).not.toContain("AppleMCEReporterDisabler.kext");
    expect(plan?.setupVirtualMap).toBeUndefined();
  });

  it("does not use a parent PCI controller as a desktop GPU", () => {
    const hardware = { ...sampleHardware, gpus: [{ ...sampleHardware.gpus[0], identitySource: "parent-pci" as const }] };
    const report = evaluateCompatibility(hardware, "14", compatibilityRules);
    expect(report.findings.some((finding) => finding.category === "gpu" && finding.status === "supported")).toBe(false);
    expect(createBuildPlan(hardware, report)?.igpuPlatformId).toBeUndefined();
    expect(createHardwareFingerprint(hardware)).not.toBe(createHardwareFingerprint(sampleHardware));
  });

  it("distinguishes absent hardware identity from a literal unknown value", () => {
    const absent = { ...sampleHardware, system: { ...sampleHardware.system, manufacturer: undefined } };
    const literal = { ...sampleHardware, system: { ...sampleHardware.system, manufacturer: "unknown" } };
    expect(createHardwareFingerprint(absent)).not.toBe(createHardwareFingerprint(literal));
  });
  it("keeps device identity and configuration stable across driver display names", () => {
    const renamed = { ...sampleHardware, gpus: [{ ...sampleHardware.gpus[0], name: "Microsoft Basic Display Adapter" }] };
    const first = createBuildPlan(sampleHardware, evaluateCompatibility(sampleHardware, "14", compatibilityRules));
    const second = createBuildPlan(renamed, evaluateCompatibility(renamed, "14", compatibilityRules));
    expect(createHardwareFingerprint(renamed)).toBe(createHardwareFingerprint(sampleHardware));
    expect(second?.igpuPlatformId).toBe(first?.igpuPlatformId);
    expect(second?.components).toEqual(first?.components);
  });

  it("does not confuse delimiter-containing identity fields", () => {
    const first = { ...sampleHardware, system: { ...sampleHardware.system, manufacturer: "Vendor|Model", productName: "Variant" } };
    const second = { ...sampleHardware, system: { ...sampleHardware.system, manufacturer: "Vendor", productName: "Model|Variant" } };
    expect(createHardwareFingerprint(first)).not.toBe(createHardwareFingerprint(second));
  });

  it("does not select desktop ACPI for a laptop", () => {
    const hardware = { ...sampleHardware, system: { ...sampleHardware.system, kind: "laptop" as const } };
    const plan = createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));
    expect(plan?.autoConfigSupported).toBe(false);
    expect(plan?.acpi).toEqual([]);
    expect(plan?.igpuPlatformId).toBeUndefined();
  });

  it("requires explicit observations instead of manufacturing successful milestones", () => {
    expect(Object.values(initializeVerificationObservations())).toEqual(Array(9).fill("not-tested"));
  });
});
