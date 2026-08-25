import type {
  CommunityEfiProfile,
  CommunityProfileMatch,
  HardwareReport,
  MacOSVersion,
} from "../domain/types";

function includesAny(value: string, candidates: string[]): boolean {
  const normalized = value.toLowerCase();
  return candidates.some((candidate) => normalized.includes(candidate.toLowerCase()));
}

function allPciIds(report: HardwareReport): Set<string> {
  const devices = [...report.gpus, ...report.network, ...report.audio, ...report.storage];
  return new Set(
    devices.map((device) => `${device.vendorId}:${device.deviceId}`.toLowerCase()),
  );
}

export function resolveCommunityProfiles(
  report: HardwareReport,
  targetMacOS: MacOSVersion,
  profiles: CommunityEfiProfile[],
): CommunityProfileMatch[] {
  const manufacturer = report.system.manufacturer ?? report.board.vendor;
  const productName = report.system.productName ?? report.board.model;
  const pciIds = allPciIds(report);

  return profiles.map((profile) => {
    const baseMatches =
      profile.machine.kind === report.system.kind &&
      includesAny(manufacturer, profile.machine.manufacturerIncludes) &&
      includesAny(productName, profile.machine.modelIncludes) &&
      profile.machine.cpuGenerations.includes(report.cpu.generation) &&
      profile.compatibleMacOS.includes(targetMacOS);

    if (!baseMatches) {
      return { profile, status: "incompatible", reasons: ["机型、平台或目标系统不匹配。"] };
    }

    const reasons: string[] = [];
    const biosMatches =
      !profile.machine.biosVersions ||
      profile.machine.biosVersions.includes(report.board.biosVersion);
    if (!biosMatches) reasons.push("BIOS 版本不在该整包的验证范围。 ");

    const devicesMatch = (profile.machine.requiredPciIds ?? []).every((pciId) =>
      pciIds.has(pciId.toLowerCase()),
    );
    if (!devicesMatch) reasons.push("一个或多个关键 PCI 设备与整包记录不一致。 ");

    const canUseAutomatically =
      profile.status === "verified" && biosMatches && devicesMatch;

    if (profile.status !== "verified") reasons.push("该来源尚未通过项目维护者审核。 ");

    return {
      profile,
      status: canUseAutomatically ? "exact" : "close",
      reasons,
    };
  });
}

