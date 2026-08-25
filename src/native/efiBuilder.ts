import { invoke } from "@tauri-apps/api/core";
import type { EfiBuildManifest } from "../domain/types";

export interface ScaffoldResult {
  outputPath: string;
  filesWritten: number;
  warnings: string[];
  readyForInstall: boolean;
  validationLevel: "ocvalidate-passed" | "components-only";
}

export interface EfiValidationResult {
  rootPath: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  validationLevel: "structure-only" | "ocvalidate-passed";
}

export interface InstallCopyResult {
  targetPath: string;
  filesCopied: number;
}

export interface UsbMapSelection {
  sourcePath: string;
  bundleName: string;
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

export function copyEfiToEmptyTarget(
  sourceRoot: string,
): Promise<InstallCopyResult | null> {
  return invoke<InstallCopyResult | null>("copy_efi_to_empty_target", {
    sourceRoot,
  });
}
