import { describe, expect, it } from "vitest";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { parseHardwareReport } from "../report/hardwareReport";
import { hardwareFixtures } from "./hardwareFixtures";
import { compatibilityRules } from "./rules";

describe("hardware fixture lab", () => {
  it.each(hardwareFixtures)("$label follows its expected safety decision", (fixture) => {
    const normalized = parseHardwareReport(fixture.report);
    const result = evaluateCompatibility(normalized, "14", compatibilityRules);

    expect(result.canContinue).toBe(true);
    expect(result.status).toBe(fixture.expectedStatus);
  });
});
