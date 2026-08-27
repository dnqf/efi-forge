import { describe, expect, it } from "vitest";
import {
  createVerificationEvidence,
  mayPromoteVerification,
  observationsForStage,
  parseVerificationEvidence,
  serializeVerificationEvidence,
  verifyEvidenceBinding,
} from "./verificationEvidence";

const rawEvidence = {
  schemaVersion: 1,
  stage: "recovery-tested",
  result: "passed",
  hardwareKey: "exact-machine-key",
  biosVersion: "1621",
  targetMacOS: "14",
  openCoreVersion: "1.0.7",
  configSha256: "a".repeat(64),
  observedAt: "2026-08-26T12:00:00+08:00",
  observations: observationsForStage("recovery-tested", "passed"),
  notes: ["进入 Recovery"],
};

describe("real-machine verification evidence", () => {
  it("promotes only evidence bound to the exact hardware, BIOS, OS, OpenCore and config", () => {
    const evidence = parseVerificationEvidence(rawEvidence);
    const binding = {
      hardwareKey: "exact-machine-key",
      biosVersion: "1621",
      targetMacOS: "14" as const,
      openCoreVersion: "1.0.7",
      configSha256: "a".repeat(64),
    };
    expect(verifyEvidenceBinding(evidence, binding)).toEqual([]);
    expect(mayPromoteVerification(evidence, binding)).toBe(true);
    expect(mayPromoteVerification(evidence, { ...binding, biosVersion: "1622" })).toBe(false);
  });

  it("rejects candidate claims and malformed config hashes", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, stage: "candidate" })).toThrow(
      "验证阶段无效",
    );
    expect(() => parseVerificationEvidence({ ...rawEvidence, configSha256: "unknown" })).toThrow(
      "config SHA-256 格式无效",
    );
  });

  it("rejects a passed stage when its milestone observations are missing", () => {
    expect(() => parseVerificationEvidence({
      ...rawEvidence,
      observations: { ...rawEvidence.observations, recovery: "not-tested" },
    })).toThrow("必要观察项");
  });

  it("creates deterministic, bounded evidence without identity fields", () => {
    const binding = {
      hardwareKey: "exact-machine-key",
      biosVersion: "1621",
      targetMacOS: "14" as const,
      openCoreVersion: "1.0.7",
      configSha256: "b".repeat(64),
    };
    const evidence = createVerificationEvidence(
      binding,
      "post-install-verified",
      "passed",
      observationsForStage("post-install-verified", "passed", { graphics: "passed" }),
      ["桌面与图形输出正常"],
      "2026-08-26T13:00:00+08:00",
    );

    expect(serializeVerificationEvidence(evidence)).toBe(
      serializeVerificationEvidence(parseVerificationEvidence(evidence)),
    );
    expect(serializeVerificationEvidence(evidence)).not.toMatch(/serial|systemuuid|mlb|rom/i);
  });

  it("rejects oversized notes and obviously future observations", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, notes: ["x".repeat(501)] })).toThrow(
      "过长",
    );
    expect(() => parseVerificationEvidence({ ...rawEvidence, observedAt: "2999-01-01T00:00:00Z" })).toThrow(
      "观察时间",
    );
  });
});
