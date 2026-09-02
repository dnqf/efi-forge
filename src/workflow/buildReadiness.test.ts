import { describe, expect, it } from "vitest";
import { compatibilityRules } from "../data/rules";
import { hardwareFixtures } from "../data/hardwareFixtures";
import { sampleHardware } from "../data/sampleHardware";
import type { HardwareReport } from "../domain/types";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { assessBuildReadiness } from "./buildReadiness";

function readinessFor(hardware: HardwareReport) {
  const report = evaluateCompatibility(hardware, "14", compatibilityRules);
  const plan = createBuildPlan(hardware, report);
  return assessBuildReadiness(hardware, report, plan);
}

describe("build readiness", () => {
  it("separates an reviewed automatic candidate from user-controlled alternatives", () => {
    const readiness = readinessFor(sampleHardware);

    expect(readiness.mode).toBe("auto-candidate");
    expect(readiness.canContinue).toBe(true);
    expect(readiness.routes.map((route) => [route.id, route.status])).toEqual([
      ["project-candidate", "ready"],
      ["user-efi", "available"],
      ["component-merge", "available"],
    ]);
  });

  it("keeps a ThinkPad without an automatic template on the manual component route", () => {
    const hardware = hardwareFixtures.find((fixture) => fixture.id === "thinkpad-t480-20l5")!.report;
    const readiness = readinessFor(hardware);

    expect(readiness.mode).toBe("manual-components");
    expect(readiness.canContinue).toBe(true);
    expect(readiness.routes[0]).toMatchObject({
      id: "project-candidate",
      status: "manual",
    });
    expect(readiness.routes.some((route) => route.id === "user-efi")).toBe(true);
  });

  it("turns incomplete old or mixed hardware evidence into warnings instead of a gate", () => {
    const incomplete: HardwareReport = {
      ...sampleHardware,
      system: {
        ...sampleHardware.system,
        manufacturer: undefined,
        productName: undefined,
      },
      board: {
        vendor: "Unknown",
        model: "Unknown",
        biosVersion: "",
      },
      gpus: [],
      network: [],
      audio: [],
      storage: [],
    };
    const readiness = readinessFor(incomplete);

    expect(readiness.canContinue).toBe(true);
    expect(readiness.evidenceGaps.map((gap) => gap.id)).toEqual(expect.arrayContaining([
      "system-model",
      "board-model",
      "bios-version",
      "bios-date",
      "gpu-empty",
      "network-empty",
      "audio-empty",
      "storage-empty",
    ]));
  });

  it("reports high-risk findings without presenting them as a hard software stop", () => {
    const hardware = hardwareFixtures.find((fixture) => fixture.id === "blocked-nvidia-pm981")!.report;
    const readiness = readinessFor(hardware);

    expect(readiness.riskSummary.highRisk).toBeGreaterThan(0);
    expect(readiness.canContinue).toBe(true);
    expect(readiness.notice).toContain("不等于");
  });

  it("uses a hard stop only for a software integrity failure", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, report);
    const readiness = assessBuildReadiness(sampleHardware, report, plan, {
      softwareIntegrityFailure: true,
    });

    expect(readiness.canContinue).toBe(false);
    expect(readiness.blockingReason).toContain("结构或完整性");
    expect(readiness.routes.every((route) => route.status === "blocked")).toBe(true);
  });
});
