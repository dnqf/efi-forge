import type {
  BuildPlan,
  CompatibilityReport,
  HardwareReport,
  HardwareReportSource,
  MacOSVersion,
} from "../domain/types";
import type { EfiValidationResult } from "../native/efiBuilder";
import { assessBuildReadiness } from "./buildReadiness";
import { summarizeCompatibility } from "./userJourney";

export type HandoffEfiSource = "generated" | "custom" | "merged" | "component-merged";

export interface EfiHandoffSummary {
  schemaVersion: 1;
  appVersion: string;
  reportCapturedAt: string;
  reportSource: HardwareReportSource;
  targetMacOS: MacOSVersion;
  hardware: {
    kind: HardwareReport["system"]["kind"];
    manufacturer: string;
    productName: string;
    machineType?: string;
    board: string;
    biosVersion: string;
    cpu: string;
  };
  compatibility: {
    confidence: CompatibilityReport["confidence"];
    ruleCoverage: number;
    attention: number;
    highRisk: number;
    unknown: number;
    evidenceGaps: Array<{ label: string; nextAction: string }>;
  };
  candidate: {
    profile: string;
    autoConfigSupported: boolean;
    smbiosModel: string;
  };
  efi: {
    source: HandoffEfiSource;
    validationLevel: EfiValidationResult["validationLevel"];
    configSha256: string | null;
    readyForSafeCopy: boolean;
  };
  boundaries: string[];
}

interface CreateHandoffSummaryInput {
  appVersion: string;
  hardware: HardwareReport;
  report: CompatibilityReport;
  reportSource: HardwareReportSource;
  targetMacOS: MacOSVersion;
  plan: BuildPlan;
  efiSource: HandoffEfiSource;
  validation: EfiValidationResult;
}

export function createHandoffSummary(input: CreateHandoffSummaryInput): EfiHandoffSummary {
  const digest = summarizeCompatibility(input.report.findings);
  const readiness = assessBuildReadiness(input.hardware, input.report, input.plan);
  return {
    schemaVersion: 1,
    appVersion: input.appVersion,
    reportCapturedAt: input.hardware.capturedAt,
    reportSource: input.reportSource,
    targetMacOS: input.targetMacOS,
    hardware: {
      kind: input.hardware.system.kind,
      manufacturer: input.hardware.system.manufacturer ?? "unknown",
      productName: input.hardware.system.productName ?? "unknown",
      machineType: input.hardware.system.machineType,
      board: `${input.hardware.board.vendor} ${input.hardware.board.model}`.trim(),
      biosVersion: input.hardware.board.biosVersion || "unknown",
      cpu: input.hardware.cpu.name,
    },
    compatibility: {
      confidence: input.report.confidence,
      ruleCoverage: input.report.coverage,
      attention: digest.attention,
      highRisk: digest.highRisk,
      unknown: digest.unknown,
      evidenceGaps: readiness.evidenceGaps.map(({ label, nextAction }) => ({ label, nextAction })),
    },
    candidate: {
      profile: input.plan.profile,
      autoConfigSupported: input.plan.autoConfigSupported,
      smbiosModel: input.plan.smbiosModel,
    },
    efi: {
      source: input.efiSource,
      validationLevel: input.validation.validationLevel,
      configSha256: input.validation.configSha256,
      readyForSafeCopy: input.validation.valid,
    },
    boundaries: [
      "规则识别度不是安装成功率。",
      "结构检查或 ocvalidate 通过不等于真机可启动。",
      "请先从独立 U 盘测试 OpenCore Picker 与 Recovery。",
      "此摘要不包含本机文件路径、序列号或网络凭据。",
    ],
  };
}

export function serializeHandoffSummary(summary: EfiHandoffSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}
