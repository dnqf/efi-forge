import type { CommunityEfiProfile } from "../domain/types";

export interface CommunityRegistryIssue {
  profileId: string;
  message: string;
}

function isCalendarDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function validateCommunityRegistry(
  profiles: CommunityEfiProfile[],
): CommunityRegistryIssue[] {
  const issues: CommunityRegistryIssue[] = [];
  const ids = new Set<string>();

  for (const profile of profiles) {
    if (ids.has(profile.id)) issues.push({ profileId: profile.id, message: "社区条目 ID 重复。" });
    ids.add(profile.id);
    if (!/^https:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/?$/i.test(profile.source.repository)) {
      issues.push({ profileId: profile.id, message: "社区来源必须是可审计的 GitHub HTTPS 仓库。" });
    }
    if (!/^[0-9a-f]{40}$/i.test(profile.source.revision)) {
      issues.push({ profileId: profile.id, message: "社区来源必须固定到 40 位 commit SHA。" });
    }
    if (!profile.source.license.trim() || profile.source.license.toLowerCase() === "not-declared") {
      issues.push({ profileId: profile.id, message: "社区来源没有许可证记录。" });
    }
    if (
      profile.machine.manufacturerIncludes.length === 0 ||
      profile.machine.modelIncludes.length === 0 ||
      profile.machine.cpuGenerations.length === 0 ||
      profile.machine.boardModels.length === 0 ||
      profile.machine.chipsets.length === 0
    ) {
      issues.push({ profileId: profile.id, message: "缺少厂商、完整型号或 CPU 代际范围。" });
    }
    if (!profile.machine.biosVersions?.length) {
      issues.push({ profileId: profile.id, message: "没有声明经过验证的 BIOS 范围。" });
    }
    if (!profile.machine.requiredPciIds?.length) {
      issues.push({ profileId: profile.id, message: "审核配置至少需要一个精确 PCI 身份。" });
    } else if (profile.machine.requiredPciIds.some((id) => !/^[0-9a-f]{4}:[0-9a-f]{4}$/i.test(id))) {
      issues.push({ profileId: profile.id, message: "审核配置的 PCI 身份必须是 VVVV:DDDD。" });
    }
    if (!/^\d+\.\d+\.\d+$/.test(profile.openCoreVersion)) {
      issues.push({ profileId: profile.id, message: "OpenCore 版本必须是固定的三段版本号。" });
    }
    if (!isCalendarDate(profile.lastVerified)) {
      issues.push({ profileId: profile.id, message: "最后验证日期格式无效。" });
    }
    if (!/^[0-9a-f]{64}$/i.test(profile.verification.configSha256)) {
      issues.push({ profileId: profile.id, message: "审核配置必须记录 64 位 config.plist SHA-256。" });
    }
    if (!isCalendarDate(profile.audit.reviewedAt)) {
      issues.push({ profileId: profile.id, message: "安全审核日期格式无效。" });
    }
    if (profile.status === "verified") {
      const audit = profile.audit;
      if (
        !audit.identitySanitized ||
        !audit.unknownExecutablesRejected ||
        !audit.officialBinariesReplaced
      ) {
        issues.push({ profileId: profile.id, message: "verified 条目没有完成全部安全审核门。" });
      }
      if (!(["install-verified", "post-install-verified"] as const).includes(
        profile.verification.stage as "install-verified" | "post-install-verified",
      )) {
        issues.push({ profileId: profile.id, message: "verified 条目必须达到安装验证或安装后验证阶段。" });
      }
    }
  }

  return issues;
}
