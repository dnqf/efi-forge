import { describe, expect, it } from "vitest";
import { compatibilityRules } from "../data/rules";
import { sampleHardware } from "../data/sampleHardware";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { applyHardwareOverrides, emptyHardwareOverrideDraft } from "./hardwareOverrides";

function planFor(hardware: typeof sampleHardware) {
  return createBuildPlan(hardware, evaluateCompatibility(hardware, "14", compatibilityRules));
}

describe("hardware provenance automation policy", () => {
  it.each([
    ["intel", "comet-lake", "Z490"],
    ["amd", "zen-3", "B550"],
  ] as const)("does not promote an unknown %s board from a manual %s chipset", (vendor, generation, chipset) => {
    const base = {
      ...sampleHardware,
      cpu: { ...sampleHardware.cpu, vendor, generation },
      board: { ...sampleHardware.board, model: "Unknown board" },
    };
    const draft = emptyHardwareOverrideDraft();
    draft.boardModel = `${chipset} user claim`;
    const manual = applyHardwareOverrides(base, draft, "scanned");
    expect(planFor(manual)?.chipset).toBe("unknown");
    expect(planFor(manual)?.autoConfigSupported).toBe(false);
  });

  it("does not apply vendor, I225, NVMe, or GPU automation from user-provided fields", () => {
    const draft = emptyHardwareOverrideDraft();
    draft.boardVendor = "ASUS user claim";
    draft.devicesJson.network = JSON.stringify([
      { id: "manual-i225", name: "Intel I225 Ethernet", vendorId: "8086", deviceId: "15F3" },
    ]);
    draft.devicesJson.storage = JSON.stringify([
      { id: "manual-nvme", name: "User NVMe", vendorId: "1234", deviceId: "5678" },
    ]);
    draft.devicesJson.gpus = JSON.stringify([
      { id: "manual-gpu", name: "Intel UHD Graphics 630", vendorId: "8086", deviceId: "9BC5" },
    ]);
    const plan = planFor(applyHardwareOverrides(sampleHardware, draft, "scanned"))!;
    expect(plan.acpi).not.toContain("SSDT-RHUB.aml");
    expect(plan.bootArgs).not.toContain("e1000=0");
    expect(plan.components).not.toContain("NVMeFix.kext");
    expect(plan.igpuPlatformId).toBeUndefined();
    expect(plan.notes.join(" ")).toContain("user-provided");
  });

  it("restoring the scanned base keeps its existing automatic path", () => {
    const draft = emptyHardwareOverrideDraft();
    draft.boardModel = "Unknown manual board";
    expect(planFor(applyHardwareOverrides(sampleHardware, draft, "scanned"))?.autoConfigSupported).toBe(false);
    expect(planFor(sampleHardware)?.autoConfigSupported).toBe(true);
    expect(planFor(sampleHardware)?.chipset).toBe("Z490");
  });
});
