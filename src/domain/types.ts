export type MacOSVersion = "13" | "14" | "15";

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

export interface CompatibilityRule {
  id: string;
  category: DeviceCategory;
  status: Exclude<CompatibilityStatus, "unknown">;
  macOS: MacOSVersion[];
  selector: RuleSelector;
  message: string;
  action: string;
  source: string;
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
}

export type ConfidenceGrade = "A" | "B" | "C" | "D";

export interface CompatibilityReport {
  targetMacOS: MacOSVersion;
  status: CompatibilityStatus;
  confidence: ConfidenceGrade;
  coverage: number;
  findings: CompatibilityFinding[];
  canContinue: boolean;
  recommended: boolean;
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
  autoConfigSupported: boolean;
  components: string[];
  acpi: string[];
  drivers: string[];
  notes: string[];
}

export interface BuildPreferences {
  amdSetupVirtualMap?: boolean;
  customUsbMapIncluded?: boolean;
}

export type HardwareReportSource = "demo" | "native" | "imported" | "fixture";

export type VerificationStage =
  | "candidate"
  | "boot-tested"
  | "recovery-tested"
  | "install-verified";

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
  };
  compatibleMacOS: MacOSVersion[];
  openCoreVersion: string;
  lastVerified: string;
  knownIssues: string[];
}

export type CommunityMatchStatus = "exact" | "close" | "incompatible";

export interface CommunityProfileMatch {
  profile: CommunityEfiProfile;
  status: CommunityMatchStatus;
  reasons: string[];
}
