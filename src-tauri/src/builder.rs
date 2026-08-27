use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use zip::ZipArchive;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LockedComponent {
    id: String,
    name: String,
    version: String,
    asset_url: String,
    asset_name: String,
    sha256: String,
    size: u64,
    provides: Vec<String>,
    #[serde(default)]
    asset_kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EfiBuildManifest {
    schema_version: u8,
    #[serde(rename = "targetMacOS")]
    target_mac_os: String,
    profile: String,
    platform: String,
    cpu_core_count: u32,
    chipset: String,
    smbios_model: String,
    #[serde(default)]
    igpu_platform_id: Option<String>,
    #[serde(default)]
    boot_args: Vec<String>,
    #[serde(default)]
    setup_virtual_map: Option<bool>,
    auto_config_supported: bool,
    components: Vec<LockedComponent>,
    acpi: Vec<String>,
    drivers: Vec<String>,
    notes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentLockFile {
    components: Vec<LockedComponent>,
}

struct AssemblyResult {
    files_written: usize,
    warnings: Vec<String>,
    ready_for_install: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaffoldResult {
    output_path: String,
    files_written: usize,
    warnings: Vec<String>,
    ready_for_install: bool,
    validation_level: &'static str,
    config_sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EfiValidationResult {
    pub(crate) root_path: String,
    pub(crate) valid: bool,
    pub(crate) errors: Vec<String>,
    warnings: Vec<String>,
    validation_level: &'static str,
    config_sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallCopyResult {
    target_path: String,
    files_copied: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsbMapSelection {
    source_path: String,
    bundle_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EfiMergeResult {
    output_path: String,
    preferred_source: String,
    files_from_preferred: usize,
    missing_files_added: usize,
    conflicts_kept: usize,
    added_files: Vec<String>,
    inactive_added_files: Vec<String>,
    warnings: Vec<String>,
    validation_level: &'static str,
    config_sha256: String,
}

#[tauri::command]
pub async fn build_efi_scaffold(
    manifest: EfiBuildManifest,
    usb_map_path: Option<String>,
) -> Result<Option<ScaffoldResult>, String> {
    validate_manifest_lock(&manifest)?;
    let usb_map = usb_map_path.as_deref().map(validate_usb_map).transpose()?;
    if usb_map.is_some()
        && !manifest
            .components
            .iter()
            .any(|component| component.id == "usb-tool-box")
    {
        return Err("导入 UTBMap 时构建清单必须包含锁定版 USBToolBox。".into());
    }
    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择 EFI 暂存包的保存位置")
        .pick_folder()
    else {
        return Ok(None);
    };

    tauri::async_runtime::spawn_blocking(move || {
        build_scaffold(&parent, &manifest, usb_map.as_ref())
    })
    .await
    .map_err(|error| format!("构建任务异常结束：{error}"))?
    .map(Some)
}

#[tauri::command]
pub fn select_usb_map() -> Result<Option<UsbMapSelection>, String> {
    let Some(selected) = rfd::FileDialog::new()
        .set_title("选择 codeless UTBMap.kext 文件夹")
        .pick_folder()
    else {
        return Ok(None);
    };
    validate_usb_map(&selected.display().to_string()).map(Some)
}

fn validate_manifest_lock(manifest: &EfiBuildManifest) -> Result<(), String> {
    if manifest.schema_version != 1
        || !matches!(manifest.target_mac_os.as_str(), "13" | "14" | "15")
    {
        return Err("构建清单版本或目标 macOS 不受支持。".into());
    }
    let lock: ComponentLockFile =
        serde_json::from_str(include_str!("../../src/data/components.lock.json"))
            .map_err(|error| format!("内置组件锁无法解析：{error}"))?;
    let mut seen = BTreeSet::new();
    for component in &manifest.components {
        if !seen.insert(component.id.as_str()) {
            return Err(format!("构建清单包含重复组件：{}", component.id));
        }
        let expected = lock
            .components
            .iter()
            .find(|candidate| candidate.id == component.id)
            .ok_or_else(|| format!("构建清单包含未授权组件：{}", component.id))?;
        if expected != component {
            return Err(format!(
                "组件 {} 与内置版本锁不一致，构建已停止。",
                component.name
            ));
        }
    }

    let provided = manifest
        .components
        .iter()
        .flat_map(|component| component.provides.iter().map(String::as_str))
        .collect::<BTreeSet<_>>();
    let mut required = BTreeSet::from(["OpenCore.efi", "Lilu.kext", "VirtualSMC.kext"]);
    required.extend(manifest.acpi.iter().map(String::as_str));
    required.extend(manifest.drivers.iter().map(String::as_str));
    if manifest.auto_config_supported && manifest.platform == "amd-zen" {
        required.insert("AMD-Vanilla-patches.plist");
        required.insert("AppleMCEReporterDisabler.kext");
    }
    let missing = required.difference(&provided).copied().collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!("构建清单缺少锁定资源：{}", missing.join("、")));
    }
    if manifest.auto_config_supported {
        validate_automatic_platform(manifest)?;
    }
    Ok(())
}

fn validate_automatic_platform(manifest: &EfiBuildManifest) -> Result<(), String> {
    let acpi = manifest
        .acpi
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let require_acpi = |names: &[&str]| -> Result<(), String> {
        let missing = names
            .iter()
            .copied()
            .filter(|name| !acpi.contains(name))
            .collect::<Vec<_>>();
        if missing.is_empty() {
            Ok(())
        } else {
            Err(format!("自动配置缺少平台必需 ACPI：{}", missing.join("、")))
        }
    };

    match manifest.platform.as_str() {
        "amd-zen"
            if matches!(
                manifest.chipset.as_str(),
                "A520" | "B450" | "B550" | "X470" | "X570"
            ) =>
        {
            if matches!(manifest.chipset.as_str(), "A520" | "B550") {
                require_acpi(&["SSDT-EC-USBX-DESKTOP.aml", "SSDT-CPUR.aml"])
            } else {
                require_acpi(&["SSDT-EC-USBX-DESKTOP.aml"])
            }
        }
        "intel-coffee-lake"
            if matches!(
                manifest.chipset.as_str(),
                "B360" | "B365" | "H310" | "H370" | "Z390"
            ) =>
        {
            if manifest.smbios_model != "iMac19,1"
                || !matches!(
                    manifest.igpu_platform_id.as_deref(),
                    None | Some("07009B3E") | Some("0300913E")
                )
            {
                return Err("Coffee Lake 的 SMBIOS 或核显平台 ID 不在审核范围。".into());
            }
            require_acpi(&[
                "SSDT-PLUG-DRTNIA.aml",
                "SSDT-EC-USBX-DESKTOP.aml",
                "SSDT-AWAC.aml",
                "SSDT-PMC.aml",
            ])
        }
        "intel-comet-lake" if matches!(manifest.chipset.as_str(), "B460" | "Z490") => {
            let expected_smbios = if manifest.cpu_core_count >= 10 {
                "iMac20,2"
            } else {
                "iMac20,1"
            };
            if manifest.smbios_model != expected_smbios
                || !matches!(
                    manifest.igpu_platform_id.as_deref(),
                    None | Some("07009B3E") | Some("0300C89B")
                )
            {
                return Err("Comet Lake 的 SMBIOS 或核显平台 ID 不在审核范围。".into());
            }
            require_acpi(&[
                "SSDT-PLUG-DRTNIA.aml",
                "SSDT-EC-USBX-DESKTOP.aml",
                "SSDT-AWAC.aml",
            ])
        }
        _ => Err(format!(
            "{} / {} 尚未开放自动 config.plist；仍可使用组件导出或自有 EFI。",
            manifest.platform, manifest.chipset
        )),
    }
}

#[tauri::command]
pub fn validate_custom_efi() -> Result<Option<EfiValidationResult>, String> {
    let Some(selected) = rfd::FileDialog::new()
        .set_title("选择包含 EFI 文件夹的位置")
        .pick_folder()
    else {
        return Ok(None);
    };

    validate_efi_root(&selected).map(Some)
}

#[tauri::command]
pub fn copy_efi_to_empty_target(source_root: String) -> Result<Option<InstallCopyResult>, String> {
    let source = PathBuf::from(source_root);
    let validation = validate_efi_root(&source)?;
    if !validation.valid {
        return Err(format!(
            "源 EFI 结构已失效：{}",
            validation.errors.join("；")
        ));
    }

    let Some(target) = rfd::FileDialog::new()
        .set_title("选择空目录或已挂载的空 EFI 分区")
        .pick_folder()
    else {
        return Ok(None);
    };

    copy_to_empty_target(&source, &target).map(Some)
}

#[tauri::command]
pub fn merge_efi_sources(
    generated_root: String,
    custom_root: String,
    preferred_source: String,
) -> Result<Option<EfiMergeResult>, String> {
    let generated = PathBuf::from(generated_root);
    let custom = PathBuf::from(custom_root);
    let generated_validation = validate_efi_root(&generated)?;
    let custom_validation = validate_efi_root(&custom)?;
    if !generated_validation.valid {
        return Err(format!(
            "项目生成 EFI 结构已失效：{}",
            generated_validation.errors.join("；")
        ));
    }
    if !custom_validation.valid {
        return Err(format!(
            "用户 EFI 结构损坏，不能参与融合：{}",
            custom_validation.errors.join("；")
        ));
    }

    let generated = PathBuf::from(generated_validation.root_path);
    let custom = PathBuf::from(custom_validation.root_path);
    if generated == custom {
        return Err("项目生成 EFI 与用户 EFI 不能是同一目录。".into());
    }
    if !matches!(preferred_source.as_str(), "generated" | "custom") {
        return Err("未知的 EFI 冲突优先级。".into());
    }

    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择融合 EFI 副本的保存位置")
        .pick_folder()
    else {
        return Ok(None);
    };

    merge_efi_roots(&generated, &custom, &parent, &preferred_source).map(Some)
}

fn build_scaffold(
    parent: &Path,
    manifest: &EfiBuildManifest,
    usb_map: Option<&UsbMapSelection>,
) -> Result<ScaffoldResult, String> {
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("无法读取保存位置：{error}"))?;
    let profile = safe_name(&manifest.profile);
    let base_name = format!("EFI-Forge-{profile}-macOS-{}", manifest.target_mac_os);
    let output = unused_child_path(&parent, &base_name)?;
    let staging = parent.join(format!(
        ".efi-forge-staging-{}-{}",
        std::process::id(),
        unix_seconds()
    ));
    fs::create_dir(&staging).map_err(|error| format!("无法创建构建暂存目录：{error}"))?;

    let build_result = assemble_scaffold(&staging, manifest, usb_map);
    if let Err(error) = build_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let assembly = build_result.unwrap();

    let config_sha256 = if assembly.ready_for_install {
        Some(hash_file_sha256(&staging.join("EFI/OC/config.plist"))?)
    } else {
        None
    };

    fs::rename(&staging, &output).map_err(|error| {
        let _ = fs::remove_dir_all(&staging);
        format!("无法完成暂存包写入：{error}")
    })?;

    Ok(ScaffoldResult {
        output_path: output.display().to_string(),
        files_written: assembly.files_written,
        warnings: assembly.warnings,
        ready_for_install: assembly.ready_for_install,
        validation_level: if assembly.ready_for_install {
            "ocvalidate-passed"
        } else {
            "components-only"
        },
        config_sha256,
    })
}

fn assemble_scaffold(
    root: &Path,
    manifest: &EfiBuildManifest,
    usb_map: Option<&UsbMapSelection>,
) -> Result<AssemblyResult, String> {
    let efi = root.join("EFI");
    let oc = efi.join("OC");
    for directory in [
        efi.join("BOOT"),
        oc.join("ACPI"),
        oc.join("Drivers"),
        oc.join("Kexts"),
        oc.join("Tools"),
        root.join("_tools"),
        root.join("_sources"),
    ] {
        fs::create_dir_all(directory).map_err(|error| format!("无法创建 EFI 目录结构：{error}"))?;
    }

    let cache = std::env::temp_dir()
        .join("efi-forge")
        .join("component-cache");
    fs::create_dir_all(&cache).map_err(|error| format!("无法创建组件缓存：{error}"))?;

    let mut files_written = 0;
    let requested_kexts: BTreeSet<&str> = manifest
        .components
        .iter()
        .flat_map(|component| component.provides.iter().map(String::as_str))
        .filter(|file| file.ends_with(".kext"))
        .collect();

    for component in &manifest.components {
        let archive_path = ensure_component(&cache, component)?;
        if component.asset_kind.as_deref() == Some("file") {
            if component.id == "amd-vanilla-patches" {
                fs::copy(
                    &archive_path,
                    root.join("_sources/AMD-Vanilla-patches.plist"),
                )
                .map_err(|error| format!("无法保存 AMD Vanilla 补丁：{error}"))?;
                files_written += 1;
            } else {
                for provided in component
                    .provides
                    .iter()
                    .filter(|file| manifest.acpi.contains(file))
                {
                    fs::copy(&archive_path, oc.join("ACPI").join(provided))
                        .map_err(|error| format!("无法保存 ACPI 文件 {provided}：{error}"))?;
                    files_written += 1;
                }
            }
            continue;
        }
        let archive_file = File::open(&archive_path)
            .map_err(|error| format!("无法打开组件 {}：{error}", component.name))?;
        let mut archive = ZipArchive::new(archive_file)
            .map_err(|error| format!("组件 {} 不是有效 ZIP：{error}", component.name))?;

        if component.id == "opencore" {
            for (source, destination) in [
                ("X64/EFI/BOOT/BOOTx64.efi", efi.join("BOOT/BOOTx64.efi")),
                ("X64/EFI/OC/OpenCore.efi", oc.join("OpenCore.efi")),
                ("Docs/Sample.plist", root.join("_sources/Sample.plist")),
                (
                    "Utilities/ocvalidate/ocvalidate.exe",
                    root.join("_tools/ocvalidate.exe"),
                ),
                (
                    "Utilities/macserial/macserial.exe",
                    root.join("_tools/macserial.exe"),
                ),
            ] {
                extract_file(&mut archive, source, &destination)?;
                files_written += 1;
            }
            for driver in &manifest.drivers {
                extract_file(
                    &mut archive,
                    &format!("X64/EFI/OC/Drivers/{driver}"),
                    &oc.join("Drivers").join(driver),
                )?;
                files_written += 1;
            }
        }

        for kext in requested_kexts
            .iter()
            .filter(|name| component.provides.iter().any(|file| file == **name))
        {
            let prefix = find_directory_prefix(&mut archive, kext)
                .ok_or_else(|| format!("组件 {} 中找不到锁定文件 {kext}", component.name))?;
            files_written +=
                extract_directory(&mut archive, &prefix, &oc.join("Kexts").join(kext))?;
        }
    }

    if let Some(usb_map) = usb_map {
        let source = PathBuf::from(&usb_map.source_path);
        files_written += copy_directory(&source, &oc.join("Kexts").join(&usb_map.bundle_name))?;
    }

    let mut warnings = Vec::new();
    let ready_for_install = if manifest.auto_config_supported {
        match manifest.platform.as_str() {
            "amd-zen" => generate_amd_config(root, manifest)?,
            "intel-coffee-lake" | "intel-comet-lake" => generate_intel_config(root, manifest)?,
            _ => return Err("清单错误：未知平台不能启用自动 config.plist。".into()),
        }
        files_written += 1;
        if let Some(usb_map) = usb_map {
            append_codeless_kext(root, &usb_map.bundle_name)?;
        }
        run_ocvalidate(root)?;
        let validation = validate_efi_root(root)?;
        if !validation.valid {
            return Err(format!(
                "生成后的 EFI 自检失败：{}",
                validation.errors.join("；")
            ));
        }
        warnings.push(
            "同版本 ocvalidate 已通过；仍需在外部启动盘完成 OpenCore、Recovery 和安装实测。".into(),
        );
        warnings.push(if usb_map.is_some() {
            "用户 USB Map 已按 codeless 结构导入并通过 ocvalidate；映射内容仍需在真机逐端口验证。"
                .into()
        } else {
            "未自动生成专属 USB 端口映射；XhciPortLimit 保持关闭，安装后需要校准 USB Map。".into()
        });
        if manifest.platform.starts_with("intel-") {
            warnings.push("请在 BIOS 核对 CFG-Lock、VT-d、CSM、Secure Boot 与 DVMT；静态扫描不能读取所有固件选项。".into());
            if manifest.igpu_platform_id.as_deref() == Some("07009B3E") {
                warnings.push(
                    "UHD 630 默认使用 07009B3E；若在 verbose 后黑屏，可改试 00009B3E 并重新验证。"
                        .into(),
                );
            }
        }
        true
    } else {
        warnings.push("当前平台尚未开放自动 config.plist；已导出可审核组件，不可直接启动。".into());
        warnings.push("可导入用户自己的完整 EFI，结构正确时继续使用。".into());
        false
    };

    let manifest_json = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("无法序列化构建清单：{error}"))?;
    fs::write(root.join("efi-forge-manifest.json"), manifest_json)
        .map_err(|error| format!("无法写入构建清单：{error}"))?;
    files_written += 1;

    let notes = if ready_for_install {
        "EFI Forge 候选 EFI\r\n\r\n已完成：锁定下载、SHA-256、config.plist 生成、引用完整性和同版本 ocvalidate。\r\n\r\n未完成：真实电脑的 OpenCore 启动、Recovery 与安装验证。请先复制到独立空 U 盘测试，勿直接替换现有 EFI。\r\n".to_string()
    } else {
        format!(
            "EFI Forge 官方组件暂存包\r\n\r\n此目录尚不可启动。\r\n\r\n计划 ACPI：\r\n- {}\r\n\r\n请提供完整 config.plist/ACPI，或导入自己的完整 EFI。\r\n",
            manifest.acpi.join("\r\n- ")
        )
    };
    fs::write(root.join("README-FIRST.txt"), notes)
        .map_err(|error| format!("无法写入构建说明：{error}"))?;
    files_written += 1;

    Ok(AssemblyResult {
        files_written,
        warnings,
        ready_for_install,
    })
}

fn generate_amd_config(root: &Path, manifest: &EfiBuildManifest) -> Result<(), String> {
    if !(1..=64).contains(&manifest.cpu_core_count) {
        return Err(format!(
            "AMD 物理核心数 {} 超出可安全写入的范围。",
            manifest.cpu_core_count
        ));
    }

    let sample_path = root.join("_sources/Sample.plist");
    let patches_path = root.join("_sources/AMD-Vanilla-patches.plist");
    let mut config = plist::Value::from_file(&sample_path)
        .map_err(|error| format!("无法读取 OpenCore Sample.plist：{error}"))?;
    let patches = plist::Value::from_file(&patches_path)
        .map_err(|error| format!("无法读取 AMD Vanilla 补丁：{error}"))?;
    set_nested(
        &mut config,
        &["DeviceProperties", "Add"],
        plist::Value::Dictionary(plist::Dictionary::new()),
    )?;

    let acpi_add = manifest
        .acpi
        .iter()
        .map(|path| {
            let mut entry = plist::Dictionary::new();
            entry.insert(
                "Comment".into(),
                plist::Value::String("EFI Forge locked ACPI".into()),
            );
            entry.insert("Enabled".into(), plist::Value::Boolean(true));
            entry.insert("Path".into(), plist::Value::String(path.clone()));
            plist::Value::Dictionary(entry)
        })
        .collect();
    set_nested(&mut config, &["ACPI", "Add"], plist::Value::Array(acpi_add))?;

    let mut kexts = Vec::new();
    for bundle_path in manifest
        .components
        .iter()
        .flat_map(|component| component.provides.iter())
        .filter(|provided| provided.ends_with(".kext"))
    {
        let executable = bundle_path.trim_end_matches(".kext");
        let (executable_path, min_kernel) = if bundle_path == "AppleMCEReporterDisabler.kext" {
            (String::new(), "21.4.0".to_string())
        } else {
            (format!("Contents/MacOS/{executable}"), String::new())
        };
        let mut entry = plist::Dictionary::new();
        entry.insert("Arch".into(), plist::Value::String("Any".into()));
        entry.insert(
            "BundlePath".into(),
            plist::Value::String(bundle_path.clone()),
        );
        entry.insert(
            "Comment".into(),
            plist::Value::String("EFI Forge locked kext".into()),
        );
        entry.insert("Enabled".into(), plist::Value::Boolean(true));
        entry.insert(
            "ExecutablePath".into(),
            plist::Value::String(executable_path),
        );
        entry.insert("MaxKernel".into(), plist::Value::String(String::new()));
        entry.insert("MinKernel".into(), plist::Value::String(min_kernel));
        entry.insert(
            "PlistPath".into(),
            plist::Value::String("Contents/Info.plist".into()),
        );
        kexts.push(plist::Value::Dictionary(entry));
    }
    set_nested(&mut config, &["Kernel", "Add"], plist::Value::Array(kexts))?;

    let mut amd_patches = nested_value(&patches, &["Kernel", "Patch"])?
        .as_array()
        .ok_or_else(|| "AMD Vanilla 的 Kernel/Patch 不是数组。".to_string())?
        .clone();
    apply_amd_core_count(&mut amd_patches, manifest.cpu_core_count)?;
    set_nested(
        &mut config,
        &["Kernel", "Patch"],
        plist::Value::Array(amd_patches),
    )?;

    let drivers = manifest
        .drivers
        .iter()
        .map(|path| {
            let mut entry = plist::Dictionary::new();
            entry.insert("Arguments".into(), plist::Value::String(String::new()));
            entry.insert(
                "Comment".into(),
                plist::Value::String("EFI Forge locked driver".into()),
            );
            entry.insert("Enabled".into(), plist::Value::Boolean(true));
            entry.insert("LoadEarly".into(), plist::Value::Boolean(false));
            entry.insert("Path".into(), plist::Value::String(path.clone()));
            plist::Value::Dictionary(entry)
        })
        .collect();
    set_nested(
        &mut config,
        &["UEFI", "Drivers"],
        plist::Value::Array(drivers),
    )?;
    set_nested(
        &mut config,
        &["Misc", "Tools"],
        plist::Value::Array(Vec::new()),
    )?;

    for (path, value) in [
        (
            &["Booter", "Quirks", "EnableWriteUnprotector"][..],
            plist::Value::Boolean(false),
        ),
        (
            &["Booter", "Quirks", "RebuildAppleMemoryMap"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Booter", "Quirks", "ResizeAppleGpuBars"][..],
            plist::Value::Integer((-1_i64).into()),
        ),
        (
            &["Booter", "Quirks", "SetupVirtualMap"][..],
            plist::Value::Boolean(manifest.setup_virtual_map.unwrap_or(true)),
        ),
        (
            &["Booter", "Quirks", "SyncRuntimePermissions"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "DisableLinkeditJettison"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Emulate", "DummyPowerManagement"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "PanicNoKextDump"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "PowerTimeoutKernelPanic"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "ProvideCurrentCpuInfo"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "XhciPortLimit"][..],
            plist::Value::Boolean(false),
        ),
        (
            &["Misc", "Security", "ScanPolicy"][..],
            plist::Value::Integer(0_u64.into()),
        ),
        (
            &["Misc", "Security", "SecureBootModel"][..],
            plist::Value::String("Default".into()),
        ),
        (
            &["Misc", "Security", "Vault"][..],
            plist::Value::String("Optional".into()),
        ),
        (
            &["UEFI", "Quirks", "ResizeGpuBars"][..],
            plist::Value::Integer((-1_i64).into()),
        ),
    ] {
        set_nested(&mut config, path, value)?;
    }

    set_boot_args(&mut config, &manifest.boot_args.join(" "))?;
    apply_smbios(root, &mut config, &manifest.smbios_model)?;

    config
        .to_file_xml(root.join("EFI/OC/config.plist"))
        .map_err(|error| format!("无法写入生成的 config.plist：{error}"))
}

fn generate_intel_config(root: &Path, manifest: &EfiBuildManifest) -> Result<(), String> {
    let mut config = plist::Value::from_file(root.join("_sources/Sample.plist"))
        .map_err(|error| format!("无法读取 OpenCore Sample.plist：{error}"))?;

    let acpi_add = manifest
        .acpi
        .iter()
        .map(|path| {
            let mut entry = plist::Dictionary::new();
            entry.insert(
                "Comment".into(),
                plist::Value::String("EFI Forge locked ACPI".into()),
            );
            entry.insert("Enabled".into(), plist::Value::Boolean(true));
            entry.insert("Path".into(), plist::Value::String(path.clone()));
            plist::Value::Dictionary(entry)
        })
        .collect();
    set_nested(&mut config, &["ACPI", "Add"], plist::Value::Array(acpi_add))?;

    let mut kexts = Vec::new();
    for bundle_path in manifest
        .components
        .iter()
        .flat_map(|component| component.provides.iter())
        .filter(|provided| provided.ends_with(".kext"))
    {
        let executable = bundle_path.trim_end_matches(".kext");
        let mut entry = plist::Dictionary::new();
        entry.insert("Arch".into(), plist::Value::String("Any".into()));
        entry.insert(
            "BundlePath".into(),
            plist::Value::String(bundle_path.clone()),
        );
        entry.insert(
            "Comment".into(),
            plist::Value::String("EFI Forge locked kext".into()),
        );
        entry.insert("Enabled".into(), plist::Value::Boolean(true));
        entry.insert(
            "ExecutablePath".into(),
            plist::Value::String(format!("Contents/MacOS/{executable}")),
        );
        entry.insert("MaxKernel".into(), plist::Value::String(String::new()));
        entry.insert("MinKernel".into(), plist::Value::String(String::new()));
        entry.insert(
            "PlistPath".into(),
            plist::Value::String("Contents/Info.plist".into()),
        );
        kexts.push(plist::Value::Dictionary(entry));
    }
    set_nested(&mut config, &["Kernel", "Add"], plist::Value::Array(kexts))?;
    set_nested(
        &mut config,
        &["Kernel", "Patch"],
        plist::Value::Array(Vec::new()),
    )?;

    let drivers = manifest
        .drivers
        .iter()
        .map(|path| {
            let mut entry = plist::Dictionary::new();
            entry.insert("Arguments".into(), plist::Value::String(String::new()));
            entry.insert(
                "Comment".into(),
                plist::Value::String("EFI Forge locked driver".into()),
            );
            entry.insert("Enabled".into(), plist::Value::Boolean(true));
            entry.insert("LoadEarly".into(), plist::Value::Boolean(false));
            entry.insert("Path".into(), plist::Value::String(path.clone()));
            plist::Value::Dictionary(entry)
        })
        .collect();
    set_nested(
        &mut config,
        &["UEFI", "Drivers"],
        plist::Value::Array(drivers),
    )?;
    set_nested(
        &mut config,
        &["Misc", "Tools"],
        plist::Value::Array(Vec::new()),
    )?;

    let mut device_properties = plist::Dictionary::new();
    if let Some(platform_id) = &manifest.igpu_platform_id {
        let mut igpu = plist::Dictionary::new();
        igpu.insert(
            "AAPL,ig-platform-id".into(),
            plist::Value::Data(decode_hex(platform_id)?),
        );
        if platform_id == "07009B3E" {
            igpu.insert(
                "framebuffer-patch-enable".into(),
                plist::Value::Data(vec![0x01, 0x00, 0x00, 0x00]),
            );
            igpu.insert(
                "framebuffer-stolenmem".into(),
                plist::Value::Data(vec![0x00, 0x00, 0x30, 0x01]),
            );
        }
        device_properties.insert(
            "PciRoot(0x0)/Pci(0x2,0x0)".into(),
            plist::Value::Dictionary(igpu),
        );
    }
    set_nested(
        &mut config,
        &["DeviceProperties", "Add"],
        plist::Value::Dictionary(device_properties),
    )?;

    let is_comet = manifest.platform == "intel-comet-lake";
    let protect_uefi_services = is_comet || manifest.chipset == "Z390";
    for (path, value) in [
        (
            &["Booter", "Quirks", "DevirtualiseMmio"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Booter", "Quirks", "EnableWriteUnprotector"][..],
            plist::Value::Boolean(false),
        ),
        (
            &["Booter", "Quirks", "ProtectUefiServices"][..],
            plist::Value::Boolean(protect_uefi_services),
        ),
        (
            &["Booter", "Quirks", "RebuildAppleMemoryMap"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Booter", "Quirks", "ResizeAppleGpuBars"][..],
            plist::Value::Integer((-1_i64).into()),
        ),
        (
            &["Booter", "Quirks", "SetupVirtualMap"][..],
            plist::Value::Boolean(!is_comet),
        ),
        (
            &["Booter", "Quirks", "SyncRuntimePermissions"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "AppleXcpmCfgLock"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "DisableIoMapper"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "DisableLinkeditJettison"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "PanicNoKextDump"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "PowerTimeoutKernelPanic"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Kernel", "Quirks", "ProvideCurrentCpuInfo"][..],
            plist::Value::Boolean(false),
        ),
        (
            &["Kernel", "Quirks", "XhciPortLimit"][..],
            plist::Value::Boolean(false),
        ),
        (
            &["Misc", "Boot", "HideAuxiliary"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Debug", "AppleDebug"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Debug", "ApplePanic"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Debug", "DisableWatchDog"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Debug", "Target"][..],
            plist::Value::Integer(67_u64.into()),
        ),
        (
            &["Misc", "Security", "AllowSetDefault"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Security", "BlacklistAppleUpdate"][..],
            plist::Value::Boolean(true),
        ),
        (
            &["Misc", "Security", "ScanPolicy"][..],
            plist::Value::Integer(0_u64.into()),
        ),
        (
            &["Misc", "Security", "SecureBootModel"][..],
            plist::Value::String("Default".into()),
        ),
        (
            &["Misc", "Security", "Vault"][..],
            plist::Value::String("Optional".into()),
        ),
        (&["NVRAM", "WriteFlash"][..], plist::Value::Boolean(true)),
        (
            &["UEFI", "Quirks", "ResizeGpuBars"][..],
            plist::Value::Integer((-1_i64).into()),
        ),
    ] {
        set_nested(&mut config, path, value)?;
    }

    set_boot_args(&mut config, &manifest.boot_args.join(" "))?;
    set_nested(
        &mut config,
        &[
            "NVRAM",
            "Add",
            "7C436110-AB2A-4BBB-A880-FE41995C9F82",
            "prev-lang:kbd",
        ],
        plist::Value::String("en-US:0".into()),
    )?;
    apply_smbios(root, &mut config, &manifest.smbios_model)?;

    config
        .to_file_xml(root.join("EFI/OC/config.plist"))
        .map_err(|error| format!("无法写入生成的 Intel config.plist：{error}"))
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    hex::decode(value).map_err(|error| format!("设备属性十六进制数据无效：{error}"))
}

fn apply_amd_core_count(
    amd_patches: &mut [plist::Value],
    physical_cores: u32,
) -> Result<(), String> {
    let mut core_patch_count = 0;
    for patch in amd_patches {
        let Some(dictionary) = patch.as_dictionary_mut() else {
            continue;
        };
        let is_core_patch = dictionary
            .get("Comment")
            .and_then(plist::Value::as_string)
            .is_some_and(|comment| comment.contains("Force cpuid_cores_per_package"));
        if !is_core_patch {
            continue;
        }
        let Some(plist::Value::Data(replace)) = dictionary.get_mut("Replace") else {
            return Err("AMD 核心数补丁缺少 Replace 数据。".into());
        };
        if replace.len() < 2 {
            return Err("AMD 核心数补丁 Replace 数据长度异常。".into());
        }
        replace[1] = physical_cores as u8;
        core_patch_count += 1;
    }
    if core_patch_count != 4 {
        return Err(format!(
            "AMD Vanilla 核心数补丁数量应为 4，实际为 {core_patch_count}；为避免错误启动已停止。"
        ));
    }
    Ok(())
}

fn nested_value<'a>(value: &'a plist::Value, keys: &[&str]) -> Result<&'a plist::Value, String> {
    let mut current = value;
    for key in keys {
        current = current
            .as_dictionary()
            .and_then(|dictionary| dictionary.get(key))
            .ok_or_else(|| format!("plist 缺少路径：{}", keys.join("/")))?;
    }
    Ok(current)
}

fn nested_value_mut<'a>(
    value: &'a mut plist::Value,
    keys: &[&str],
) -> Result<&'a mut plist::Value, String> {
    let mut current = value;
    for key in keys {
        current = current
            .as_dictionary_mut()
            .and_then(|dictionary| dictionary.get_mut(key))
            .ok_or_else(|| format!("config.plist 缺少路径：{}", keys.join("/")))?;
    }
    Ok(current)
}

fn set_nested(
    value: &mut plist::Value,
    keys: &[&str],
    replacement: plist::Value,
) -> Result<(), String> {
    let (last, parents) = keys
        .split_last()
        .ok_or_else(|| "不能写入空 plist 路径。".to_string())?;
    let mut current = value;
    for key in parents {
        current = current
            .as_dictionary_mut()
            .and_then(|dictionary| dictionary.get_mut(key))
            .ok_or_else(|| format!("OpenCore Sample.plist 缺少路径：{}", keys.join("/")))?;
    }
    current
        .as_dictionary_mut()
        .ok_or_else(|| format!("OpenCore Sample.plist 路径不是字典：{}", parents.join("/")))?
        .insert((*last).into(), replacement);
    Ok(())
}

fn set_boot_args(config: &mut plist::Value, boot_args: &str) -> Result<(), String> {
    set_nested(
        config,
        &[
            "NVRAM",
            "Add",
            "7C436110-AB2A-4BBB-A880-FE41995C9F82",
            "boot-args",
        ],
        plist::Value::String(boot_args.into()),
    )
}

fn apply_smbios(root: &Path, config: &mut plist::Value, model: &str) -> Result<(), String> {
    let macserial = root.join("_tools/macserial.exe");
    let output = Command::new(&macserial)
        .args(["-m", model, "-n", "1"])
        .output()
        .map_err(|error| format!("无法运行 OpenCore macserial：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "OpenCore macserial 生成身份失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains('|'))
        .ok_or_else(|| "OpenCore macserial 未返回序列号。".to_string())?
        .to_string();
    let (serial, mlb) = line
        .split_once('|')
        .ok_or_else(|| "OpenCore macserial 返回格式异常。".to_string())?;
    let system_uuid = Uuid::new_v4();
    let mut rom = system_uuid.as_bytes()[..6].to_vec();
    rom[0] = (rom[0] | 0x02) & 0xFE;

    for (key, value) in [
        ("SystemProductName", plist::Value::String(model.into())),
        (
            "SystemSerialNumber",
            plist::Value::String(serial.trim().into()),
        ),
        ("MLB", plist::Value::String(mlb.trim().into())),
        (
            "SystemUUID",
            plist::Value::String(system_uuid.to_string().to_uppercase()),
        ),
        ("ROM", plist::Value::Data(rom)),
    ] {
        set_nested(config, &["PlatformInfo", "Generic", key], value)?;
    }
    set_nested(
        config,
        &["PlatformInfo", "Automatic"],
        plist::Value::Boolean(true),
    )?;
    Ok(())
}

fn run_ocvalidate(root: &Path) -> Result<(), String> {
    let validator = root.join("_tools/ocvalidate.exe");
    let config = root.join("EFI/OC/config.plist");
    run_ocvalidate_binary(&validator, &config)
}

pub(crate) fn run_locked_ocvalidate(root: &Path) -> Result<(), String> {
    let lock: ComponentLockFile =
        serde_json::from_str(include_str!("../../src/data/components.lock.json"))
            .map_err(|error| format!("内置组件锁无法解析：{error}"))?;
    let component = lock
        .components
        .iter()
        .find(|component| component.id == "opencore")
        .ok_or_else(|| "组件锁中缺少 OpenCore。".to_string())?;
    let cache = std::env::temp_dir()
        .join("efi-forge")
        .join("component-cache");
    fs::create_dir_all(&cache).map_err(|error| format!("无法创建组件缓存：{error}"))?;
    let archive_path = ensure_component(&cache, component)?;
    let archive_file = File::open(&archive_path)
        .map_err(|error| format!("无法打开已验证的 OpenCore 组件：{error}"))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("已验证的 OpenCore 组件无法解压：{error}"))?;
    let validator_root = std::env::temp_dir()
        .join("efi-forge")
        .join(format!("ocvalidate-{}", Uuid::new_v4()));
    fs::create_dir_all(&validator_root)
        .map_err(|error| format!("无法创建 ocvalidate 暂存目录：{error}"))?;
    let validator = validator_root.join("ocvalidate.exe");
    let result = (|| -> Result<(), String> {
        extract_file(
            &mut archive,
            "Utilities/ocvalidate/ocvalidate.exe",
            &validator,
        )?;
        run_ocvalidate_binary(&validator, &root.join("EFI/OC/config.plist"))
    })();
    let _ = fs::remove_dir_all(&validator_root);
    result
}

fn run_ocvalidate_binary(validator: &Path, config: &Path) -> Result<(), String> {
    let output = Command::new(validator)
        .arg(config)
        .output()
        .map_err(|error| format!("无法运行同版本 ocvalidate：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let details = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Err(format!("ocvalidate 未通过，构建已停止：{}", details.trim()))
}

fn append_codeless_kext(root: &Path, bundle_name: &str) -> Result<(), String> {
    let config_path = root.join("EFI/OC/config.plist");
    let mut config = plist::Value::from_file(&config_path)
        .map_err(|error| format!("无法读取待加入 USB Map 的 config.plist：{error}"))?;
    let entries = nested_value_mut(&mut config, &["Kernel", "Add"])?
        .as_array_mut()
        .ok_or_else(|| "config.plist 的 Kernel/Add 不是数组。".to_string())?;
    let mut entry = plist::Dictionary::new();
    entry.insert("Arch".into(), plist::Value::String("Any".into()));
    entry.insert(
        "BundlePath".into(),
        plist::Value::String(bundle_name.to_string()),
    );
    entry.insert(
        "Comment".into(),
        plist::Value::String("EFI Forge user codeless USB map".into()),
    );
    entry.insert("Enabled".into(), plist::Value::Boolean(true));
    entry.insert("ExecutablePath".into(), plist::Value::String(String::new()));
    entry.insert("MaxKernel".into(), plist::Value::String(String::new()));
    entry.insert("MinKernel".into(), plist::Value::String(String::new()));
    entry.insert(
        "PlistPath".into(),
        plist::Value::String("Contents/Info.plist".into()),
    );
    entries.push(plist::Value::Dictionary(entry));
    config
        .to_file_xml(&config_path)
        .map_err(|error| format!("无法写回 USB Map 配置：{error}"))
}

fn validate_usb_map(path: &str) -> Result<UsbMapSelection, String> {
    let source = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("无法读取 USB Map：{error}"))?;
    if !source.is_dir() {
        return Err("USB Map 必须是一个 .kext 文件夹。".into());
    }
    let bundle_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.to_ascii_lowercase().ends_with(".kext"))
        .ok_or_else(|| "请选择名称以 .kext 结尾的 USB Map 文件夹。".to_string())?
        .to_string();
    if bundle_name.contains('/') || bundle_name.contains('\\') || bundle_name == ".kext" {
        return Err("USB Map 文件夹名称不安全。".into());
    }
    ensure_tree_has_no_links(&source)?;

    let info_path = source.join("Contents/Info.plist");
    let info = plist::Value::from_file(&info_path)
        .map_err(|error| format!("USB Map 的 Contents/Info.plist 无法解析：{error}"))?;
    let dictionary = info
        .as_dictionary()
        .ok_or_else(|| "USB Map 的 Info.plist 顶层不是字典。".to_string())?;
    if dictionary
        .get("CFBundlePackageType")
        .and_then(plist::Value::as_string)
        != Some("KEXT")
    {
        return Err("所选文件夹不是有效 KEXT。".into());
    }
    let uses_usb_tool_box = dictionary
        .get("OSBundleLibraries")
        .and_then(plist::Value::as_dictionary)
        .is_some_and(|libraries| libraries.contains_key("com.dhinakg.USBToolBox.kext"));
    if !uses_usb_tool_box {
        return Err(
            "当前只接受由 USBToolBox 生成、依赖 com.dhinakg.USBToolBox.kext 的映射。".into(),
        );
    }
    if dictionary
        .get("CFBundleExecutable")
        .and_then(plist::Value::as_string)
        .is_some_and(|value| !value.is_empty())
        || source.join("Contents/MacOS").exists()
    {
        return Err("USB Map 包含可执行内容；安全导入只接受 codeless 映射。".into());
    }
    Ok(UsbMapSelection {
        source_path: source.display().to_string(),
        bundle_name,
    })
}

fn ensure_tree_has_no_links(root: &Path) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|error| format!("无法读取 USB Map：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取 USB Map 条目：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法检查 USB Map 条目：{error}"))?;
        if file_type.is_symlink() || is_reparse_point(&entry.path())? {
            return Err(format!(
                "USB Map 包含符号链接，已拒绝：{}",
                entry.path().display()
            ));
        }
        if file_type.is_dir() {
            ensure_tree_has_no_links(&entry.path())?;
        } else if !file_type.is_file() {
            return Err(format!(
                "USB Map 包含不支持的文件类型：{}",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn ensure_component(cache: &Path, component: &LockedComponent) -> Result<PathBuf, String> {
    let destination = cache.join(&component.asset_name);
    if destination.is_file() && verify_file(&destination, component)? {
        return Ok(destination);
    }

    let partial = cache.join(format!(
        "{}.{}.part",
        component.asset_name,
        std::process::id()
    ));
    let client = reqwest::blocking::Client::builder()
        .user_agent("EFI-Forge/0.1")
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("无法初始化下载器：{error}"))?;
    let response = client
        .get(&component.asset_url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| format!("下载 {} 失败：{error}", component.name))?;
    if response
        .content_length()
        .is_some_and(|length| length != component.size)
    {
        return Err(format!(
            "{} 的远程文件大小与锁定清单不一致。",
            component.name
        ));
    }
    let mut limited_response = response.take(component.size + 1);
    let mut file = File::create(&partial)
        .map_err(|error| format!("无法创建 {} 的下载缓存：{error}", component.name))?;
    io::copy(&mut limited_response, &mut file)
        .map_err(|error| format!("下载 {} 时写入失败：{error}", component.name))?;
    drop(file);

    if !verify_file(&partial, component)? {
        let _ = fs::remove_file(&partial);
        return Err(format!(
            "{} 的大小或 SHA-256 与锁定清单不一致，构建已停止。",
            component.name
        ));
    }
    if destination.exists() {
        fs::remove_file(&destination)
            .map_err(|error| format!("无法更新损坏的组件缓存：{error}"))?;
    }
    fs::rename(&partial, &destination)
        .map_err(|error| format!("无法保存 {} 的已验证缓存：{error}", component.name))?;
    Ok(destination)
}

fn verify_file(path: &Path, component: &LockedComponent) -> Result<bool, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取组件缓存：{error}"))?;
    if metadata.len() != component.size {
        return Ok(false);
    }
    let mut file = File::open(path).map_err(|error| format!("无法校验组件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("读取组件失败：{error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()).eq_ignore_ascii_case(&component.sha256))
}

fn hash_file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("无法读取文件哈希：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("计算文件哈希失败：{error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn extract_file(
    archive: &mut ZipArchive<File>,
    source: &str,
    destination: &Path,
) -> Result<(), String> {
    let mut entry = archive
        .by_name(source)
        .map_err(|_| format!("官方压缩包中缺少 {source}"))?;
    if entry.is_dir() || entry.enclosed_name().is_none() {
        return Err(format!("官方压缩包中的路径无效：{source}"));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建目标目录：{error}"))?;
    }
    let mut output = File::create(destination)
        .map_err(|error| format!("无法写入 {}：{error}", destination.display()))?;
    io::copy(&mut entry, &mut output).map_err(|error| format!("解压 {source} 失败：{error}"))?;
    Ok(())
}

fn find_directory_prefix(archive: &mut ZipArchive<File>, directory_name: &str) -> Option<String> {
    let suffix = format!("{directory_name}/");
    (0..archive.len()).find_map(|index| {
        let entry = archive.by_index(index).ok()?;
        let name = entry.name().replace('\\', "/");
        if entry.is_dir() && name.ends_with(&suffix) {
            Some(name)
        } else {
            None
        }
    })
}

fn extract_directory(
    archive: &mut ZipArchive<File>,
    prefix: &str,
    destination: &Path,
) -> Result<usize, String> {
    let mut written = 0;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 ZIP 条目失败：{error}"))?;
        let name = entry.name().replace('\\', "/");
        if !name.starts_with(prefix) || entry.enclosed_name().is_none() {
            continue;
        }
        let relative = name.strip_prefix(prefix).unwrap_or_default();
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| format!("无法创建 Kext 目录：{error}"))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("无法创建 Kext 子目录：{error}"))?;
            }
            let mut output =
                File::create(&target).map_err(|error| format!("无法写入 Kext：{error}"))?;
            io::copy(&mut entry, &mut output)
                .map_err(|error| format!("解压 Kext 失败：{error}"))?;
            written += 1;
        }
    }
    Ok(written)
}

pub(crate) fn validate_efi_root(selected: &Path) -> Result<EfiValidationResult, String> {
    let selected = selected
        .canonicalize()
        .map_err(|error| format!("无法读取所选目录：{error}"))?;
    let root = if selected.join("EFI").is_dir() {
        selected
    } else if selected
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("EFI"))
    {
        selected.parent().unwrap_or(&selected).to_path_buf()
    } else {
        selected
    };
    let efi = root.join("EFI");
    let oc = efi.join("OC");
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    for required in [
        efi.join("BOOT/BOOTx64.efi"),
        oc.join("OpenCore.efi"),
        oc.join("config.plist"),
    ] {
        if !is_nonempty_file(&required) {
            errors.push(format!(
                "缺少或为空：{}",
                display_relative(&root, &required)
            ));
        }
    }
    for required in [oc.join("ACPI"), oc.join("Drivers"), oc.join("Kexts")] {
        if !required.is_dir() {
            errors.push(format!("缺少目录：{}", display_relative(&root, &required)));
        }
    }

    let config = oc.join("config.plist");
    let config_sha256 = config
        .is_file()
        .then(|| hash_file_sha256(&config))
        .transpose()?;
    if config.is_file() {
        match plist::Value::from_file(&config) {
            Ok(value) => validate_config_references(&root, &value, &mut errors),
            Err(error) => errors.push(format!("config.plist 无法解析：{error}")),
        }
    }
    warnings.push(
        "安全模式不会执行所选 EFI 中的 ocvalidate 或其他程序；仅完成结构与文件引用校验。".into(),
    );
    warnings.push("结构校验不能替代 Recovery 启动和安装实测。".into());

    Ok(EfiValidationResult {
        root_path: root.display().to_string(),
        valid: errors.is_empty(),
        errors,
        warnings,
        validation_level: "structure-only",
        config_sha256,
    })
}

fn validate_config_references(root: &Path, value: &plist::Value, errors: &mut Vec<String>) {
    let Some(config) = value.as_dictionary() else {
        errors.push("config.plist 顶层不是字典。".into());
        return;
    };
    for key in [
        "ACPI",
        "Booter",
        "DeviceProperties",
        "Kernel",
        "Misc",
        "NVRAM",
        "PlatformInfo",
        "UEFI",
    ] {
        if !config.contains_key(key) {
            errors.push(format!("config.plist 缺少顶层键：{key}"));
        }
    }

    validate_enabled_paths(
        config,
        &["ACPI", "Add"],
        "Path",
        &root.join("EFI/OC/ACPI"),
        errors,
    );
    validate_enabled_paths(
        config,
        &["Kernel", "Add"],
        "BundlePath",
        &root.join("EFI/OC/Kexts"),
        errors,
    );
    validate_enabled_kext_subpaths(config, &root.join("EFI/OC/Kexts"), errors);
    validate_enabled_paths(
        config,
        &["UEFI", "Drivers"],
        "Path",
        &root.join("EFI/OC/Drivers"),
        errors,
    );
}

fn validate_enabled_kext_subpaths(
    config: &plist::Dictionary,
    directory: &Path,
    errors: &mut Vec<String>,
) {
    let Some(entries) = config
        .get("Kernel")
        .and_then(plist::Value::as_dictionary)
        .and_then(|kernel| kernel.get("Add"))
        .and_then(plist::Value::as_array)
    else {
        return;
    };

    for entry in entries {
        let Some(dict) = entry.as_dictionary() else {
            continue;
        };
        if !dict
            .get("Enabled")
            .and_then(plist::Value::as_boolean)
            .unwrap_or(false)
        {
            continue;
        }
        let Some(bundle_path) = dict.get("BundlePath").and_then(plist::Value::as_string) else {
            continue;
        };
        if !is_safe_relative_path(bundle_path) {
            continue;
        }
        let bundle = directory.join(bundle_path);
        if !bundle.is_dir() {
            continue;
        }

        for path_key in ["ExecutablePath", "PlistPath"] {
            let Some(relative) = dict.get(path_key).and_then(plist::Value::as_string) else {
                continue;
            };
            if relative.is_empty() {
                continue;
            }
            if !is_safe_relative_path(relative) || !bundle.join(relative).is_file() {
                errors.push(format!(
                    "Kernel/Add 引用的 Kext 内部文件不存在或路径不安全：{bundle_path}/{relative}"
                ));
            }
        }
    }
}

fn is_safe_relative_path(value: &str) -> bool {
    !value.is_empty()
        && !Path::new(value).is_absolute()
        && Path::new(value)
            .components()
            .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn validate_enabled_paths(
    config: &plist::Dictionary,
    keys: &[&str],
    path_key: &str,
    directory: &Path,
    errors: &mut Vec<String>,
) {
    let mut value = config.get(keys[0]);
    for key in &keys[1..] {
        value = value
            .and_then(plist::Value::as_dictionary)
            .and_then(|dict| dict.get(key));
    }
    let Some(entries) = value.and_then(plist::Value::as_array) else {
        return;
    };
    for entry in entries {
        let Some(dict) = entry.as_dictionary() else {
            continue;
        };
        if !dict
            .get("Enabled")
            .and_then(plist::Value::as_boolean)
            .unwrap_or(false)
        {
            continue;
        }
        let Some(relative) = dict.get(path_key).and_then(plist::Value::as_string) else {
            errors.push(format!("{} 中启用项缺少 {path_key}", keys.join("/")));
            continue;
        };
        if !is_safe_relative_path(relative) || !directory.join(relative).exists() {
            errors.push(format!(
                "{} 引用的文件不存在或路径不安全：{relative}",
                keys.join("/")
            ));
        }
    }
}

fn copy_to_empty_target(source_root: &Path, target: &Path) -> Result<InstallCopyResult, String> {
    let source_root = source_root
        .canonicalize()
        .map_err(|error| format!("无法读取源 EFI：{error}"))?;
    let target = target
        .canonicalize()
        .map_err(|error| format!("无法读取目标目录：{error}"))?;
    if target == source_root || target.starts_with(&source_root) || source_root.starts_with(&target)
    {
        return Err("源目录与目标目录不能相同或互相包含。".into());
    }
    let mut entries =
        fs::read_dir(&target).map_err(|error| format!("无法检查目标目录：{error}"))?;
    if entries.next().is_some() {
        return Err("目标目录不是空目录。为避免破坏已有数据，复制已停止。".into());
    }

    let staging = target.join(format!(".efi-forge-copy-{}", std::process::id()));
    fs::create_dir(&staging).map_err(|error| format!("无法创建复制暂存目录：{error}"))?;
    let copied = copy_directory(&source_root.join("EFI"), &staging.join("EFI"));
    if let Err(error) = copied {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let files_copied = copied.unwrap();
    fs::rename(staging.join("EFI"), target.join("EFI")).map_err(|error| {
        let _ = fs::remove_dir_all(&staging);
        format!("无法完成 EFI 复制：{error}")
    })?;
    fs::remove_dir(&staging).map_err(|error| format!("无法清理复制暂存目录：{error}"))?;
    Ok(InstallCopyResult {
        target_path: target.join("EFI").display().to_string(),
        files_copied,
    })
}

fn merge_efi_roots(
    generated_root: &Path,
    custom_root: &Path,
    parent: &Path,
    preferred_source: &str,
) -> Result<EfiMergeResult, String> {
    let generated_root = generated_root
        .canonicalize()
        .map_err(|error| format!("无法读取项目生成 EFI：{error}"))?;
    let custom_root = custom_root
        .canonicalize()
        .map_err(|error| format!("无法读取用户 EFI：{error}"))?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("无法读取融合保存位置：{error}"))?;
    if parent.starts_with(&generated_root) || parent.starts_with(&custom_root) {
        return Err("融合保存位置不能位于任一源 EFI 内部。".into());
    }

    let (preferred, secondary, preferred_label) = match preferred_source {
        "generated" => (&generated_root, &custom_root, "generated"),
        "custom" => (&custom_root, &generated_root, "custom"),
        _ => return Err("未知的 EFI 冲突优先级。".into()),
    };
    let output = unused_child_path(&parent, "EFI-Forge-Merged")?;
    let staging = parent.join(format!(
        ".efi-forge-merge-{}-{}",
        std::process::id(),
        unix_seconds()
    ));
    if staging.exists() {
        return Err("融合暂存目录已存在，请稍后重试。".into());
    }
    fs::create_dir(&staging).map_err(|error| format!("无法创建融合暂存目录：{error}"))?;

    let result = (|| -> Result<EfiMergeResult, String> {
        let files_from_preferred = copy_directory(&preferred.join("EFI"), &staging.join("EFI"))?;
        let mut added_files = Vec::new();
        let mut conflicts = Vec::new();
        copy_missing_entries(
            &secondary.join("EFI"),
            &staging.join("EFI"),
            &staging,
            &mut added_files,
            &mut conflicts,
        )?;

        let validation = validate_efi_root(&staging)?;
        if !validation.valid {
            return Err(format!(
                "融合结果结构损坏，已停止且不会保留输出：{}",
                validation.errors.join("；")
            ));
        }

        let inactive_added_files = inactive_added_components(&staging, &added_files)?;
        let mut warnings = vec![
            "融合结果只完成结构与引用检查；不会执行用户 EFI 中的任何程序，也不代表真机可启动。"
                .into(),
            "同名冲突保留主来源版本；次来源只补充主来源中不存在的文件。".into(),
        ];
        if !inactive_added_files.is_empty() {
            warnings.push(format!(
                "有 {} 个补入组件未被主来源 config.plist 启用，已保留但不会自动加载。",
                inactive_added_files.len()
            ));
        }

        let report = EfiMergeResult {
            output_path: output.display().to_string(),
            preferred_source: preferred_label.into(),
            files_from_preferred,
            missing_files_added: added_files.len(),
            conflicts_kept: conflicts.len(),
            added_files,
            inactive_added_files,
            warnings,
            validation_level: "structure-only",
            config_sha256: validation
                .config_sha256
                .ok_or_else(|| "融合结果缺少 config.plist 哈希。".to_string())?,
        };
        let report_json = serde_json::to_string_pretty(&report)
            .map_err(|error| format!("无法生成融合报告：{error}"))?;
        fs::write(staging.join("EFI-FORGE-MERGE-REPORT.json"), report_json)
            .map_err(|error| format!("无法写入融合报告：{error}"))?;
        fs::write(
            staging.join("README-FIRST.txt"),
            "EFI Forge 融合副本\r\n\r\n此目录由两份 EFI 静态融合而成，原始目录未修改。\r\n同名冲突遵循用户选择，次来源只补充缺失文件。\r\n补入但未被 config.plist 引用的组件不会自动启用。\r\n当前仅通过结构与引用检查，请先在独立 U 盘测试 OpenCore 和 Recovery。\r\n",
        )
        .map_err(|error| format!("无法写入融合说明：{error}"))?;
        Ok(report)
    })();

    match result {
        Ok(mut report) => {
            fs::rename(&staging, &output).map_err(|error| {
                let _ = fs::remove_dir_all(&staging);
                format!("无法完成融合副本写入：{error}")
            })?;
            report.output_path = output.display().to_string();
            Ok(report)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

fn copy_missing_entries(
    source: &Path,
    destination: &Path,
    report_root: &Path,
    added_files: &mut Vec<String>,
    conflicts: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|error| format!("无法读取次来源 EFI：{error}"))?
    {
        let entry = entry.map_err(|error| format!("无法读取次来源 EFI 条目：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法检查次来源 EFI 条目：{error}"))?;
        let source_path = entry.path();
        if file_type.is_symlink() || is_reparse_point(&source_path)? {
            return Err(format!(
                "次来源 EFI 包含符号链接或重解析点，融合已停止：{}",
                source_path.display()
            ));
        }
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            if target.exists() && !target.is_dir() {
                conflicts.push(display_relative(report_root, &target));
            } else {
                if !target.exists() {
                    fs::create_dir(&target)
                        .map_err(|error| format!("无法创建融合目录：{error}"))?;
                }
                copy_missing_entries(&source_path, &target, report_root, added_files, conflicts)?;
            }
        } else if file_type.is_file() {
            if is_forbidden_windows_payload(&source_path) {
                return Err(format!(
                    "次来源 EFI 包含不允许的 Windows 程序或脚本，融合已停止：{}",
                    source_path.display()
                ));
            }
            if target.exists() {
                conflicts.push(display_relative(report_root, &target));
            } else {
                fs::copy(&source_path, &target)
                    .map_err(|error| format!("补充 EFI 文件失败：{error}"))?;
                added_files.push(display_relative(report_root, &target).replace('\\', "/"));
            }
        }
    }
    Ok(())
}

fn inactive_added_components(root: &Path, added_files: &[String]) -> Result<Vec<String>, String> {
    let config = plist::Value::from_file(root.join("EFI/OC/config.plist"))
        .map_err(|error| format!("无法分析融合后的 config.plist：{error}"))?;
    let active = active_component_paths(&config);
    let mut components = BTreeSet::new();
    for path in added_files {
        let normalized = path.replace('\\', "/");
        for (prefix, bundle) in [
            ("EFI/OC/ACPI/", false),
            ("EFI/OC/Drivers/", false),
            ("EFI/OC/Kexts/", true),
        ] {
            let Some(relative) = normalized.strip_prefix(prefix) else {
                continue;
            };
            let component = if bundle {
                relative
                    .split('/')
                    .next()
                    .map(|name| format!("{prefix}{name}"))
            } else if relative.contains('/') {
                None
            } else {
                Some(format!("{prefix}{relative}"))
            };
            if let Some(component) = component {
                components.insert(component);
            }
        }
    }
    Ok(components
        .into_iter()
        .filter(|component| !active.contains(&component.to_ascii_lowercase()))
        .collect())
}

fn active_component_paths(config: &plist::Value) -> BTreeSet<String> {
    let Some(dictionary) = config.as_dictionary() else {
        return BTreeSet::new();
    };
    let mut active = BTreeSet::new();
    collect_active_paths(
        dictionary,
        &["ACPI", "Add"],
        "Path",
        "EFI/OC/ACPI/",
        &mut active,
    );
    collect_active_paths(
        dictionary,
        &["Kernel", "Add"],
        "BundlePath",
        "EFI/OC/Kexts/",
        &mut active,
    );
    collect_active_paths(
        dictionary,
        &["UEFI", "Drivers"],
        "Path",
        "EFI/OC/Drivers/",
        &mut active,
    );
    active
}

fn collect_active_paths(
    config: &plist::Dictionary,
    keys: &[&str],
    path_key: &str,
    prefix: &str,
    active: &mut BTreeSet<String>,
) {
    let mut value = config.get(keys[0]);
    for key in &keys[1..] {
        value = value
            .and_then(plist::Value::as_dictionary)
            .and_then(|dictionary| dictionary.get(key));
    }
    let Some(entries) = value.and_then(plist::Value::as_array) else {
        return;
    };
    for entry in entries {
        let Some(dictionary) = entry.as_dictionary() else {
            continue;
        };
        if !dictionary
            .get("Enabled")
            .and_then(plist::Value::as_boolean)
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(path) = dictionary.get(path_key).and_then(plist::Value::as_string) {
            active.insert(
                format!("{prefix}{path}")
                    .replace('\\', "/")
                    .to_ascii_lowercase(),
            );
        }
    }
}

fn is_forbidden_windows_payload(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "exe" | "com" | "bat" | "cmd" | "ps1" | "vbs" | "js" | "msi" | "scr"
            )
        })
}

pub(crate) fn copy_directory(source: &Path, destination: &Path) -> Result<usize, String> {
    fs::create_dir(destination).map_err(|error| format!("无法创建目标 EFI 目录：{error}"))?;
    let mut copied = 0;
    for entry in fs::read_dir(source).map_err(|error| format!("无法读取源 EFI：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取源 EFI 条目：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法检查 EFI 条目：{error}"))?;
        let target = destination.join(entry.file_name());
        if file_type.is_symlink() || is_reparse_point(&entry.path())? {
            return Err(format!(
                "EFI 中包含符号链接，复制已停止：{}",
                entry.path().display()
            ));
        }
        if file_type.is_dir() {
            copied += copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            if is_forbidden_windows_payload(&entry.path()) {
                return Err(format!(
                    "EFI 中包含不允许的 Windows 程序或脚本，复制已停止：{}",
                    entry.path().display()
                ));
            }
            fs::copy(entry.path(), target)
                .map_err(|error| format!("复制 EFI 文件失败：{error}"))?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn is_nonempty_file(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}

pub(crate) fn is_reparse_point(path: &Path) -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("无法检查 Windows 重解析点：{error}"))?;
        Ok(metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(false)
    }
}

fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}

pub(crate) fn unused_child_path(parent: &Path, base_name: &str) -> Result<PathBuf, String> {
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            base_name.to_string()
        } else {
            format!("{base_name}-{suffix}")
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("保存位置中同名构建目录过多，请选择其他目录。".into())
}

fn safe_name(value: &str) -> String {
    let filtered: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect();
    if filtered.trim_matches('-').is_empty() {
        "custom".into()
    } else {
        filtered
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct TestComponentLock {
        components: Vec<LockedComponent>,
    }

    fn test_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("efi-forge-{label}-{}-{nanos}", std::process::id()))
    }

    fn create_valid_efi(root: &Path) {
        for directory in [
            root.join("EFI/BOOT"),
            root.join("EFI/OC/ACPI"),
            root.join("EFI/OC/Drivers"),
            root.join("EFI/OC/Kexts"),
        ] {
            fs::create_dir_all(directory).unwrap();
        }
        fs::write(root.join("EFI/BOOT/BOOTx64.efi"), b"boot").unwrap();
        fs::write(root.join("EFI/OC/OpenCore.efi"), b"opencore").unwrap();

        let mut config = plist::Dictionary::new();
        for key in [
            "ACPI",
            "Booter",
            "DeviceProperties",
            "Kernel",
            "Misc",
            "NVRAM",
            "PlatformInfo",
            "UEFI",
        ] {
            config.insert(
                key.into(),
                plist::Value::Dictionary(plist::Dictionary::new()),
            );
        }
        plist::Value::Dictionary(config)
            .to_file_xml(root.join("EFI/OC/config.plist"))
            .unwrap();
    }

    #[test]
    fn safe_name_removes_path_separators() {
        assert_eq!(safe_name("../coffee/lake"), "---coffee-lake");
    }

    #[test]
    fn rejects_a_manifest_without_core_kexts() {
        let lock: TestComponentLock =
            serde_json::from_str(include_str!("../../src/data/components.lock.json")).unwrap();
        let components = lock
            .components
            .into_iter()
            .filter(|component| component.id == "opencore")
            .collect();
        let manifest = EfiBuildManifest {
            schema_version: 1,
            target_mac_os: "14".into(),
            profile: "manual-uefi-candidate".into(),
            platform: "unknown".into(),
            cpu_core_count: 4,
            chipset: "unknown".into(),
            smbios_model: "iMac19,1".into(),
            igpu_platform_id: None,
            boot_args: vec!["-v".into()],
            setup_virtual_map: None,
            auto_config_supported: false,
            components,
            acpi: Vec::new(),
            drivers: vec!["OpenRuntime.efi".into(), "OpenHfsPlus.efi".into()],
            notes: Vec::new(),
        };

        let error = validate_manifest_lock(&manifest).unwrap_err();
        assert!(error.contains("Lilu.kext"));
        assert!(error.contains("VirtualSMC.kext"));
    }

    #[test]
    fn refuses_unreviewed_intel_chipsets_for_automatic_config() {
        let manifest = EfiBuildManifest {
            schema_version: 1,
            target_mac_os: "14".into(),
            profile: "intel-coffee-lake-Z370-desktop".into(),
            platform: "intel-coffee-lake".into(),
            cpu_core_count: 6,
            chipset: "Z370".into(),
            smbios_model: "iMac19,1".into(),
            igpu_platform_id: Some("07009B3E".into()),
            boot_args: vec!["-v".into()],
            setup_virtual_map: None,
            auto_config_supported: true,
            components: Vec::new(),
            acpi: vec![
                "SSDT-PLUG-DRTNIA.aml".into(),
                "SSDT-EC-USBX-DESKTOP.aml".into(),
            ],
            drivers: Vec::new(),
            notes: Vec::new(),
        };

        let error = validate_automatic_platform(&manifest).unwrap_err();
        assert!(error.contains("尚未开放"));
    }

    #[test]
    fn requires_cpur_only_for_reviewed_amd_500_series_chipsets() {
        for (chipset, acpi, expected) in [
            (
                "B550",
                vec!["SSDT-EC-USBX-DESKTOP.aml".into()],
                Some("SSDT-CPUR.aml"),
            ),
            (
                "A520",
                vec!["SSDT-EC-USBX-DESKTOP.aml".into(), "SSDT-CPUR.aml".into()],
                None,
            ),
            ("X570", vec!["SSDT-EC-USBX-DESKTOP.aml".into()], None),
            ("X470", vec!["SSDT-EC-USBX-DESKTOP.aml".into()], None),
        ] {
            let manifest = EfiBuildManifest {
                schema_version: 1,
                target_mac_os: "14".into(),
                profile: format!("amd-zen-{chipset}-desktop"),
                platform: "amd-zen".into(),
                cpu_core_count: 8,
                chipset: chipset.into(),
                smbios_model: "MacPro7,1".into(),
                igpu_platform_id: None,
                boot_args: vec!["-v".into()],
                setup_virtual_map: Some(false),
                auto_config_supported: true,
                components: Vec::new(),
                acpi,
                drivers: Vec::new(),
                notes: Vec::new(),
            };

            let result = validate_automatic_platform(&manifest);
            match expected {
                Some(required) => assert!(result.unwrap_err().contains(required)),
                None => result.unwrap(),
            }
        }
    }

    #[test]
    fn writes_physical_core_count_to_all_four_amd_patches() {
        let mut patches = (0..4)
            .map(|index| {
                let mut patch = plist::Dictionary::new();
                patch.insert(
                    "Comment".into(),
                    plist::Value::String(format!(
                        "algrey | Force cpuid_cores_per_package to constant (user-specified) | {index}"
                    )),
                );
                patch.insert(
                    "Replace".into(),
                    plist::Value::Data(vec![0xB8, 0x00, 0, 0, 0, 0]),
                );
                plist::Value::Dictionary(patch)
            })
            .collect::<Vec<_>>();

        apply_amd_core_count(&mut patches, 6).unwrap();

        for patch in patches {
            let replace = patch
                .as_dictionary()
                .and_then(|dictionary| dictionary.get("Replace"))
                .and_then(plist::Value::as_data)
                .unwrap();
            assert_eq!(replace[1], 6);
        }
    }

    #[test]
    fn unused_path_never_overwrites_existing_directory() {
        let parent = test_root("unused-path");
        fs::create_dir_all(parent.join("build")).unwrap();
        assert_eq!(
            unused_child_path(&parent, "build").unwrap(),
            parent.join("build-1")
        );
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn validates_and_copies_a_structurally_complete_efi() {
        let source = test_root("valid-source");
        let target = test_root("empty-target");
        fs::create_dir_all(&target).unwrap();
        create_valid_efi(&source);

        let validation = validate_efi_root(&source).unwrap();
        assert!(validation.valid, "{:?}", validation.errors);
        assert!(validation
            .config_sha256
            .as_deref()
            .is_some_and(|hash| hash.len() == 64
                && hash.chars().all(|character| character.is_ascii_hexdigit())));
        let result = copy_to_empty_target(&source, &target).unwrap();
        assert_eq!(result.files_copied, 3);
        assert!(target.join("EFI/OC/config.plist").is_file());

        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    fn rejects_enabled_kext_with_a_missing_internal_executable() {
        let source = test_root("missing-kext-executable");
        create_valid_efi(&source);
        fs::create_dir_all(source.join("EFI/OC/Kexts/Demo.kext/Contents")).unwrap();
        fs::write(
            source.join("EFI/OC/Kexts/Demo.kext/Contents/Info.plist"),
            b"plist",
        )
        .unwrap();

        let config_path = source.join("EFI/OC/config.plist");
        let mut config = plist::Value::from_file(&config_path).unwrap();
        let mut entry = plist::Dictionary::new();
        entry.insert("Enabled".into(), plist::Value::Boolean(true));
        entry.insert(
            "BundlePath".into(),
            plist::Value::String("Demo.kext".into()),
        );
        entry.insert(
            "ExecutablePath".into(),
            plist::Value::String("Contents/MacOS/Demo".into()),
        );
        entry.insert(
            "PlistPath".into(),
            plist::Value::String("Contents/Info.plist".into()),
        );
        config
            .as_dictionary_mut()
            .unwrap()
            .get_mut("Kernel")
            .and_then(plist::Value::as_dictionary_mut)
            .unwrap()
            .insert(
                "Add".into(),
                plist::Value::Array(vec![plist::Value::Dictionary(entry)]),
            );
        config.to_file_xml(&config_path).unwrap();

        let validation = validate_efi_root(&source).unwrap();

        assert!(!validation.valid);
        assert!(validation
            .errors
            .iter()
            .any(|error| error.contains("Contents/MacOS/Demo")));
        fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn merges_two_valid_efi_roots_without_overwriting_either_source() {
        let generated = test_root("merge-generated");
        let custom = test_root("merge-custom");
        let parent = test_root("merge-output");
        create_valid_efi(&generated);
        create_valid_efi(&custom);
        fs::create_dir_all(generated.join("EFI/OC/Drivers")).unwrap();
        fs::write(generated.join("EFI/OC/Drivers/Conflict.efi"), b"generated").unwrap();
        fs::write(custom.join("EFI/OC/Drivers/Conflict.efi"), b"custom").unwrap();
        fs::create_dir_all(custom.join("EFI/OC/Kexts/UserOnly.kext/Contents")).unwrap();
        fs::write(
            custom.join("EFI/OC/Kexts/UserOnly.kext/Contents/Info.plist"),
            b"user-only",
        )
        .unwrap();
        fs::create_dir_all(&parent).unwrap();

        let result = merge_efi_roots(&generated, &custom, &parent, "generated").unwrap();
        let output = PathBuf::from(&result.output_path);

        assert_eq!(
            fs::read(output.join("EFI/OC/Drivers/Conflict.efi")).unwrap(),
            b"generated"
        );
        assert!(output
            .join("EFI/OC/Kexts/UserOnly.kext/Contents/Info.plist")
            .is_file());
        assert_eq!(result.missing_files_added, 1);
        assert_eq!(result.config_sha256.len(), 64);
        assert!(result.conflicts_kept >= 4);
        assert_eq!(
            result.inactive_added_files,
            vec!["EFI/OC/Kexts/UserOnly.kext"]
        );
        assert!(output.join("EFI-FORGE-MERGE-REPORT.json").is_file());
        assert_eq!(
            fs::read(generated.join("EFI/OC/Drivers/Conflict.efi")).unwrap(),
            b"generated"
        );
        assert_eq!(
            fs::read(custom.join("EFI/OC/Drivers/Conflict.efi")).unwrap(),
            b"custom"
        );

        fs::remove_dir_all(generated).unwrap();
        fs::remove_dir_all(custom).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn rejects_windows_payloads_and_removes_only_the_new_merge_staging_directory() {
        let generated = test_root("merge-safe-generated");
        let custom = test_root("merge-unsafe-custom");
        let parent = test_root("merge-safe-output");
        create_valid_efi(&generated);
        create_valid_efi(&custom);
        fs::create_dir_all(custom.join("EFI/OC/Tools")).unwrap();
        fs::write(custom.join("EFI/OC/Tools/run-me.exe"), b"never execute").unwrap();
        fs::create_dir_all(&parent).unwrap();

        let error = merge_efi_roots(&generated, &custom, &parent, "generated").unwrap_err();

        assert!(error.contains("Windows 程序或脚本"));
        assert!(fs::read_dir(&parent).unwrap().next().is_none());
        assert!(custom.join("EFI/OC/Tools/run-me.exe").is_file());

        fs::remove_dir_all(generated).unwrap();
        fs::remove_dir_all(custom).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn never_executes_ocvalidate_from_a_custom_efi() {
        let source = test_root("untrusted-validator");
        create_valid_efi(&source);
        fs::create_dir_all(source.join("_tools")).unwrap();
        fs::write(
            source.join("_tools/ocvalidate.exe"),
            b"this file must never be executed",
        )
        .unwrap();

        let validation = validate_efi_root(&source).unwrap();

        assert!(validation.valid, "{:?}", validation.errors);
        assert!(validation
            .warnings
            .iter()
            .any(|warning| warning.contains("不会执行所选 EFI")));
        fs::remove_dir_all(source).unwrap();
    }

    fn create_usb_map(root: &Path, executable: bool) {
        let map = root.join("UTBMap.kext/Contents");
        fs::create_dir_all(&map).unwrap();
        let mut libraries = plist::Dictionary::new();
        libraries.insert(
            "com.dhinakg.USBToolBox.kext".into(),
            plist::Value::String("1.0.0".into()),
        );
        let mut info = plist::Dictionary::new();
        info.insert(
            "CFBundlePackageType".into(),
            plist::Value::String("KEXT".into()),
        );
        info.insert(
            "OSBundleLibraries".into(),
            plist::Value::Dictionary(libraries),
        );
        if executable {
            info.insert(
                "CFBundleExecutable".into(),
                plist::Value::String("payload".into()),
            );
        }
        plist::Value::Dictionary(info)
            .to_file_xml(map.join("Info.plist"))
            .unwrap();
    }

    #[test]
    fn accepts_only_codeless_usb_tool_box_maps() {
        let safe_root = test_root("safe-usb-map");
        create_usb_map(&safe_root, false);
        let selection = validate_usb_map(
            safe_root
                .join("UTBMap.kext")
                .to_str()
                .expect("temporary path is valid UTF-8"),
        )
        .unwrap();
        assert_eq!(selection.bundle_name, "UTBMap.kext");

        let executable_root = test_root("executable-usb-map");
        create_usb_map(&executable_root, true);
        let error = validate_usb_map(
            executable_root
                .join("UTBMap.kext")
                .to_str()
                .expect("temporary path is valid UTF-8"),
        )
        .unwrap_err();
        assert!(error.contains("可执行内容"));

        fs::remove_dir_all(safe_root).unwrap();
        fs::remove_dir_all(executable_root).unwrap();
    }

    #[test]
    fn refuses_to_copy_into_a_nonempty_target() {
        let source = test_root("nonempty-source");
        let target = test_root("nonempty-target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("keep-me.txt"), b"user data").unwrap();
        create_valid_efi(&source);

        let error = copy_to_empty_target(&source, &target).unwrap_err();
        assert!(error.contains("不是空目录"));
        assert_eq!(fs::read(target.join("keep-me.txt")).unwrap(), b"user data");

        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(target).unwrap();
    }

    #[test]
    #[ignore = "downloads pinned upstream release assets"]
    fn downloads_and_verifies_gate2_locked_components() {
        let lock: TestComponentLock =
            serde_json::from_str(include_str!("../../src/data/components.lock.json")).unwrap();
        let expected = [
            ("realtek-rtl8111", "RealtekRTL8111.kext"),
            ("nvme-fix", "NVMeFix.kext"),
            ("usb-tool-box", "USBToolBox.kext"),
        ];
        let cache = test_root("gate2-components");
        fs::create_dir_all(&cache).unwrap();

        for (id, provided) in expected {
            let component = lock
                .components
                .iter()
                .find(|component| component.id == id)
                .unwrap();
            let archive_path = ensure_component(&cache, component).unwrap();
            let archive_file = File::open(archive_path).unwrap();
            let mut archive = ZipArchive::new(archive_file).unwrap();
            assert!(find_directory_prefix(&mut archive, provided).is_some());
        }

        fs::remove_dir_all(cache).unwrap();
    }

    #[test]
    #[ignore = "downloads pinned upstream release assets"]
    fn builds_and_validates_a_real_ryzen_b450_candidate() {
        let lock: TestComponentLock =
            serde_json::from_str(include_str!("../../src/data/components.lock.json")).unwrap();
        let required = BTreeSet::from([
            "opencore",
            "lilu",
            "virtual-smc",
            "apple-mce-reporter-disabler",
            "apple-alc",
            "lucy-rtl8125",
            "amd-vanilla-patches",
            "dortania-ssdt-ec-usbx-desktop",
        ]);
        let components = lock
            .components
            .into_iter()
            .filter(|component| required.contains(component.id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(components.len(), required.len());

        let manifest = EfiBuildManifest {
            schema_version: 1,
            target_mac_os: "14".into(),
            profile: "amd-zen-desktop".into(),
            platform: "amd-zen".into(),
            cpu_core_count: 6,
            chipset: "B450".into(),
            smbios_model: "MacPro7,1".into(),
            igpu_platform_id: None,
            boot_args: vec!["-v".into(), "debug=0x100".into(), "keepsyms=1".into()],
            setup_virtual_map: Some(true),
            auto_config_supported: true,
            components,
            acpi: vec!["SSDT-EC-USBX-DESKTOP.aml".into()],
            drivers: vec!["OpenRuntime.efi".into(), "OpenHfsPlus.efi".into()],
            notes: Vec::new(),
        };
        let parent = test_root("real-amd-build");
        fs::create_dir_all(&parent).unwrap();

        let result = build_scaffold(&parent, &manifest, None).unwrap();
        let output = PathBuf::from(&result.output_path);
        assert!(result.ready_for_install);
        assert!(output.join("EFI/OC/config.plist").is_file());
        assert!(output
            .join("EFI/OC/ACPI/SSDT-EC-USBX-DESKTOP.aml")
            .is_file());
        assert!(output
            .join("EFI/OC/Kexts/LucyRTL8125Ethernet.kext/Contents/Info.plist")
            .is_file());
        assert!(output
            .join("EFI/OC/Kexts/AppleMCEReporterDisabler.kext/Contents/Info.plist")
            .is_file());
        assert!(!output.join("EFI/OC/ACPI/SSDT-PLUG.aml").exists());
        let validation = validate_efi_root(&output).unwrap();
        assert!(validation.valid, "{:?}", validation.errors);
        run_locked_ocvalidate(&output).unwrap();

        let config = plist::Value::from_file(output.join("EFI/OC/config.plist")).unwrap();
        let patches = nested_value(&config, &["Kernel", "Patch"])
            .unwrap()
            .as_array()
            .unwrap();
        let core_values = patches
            .iter()
            .filter_map(plist::Value::as_dictionary)
            .filter(|patch| {
                patch
                    .get("Comment")
                    .and_then(plist::Value::as_string)
                    .is_some_and(|comment| comment.contains("Force cpuid_cores_per_package"))
            })
            .map(|patch| {
                patch
                    .get("Replace")
                    .and_then(plist::Value::as_data)
                    .unwrap()[1]
            })
            .collect::<Vec<_>>();
        assert_eq!(core_values, vec![6, 6, 6, 6]);
        assert_eq!(
            nested_value(&config, &["Kernel", "Quirks", "ProvideCurrentCpuInfo"])
                .unwrap()
                .as_boolean(),
            Some(true)
        );
        assert_eq!(
            nested_value(&config, &["Kernel", "Emulate", "DummyPowerManagement"])
                .unwrap()
                .as_boolean(),
            Some(true)
        );
        assert_eq!(
            nested_value(&config, &["Booter", "Quirks", "SetupVirtualMap"])
                .unwrap()
                .as_boolean(),
            Some(true)
        );
        let mce_entry = nested_value(&config, &["Kernel", "Add"])
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .filter_map(plist::Value::as_dictionary)
            .find(|entry| {
                entry.get("BundlePath").and_then(plist::Value::as_string)
                    == Some("AppleMCEReporterDisabler.kext")
            })
            .unwrap();
        assert_eq!(
            mce_entry
                .get("ExecutablePath")
                .and_then(plist::Value::as_string),
            Some("")
        );
        assert_eq!(
            mce_entry.get("MinKernel").and_then(plist::Value::as_string),
            Some("21.4.0")
        );

        let empty_target = parent.join("empty-target");
        fs::create_dir(&empty_target).unwrap();
        let copied = copy_to_empty_target(&output, &empty_target).unwrap();
        assert!(copied.files_copied > 0);
        assert!(empty_target.join("EFI/OC/config.plist").is_file());

        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    #[ignore = "downloads pinned upstream release assets"]
    fn builds_and_validates_a_real_ryzen_b550_candidate() {
        let lock: TestComponentLock =
            serde_json::from_str(include_str!("../../src/data/components.lock.json")).unwrap();
        let required = BTreeSet::from([
            "opencore",
            "lilu",
            "virtual-smc",
            "apple-mce-reporter-disabler",
            "amd-vanilla-patches",
            "dortania-ssdt-ec-usbx-desktop",
            "dortania-ssdt-cpur",
        ]);
        let components = lock
            .components
            .into_iter()
            .filter(|component| required.contains(component.id.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(components.len(), required.len());

        let manifest = EfiBuildManifest {
            schema_version: 1,
            target_mac_os: "14".into(),
            profile: "amd-zen-B550-desktop".into(),
            platform: "amd-zen".into(),
            cpu_core_count: 8,
            chipset: "B550".into(),
            smbios_model: "MacPro7,1".into(),
            igpu_platform_id: None,
            boot_args: vec!["-v".into(), "debug=0x100".into(), "keepsyms=1".into()],
            setup_virtual_map: Some(false),
            auto_config_supported: true,
            components,
            acpi: vec!["SSDT-EC-USBX-DESKTOP.aml".into(), "SSDT-CPUR.aml".into()],
            drivers: vec!["OpenRuntime.efi".into(), "OpenHfsPlus.efi".into()],
            notes: Vec::new(),
        };
        let parent = test_root("real-amd-b550-build");
        fs::create_dir_all(&parent).unwrap();

        let result = build_scaffold(&parent, &manifest, None).unwrap();
        let output = PathBuf::from(&result.output_path);
        assert!(result.ready_for_install);
        assert!(output.join("EFI/OC/ACPI/SSDT-CPUR.aml").is_file());
        let validation = validate_efi_root(&output).unwrap();
        assert!(validation.valid, "{:?}", validation.errors);

        let config = plist::Value::from_file(output.join("EFI/OC/config.plist")).unwrap();
        assert_eq!(
            nested_value(&config, &["Booter", "Quirks", "SetupVirtualMap"])
                .unwrap()
                .as_boolean(),
            Some(false)
        );

        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    #[ignore = "downloads pinned upstream release assets"]
    fn builds_and_validates_real_coffee_and_comet_lake_candidates() {
        let lock: TestComponentLock =
            serde_json::from_str(include_str!("../../src/data/components.lock.json")).unwrap();
        let common_ids = [
            "opencore",
            "lilu",
            "virtual-smc",
            "whatever-green",
            "apple-alc",
            "intel-mausi",
            "dortania-ssdt-plug-drtnia",
            "dortania-ssdt-ec-usbx-desktop",
            "dortania-ssdt-awac",
        ];
        let profiles = [
            (
                "intel-coffee-lake",
                "Z390",
                "iMac19,1",
                "0300913E",
                "dortania-ssdt-pmc",
                vec![
                    "SSDT-PLUG-DRTNIA.aml",
                    "SSDT-EC-USBX-DESKTOP.aml",
                    "SSDT-AWAC.aml",
                    "SSDT-PMC.aml",
                ],
                true,
            ),
            (
                "intel-comet-lake",
                "Z490",
                "iMac20,1",
                "07009B3E",
                "dortania-ssdt-rhub",
                vec![
                    "SSDT-PLUG-DRTNIA.aml",
                    "SSDT-EC-USBX-DESKTOP.aml",
                    "SSDT-AWAC.aml",
                    "SSDT-RHUB.aml",
                ],
                false,
            ),
        ];

        for (platform, chipset, smbios, igpu, extra_id, acpi, setup_virtual_map) in profiles {
            let required = common_ids
                .iter()
                .copied()
                .chain(std::iter::once(extra_id))
                .collect::<BTreeSet<_>>();
            let components = lock
                .components
                .iter()
                .filter(|component| required.contains(component.id.as_str()))
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(components.len(), required.len());
            let parent = test_root(platform);
            fs::create_dir_all(&parent).unwrap();
            let manifest = EfiBuildManifest {
                schema_version: 1,
                target_mac_os: "14".into(),
                profile: format!("{platform}-{chipset}-desktop"),
                platform: platform.into(),
                cpu_core_count: 8,
                chipset: chipset.into(),
                smbios_model: smbios.into(),
                igpu_platform_id: Some(igpu.into()),
                boot_args: vec!["-v".into(), "debug=0x100".into(), "keepsyms=1".into()],
                setup_virtual_map: None,
                auto_config_supported: true,
                components,
                acpi: acpi.into_iter().map(str::to_string).collect(),
                drivers: vec!["OpenRuntime.efi".into(), "OpenHfsPlus.efi".into()],
                notes: Vec::new(),
            };

            validate_manifest_lock(&manifest).unwrap();
            let result = build_scaffold(&parent, &manifest, None).unwrap();
            let output = PathBuf::from(result.output_path);
            assert!(result.ready_for_install);
            let validation = validate_efi_root(&output).unwrap();
            assert!(validation.valid, "{:?}", validation.errors);
            assert!(output
                .join("EFI/OC/Kexts/IntelMausi.kext/Contents/Info.plist")
                .is_file());

            let config = plist::Value::from_file(output.join("EFI/OC/config.plist")).unwrap();
            assert_eq!(
                nested_value(&config, &["Booter", "Quirks", "SetupVirtualMap"])
                    .unwrap()
                    .as_boolean(),
                Some(setup_virtual_map)
            );
            assert_eq!(
                nested_value(&config, &["PlatformInfo", "Generic", "SystemProductName"])
                    .unwrap()
                    .as_string(),
                Some(smbios)
            );
            assert_eq!(
                nested_value(
                    &config,
                    &[
                        "DeviceProperties",
                        "Add",
                        "PciRoot(0x0)/Pci(0x2,0x0)",
                        "AAPL,ig-platform-id",
                    ],
                )
                .unwrap()
                .as_data(),
                Some(decode_hex(igpu).unwrap().as_slice())
            );

            fs::remove_dir_all(parent).unwrap();
        }
    }
}
