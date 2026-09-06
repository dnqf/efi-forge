import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import type { CommunityEfiProfile } from "../domain/types";
import { resolveCommunityProfiles } from "./resolveCommunityProfiles";

const verifiedProfile: CommunityEfiProfile = {
  id: "asus-prime-z490-p-demo",
  title: "ASUS PRIME Z490-P verified overlay",
  status: "verified",
  source: {
    repository: "https://github.com/example/verified-profile",
    revision: "0123456789abcdef0123456789abcdef01234567",
    license: "MIT",
  },
  machine: {
    kind: "desktop",
    manufacturerIncludes: ["ASUSTeK"],
    modelIncludes: ["PRIME Z490-P"],
    cpuGenerations: ["comet-lake"],
    systemSkus: [],
    boardModels: ["PRIME Z490-P"],
    chipsets: ["Z490"],
    biosVersions: ["1621"],
    requiredPciIds: ["8086:9BC5", "8086:0D4D"],
    requiredAcpiFeatures: [],
  },
  compatibleMacOS: ["14"],
  openCoreVersion: "1.0.7",
  lastVerified: "2026-08-25",
  knownIssues: [],
  verification: {
    stage: "install-verified",
    configSha256: "b".repeat(64),
  },
  audit: {
    identitySanitized: true,
    unknownExecutablesRejected: true,
    officialBinariesReplaced: true,
    reviewedAt: "2026-08-25",
  },
};

describe("community EFI profile resolver", () => {
  it("rejects duplicate registry identities before matching", () => {
    expect(resolveCommunityProfiles(sampleHardware, "14", [verifiedProfile, verifiedProfile])
      .every((match) => match.status === "incompatible")).toBe(true);
  });

  it("does not accept inherited controller identity as required device evidence", () => {
    const hardware = { ...sampleHardware, gpus: [{ ...sampleHardware.gpus[0], identitySource: "parent-pci" as const }] };
    expect(resolveCommunityProfiles(hardware, "14", [verifiedProfile])[0].status).toBe("close");
  });

  it("rejects blank identity conditions", () => {
    const profile = { ...verifiedProfile, machine: { ...verifiedProfile.machine, modelIncludes: [" "] } };
    expect(resolveCommunityProfiles(sampleHardware, "14", [profile])[0].reasons.join(" ")).toContain("空白值");
  });
  it("keeps unobserved ACPI requirements as an uncertain candidate", () => {
    const profile = { ...verifiedProfile, machine: { ...verifiedProfile.machine, requiredAcpiFeatures: ["PNP0C09"] } };
    expect(resolveCommunityProfiles(sampleHardware, "14", [profile])[0].status).toBe("close");
  });

  it("does not call a similarly named motherboard an exact match", () => {
    const hardware = { ...sampleHardware, board: { ...sampleHardware.board, model: "PRIME Z490-PRO" } };
    expect(resolveCommunityProfiles(hardware, "14", [verifiedProfile])[0].status).not.toBe("exact");
  });
  it("allows only a verified exact machine match", () => {
    const [match] = resolveCommunityProfiles(sampleHardware, "14", [verifiedProfile]);

    expect(match.status).toBe("exact");
    expect(match.reasons).toEqual([]);
  });

  it("keeps an otherwise matching profile manual when BIOS differs", () => {
    const hardware = {
      ...sampleHardware,
      board: { ...sampleHardware.board, biosVersion: "9999" },
    };
    const [match] = resolveCommunityProfiles(hardware, "14", [verifiedProfile]);

    expect(match.status).toBe("close");
    expect(match.reasons).toContain("BIOS 版本不在该整包的验证范围。 ");
  });

  it("does not match a different target macOS", () => {
    const [match] = resolveCommunityProfiles(sampleHardware, "15", [verifiedProfile]);

    expect(match.status).toBe("incompatible");
  });
});
