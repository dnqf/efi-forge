import type {
  MacOSVersion,
  VerificationStage,
} from "../domain/types";

export type CompletedVerificationStage = Exclude<VerificationStage, "candidate">;
export type VerificationObservation = "passed" | "failed" | "not-tested";

export interface VerificationObservations {
  bootPicker: VerificationObservation;
  recovery: VerificationObservation;
  installer: VerificationObservation;
  desktop: VerificationObservation;
  graphics: VerificationObservation;
  network: VerificationObservation;
  audio: VerificationObservation;
  usb: VerificationObservation;
  sleep: VerificationObservation;
}

export interface VerificationEvidence {
  schemaVersion: 1;
  stage: CompletedVerificationStage;
  result: "passed" | "failed";
  hardwareKey: string;
  biosVersion: string;
  targetMacOS: MacOSVersion;
  openCoreVersion: string;
  configSha256: string;
  observedAt: string;
  observations: VerificationObservations;
  notes: string[];
}

export interface VerificationBinding {
  hardwareKey: string;
  biosVersion: string;
  targetMacOS: MacOSVersion;
  openCoreVersion: string;
  configSha256: string;
}

const stages: CompletedVerificationStage[] = [
  "boot-tested",
  "recovery-tested",
  "install-verified",
  "post-install-verified",
];
const observationValues: VerificationObservation[] = ["passed", "failed", "not-tested"];
const observationKeys = [
  "bootPicker",
  "recovery",
  "installer",
  "desktop",
  "graphics",
  "network",
  "audio",
  "usb",
  "sleep",
] as const;
const requiredObservations: Record<CompletedVerificationStage, (keyof VerificationObservations)[]> = {
  "boot-tested": ["bootPicker"],
  "recovery-tested": ["bootPicker", "recovery"],
  "install-verified": ["bootPicker", "recovery", "installer"],
  "post-install-verified": ["bootPicker", "recovery", "installer", "desktop"],
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} 不能为空。`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(normalized)) {
    throw new Error(`${label} 包含无效或过长内容。`);
  }
  return normalized;
}

function parseObservations(value: unknown): VerificationObservations {
  const data = object(value, "验证观察项");
  const parsed = {} as VerificationObservations;
  for (const key of observationKeys) {
    if (!observationValues.includes(data[key] as VerificationObservation)) {
      throw new Error(`验证观察项 ${key} 无效。`);
    }
    parsed[key] = data[key] as VerificationObservation;
  }
  return parsed;
}

function validateStageResult(evidence: VerificationEvidence): void {
  if (evidence.result === "passed") {
    const missing = requiredObservations[evidence.stage].filter(
      (key) => evidence.observations[key] !== "passed",
    );
    if (missing.length > 0) {
      throw new Error(`验证阶段缺少已通过的必要观察项：${missing.join("、")}。`);
    }
  }
}

export function observationsForStage(
  stage: CompletedVerificationStage,
  result: "passed" | "failed",
  optional: Partial<VerificationObservations> = {},
): VerificationObservations {
  const observations = Object.fromEntries(
    observationKeys.map((key) => [key, "not-tested"]),
  ) as unknown as VerificationObservations;
  const required = requiredObservations[stage];
  for (const key of required) observations[key] = "passed";
  if (result === "failed") observations[required.at(-1)!] = "failed";
  for (const key of observationKeys) {
    if (optional[key]) observations[key] = optional[key];
  }
  return observations;
}

export function createVerificationEvidence(
  binding: VerificationBinding,
  stage: CompletedVerificationStage,
  result: "passed" | "failed",
  observations: VerificationObservations,
  notes: string[],
  observedAt = new Date().toISOString(),
): VerificationEvidence {
  return parseVerificationEvidence({
    schemaVersion: 1,
    stage,
    result,
    ...binding,
    observedAt,
    observations,
    notes,
  });
}

export function parseVerificationEvidence(value: unknown): VerificationEvidence {
  const data = object(value, "验证证据");
  if (data.schemaVersion !== 1) throw new Error("不支持的验证证据版本。");
  if (!stages.includes(data.stage as CompletedVerificationStage)) {
    throw new Error("验证阶段无效。");
  }
  if (data.result !== "passed" && data.result !== "failed") throw new Error("验证结果无效。");
  if (!["13", "14", "15"].includes(String(data.targetMacOS))) throw new Error("目标 macOS 无效。");
  const configSha256 = text(data.configSha256, "config SHA-256", 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(configSha256)) throw new Error("config SHA-256 格式无效。");
  if (!Array.isArray(data.notes) || data.notes.length > 12) {
    throw new Error("验证备注必须是不超过 12 项的字符串数组。");
  }
  const notes = data.notes.map((note, index) => text(note, `验证备注 ${index + 1}`, 500));
  const observedAt = text(data.observedAt, "观察时间", 64);
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime) || observedTime > Date.now() + 24 * 60 * 60 * 1000) {
    throw new Error("观察时间格式无效或明显晚于当前时间。");
  }

  const evidence: VerificationEvidence = {
    schemaVersion: 1,
    stage: data.stage as CompletedVerificationStage,
    result: data.result,
    hardwareKey: text(data.hardwareKey, "硬件指纹", 16_384),
    biosVersion: text(data.biosVersion, "BIOS 版本", 256),
    targetMacOS: data.targetMacOS as MacOSVersion,
    openCoreVersion: text(data.openCoreVersion, "OpenCore 版本", 64),
    configSha256,
    observedAt,
    observations: parseObservations(data.observations),
    notes,
  };
  validateStageResult(evidence);
  return evidence;
}

export function serializeVerificationEvidence(evidence: VerificationEvidence): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

export function verifyEvidenceBinding(
  evidence: VerificationEvidence,
  binding: VerificationBinding,
): string[] {
  const mismatches: string[] = [];
  if (evidence.hardwareKey !== binding.hardwareKey) mismatches.push("硬件指纹不一致");
  if (evidence.biosVersion !== binding.biosVersion) mismatches.push("BIOS 版本不一致");
  if (evidence.targetMacOS !== binding.targetMacOS) mismatches.push("macOS 版本不一致");
  if (evidence.openCoreVersion !== binding.openCoreVersion) mismatches.push("OpenCore 版本不一致");
  if (evidence.configSha256.toLowerCase() !== binding.configSha256.toLowerCase()) {
    mismatches.push("config.plist 哈希不一致");
  }
  return mismatches;
}

export function mayPromoteVerification(
  evidence: VerificationEvidence,
  binding: VerificationBinding,
): boolean {
  return evidence.result === "passed" && verifyEvidenceBinding(evidence, binding).length === 0;
}
