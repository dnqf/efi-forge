import { invoke } from "@tauri-apps/api/core";
import type { EfiBuildManifest } from "../domain/types";

export interface ScaffoldResult {
  outputPath: string;
  filesWritten: number;
  warnings: string[];
  readyForInstall: boolean;
  validationLevel: "ocvalidate-passed" | "components-only";
  configSha256: string | null;
}

export interface EfiValidationResult {
  rootPath: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  validationLevel: "structure-only" | "ocvalidate-passed";
  configSha256: string | null;
}

export interface InstallCopyResult {
  targetPath: string;
  filesCopied: number;
}

export interface UsbMapSelection {
  sourcePath: string;
  bundleName: string;
}

export interface EfiMergeResult {
  outputPath: string;
  preferredSource: "generated" | "custom";
  filesFromPreferred: number;
  missingFilesAdded: number;
  conflictsKept: number;
  addedFiles: string[];
  inactiveAddedFiles: string[];
  warnings: string[];
  validationLevel: "structure-only";
  configSha256: string;
}

export type ComponentKind = "kext" | "acpi" | "driver";
export type ComponentComparison = "new" | "identical" | "path-conflict" | "identity-conflict";
export type ComponentAction =
  | "keep-base"
  | "use-imported"
  | "add-inactive"
  | "add-enabled"
  | "preserve-inactive"
  | "skip";

export interface ComponentItem {
  id: string;
  name: string;
  kind: ComponentKind;
  identity: string;
  version?: string;
  sha256: string;
  size: number;
  sourcePath: string;
  targetPath: string;
  comparison: ComponentComparison;
  baseSha256?: string;
  baseEnabled: boolean;
  dependencies: string[];
  configPreview: string[];
  defaultAction: ComponentAction;
  allowedActions: ComponentAction[];
  warnings: string[];
}

export interface ComponentScanResult {
  scanId: string;
  sourceLabel: string;
  items: ComponentItem[];
  warnings: string[];
}

export interface ComponentSelection {
  itemId: string;
  action: ComponentAction;
}

export interface AppliedComponent {
  itemId: string;
  name: string;
  kind: ComponentKind;
  action: ComponentAction;
  sourceSha256: string;
  finalTarget?: string;
  enabledInResult: boolean;
}

export interface ComponentMergeResult {
  outputPath: string;
  filesCopied: number;
  componentsAdded: number;
  componentsReplaced: number;
  componentsPreserved: number;
  configModified: boolean;
  configBeforeSha256: string;
  configAfterSha256: string;
  configChanges: string[];
  applied: AppliedComponent[];
  warnings: string[];
  validationLevel: "structure-only" | "ocvalidate-passed";
}

export function buildEfiScaffold(
  manifest: EfiBuildManifest,
  usbMapPath?: string,
): Promise<ScaffoldResult | null> {
  return invoke<ScaffoldResult | null>("build_efi_scaffold", { manifest, usbMapPath });
}

export function selectUsbMap(): Promise<UsbMapSelection | null> {
  return invoke<UsbMapSelection | null>("select_usb_map");
}

export function validateCustomEfi(): Promise<EfiValidationResult | null> {
  return invoke<EfiValidationResult | null>("validate_custom_efi");
}

export function mergeEfiSources(
  generatedRoot: string,
  customRoot: string,
  preferredSource: "generated" | "custom",
): Promise<EfiMergeResult | null> {
  return invoke<EfiMergeResult | null>("merge_efi_sources", {
    generatedRoot,
    customRoot,
    preferredSource,
  });
}

export function selectComponentSource(
  selectionMode: "folder" | "files",
  baseRoot: string,
): Promise<ComponentScanResult | null> {
  return invoke<ComponentScanResult | null>("select_component_source", {
    selectionMode,
    baseRoot,
  });
}

export function mergeComponentSelections(
  scanId: string,
  baseRoot: string,
  selections: ComponentSelection[],
): Promise<ComponentMergeResult | null> {
  return invoke<ComponentMergeResult | null>("merge_component_selections", {
    scanId,
    baseRoot,
    selections,
  });
}

export function copyEfiToEmptyTarget(
  sourceRoot: string,
): Promise<InstallCopyResult | null> {
  return invoke<InstallCopyResult | null>("copy_efi_to_empty_target", {
    sourceRoot,
  });
}
