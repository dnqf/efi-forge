import { describe, expect, it } from "vitest";
import type { CommunityEfiProfile } from "../domain/types";
import { validateCommunityRegistry } from "./validateCommunityRegistry";

const completeProfile: CommunityEfiProfile = {
  id: "vendor-model-profile",
  title: "Audited profile",
  status: "verified",
  source: {
    repository: "https://github.com/example/audited-efi",
    revision: "0123456789abcdef0123456789abcdef01234567",
    license: "MIT",
  },
  machine: {
    kind: "laptop",
    manufacturerIncludes: ["Example"],
    modelIncludes: ["Model 14 2020"],
    cpuGenerations: ["comet-lake"],
    biosVersions: ["1.12", "1.13"],
    requiredPciIds: ["8086:9bc4"],
    requiredAcpiFeatures: ["PNP0C09", "PNP0C0A"],
  },
  compatibleMacOS: ["14"],
  openCoreVersion: "1.0.7",
  lastVerified: "2026-08-25",
  knownIssues: ["睡眠尚未验证"],
  audit: {
    identitySanitized: true,
    unknownExecutablesRejected: true,
    officialBinariesReplaced: true,
    reviewedAt: "2026-08-25",
  },
};

describe("community profile admission", () => {
  it("accepts only a fixed, licensed and fully audited verified entry", () => {
    expect(validateCommunityRegistry([completeProfile])).toEqual([]);
  });

  it("rejects a moving revision and incomplete safety gates", () => {
    const invalid = {
      ...completeProfile,
      source: { ...completeProfile.source, revision: "main" },
      audit: { ...completeProfile.audit, officialBinariesReplaced: false },
    };
    expect(validateCommunityRegistry([invalid]).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "社区来源必须固定到 40 位 commit SHA。",
        "verified 条目没有完成全部安全审核门。",
      ]),
    );
  });
});
