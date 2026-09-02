export type MacOSVersion = "13" | "14" | "15" | "26";

export type DeviceCategory =
  | "firmware"
  | "cpu"
  | "board"
  | "gpu"
  | "network"
  | "audio"
  | "storage";

export type CompatibilityStatus =
  | "supported"
  | "partial"
  | "blocked"
  | "unknown";

export interface PciDevice {
  id: string;
  name: string;
  vendorId: string;
  deviceId: string;
  subsystemId?: string;
  classCode?: string;
  identitySource?: "direct-pci" | "parent-pci" | "name-only";
}

export interface HardwareReport {
  schemaVersion: 1;
  capturedAt: string;
  system: {
    kind: "desktop" | "laptop";
    firmware: "uefi" | "legacy";
    secureBoot: boolean;
    manufacturer?: string;
    productName?: string;
    /** Lenovo 等 OEM 的四位机型码，例如 ThinkPad T480 的 20L5。不是序列号。 */
    machineType?: string;
  };
  cpu: {
    vendor: "intel" | "amd" | "unknown";
    name: string;
    generation: string;
    family: number;
    model: number;
    cores: number;
    threads: number;
    features: string[];
  };
  board: {
    vendor: string;
    model: string;
    biosVersion: string;
    biosDate?: string;
  };
  gpus: PciDevice[];
  network: PciDevice[];
  audio: PciDevice[];
  storage: PciDevice[];
}

export interface RuleSelector {
  values?: string[];
  vendorIds?: string[];
  deviceIds?: string[];
  nameIncludes?: string[];
}

export type RuleEvidence =
  | "firmware-mode"
  | "cpu-generation"
  | "pci-vendor-id"
  | "pci-device-id"
  | "device-name";

export type RuleMaturity = "reviewed" | "experimental" | "deprecated";

export type RuleOperation =
  | { type: "add-component"; value: string }
  | { type: "add-boot-arg"; value: string }
  | { type: "add-note"; value: string }
  | { type: "manual-review"; value: string };

export interface RuleRegistryMetadata {
  priority: number;
  evidence: RuleEvidence[];
  maturity: RuleMaturity;
  operations: RuleOperation[];
  testSampleIds: string[];
}

export interface CompatibilityRule {
  id: string;
  category: DeviceCategory;
  status: Exclude<CompatibilityStatus, "unknown">;
  macOS: MacOSVersion[];
  selector: RuleSelector;
  message: string;
  action: string;
  source: string;
  registry: RuleRegistryMetadata;
}

export interface CompatibilityFinding {
  subjectId: string;
  subject: string;
  category: DeviceCategory;
  status: CompatibilityStatus;
  ruleId: string;
  message: string;
  action: string;
  source?: string;
  operations: RuleOperation[];
}

export type HardwareModuleId =
  | "platform"
  | "graphics"
  | "ethernet"
  | "wireless"
  | "audio"
  | "storage"
  | "usb"
  | "laptop-input"
  | "battery"
  | "backlight"
  | "sleep";

export interface ModuleChoice {
  id: string;
  label: string;
  description: string;
  risk: "recommended" | "experimental";
}

export interface HardwareModuleAssessment {
  id: HardwareModuleId;
  label: string;
  status: CompatibilityStatus;
  summary: string;
  evidence: string[];
  choices: ModuleChoice[];
}

export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface CompatibilityReport {
  targetMacOS: MacOSVersion;
  status: CompatibilityStatus;
  confidence: ConfidenceGrade;
  coverage: number;
  findings: CompatibilityFinding[];
  modules: HardwareModuleAssessment[];
  feasibility: LegacyFeasibilityAssessment;
  canContinue: boolean;
  recommended: boolean;
}

export interface AcpiClockEvidence {
  sourceName: string;
  signature: string;
  oemId: string;
  oemTableId: string;
  revision: number;
  length: number;
  sha256: string;
  hasAwacDeviceId: boolean;
  hasLegacyRtcId: boolean;
  hasStasSymbol: boolean;
  suggestedMode: "awac" | "manual";
  confidence: "strong-clue" | "possible-clue" | "insufficient";
  reasons: string[];
  warnings: string[];
}

export interface BuildPlan {
  platform: "amd-zen" | "intel-coffee-lake" | "intel-comet-lake" | "unknown";
  profile: string;
  cpuCoreCount: number;
  chipset: string;
  smbiosModel: string;
  igpuPlatformId?: string;
  bootArgs: string[];
  setupVirtualMap?: boolean;
  intelClockMode?: "awac" | "manual";
  intelClockEvidence?: AcpiClockEvidence;
  autoConfigSupported: boolean;
  components: string[];
  acpi: string[];
  drivers: string[];
  notes: string[];
}

export interface BuildPreferences {
  amdSetupVirtualMap?: boolean;
  intelClockMode?: "awac" | "manual";
  intelClockEvidence?: AcpiClockEvidence;
  customUsbMapIncluded?: boolean;
  unsupportedGpuMode?: "disable" | "preserve";
}

export type HardwareReportSource = "demo" | "native" | "imported" | "fixture";

export type VerificationStage =
  | "candidate"
  | "boot-tested"
  | "recovery-tested"
  | "install-verified"
  | "post-install-verified";

export type ValidationCheckStatus = "passed" | "warning" | "pending" | "failed";

export interface ValidationCheck {
  id: string;
  label: string;
  status: ValidationCheckStatus;
  detail: string;
}

export interface LockedComponent {
  id: string;
  name: string;
  version: string;
  repository: string;
  releaseUrl: string;
  assetUrl: string;
  assetName: string;
  sha256: string;
  size: number;
  license: string;
  provides: string[];
  assetKind?: "zip" | "file";
}

export interface EfiBuildManifest {
  schemaVersion: 1;
  targetMacOS: MacOSVersion;
  hardwareKey: string;
  sourceReportCapturedAt: string;
  profile: string;
  platform: BuildPlan["platform"];
  cpuCoreCount: number;
  chipset: string;
  smbiosModel: string;
  igpuPlatformId?: string;
  bootArgs: string[];
  setupVirtualMap?: boolean;
  intelClockMode?: "awac" | "manual";
  intelClockEvidence?: AcpiClockEvidence;
  autoConfigSupported: boolean;
  components: LockedComponent[];
  acpi: string[];
  drivers: string[];
  notes: string[];
  verificationStage: VerificationStage;
  checks: ValidationCheck[];
}

export type CommunityProfileStatus = "candidate" | "verified" | "deprecated";

export interface CommunityEfiProfile {
  id: string;
  title: string;
  status: CommunityProfileStatus;
  source: {
    repository: string;
    revision: string;
    license: string;
  };
  machine: {
    kind: "desktop" | "laptop";
    manufacturerIncludes: string[];
    modelIncludes: string[];
    cpuGenerations: string[];
    biosVersions?: string[];
    requiredPciIds?: string[];
    requiredAcpiFeatures: string[];
  };
  compatibleMacOS: MacOSVersion[];
  openCoreVersion: string;
  lastVerified: string;
  knownIssues: string[];
  audit: {
    identitySanitized: boolean;
    unknownExecutablesRejected: boolean;
    officialBinariesReplaced: boolean;
    reviewedAt: string;
  };
}

export type CommunityMatchStatus = "exact" | "close" | "incompatible";

export interface CommunityProfileMatch {
  profile: CommunityEfiProfile;
  status: CommunityMatchStatus;
  reasons: string[];
}

/**
 * A discovery record points at third-party material that may contain useful
 * machine-specific clues. It is deliberately separate from CommunityEfiProfile:
 * discovery records are not audited EFI packages and never enter a build plan.
 */
export type CommunityDiscoveryBootloader =
  | "opencore"
  | "clover"
  | "mixed"
  | "unknown";

export interface CommunityDiscoveryEntry {
  id: string;
  formFactor: "desktop" | "laptop";
  section: string;
  model: string;
  repositories: string[];
  guides: string[];
  note: string;
  bootloaderHint: CommunityDiscoveryBootloader;
}

export interface CommunityDiscoveryCatalog {
  schemaVersion: 1;
  source: {
    repository: string;
    revision: string;
    sourceFile: string;
    upstreamUpdated: string | null;
    licenseStatus: "not-declared";
    trust: "discovery-only";
  };
  stats: {
    entries: number;
    laptopEntries: number;
    desktopEntries: number;
    repositories: number;
  };
  entries: CommunityDiscoveryEntry[];
}

export interface CommunityDiscoveryMatch {
  entry: CommunityDiscoveryEntry;
  confidence: "strong-clue" | "possible-clue";
  score: number;
  reasons: string[];
}

export interface LegacyFeasibilityAssessment {
  automaticPath: boolean;
  level: "modern-uefi" | "manual-uefi" | "legacy-experimental" | "instruction-set-risk";
  reasons: string[];
  choices: ModuleChoice[];
}

export type ThinkPadSupportTier =
  | "guided-candidate"
  | "legacy-patch-required"
  | "research-only"
  | "unsupported-generation";

export interface ThinkPadEvidenceSource {
  label: string;
  url: string;
  kind: "lenovo-psref" | "community-repository" | "opencore-guide";
}

export interface ThinkPadModelProfile {
  id: string;
  label: string;
  aliases: string[];
  machineTypes: string[];
  cpuGenerations: string[];
  tier: Exclude<ThinkPadSupportTier, "unsupported-generation">;
  targetMacOS: MacOSVersion[];
  notes: string[];
  sources: ThinkPadEvidenceSource[];
}

export interface ThinkPadVariantCheck {
  id: "identity" | "cpu" | "graphics" | "wireless" | "storage" | "firmware";
  label: string;
  status: "passed" | "warning" | "unknown";
  detail: string;
}

export interface ThinkPadAssessment {
  detected: boolean;
  match: "machine-type" | "product-name" | "family-only" | "none";
  profile?: ThinkPadModelProfile;
  tier: ThinkPadSupportTier;
  title: string;
  summary: string;
  route: string;
  checks: ThinkPadVariantCheck[];
  warnings: string[];
}
