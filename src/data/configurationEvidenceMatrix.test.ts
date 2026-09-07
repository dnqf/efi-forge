import { describe, expect, it } from "vitest";
import { createHardwareFingerprint } from "../build/createEfiManifest";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { parseHardwareReport } from "../report/hardwareReport";
import { assessThinkPad } from "../thinkpad/assessThinkPad";
import { createVerificationEvidence, initializeVerificationObservations, verifyEvidenceBinding } from "../feedback/verificationEvidence";
import { compatibilityRules } from "./rules";
import { configurationEvidenceMatrix } from "./configurationEvidenceMatrix";
import { createComponentSelections } from "../components/componentSelections";
import type { ComponentItem } from "../native/efiBuilder";

describe("synthetic configuration evidence matrix", () => {
  it("contains positive, missing, and near-negative inputs for all twelve planned scenarios", () => {
    expect(new Set(configurationEvidenceMatrix.map((item) => item.scenario)).size).toBe(12);
    expect(configurationEvidenceMatrix).toHaveLength(36);
    for (const scenario of new Set(configurationEvidenceMatrix.map((item) => item.scenario))) {
      expect(configurationEvidenceMatrix.filter((item) => item.scenario === scenario).map((item) => item.variant).sort())
        .toEqual(["missing", "near-negative", "positive"]);
    }
    expect(configurationEvidenceMatrix.every((item) => item.source === "synthetic")).toBe(true);
  });

  it.each(configurationEvidenceMatrix)("executes $id and enforces its expected contract", ({ id, report, expected }) => {
    const parsed = parseHardwareReport(report);
    const compatibility = evaluateCompatibility(parsed, "14", compatibilityRules);
    const plan = createBuildPlan(parsed, compatibility);
    const matched = compatibility.findings.map((finding) => finding.ruleId);
    expect(compatibility.canContinue, id).toBe(expected.canContinue);
    expect(plan?.autoConfigSupported, id).toBe(expected.autoConfig);
    for (const ruleId of expected.requiredRuleIds ?? []) expect(matched, id).toContain(ruleId);
    for (const ruleId of expected.forbiddenRuleIds ?? []) expect(matched, id).not.toContain(ruleId);
    for (const arg of expected.requiredBootArgs ?? []) expect(plan?.bootArgs, id).toContain(arg);
    for (const arg of expected.forbiddenBootArgs ?? []) expect(plan?.bootArgs, id).not.toContain(arg);
    for (const note of expected.requiredNotes ?? []) {
      expect(plan?.notes.some((value) => value.includes(note)), id).toBe(true);
    }
  });

  it("keeps user-provided device identities as notes without automatic side effects", () => {
    const item = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.user-component-or-efi-source.positive")!;
    const plan = createBuildPlan(item.report, evaluateCompatibility(item.report, "14", compatibilityRules));
    expect(plan?.notes.some((note) => note.includes("user-provided"))).toBe(true);
    expect(plan?.bootArgs).not.toContain("e1000=0");
  });

  it("does not turn an unknown ThinkPad machine type into a reviewed profile", () => {
    const item = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.thinkpad-family-and-machine-type.positive")!;
    const assessment = assessThinkPad(item.report, "14");
    expect(assessment?.match).not.toBe("machine-type");
    expect(assessment?.tier).toBe("research-only");
  });

  it("changes verification binding material when the report changes", () => {
    const positive = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.verification-binding-after-config-change.positive")!;
    const missing = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.verification-binding-after-config-change.missing")!;
    expect(createHardwareFingerprint(positive.report)).not.toBe(createHardwareFingerprint(missing.report));
  });

  it("rejects old verification evidence after config.plist content changes", () => {
    const first = { hardwareKey: "hardware", biosVersion: "1.0", targetMacOS: "14" as const, openCoreVersion: "1.0.5", configSha256: "a".repeat(64) };
    const evidence = createVerificationEvidence(first, "boot-tested", "passed", initializeVerificationObservations({ bootPicker: "passed" }), [], "2026-09-07T00:00:00.000Z");
    const changed = { ...first, configSha256: "b".repeat(64) };
    expect(verifyEvidenceBinding(evidence, changed)).toContain("config.plist 哈希不一致");
  });

  it("covers T/E/L/P/X ThinkPad family clues without treating them as machine-type evidence", () => {
    for (const family of ["T", "E", "L", "P", "X"]) {
      const base = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.thinkpad-family-and-machine-type.positive")!.report;
      const report = { ...base, system: { ...base.system, productName: `ThinkPad ${family}999`, machineType: "ZZZZ" } };
      expect(assessThinkPad(report, "14")?.match, family).not.toBe("machine-type");
    }
  });

  it("keeps VMD and multiple disks informational without encoding BIOS or partition writes", () => {
    const item = configurationEvidenceMatrix.find((entry) => entry.id === "matrix.sata-nvme-vmd-mode.positive")!;
    const plan = createBuildPlan(item.report, evaluateCompatibility(item.report, "14", compatibilityRules))!;
    expect(plan.notes.some((note) => note.includes("不会自动更改 BIOS"))).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/format|partition|分区写入/i);
  });

  it("requires an explicit decision for a user component instead of enabling it from hardware clues", () => {
    const component: ComponentItem = {
      id: "synthetic-kext", name: "Synthetic.kext", kind: "kext", identity: "example.synthetic",
      sha256: "c".repeat(64), size: 1, sourcePath: "Synthetic.kext", targetPath: "EFI/OC/Kexts/Synthetic.kext",
      comparison: "new", baseEnabled: false, dependencies: [], configPreview: [], defaultAction: "add-inactive",
      allowedActions: ["add-inactive", "skip"], warnings: [],
    };
    expect(createComponentSelections([component], { "synthetic-kext": "skip" })).toEqual([
      { itemId: "synthetic-kext", action: "skip" },
    ]);
  });
});
