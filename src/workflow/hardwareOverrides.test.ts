import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import { compatibilityRules } from "../data/rules";
import { hasDirectPciIdentity } from "../engine/deviceIdentity";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { parseHardwareReport, serializeHardwareReport } from "../report/hardwareReport";
import {
  applyHardwareOverrides,
  emptyHardwareOverrideDraft,
  hasManualHardwareOverrides,
} from "./hardwareOverrides";

describe("manual hardware overrides", () => {
  it("keeps provenance and prevents user PCI values from becoming scan evidence", () => {
    const draft = emptyHardwareOverrideDraft();
    draft.productName = "User confirmed full model";
    draft.devicesJson.network = JSON.stringify([{ id: "manual-net", name: "Intel AX200", vendorId: "8086", deviceId: "2723" }]);
    const result = applyHardwareOverrides(sampleHardware, draft, "scanned");
    expect(result.provenance?.baseSource).toBe("scanned");
    expect(result.provenance?.manualFields).toEqual(["network", "system.productName"]);
    expect(result.network[0].identitySource).toBe("user-provided");
    expect(hasDirectPciIdentity(result.network[0])).toBe(false);
    expect(evaluateCompatibility(result, "14", compatibilityRules).findings)
      .not.toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleId: "network.intel.wireless-exact" }),
      ]));
    expect(hasManualHardwareOverrides(result)).toBe(true);
    expect(parseHardwareReport(JSON.parse(serializeHardwareReport(result)))).toEqual(result);
  });

  it("uses the trusted session source instead of an imported provenance claim", () => {
    const claimed = {
      ...sampleHardware,
      provenance: { baseSource: "scanned" as const, manualFields: ["board.model"] },
    };
    const draft = emptyHardwareOverrideDraft();
    draft.boardModel = "User board";
    expect(applyHardwareOverrides(claimed, draft, "imported").provenance?.baseSource).toBe("imported");
  });

  it("rejects invalid PCI IDs without mutating the base report", () => {
    const draft = emptyHardwareOverrideDraft();
    draft.devicesJson.gpus = JSON.stringify([{ id: "bad", name: "GPU", vendorId: "XYZ", deviceId: "1234" }]);
    expect(() => applyHardwareOverrides(sampleHardware, draft, "imported")).toThrow("gpus[0].vendorId");
    expect(sampleHardware.gpus[0].vendorId).toBe("8086");
  });

  it("rejects empty and malformed edits", () => {
    expect(() => applyHardwareOverrides(sampleHardware, emptyHardwareOverrideDraft(), "imported"))
      .toThrow("至少填写一项");
    const malformed = emptyHardwareOverrideDraft();
    malformed.devicesJson.storage = "not json";
    expect(() => applyHardwareOverrides(sampleHardware, malformed, "imported"))
      .toThrow("storage 必须是有效的 JSON");
  });
});
