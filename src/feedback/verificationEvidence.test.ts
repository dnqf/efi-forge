import { describe, expect, it } from "vitest";
import {
  createVerificationEvidence,
  initializeVerificationObservations,
  mayPromoteVerification,
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
  observations: initializeVerificationObservations({ bootPicker: "passed", recovery: "passed" }),
  notes: ["进入 Recovery"],
};

describe("real-machine verification evidence", () => {
  it("initializes only explicit observations and leaves all other checks untested", () => {
    expect(Object.values(initializeVerificationObservations())).toEqual(Array(9).fill("not-tested"));
    expect(initializeVerificationObservations({ bootPicker: "failed" }).bootPicker).toBe("failed");
  });

  it("rejects numeric OS values rather than storing an invalid type", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, targetMacOS: 14 })).toThrow("目标 macOS 无效");
  });

  it("rejects unsupported historical schemas and invalid observation values", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, schemaVersion: 0 })).toThrow(
      "不支持的验证证据版本",
    );
    expect(() => parseVerificationEvidence({
      ...rawEvidence,
      observations: { ...rawEvidence.observations, recovery: "assumed-passed" },
    })).toThrow("验证观察项 recovery 无效");
  });

  it("does not call desktop entry alone post-install functional verification", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, stage: "post-install-verified",
      observations: { ...rawEvidence.observations, installer: "passed", desktop: "passed" } })).toThrow("必要观察项");
  });
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
    expect(mayPromoteVerification(evidence, { ...binding, configSha256: "b".repeat(64) })).toBe(false);
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

  it("rejects contradictory failed evidence without a failed observation", () => {
    expect(() => parseVerificationEvidence({
      ...rawEvidence,
      result: "failed",
      observations: initializeVerificationObservations(),
    })).toThrow("至少一个失败观察项");
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
      initializeVerificationObservations({
        bootPicker: "passed", recovery: "passed", installer: "passed", desktop: "passed",
        graphics: "passed", network: "passed", audio: "passed", usb: "passed", sleep: "passed",
      }),
      ["桌面与图形输出正常"],
      "2026-08-26T13:00:00+08:00",
    );

    expect(serializeVerificationEvidence(evidence)).toBe(
      serializeVerificationEvidence(parseVerificationEvidence(evidence)),
    );
    expect(serializeVerificationEvidence(evidence)).not.toMatch(/serial|systemuuid|mlb|rom/i);
  });

  it("revalidates evidence before serializing it", () => {
    const malformed = {
      ...parseVerificationEvidence(rawEvidence),
      configSha256: "tampered-after-parse",
    };

    expect(() => serializeVerificationEvidence(malformed)).toThrow("config SHA-256 格式无效");
  });

  it("revalidates parsed evidence at the promotion boundary", () => {
    const evidence = {
      ...parseVerificationEvidence(rawEvidence),
      observations: { ...rawEvidence.observations, recovery: "not-tested" as const },
    };
    const binding = {
      hardwareKey: "exact-machine-key",
      biosVersion: "1621",
      targetMacOS: "14" as const,
      openCoreVersion: "1.0.7",
      configSha256: "a".repeat(64),
    };

    expect(mayPromoteVerification(evidence, binding)).toBe(false);
    expect(mayPromoteVerification({ ...evidence, targetMacOS: 14 }, binding)).toBe(false);
  });

  it("rejects oversized notes and obviously future observations", () => {
    expect(() => parseVerificationEvidence({ ...rawEvidence, notes: ["x".repeat(501)] })).toThrow(
      "过长",
    );
    expect(() => parseVerificationEvidence({ ...rawEvidence, observedAt: "2999-01-01T00:00:00Z" })).toThrow(
      "观察时间",
    );
  });

  it("accepts evidence explicitly bound to the macOS Tahoe manual target", () => {
    const evidence = parseVerificationEvidence({ ...rawEvidence, targetMacOS: "26" });

    expect(evidence.targetMacOS).toBe("26");
  });
});
