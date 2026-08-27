import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import { evaluateLegacyFeasibility } from "./evaluateLegacyFeasibility";

describe("old platform feasibility split", () => {
  it("keeps Legacy/OpenDuet isolated from the automatic UEFI path", () => {
    const hardware = {
      ...sampleHardware,
      system: { ...sampleHardware.system, firmware: "legacy" as const },
    };
    const result = evaluateLegacyFeasibility(hardware, "14");
    expect(result.level).toBe("legacy-experimental");
    expect(result.automaticPath).toBe(false);
    expect(result.choices.map((choice) => choice.id)).toEqual(["switch-to-uefi", "manual-openduet"]);
  });

  it("keeps an old UEFI CPU manual without blocking user-owned EFI", () => {
    const hardware = {
      ...sampleHardware,
      cpu: { ...sampleHardware.cpu, generation: "ivy-bridge", features: ["sse4.2"] },
    };
    const result = evaluateLegacyFeasibility(hardware, "13");
    expect(result.level).toBe("manual-uefi");
    expect(result.choices[0].id).toBe("manual-uefi-candidate");
  });

  it("stops automatic generation when reported instruction-set evidence is insufficient", () => {
    const hardware = {
      ...sampleHardware,
      cpu: { ...sampleHardware.cpu, generation: "sandy-bridge", features: ["sse2"] },
    };
    expect(evaluateLegacyFeasibility(hardware, "13").level).toBe("instruction-set-risk");
  });
});
