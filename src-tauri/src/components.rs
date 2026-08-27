use crate::builder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use uuid::Uuid;

const MAX_FILES: usize = 4096;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DEPTH: usize = 16;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentItem {
    id: String,
    name: String,
    kind: String,
    identity: String,
    version: Option<String>,
    sha256: String,
    size: u64,
    source_path: String,
    target_path: String,
    comparison: String,
    base_sha256: Option<String>,
    base_enabled: bool,
    dependencies: Vec<String>,
    config_preview: Vec<String>,
    default_action: String,
    allowed_actions: Vec<String>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentScanResult {
    scan_id: String,
    source_label: String,
    items: Vec<ComponentItem>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSelection {
    item_id: String,
    action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedComponent {
    item_id: String,
    name: String,
    kind: String,
    action: String,
    source_sha256: String,
    final_target: Option<String>,
    enabled_in_result: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentMergeResult {
    output_path: String,
    files_copied: usize,
    components_added: usize,
    components_replaced: usize,
    components_preserved: usize,
    config_modified: bool,
    config_before_sha256: String,
    config_after_sha256: String,
    config_changes: Vec<String>,
    applied: Vec<AppliedComponent>,
    warnings: Vec<String>,
    validation_level: &'static str,
}

#[derive(Debug, Clone)]
struct ScanItem {
    public: ComponentItem,
    source: PathBuf,
    is_directory: bool,
}

#[derive(Debug, Clone)]
struct ScanSession {
    base_root: PathBuf,
    items: Vec<ScanItem>,
}

#[derive(Default)]
struct SessionStore {
    sessions: HashMap<String, ScanSession>,
    order: VecDeque<String>,
}

#[derive(Default)]
struct ScanBudget {
    files: usize,
    bytes: u64,
}

#[derive(Debug)]
struct InspectedComponent {
    source: PathBuf,
    name: String,
    kind: &'static str,
    identity: String,
    version: Option<String>,
    sha256: String,
    size: u64,
    dependencies: Vec<String>,
    executable_path: Option<String>,
    is_directory: bool,
}

fn sessions() -> &'static Mutex<SessionStore> {
    static SESSIONS: OnceLock<Mutex<SessionStore>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(SessionStore::default()))
}

#[tauri::command]
pub fn select_component_source(
    selection_mode: String,
    base_root: String,
) -> Result<Option<ComponentScanResult>, String> {
    let selected = match selection_mode.as_str() {
        "folder" => rfd::FileDialog::new()
            .set_title("选择 Kext 或 EFI 组件文件夹")
            .pick_folder()
            .map(|path| vec![path]),
        "files" => rfd::FileDialog::new()
            .set_title("选择 AML 或 UEFI Driver")
            .add_filter("EFI 组件", &["aml", "efi"])
            .pick_files(),
        _ => return Err("未知的组件选择方式。".into()),
    };
    let Some(selected) = selected else {
        return Ok(None);
    };
    scan_component_sources(&selected, Path::new(&base_root)).map(Some)
}

#[tauri::command]
pub fn merge_component_selections(
    scan_id: String,
    base_root: String,
    selections: Vec<ComponentSelection>,
) -> Result<Option<ComponentMergeResult>, String> {
    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择组件融合副本的保存位置")
        .pick_folder()
    else {
        return Ok(None);
    };
    merge_component_session(&scan_id, Path::new(&base_root), &selections, &parent).map(Some)
}

fn merge_component_session(
    scan_id: &str,
    base_root: &Path,
    selections: &[ComponentSelection],
    parent: &Path,
) -> Result<ComponentMergeResult, String> {
    merge_component_session_with_validator(
        scan_id,
        base_root,
        selections,
        parent,
        builder::run_locked_ocvalidate,
    )
}

fn merge_component_session_with_validator<F>(
    scan_id: &str,
    base_root: &Path,
    selections: &[ComponentSelection],
    parent: &Path,
    validator: F,
) -> Result<ComponentMergeResult, String>
where
    F: Fn(&Path) -> Result<(), String>,
{
    let session = sessions()
        .lock()
        .map_err(|_| "组件扫描会话锁已损坏。".to_string())?
        .sessions
        .get(scan_id)
        .cloned()
        .ok_or_else(|| "组件扫描会话已失效，请重新选择组件。".to_string())?;
    let validation = builder::validate_efi_root(base_root)?;
    if !validation.valid {
        return Err(format!(
            "基础 EFI 结构损坏，融合已停止：{}",
            validation.errors.join("；")
        ));
    }
    let base_root = PathBuf::from(validation.root_path)
        .canonicalize()
        .map_err(|error| format!("无法读取基础 EFI：{error}"))?;
    if base_root != session.base_root {
        return Err("基础 EFI 与组件扫描时不一致，请重新扫描组件。".into());
    }
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("无法读取保存位置：{error}"))?;
    if parent.starts_with(&base_root) {
        return Err("组件融合保存位置不能位于基础 EFI 内部。".into());
    }

    let decisions = validated_decisions(&session, selections)?;
    let output = builder::unused_child_path(&parent, "EFI-Forge-Component-Merged")?;
    let staging = parent.join(format!(".efi-forge-components-{}", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|error| format!("无法创建组件融合暂存目录：{error}"))?;

    let result = (|| -> Result<ComponentMergeResult, String> {
        let mut files_copied =
            builder::copy_directory(&base_root.join("EFI"), &staging.join("EFI"))?;
        let config_before = hash_file(&staging.join("EFI/OC/config.plist"))?.0;
        let mut applied = Vec::new();
        let mut added = 0usize;
        let mut replaced = 0usize;
        let mut preserved = 0usize;
        let mut enable_item_ids = HashSet::new();
        let mut active_component_changed = false;

        for item in &session.items {
            let action = decisions
                .get(&item.public.id)
                .expect("validated decisions include every item");
            revalidate_scan_item(item)?;
            let target = safe_staging_target(&staging, &item.public.target_path)?;
            let mut final_target = None;
            let mut enabled = false;

            match action.as_str() {
                "keep-base" | "skip" => {}
                "add-inactive" | "add-enabled" => {
                    if target.exists() {
                        return Err(format!(
                            "补入目标已存在，不能覆盖：{}",
                            item.public.target_path
                        ));
                    }
                    files_copied += copy_component(item, &target)?;
                    added += 1;
                    if action == "add-enabled" {
                        enable_item_ids.insert(item.public.id.clone());
                        enabled = true;
                        active_component_changed = true;
                    }
                    final_target = Some(item.public.target_path.clone());
                }
                "use-imported" => {
                    if !target.exists() {
                        return Err(format!(
                            "待替换的项目组件已不存在：{}",
                            item.public.target_path
                        ));
                    }
                    remove_staging_component(&staging, &target)?;
                    files_copied += copy_component(item, &target)?;
                    replaced += 1;
                    enabled = item.public.base_enabled;
                    active_component_changed |= enabled;
                    final_target = Some(item.public.target_path.clone());
                }
                "preserve-inactive" => {
                    let isolated =
                        isolated_target(&staging, &target, &item.public.name, &item.public.sha256)?;
                    files_copied += copy_component(item, &isolated)?;
                    preserved += 1;
                    final_target = Some(display_relative(&staging, &isolated));
                }
                _ => unreachable!("validated action"),
            }

            applied.push(AppliedComponent {
                item_id: item.public.id.clone(),
                name: item.public.name.clone(),
                kind: item.public.kind.clone(),
                action: action.clone(),
                source_sha256: item.public.sha256.clone(),
                final_target,
                enabled_in_result: enabled,
            });
        }

        let enabled_items = session
            .items
            .iter()
            .filter(|item| enable_item_ids.contains(&item.public.id))
            .collect::<Vec<_>>();
        let config_changes = if enabled_items.is_empty() {
            Vec::new()
        } else {
            apply_enabled_component_entries(&staging, &enabled_items)?
        };
        if active_component_changed {
            validate_enabled_kext_dependencies(&staging)?;
        }
        let config_after = hash_file(&staging.join("EFI/OC/config.plist"))?.0;
        let config_modified = config_before != config_after;
        if enabled_items.is_empty() && config_modified {
            return Err("没有选择启用组件，但 config.plist 发生变化，融合已停止。".into());
        }
        let validation = builder::validate_efi_root(&staging)?;
        if !validation.valid {
            return Err(format!(
                "组件融合结果结构损坏，已停止：{}",
                validation.errors.join("；")
            ));
        }
        let validation_level = if active_component_changed {
            validator(&staging)?;
            "ocvalidate-passed"
        } else {
            "structure-only"
        };

        let mut warnings = vec![
            "替换或启用用户组件不代表项目推荐，版本兼容性仍需独立 U 盘验证。".into(),
            "静态检查和 ocvalidate 不能代替 OpenCore Picker、Recovery 或安装实测。".into(),
        ];
        warnings.insert(
            0,
            if config_modified {
                format!(
                    "已按用户明确选择向 config.plist 写入 {} 项最小配置；未修改 PlatformInfo、DeviceProperties、NVRAM、Kernel Patch 或 Quirks。",
                    enabled_items.len()
                )
            } else {
                "本轮没有修改 config.plist；补入和隔离保留的组件不会自动加载。".into()
            },
        );
        let mut result = ComponentMergeResult {
            output_path: output.display().to_string(),
            files_copied,
            components_added: added,
            components_replaced: replaced,
            components_preserved: preserved,
            config_modified,
            config_before_sha256: config_before.clone(),
            config_after_sha256: config_after.clone(),
            config_changes,
            applied,
            warnings,
            validation_level,
        };
        let report = serde_json::to_string_pretty(&result)
            .map_err(|error| format!("无法生成组件融合报告：{error}"))?;
        fs::write(staging.join("EFI-FORGE-COMPONENT-REPORT.json"), &report)
            .map_err(|error| format!("无法写入组件融合报告：{error}"))?;
        let provenance = serde_json::json!({
            "schemaVersion": 2,
            "baseConfigSha256": config_before,
            "resultConfigSha256": config_after,
            "configModified": result.config_modified,
            "scanId": scan_id,
            "components": &result.applied,
        });
        fs::write(
            staging.join("EFI-FORGE-PROVENANCE.json"),
            serde_json::to_string_pretty(&provenance)
                .map_err(|error| format!("无法生成来源报告：{error}"))?,
        )
        .map_err(|error| format!("无法写入来源报告：{error}"))?;
        fs::write(
            staging.join("README-FIRST.txt"),
            if result.config_modified {
                "EFI Forge 受控组件配置副本\r\n\r\n原始 EFI 和组件来源均未修改。\r\nconfig.plist 只加入用户明确启用组件的最小条目，并已通过锁定版 ocvalidate。\r\n未修改 PlatformInfo、DeviceProperties、NVRAM、Kernel Patch 或 Quirks。\r\n请先使用独立 U 盘验证 OpenCore 和 Recovery。\r\n"
            } else {
                "EFI Forge 组件融合副本\r\n\r\n原始 EFI 和组件来源均未修改。\r\n本轮没有修改 config.plist。\r\n新补入或隔离保留的组件不会自动加载。\r\n请先使用独立 U 盘验证 OpenCore 和 Recovery。\r\n"
            },
        )
        .map_err(|error| format!("无法写入组件融合说明：{error}"))?;
        result.output_path = output.display().to_string();
        Ok(result)
    })();

    match result {
        Ok(result) => {
            fs::rename(&staging, &output).map_err(|error| {
                let _ = fs::remove_dir_all(&staging);
                format!("无法完成组件融合副本写入：{error}")
            })?;
            Ok(result)
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            Err(error)
        }
    }
}

fn validated_decisions(
    session: &ScanSession,
    selections: &[ComponentSelection],
) -> Result<HashMap<String, String>, String> {
    if selections.len() != session.items.len() {
        return Err("每个已扫描组件都必须有明确选择。".into());
    }
    let mut decisions = HashMap::new();
    for selection in selections {
        if decisions
            .insert(selection.item_id.clone(), selection.action.clone())
            .is_some()
        {
            return Err(format!("组件选择重复：{}", selection.item_id));
        }
    }
    for item in &session.items {
        let action = decisions
            .get(&item.public.id)
            .ok_or_else(|| format!("缺少组件选择：{}", item.public.name))?;
        if !item.public.allowed_actions.contains(action) {
            return Err(format!("{} 不允许执行动作 {action}。", item.public.name));
        }
    }
    Ok(decisions)
}

fn revalidate_scan_item(item: &ScanItem) -> Result<(), String> {
    let current = match item.public.kind.as_str() {
        "kext" => inspect_kext(&item.source, &mut ScanBudget::default())?,
        "acpi" => inspect_aml(&item.source)?,
        "driver" => inspect_driver(&item.source)?,
        _ => return Err("扫描会话包含未知组件类型。".into()),
    };
    if current.sha256 != item.public.sha256 || current.identity != item.public.identity {
        return Err(format!(
            "组件在扫描后发生变化，请重新扫描：{}",
            item.public.name
        ));
    }
    Ok(())
}

fn safe_staging_target(staging: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("组件目标路径不安全。".into());
    }
    let target = staging.join(relative);
    if !target.starts_with(staging.join("EFI/OC")) {
        return Err("组件目标必须位于 EFI/OC 内。".into());
    }
    Ok(target)
}

fn copy_component(item: &ScanItem, target: &Path) -> Result<usize, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建组件目标目录：{error}"))?;
    }
    let copied = if item.is_directory {
        builder::copy_directory(&item.source, target)
    } else {
        fs::copy(&item.source, target)
            .map(|_| 1)
            .map_err(|error| format!("无法复制用户组件：{error}"))
    }?;
    let copied_hash = if item.is_directory {
        hash_directory(target, &mut ScanBudget::default())?.0
    } else {
        hash_file(target)?.0
    };
    if copied_hash != item.public.sha256 {
        return Err(format!(
            "组件复制后的哈希与扫描结果不一致，已停止：{}",
            item.public.name
        ));
    }
    Ok(copied)
}

fn apply_enabled_component_entries(
    staging: &Path,
    items: &[&ScanItem],
) -> Result<Vec<String>, String> {
    let config_path = staging.join("EFI/OC/config.plist");
    let mut config = plist::Value::from_file(&config_path)
        .map_err(|error| format!("无法读取待修改的 config.plist：{error}"))?;
    let protected_before = protected_config_snapshot(&config);
    let mut changes = Vec::new();

    for item in items {
        match item.public.kind.as_str() {
            "kext" => {
                let bundle_path = component_config_path(&item.public.target_path, "EFI/OC/Kexts/")?;
                ensure_config_path_absent(&config, "Kernel", "Add", "BundlePath", &bundle_path)?;
                let inspected = inspect_kext(
                    &staging.join(&item.public.target_path),
                    &mut ScanBudget::default(),
                )?;
                let executable_path = inspected
                    .executable_path
                    .map(|name| format!("Contents/MacOS/{name}"))
                    .unwrap_or_default();
                let mut entry = plist::Dictionary::new();
                entry.insert("Arch".into(), plist::Value::String("Any".into()));
                entry.insert(
                    "BundlePath".into(),
                    plist::Value::String(bundle_path.clone()),
                );
                entry.insert(
                    "Comment".into(),
                    plist::Value::String(format!(
                        "EFI Forge user component · {}",
                        inspected.identity
                    )),
                );
                entry.insert("Enabled".into(), plist::Value::Boolean(true));
                entry.insert(
                    "ExecutablePath".into(),
                    plist::Value::String(executable_path),
                );
                entry.insert("MaxKernel".into(), plist::Value::String(String::new()));
                entry.insert("MinKernel".into(), plist::Value::String(String::new()));
                entry.insert(
                    "PlistPath".into(),
                    plist::Value::String("Contents/Info.plist".into()),
                );
                config_array_mut(&mut config, "Kernel", "Add")?
                    .push(plist::Value::Dictionary(entry));
                changes.push(format!(
                    "启用 Kext：{bundle_path}（{}）",
                    inspected.identity
                ));
            }
            "acpi" => {
                let path = component_config_path(&item.public.target_path, "EFI/OC/ACPI/")?;
                ensure_config_path_absent(&config, "ACPI", "Add", "Path", &path)?;
                let mut entry = plist::Dictionary::new();
                entry.insert(
                    "Comment".into(),
                    plist::Value::String(format!("EFI Forge user ACPI · {}", item.public.identity)),
                );
                entry.insert("Enabled".into(), plist::Value::Boolean(true));
                entry.insert("Path".into(), plist::Value::String(path.clone()));
                config_array_mut(&mut config, "ACPI", "Add")?.push(plist::Value::Dictionary(entry));
                changes.push(format!("启用 ACPI：{path}"));
            }
            "driver" => {
                let path = component_config_path(&item.public.target_path, "EFI/OC/Drivers/")?;
                ensure_config_path_absent(&config, "UEFI", "Drivers", "Path", &path)?;
                let mut entry = plist::Dictionary::new();
                entry.insert("Arguments".into(), plist::Value::String(String::new()));
                entry.insert(
                    "Comment".into(),
                    plist::Value::String("EFI Forge user UEFI driver".into()),
                );
                entry.insert("Enabled".into(), plist::Value::Boolean(true));
                entry.insert("LoadEarly".into(), plist::Value::Boolean(false));
                entry.insert("Path".into(), plist::Value::String(path.clone()));
                config_array_mut(&mut config, "UEFI", "Drivers")?
                    .push(plist::Value::Dictionary(entry));
                changes.push(format!("启用 UEFI Driver：{path}"));
            }
            _ => return Err("不能为未知组件类型生成配置。".into()),
        }
    }

    sort_enabled_kext_entries(staging, &mut config)?;
    if protected_before != protected_config_snapshot(&config) {
        return Err(
            "受保护的 PlatformInfo、DeviceProperties、NVRAM、Patch 或 Quirks 发生变化。".into(),
        );
    }
    config
        .to_file_xml(&config_path)
        .map_err(|error| format!("无法写回受控 config.plist：{error}"))?;
    Ok(changes)
}

fn component_config_path(target_path: &str, prefix: &str) -> Result<String, String> {
    target_path
        .strip_prefix(prefix)
        .filter(|path| safe_single_name(path))
        .map(str::to_string)
        .ok_or_else(|| format!("组件目标不能安全转换为配置路径：{target_path}"))
}

fn config_array_mut<'a>(
    config: &'a mut plist::Value,
    section: &str,
    key: &str,
) -> Result<&'a mut Vec<plist::Value>, String> {
    config
        .as_dictionary_mut()
        .and_then(|root| root.get_mut(section))
        .and_then(plist::Value::as_dictionary_mut)
        .and_then(|dictionary| dictionary.get_mut(key))
        .and_then(plist::Value::as_array_mut)
        .ok_or_else(|| format!("config.plist 缺少可写数组：{section}/{key}"))
}

fn config_array<'a>(
    config: &'a plist::Value,
    section: &str,
    key: &str,
) -> Result<&'a Vec<plist::Value>, String> {
    config
        .as_dictionary()
        .and_then(|root| root.get(section))
        .and_then(plist::Value::as_dictionary)
        .and_then(|dictionary| dictionary.get(key))
        .and_then(plist::Value::as_array)
        .ok_or_else(|| format!("config.plist 缺少数组：{section}/{key}"))
}

fn ensure_config_path_absent(
    config: &plist::Value,
    section: &str,
    key: &str,
    path_key: &str,
    path: &str,
) -> Result<(), String> {
    if config_array(config, section, key)?.iter().any(|entry| {
        entry
            .as_dictionary()
            .and_then(|dictionary| dictionary.get(path_key))
            .and_then(plist::Value::as_string)
            .is_some_and(|existing| existing.eq_ignore_ascii_case(path))
    }) {
        return Err(format!(
            "config.plist 已包含 {section}/{key} 路径 {path}，不会生成重复条目。"
        ));
    }
    Ok(())
}

fn protected_config_snapshot(config: &plist::Value) -> Vec<(String, Option<plist::Value>)> {
    [
        &["PlatformInfo"][..],
        &["DeviceProperties"][..],
        &["NVRAM"][..],
        &["Kernel", "Patch"][..],
        &["Kernel", "Quirks"][..],
        &["Kernel", "Emulate"][..],
        &["UEFI", "Quirks"][..],
    ]
    .into_iter()
    .map(|path| (path.join("/"), nested_config_value(config, path).cloned()))
    .collect()
}

fn nested_config_value<'a>(config: &'a plist::Value, path: &[&str]) -> Option<&'a plist::Value> {
    let mut current = Some(config);
    for key in path {
        current = current
            .and_then(plist::Value::as_dictionary)
            .and_then(|dictionary| dictionary.get(key));
    }
    current
}

#[derive(Clone)]
struct EnabledKextNode {
    identity: String,
    display_name: String,
    dependencies: Vec<String>,
    entry: plist::Value,
    rank: usize,
}

fn enabled_kext_nodes(root: &Path, config: &plist::Value) -> Result<Vec<EnabledKextNode>, String> {
    let mut nodes = Vec::new();
    let mut identities = HashSet::new();
    for (rank, entry) in config_array(config, "Kernel", "Add")?.iter().enumerate() {
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
        let bundle_path = dictionary
            .get("BundlePath")
            .and_then(plist::Value::as_string)
            .ok_or_else(|| "启用的 Kernel/Add 项缺少 BundlePath。".to_string())?;
        if !safe_single_name(bundle_path) {
            return Err(format!("Kext BundlePath 不安全：{bundle_path}"));
        }
        let inspected = inspect_kext(
            &root.join("EFI/OC/Kexts").join(bundle_path),
            &mut ScanBudget::default(),
        )?;
        let configured_executable = dictionary
            .get("ExecutablePath")
            .and_then(plist::Value::as_string)
            .unwrap_or("");
        let expected_executable = inspected
            .executable_path
            .as_deref()
            .map(|name| format!("Contents/MacOS/{name}"))
            .unwrap_or_default();
        let configured_plist = dictionary
            .get("PlistPath")
            .and_then(plist::Value::as_string)
            .unwrap_or("");
        if configured_executable != expected_executable || configured_plist != "Contents/Info.plist"
        {
            return Err(format!(
                "启用的 {bundle_path} 配置路径与 Kext 自身声明不一致；当前 ExecutablePath={configured_executable}、PlistPath={configured_plist}，期望 ExecutablePath={expected_executable}、PlistPath=Contents/Info.plist。"
            ));
        }
        let normalized = inspected.identity.to_ascii_lowercase();
        if !identities.insert(normalized.clone()) {
            return Err(format!("存在重复启用的 Kext 身份：{}", inspected.identity));
        }
        nodes.push(EnabledKextNode {
            identity: normalized,
            display_name: bundle_path.to_string(),
            dependencies: inspected
                .dependencies
                .into_iter()
                .filter(|dependency| !dependency.to_ascii_lowercase().starts_with("com.apple."))
                .map(|dependency| dependency.to_ascii_lowercase())
                .collect(),
            entry: entry.clone(),
            rank,
        });
    }
    Ok(nodes)
}

fn validate_kext_node_dependencies(nodes: &[EnabledKextNode]) -> Result<(), String> {
    let identities = nodes
        .iter()
        .map(|node| node.identity.as_str())
        .collect::<HashSet<_>>();
    for node in nodes {
        let missing = node
            .dependencies
            .iter()
            .filter(|dependency| !identities.contains(dependency.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "启用 {} 缺少 Kext 依赖：{}。请同时导入并选择启用，或改为只保留。",
                node.display_name,
                missing.join("、")
            ));
        }
    }
    Ok(())
}

fn validate_enabled_kext_dependencies(root: &Path) -> Result<(), String> {
    let config = plist::Value::from_file(root.join("EFI/OC/config.plist"))
        .map_err(|error| format!("无法读取 Kext 依赖配置：{error}"))?;
    validate_kext_node_dependencies(&enabled_kext_nodes(root, &config)?)
}

fn sort_enabled_kext_entries(root: &Path, config: &mut plist::Value) -> Result<(), String> {
    let nodes = enabled_kext_nodes(root, config)?;
    validate_kext_node_dependencies(&nodes)?;
    let mut remaining = nodes;
    let mut emitted = HashSet::new();
    let mut sorted = Vec::new();
    while !remaining.is_empty() {
        let candidate = remaining
            .iter()
            .enumerate()
            .filter(|(_, node)| {
                node.dependencies
                    .iter()
                    .all(|dependency| emitted.contains(dependency))
            })
            .min_by_key(|(_, node)| node.rank)
            .map(|(index, _)| index)
            .ok_or_else(|| "启用的 Kext 依赖形成循环，无法生成安全加载顺序。".to_string())?;
        let node = remaining.remove(candidate);
        emitted.insert(node.identity.clone());
        sorted.push(node.entry);
    }

    let entries = config_array_mut(config, "Kernel", "Add")?;
    let mut sorted = sorted.into_iter();
    for entry in entries.iter_mut() {
        let enabled = entry
            .as_dictionary()
            .and_then(|dictionary| dictionary.get("Enabled"))
            .and_then(plist::Value::as_boolean)
            .unwrap_or(false);
        if enabled {
            *entry = sorted
                .next()
                .ok_or_else(|| "Kext 排序结果数量不一致。".to_string())?;
        }
    }
    if sorted.next().is_some() {
        return Err("Kext 排序结果数量不一致。".into());
    }
    Ok(())
}

fn remove_staging_component(staging: &Path, target: &Path) -> Result<(), String> {
    let efi = staging.join("EFI");
    if !target.starts_with(&efi) || target == efi {
        return Err("拒绝删除暂存目录范围外的组件。".into());
    }
    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|error| format!("无法替换暂存 Kext：{error}"))
    } else {
        fs::remove_file(target).map_err(|error| format!("无法替换暂存组件：{error}"))
    }
}

fn isolated_target(
    staging: &Path,
    conflict_target: &Path,
    source_name: &str,
    sha256: &str,
) -> Result<PathBuf, String> {
    let parent = conflict_target
        .parent()
        .ok_or_else(|| "冲突组件缺少目标目录。".to_string())?;
    let source = Path::new(source_name);
    let stem = source
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "组件文件名无效。".to_string())?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let suffix = &sha256[..8];
    let isolated_name = if extension.is_empty() {
        format!("{stem}-imported-{suffix}")
    } else {
        format!("{stem}-imported-{suffix}.{extension}")
    };
    let target = parent.join(isolated_name);
    if target.exists() || !target.starts_with(staging.join("EFI/OC")) {
        return Err("隔离组件目标已存在或路径不安全。".into());
    }
    Ok(target)
}

fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn scan_component_sources(
    selected: &[PathBuf],
    base_root: &Path,
) -> Result<ComponentScanResult, String> {
    let validation = builder::validate_efi_root(base_root)?;
    if !validation.valid {
        return Err(format!(
            "基础 EFI 结构损坏，不能比较组件：{}",
            validation.errors.join("；")
        ));
    }
    let base_root = PathBuf::from(validation.root_path)
        .canonicalize()
        .map_err(|error| format!("无法读取基础 EFI：{error}"))?;
    let mut inspected = Vec::new();
    let mut budget = ScanBudget::default();
    let mut ignored = 0usize;
    let mut roots = Vec::new();

    for path in selected {
        let path = path
            .canonicalize()
            .map_err(|error| format!("无法读取所选组件：{error}"))?;
        if path.starts_with(&base_root) || base_root.starts_with(&path) {
            return Err("组件来源与基础 EFI 不能相同或互相包含。".into());
        }
        if builder::is_reparse_point(&path)? {
            return Err(format!(
                "组件来源是符号链接或 Windows 重解析点：{}",
                path.display()
            ));
        }
        roots.push(path.clone());
        discover_components(&path, 0, &mut budget, &mut inspected, &mut ignored)?;
    }
    if inspected.is_empty() {
        return Err("所选位置没有通过格式检查的 Kext、AML 或 UEFI Driver。".into());
    }

    let active = active_component_paths(&base_root)?;
    let mut items = Vec::new();
    for component in inspected {
        let target = suggested_target(&component);
        let config_preview = config_preview(&component);
        let (target, comparison, base_sha256) = compare_with_base(&base_root, &component, &target)?;
        let base_enabled = active.contains(&target.to_ascii_lowercase());
        let (default_action, allowed_actions) = action_options(&comparison);
        let mut warnings = vec!["用户组件未经项目审核；不会自动获得推荐等级。".into()];
        if !component.dependencies.is_empty() {
            warnings.push("选择启用时将检查非 Apple Kext 依赖并按依赖关系排序。".into());
        }
        let id = format!("component-{}-{}", items.len() + 1, &component.sha256[..12]);
        items.push(ScanItem {
            public: ComponentItem {
                id,
                name: component.name,
                kind: component.kind.into(),
                identity: component.identity,
                version: component.version,
                sha256: component.sha256,
                size: component.size,
                source_path: display_selected_path(&roots, &component.source),
                target_path: target,
                comparison,
                base_sha256,
                base_enabled,
                dependencies: component.dependencies,
                config_preview,
                default_action,
                allowed_actions,
                warnings,
            },
            source: component.source,
            is_directory: component.is_directory,
        });
    }

    let scan_id = Uuid::new_v4().to_string();
    let source_label = if selected.len() == 1 {
        selected[0]
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("组件来源")
            .to_string()
    } else {
        format!("{} 个用户文件", selected.len())
    };
    let mut warnings = vec![
        "新增组件默认补入但不启用；只有用户逐项选择后才生成最小配置条目。".into(),
        "受控启用会检查 Kext 依赖、加载顺序和锁定版 ocvalidate，但不能证明真机兼容。".into(),
    ];
    if ignored > 0 {
        warnings.push(format!(
            "扫描时忽略了 {ignored} 个非 Kext/AML/Driver 文件。"
        ));
    }

    let result = ComponentScanResult {
        scan_id: scan_id.clone(),
        source_label,
        items: items.iter().map(|item| item.public.clone()).collect(),
        warnings,
    };
    let mut store = sessions()
        .lock()
        .map_err(|_| "组件扫描会话锁已损坏。".to_string())?;
    while store.sessions.len() >= 32 {
        if let Some(expired) = store.order.pop_front() {
            store.sessions.remove(&expired);
        }
    }
    store.order.push_back(scan_id.clone());
    store
        .sessions
        .insert(scan_id, ScanSession { base_root, items });
    Ok(result)
}

fn discover_components(
    path: &Path,
    depth: usize,
    budget: &mut ScanBudget,
    components: &mut Vec<InspectedComponent>,
    ignored: &mut usize,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(format!("组件目录超过 {MAX_DEPTH} 层，扫描已停止。"));
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("无法检查组件来源：{error}"))?;
    if metadata.file_type().is_symlink() || builder::is_reparse_point(path)? {
        return Err(format!("组件包包含符号链接或重解析点：{}", path.display()));
    }
    if metadata.is_dir() && extension_is(path, "kext") {
        components.push(inspect_kext(path, budget)?);
        return Ok(());
    }
    if metadata.is_dir() {
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("无法读取组件目录：{error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("无法读取组件目录条目：{error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            discover_components(&entry.path(), depth + 1, budget, components, ignored)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(format!("组件包包含不支持的文件类型：{}", path.display()));
    }
    consume_budget(budget, metadata.len())?;
    if forbidden_payload(path) {
        return Err(format!(
            "组件包包含危险 Windows 程序或脚本：{}",
            path.display()
        ));
    }
    if extension_is(path, "aml") {
        components.push(inspect_aml(path)?);
    } else if extension_is(path, "efi") {
        components.push(inspect_driver(path)?);
    } else {
        *ignored += 1;
    }
    Ok(())
}

fn inspect_kext(path: &Path, budget: &mut ScanBudget) -> Result<InspectedComponent, String> {
    let info_path = path.join("Contents/Info.plist");
    let info = plist::Value::from_file(&info_path)
        .map_err(|error| format!("Kext 缺少可解析的 Contents/Info.plist：{error}"))?;
    let dictionary = info
        .as_dictionary()
        .ok_or_else(|| "Kext Info.plist 顶层不是字典。".to_string())?;
    let identity = required_plist_string(dictionary, "CFBundleIdentifier")?;
    let version = dictionary
        .get("CFBundleShortVersionString")
        .or_else(|| dictionary.get("CFBundleVersion"))
        .and_then(plist::Value::as_string)
        .map(str::to_string);
    let executable_path = dictionary
        .get("CFBundleExecutable")
        .and_then(plist::Value::as_string)
        .map(str::to_string);
    if let Some(executable) = executable_path.as_deref() {
        if !safe_single_name(executable) || !path.join("Contents/MacOS").join(executable).is_file()
        {
            return Err(format!(
                "Kext 声明的可执行文件不存在或路径不安全：{executable}"
            ));
        }
    }
    let dependencies = dictionary
        .get("OSBundleLibraries")
        .and_then(plist::Value::as_dictionary)
        .map(|items| items.keys().cloned().collect())
        .unwrap_or_default();
    let (sha256, size) = hash_directory(path, budget)?;
    Ok(InspectedComponent {
        source: path.to_path_buf(),
        name: file_name(path)?,
        kind: "kext",
        identity,
        version,
        sha256,
        size,
        dependencies,
        executable_path,
        is_directory: true,
    })
}

fn inspect_aml(path: &Path) -> Result<InspectedComponent, String> {
    ensure_single_file_limit(path)?;
    let bytes = fs::read(path).map_err(|error| format!("无法读取 AML：{error}"))?;
    if bytes.len() < 36 {
        return Err("AML 小于 ACPI 标准表头长度。".into());
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared < 36 || declared != bytes.len() {
        return Err("AML 表头声明长度与文件大小不一致。".into());
    }
    if bytes.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)) != 0 {
        return Err("AML ACPI 校验和无效。".into());
    }
    let signature = ascii_field(&bytes[0..4], "AML Signature")?;
    let oem_table = ascii_field(&bytes[16..24], "AML OEM Table ID")?;
    let (sha256, size) = hash_file(path)?;
    Ok(InspectedComponent {
        source: path.to_path_buf(),
        name: file_name(path)?,
        kind: "acpi",
        identity: format!("{signature}:{oem_table}"),
        version: Some(bytes[8].to_string()),
        sha256,
        size,
        dependencies: Vec::new(),
        executable_path: None,
        is_directory: false,
    })
}

fn inspect_driver(path: &Path) -> Result<InspectedComponent, String> {
    ensure_single_file_limit(path)?;
    let bytes = fs::read(path).map_err(|error| format!("无法读取 UEFI Driver：{error}"))?;
    if bytes.len() < 0x100 || &bytes[0..2] != b"MZ" {
        return Err("UEFI Driver 缺少 DOS/PE 文件头。".into());
    }
    let pe_offset = u32::from_le_bytes(bytes[0x3c..0x40].try_into().unwrap()) as usize;
    let pe_end = pe_offset
        .checked_add(0x60)
        .ok_or_else(|| "UEFI Driver 的 PE 偏移溢出。".to_string())?;
    if pe_end > bytes.len() || &bytes[pe_offset..pe_offset + 4] != b"PE\0\0" {
        return Err("UEFI Driver 的 PE 文件头无效。".into());
    }
    let machine = u16::from_le_bytes(bytes[pe_offset + 4..pe_offset + 6].try_into().unwrap());
    let optional = pe_offset + 24;
    let magic = u16::from_le_bytes(bytes[optional..optional + 2].try_into().unwrap());
    let subsystem = u16::from_le_bytes(bytes[optional + 68..optional + 70].try_into().unwrap());
    if machine != 0x8664 || magic != 0x20b || !matches!(subsystem, 10..=12) {
        return Err("Driver 不是 x86_64 PE32+ EFI 应用或驱动。".into());
    }
    let (sha256, size) = hash_file(path)?;
    Ok(InspectedComponent {
        source: path.to_path_buf(),
        name: file_name(path)?,
        kind: "driver",
        identity: file_name(path)?.to_ascii_lowercase(),
        version: None,
        sha256,
        size,
        dependencies: Vec::new(),
        executable_path: None,
        is_directory: false,
    })
}

fn compare_with_base(
    base_root: &Path,
    component: &InspectedComponent,
    suggested: &str,
) -> Result<(String, String, Option<String>), String> {
    let direct = base_root.join(Path::new(suggested));
    if direct.exists() {
        let base_hash = if direct.is_dir() {
            hash_directory(&direct, &mut ScanBudget::default())?.0
        } else {
            hash_file(&direct)?.0
        };
        let comparison = if base_hash == component.sha256 {
            "identical"
        } else {
            "path-conflict"
        };
        return Ok((suggested.into(), comparison.into(), Some(base_hash)));
    }
    if component.kind == "kext" {
        let kexts = base_root.join("EFI/OC/Kexts");
        if kexts.is_dir() {
            for entry in
                fs::read_dir(kexts).map_err(|error| format!("无法读取基础 Kext：{error}"))?
            {
                let entry = entry.map_err(|error| format!("无法读取基础 Kext 条目：{error}"))?;
                if !entry.path().is_dir() || !extension_is(&entry.path(), "kext") {
                    continue;
                }
                let info = plist::Value::from_file(entry.path().join("Contents/Info.plist"))
                    .map_err(|error| format!("基础 Kext Info.plist 无法解析：{error}"))?;
                let identity = info
                    .as_dictionary()
                    .and_then(|dictionary| dictionary.get("CFBundleIdentifier"))
                    .and_then(plist::Value::as_string)
                    .unwrap_or("");
                if identity.eq_ignore_ascii_case(&component.identity) {
                    let base_hash = hash_directory(&entry.path(), &mut ScanBudget::default())?.0;
                    return Ok((
                        format!("EFI/OC/Kexts/{}", entry.file_name().to_string_lossy()),
                        "identity-conflict".into(),
                        Some(base_hash),
                    ));
                }
            }
        }
    }
    Ok((suggested.into(), "new".into(), None))
}

fn action_options(comparison: &str) -> (String, Vec<String>) {
    match comparison {
        "new" => (
            "add-inactive".into(),
            vec!["add-inactive".into(), "add-enabled".into(), "skip".into()],
        ),
        "identical" => ("keep-base".into(), vec!["keep-base".into(), "skip".into()]),
        _ => (
            "keep-base".into(),
            vec![
                "keep-base".into(),
                "use-imported".into(),
                "preserve-inactive".into(),
                "skip".into(),
            ],
        ),
    }
}

fn config_preview(component: &InspectedComponent) -> Vec<String> {
    match component.kind {
        "kext" => vec![
            format!("Kernel/Add · BundlePath={}", component.name),
            format!(
                "ExecutablePath={}",
                component
                    .executable_path
                    .as_deref()
                    .map(|name| format!("Contents/MacOS/{name}"))
                    .unwrap_or_default()
            ),
            "PlistPath=Contents/Info.plist".into(),
        ],
        "acpi" => vec![format!("ACPI/Add · Path={}", component.name)],
        _ => vec![format!("UEFI/Drivers · Path={}", component.name)],
    }
}

fn suggested_target(component: &InspectedComponent) -> String {
    let directory = match component.kind {
        "kext" => "Kexts",
        "acpi" => "ACPI",
        _ => "Drivers",
    };
    format!("EFI/OC/{directory}/{}", component.name)
}

fn active_component_paths(root: &Path) -> Result<HashSet<String>, String> {
    let value = plist::Value::from_file(root.join("EFI/OC/config.plist"))
        .map_err(|error| format!("无法读取基础 config.plist：{error}"))?;
    let dictionary = value
        .as_dictionary()
        .ok_or_else(|| "基础 config.plist 顶层不是字典。".to_string())?;
    let mut active = HashSet::new();
    for (keys, path_key, prefix) in [
        (&["ACPI", "Add"][..], "Path", "EFI/OC/ACPI/"),
        (&["Kernel", "Add"][..], "BundlePath", "EFI/OC/Kexts/"),
        (&["UEFI", "Drivers"][..], "Path", "EFI/OC/Drivers/"),
    ] {
        let mut current = dictionary.get(keys[0]);
        for key in &keys[1..] {
            current = current
                .and_then(plist::Value::as_dictionary)
                .and_then(|item| item.get(key));
        }
        if let Some(entries) = current.and_then(plist::Value::as_array) {
            for entry in entries {
                let Some(item) = entry.as_dictionary() else {
                    continue;
                };
                if !item
                    .get("Enabled")
                    .and_then(plist::Value::as_boolean)
                    .unwrap_or(false)
                {
                    continue;
                }
                if let Some(path) = item.get(path_key).and_then(plist::Value::as_string) {
                    active.insert(
                        format!("{prefix}{path}")
                            .replace('\\', "/")
                            .to_ascii_lowercase(),
                    );
                }
            }
        }
    }
    Ok(active)
}

fn hash_directory(path: &Path, budget: &mut ScanBudget) -> Result<(String, u64), String> {
    let mut files = BTreeMap::new();
    collect_directory_files(path, path, 0, budget, &mut files)?;
    let mut hasher = Sha256::new();
    let mut size = 0u64;
    for (relative, file) in files {
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        let mut input = File::open(&file).map_err(|error| format!("无法读取组件文件：{error}"))?;
        size += update_hash_from_reader(&mut hasher, &mut input)?;
    }
    Ok((hex::encode(hasher.finalize()), size))
}

fn collect_directory_files(
    root: &Path,
    path: &Path,
    depth: usize,
    budget: &mut ScanBudget,
    files: &mut BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(format!("组件目录超过 {MAX_DEPTH} 层，扫描已停止。"));
    }
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("无法读取组件包：{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("无法读取组件包条目：{error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path)
            .map_err(|error| format!("无法检查组件文件：{error}"))?;
        if metadata.file_type().is_symlink() || builder::is_reparse_point(&entry_path)? {
            return Err(format!(
                "组件包包含符号链接或重解析点：{}",
                entry_path.display()
            ));
        }
        if metadata.is_dir() {
            collect_directory_files(root, &entry_path, depth + 1, budget, files)?;
        } else if metadata.is_file() {
            if forbidden_payload(&entry_path) {
                return Err(format!(
                    "组件包包含危险 Windows 程序或脚本：{}",
                    entry_path.display()
                ));
            }
            consume_budget(budget, metadata.len())?;
            let relative = entry_path
                .strip_prefix(root)
                .map_err(|_| "组件路径逃逸。".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative, entry_path);
        }
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("无法读取组件元数据：{error}"))?;
    let mut input = File::open(path).map_err(|error| format!("无法读取组件：{error}"))?;
    let mut hasher = Sha256::new();
    update_hash_from_reader(&mut hasher, &mut input)?;
    Ok((hex::encode(hasher.finalize()), metadata.len()))
}

fn update_hash_from_reader(hasher: &mut Sha256, input: &mut File) -> Result<u64, String> {
    let mut buffer = [0u8; 64 * 1024];
    let mut total = 0u64;
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("无法计算组件哈希：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total += read as u64;
    }
    Ok(total)
}

fn consume_budget(budget: &mut ScanBudget, bytes: u64) -> Result<(), String> {
    budget.files += 1;
    budget.bytes = budget.bytes.saturating_add(bytes);
    if budget.files > MAX_FILES {
        return Err(format!("组件包文件数超过 {MAX_FILES}，扫描已停止。"));
    }
    if budget.bytes > MAX_TOTAL_BYTES {
        return Err("组件包总大小超过 512 MB，扫描已停止。".into());
    }
    Ok(())
}

fn ensure_single_file_limit(path: &Path) -> Result<(), String> {
    let size = path
        .metadata()
        .map_err(|error| format!("无法读取组件元数据：{error}"))?
        .len();
    if size > MAX_TOTAL_BYTES {
        return Err("单个组件文件超过 512 MB，扫描已停止。".into());
    }
    Ok(())
}

fn forbidden_payload(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "exe" | "com" | "bat" | "cmd" | "ps1" | "vbs" | "js" | "msi" | "scr"
            )
        })
}

fn required_plist_string(dictionary: &plist::Dictionary, key: &str) -> Result<String, String> {
    dictionary
        .get(key)
        .and_then(plist::Value::as_string)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("Kext Info.plist 缺少 {key}。"))
}

fn ascii_field(bytes: &[u8], label: &str) -> Result<String, String> {
    if !bytes
        .iter()
        .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
    {
        return Err(format!("{label} 包含非法字符。"));
    }
    Ok(String::from_utf8_lossy(bytes).trim().to_string())
}

fn safe_single_name(value: &str) -> bool {
    let path = Path::new(value);
    !value.is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
        && path.components().count() == 1
}

fn extension_is(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .ok_or_else(|| "组件文件名不是有效 Unicode。".to_string())
}

fn display_selected_path(roots: &[PathBuf], path: &Path) -> String {
    roots
        .iter()
        .find_map(|root| path.strip_prefix(root).ok())
        .filter(|relative| !relative.as_os_str().is_empty())
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("efi-forge-components-{label}-{nanos}"))
    }

    fn create_kext(path: &Path, identity: &str, executable: bool) {
        fs::create_dir_all(path.join("Contents/MacOS")).unwrap();
        let mut info = plist::Dictionary::new();
        info.insert(
            "CFBundleIdentifier".into(),
            plist::Value::String(identity.into()),
        );
        info.insert(
            "CFBundleVersion".into(),
            plist::Value::String("1.2.3".into()),
        );
        if executable {
            info.insert(
                "CFBundleExecutable".into(),
                plist::Value::String("Demo".into()),
            );
            fs::write(path.join("Contents/MacOS/Demo"), b"kext-binary").unwrap();
        }
        plist::Value::Dictionary(info)
            .to_file_xml(path.join("Contents/Info.plist"))
            .unwrap();
    }

    fn set_kext_dependencies(path: &Path, dependencies: &[&str]) {
        let info_path = path.join("Contents/Info.plist");
        let mut info = plist::Value::from_file(&info_path).unwrap();
        let libraries = dependencies
            .iter()
            .map(|identity| {
                (
                    (*identity).to_string(),
                    plist::Value::String("1.0.0".into()),
                )
            })
            .collect::<plist::Dictionary>();
        info.as_dictionary_mut().unwrap().insert(
            "OSBundleLibraries".into(),
            plist::Value::Dictionary(libraries),
        );
        info.to_file_xml(&info_path).unwrap();
    }

    fn valid_aml() -> Vec<u8> {
        let mut bytes = vec![0u8; 36];
        bytes[0..4].copy_from_slice(b"SSDT");
        bytes[4..8].copy_from_slice(&(36u32).to_le_bytes());
        bytes[8] = 2;
        bytes[10..16].copy_from_slice(b"EFIFRG");
        bytes[16..24].copy_from_slice(b"TESTTABL");
        let sum = bytes
            .iter()
            .fold(0u8, |value, byte| value.wrapping_add(*byte));
        bytes[9] = 0u8.wrapping_sub(sum);
        bytes
    }

    fn valid_driver() -> Vec<u8> {
        let mut bytes = vec![0u8; 0x200];
        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&(0x80u32).to_le_bytes());
        bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
        bytes[0x84..0x86].copy_from_slice(&(0x8664u16).to_le_bytes());
        bytes[0x94..0x96].copy_from_slice(&(0xf0u16).to_le_bytes());
        bytes[0x98..0x9a].copy_from_slice(&(0x20bu16).to_le_bytes());
        bytes[0xdc..0xde].copy_from_slice(&(10u16).to_le_bytes());
        bytes
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
        let mut kernel_entry = plist::Dictionary::new();
        kernel_entry.insert("Enabled".into(), plist::Value::Boolean(true));
        kernel_entry.insert(
            "BundlePath".into(),
            plist::Value::String("Demo.kext".into()),
        );
        kernel_entry.insert(
            "ExecutablePath".into(),
            plist::Value::String("Contents/MacOS/Demo".into()),
        );
        kernel_entry.insert(
            "PlistPath".into(),
            plist::Value::String("Contents/Info.plist".into()),
        );
        config
            .get_mut("Kernel")
            .and_then(plist::Value::as_dictionary_mut)
            .unwrap()
            .insert(
                "Add".into(),
                plist::Value::Array(vec![plist::Value::Dictionary(kernel_entry)]),
            );
        config
            .get_mut("ACPI")
            .and_then(plist::Value::as_dictionary_mut)
            .unwrap()
            .insert("Add".into(), plist::Value::Array(Vec::new()));
        config
            .get_mut("UEFI")
            .and_then(plist::Value::as_dictionary_mut)
            .unwrap()
            .insert("Drivers".into(), plist::Value::Array(Vec::new()));
        plist::Value::Dictionary(config)
            .to_file_xml(root.join("EFI/OC/config.plist"))
            .unwrap();
        create_kext(
            &root.join("EFI/OC/Kexts/Demo.kext"),
            "com.example.demo",
            true,
        );
    }

    #[test]
    fn identifies_real_component_structures_instead_of_trusting_extensions() {
        let root = test_root("formats");
        let kext = root.join("Demo.kext");
        fs::create_dir_all(&root).unwrap();
        create_kext(&kext, "com.example.demo", true);
        fs::write(root.join("SSDT-DEMO.aml"), valid_aml()).unwrap();
        fs::write(root.join("Demo.efi"), valid_driver()).unwrap();

        let kext = inspect_kext(&kext, &mut ScanBudget::default()).unwrap();
        let aml = inspect_aml(&root.join("SSDT-DEMO.aml")).unwrap();
        let driver = inspect_driver(&root.join("Demo.efi")).unwrap();

        assert_eq!(kext.identity, "com.example.demo");
        assert_eq!(kext.version.as_deref(), Some("1.2.3"));
        assert_eq!(aml.identity, "SSDT:TESTTABL");
        assert_eq!(driver.kind, "driver");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_corrupt_aml_fake_drivers_and_missing_kext_executables() {
        let root = test_root("invalid");
        let kext = root.join("Broken.kext");
        fs::create_dir_all(&root).unwrap();
        create_kext(&kext, "com.example.broken", false);
        let mut info = plist::Value::from_file(kext.join("Contents/Info.plist")).unwrap();
        info.as_dictionary_mut().unwrap().insert(
            "CFBundleExecutable".into(),
            plist::Value::String("Missing".into()),
        );
        info.to_file_xml(kext.join("Contents/Info.plist")).unwrap();
        fs::write(root.join("Broken.aml"), b"not-acpi").unwrap();
        fs::write(root.join("Fake.efi"), b"not-pe").unwrap();

        assert!(inspect_kext(&kext, &mut ScanBudget::default()).is_err());
        assert!(inspect_aml(&root.join("Broken.aml")).is_err());
        assert!(inspect_driver(&root.join("Fake.efi")).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_kexts_without_info_plists_and_enforces_scan_limits() {
        let root = test_root("limits");
        let missing_info = root.join("MissingInfo.kext");
        fs::create_dir_all(missing_info.join("Contents")).unwrap();

        assert!(inspect_kext(&missing_info, &mut ScanBudget::default()).is_err());

        let mut file_budget = ScanBudget {
            files: MAX_FILES,
            bytes: 0,
        };
        assert!(consume_budget(&mut file_budget, 1)
            .unwrap_err()
            .contains("文件数超过"));

        let mut size_budget = ScanBudget {
            files: 0,
            bytes: MAX_TOTAL_BYTES,
        };
        assert!(consume_budget(&mut size_budget, 1)
            .unwrap_err()
            .contains("总大小超过"));

        let mut nested = root.join("deep");
        fs::create_dir_all(&nested).unwrap();
        for _ in 0..=MAX_DEPTH {
            nested = nested.join("level");
            fs::create_dir_all(&nested).unwrap();
        }
        assert!(discover_components(
            &root.join("deep"),
            0,
            &mut ScanBudget::default(),
            &mut Vec::new(),
            &mut 0,
        )
        .unwrap_err()
        .contains("超过"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_component_target_path_traversal() {
        let staging = test_root("unsafe-target");
        fs::create_dir_all(staging.join("EFI/OC")).unwrap();

        assert!(safe_staging_target(&staging, "EFI/OC/Kexts/../../outside").is_err());
        assert!(safe_staging_target(&staging, "../EFI/OC/Drivers/Test.efi").is_err());

        fs::remove_dir_all(staging).unwrap();
    }

    #[test]
    fn rejects_dangerous_windows_payloads_inside_component_folders() {
        let root = test_root("payload");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("install.ps1"), b"never run").unwrap();
        let mut budget = ScanBudget::default();
        let error =
            discover_components(&root, 0, &mut budget, &mut Vec::new(), &mut 0).unwrap_err();
        assert!(error.contains("危险 Windows 程序或脚本"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn classifies_same_bundle_id_as_an_identity_conflict() {
        let base = test_root("comparison-base");
        let source = test_root("comparison-source");
        create_valid_efi(&base);
        create_kext(&source.join("CustomName.kext"), "com.example.demo", true);
        fs::write(
            source.join("CustomName.kext/Contents/user-marker"),
            b"different user build",
        )
        .unwrap();

        let result = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();

        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].comparison, "identity-conflict");
        assert_eq!(result.items[0].target_path, "EFI/OC/Kexts/Demo.kext");
        assert_eq!(result.items[0].default_action, "keep-base");
        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn classifies_identical_and_same_path_different_hash_components() {
        let base = test_root("same-path-base");
        let source = test_root("same-path-source");
        create_valid_efi(&base);
        create_kext(&source.join("Demo.kext"), "com.example.demo", true);

        let identical = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        assert_eq!(identical.items[0].comparison, "identical");
        assert_eq!(identical.items[0].default_action, "keep-base");

        fs::write(
            source.join("Demo.kext/Contents/user-marker"),
            b"different build",
        )
        .unwrap();
        let conflict = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        assert_eq!(conflict.items[0].comparison, "path-conflict");
        assert!(conflict.items[0]
            .allowed_actions
            .contains(&"use-imported".to_string()));

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn applies_explicit_file_choices_to_a_new_copy_without_changing_config_or_sources() {
        let base = test_root("merge-base");
        let source = test_root("merge-source");
        let parent = test_root("merge-parent");
        create_valid_efi(&base);
        create_kext(&source.join("CustomName.kext"), "com.example.demo", true);
        fs::write(
            source.join("CustomName.kext/Contents/user-marker"),
            b"different user build",
        )
        .unwrap();
        fs::write(source.join("SSDT-USER.aml"), valid_aml()).unwrap();
        fs::create_dir_all(&parent).unwrap();
        let config_before = fs::read(base.join("EFI/OC/config.plist")).unwrap();
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = scan
            .items
            .iter()
            .map(|item| ComponentSelection {
                item_id: item.id.clone(),
                action: if item.kind == "kext" {
                    "use-imported".into()
                } else {
                    "add-inactive".into()
                },
            })
            .collect::<Vec<_>>();

        let result = merge_component_session_with_validator(
            &scan.scan_id,
            &base,
            &selections,
            &parent,
            |_| Ok(()),
        )
        .unwrap();
        let output = PathBuf::from(&result.output_path);

        assert_eq!(
            fs::read(output.join("EFI/OC/config.plist")).unwrap(),
            config_before
        );
        assert!(output
            .join("EFI/OC/Kexts/Demo.kext/Contents/user-marker")
            .is_file());
        assert!(output.join("EFI/OC/ACPI/SSDT-USER.aml").is_file());
        assert!(source
            .join("CustomName.kext/Contents/user-marker")
            .is_file());
        assert_eq!(result.components_replaced, 1);
        assert_eq!(result.components_added, 1);
        assert!(output.join("EFI-FORGE-COMPONENT-REPORT.json").is_file());
        assert!(output.join("EFI-FORGE-PROVENANCE.json").is_file());

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn supports_keep_preserve_and_skip_without_touching_the_base() {
        let base = test_root("choices-base");
        let source = test_root("choices-source");
        let parent = test_root("choices-parent");
        create_valid_efi(&base);
        create_kext(&source.join("CustomName.kext"), "com.example.demo", true);
        fs::write(
            source.join("CustomName.kext/Contents/user-marker"),
            b"preserved user build",
        )
        .unwrap();
        fs::write(source.join("SSDT-SKIP.aml"), valid_aml()).unwrap();
        fs::create_dir_all(&parent).unwrap();
        let base_kext_before = hash_directory(
            &base.join("EFI/OC/Kexts/Demo.kext"),
            &mut ScanBudget::default(),
        )
        .unwrap()
        .0;
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();

        let preserve = scan
            .items
            .iter()
            .map(|item| ComponentSelection {
                item_id: item.id.clone(),
                action: if item.kind == "kext" {
                    "preserve-inactive".into()
                } else {
                    "skip".into()
                },
            })
            .collect::<Vec<_>>();
        let preserved = merge_component_session(&scan.scan_id, &base, &preserve, &parent).unwrap();
        let preserved_root = PathBuf::from(&preserved.output_path);
        assert_eq!(preserved.components_preserved, 1);
        assert!(!preserved_root.join("EFI/OC/ACPI/SSDT-SKIP.aml").exists());
        assert!(fs::read_dir(preserved_root.join("EFI/OC/Kexts"))
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("CustomName-imported-")));

        let keep = scan
            .items
            .iter()
            .map(|item| ComponentSelection {
                item_id: item.id.clone(),
                action: if item.kind == "kext" {
                    "keep-base".into()
                } else {
                    "skip".into()
                },
            })
            .collect::<Vec<_>>();
        let kept = merge_component_session(&scan.scan_id, &base, &keep, &parent).unwrap();
        assert_eq!(kept.components_added, 0);
        assert_eq!(kept.components_replaced, 0);
        assert_eq!(kept.components_preserved, 0);
        assert_eq!(
            hash_directory(
                &base.join("EFI/OC/Kexts/Demo.kext"),
                &mut ScanBudget::default(),
            )
            .unwrap()
            .0,
            base_kext_before
        );

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn removes_failed_output_when_replacement_breaks_an_enabled_kext_reference() {
        let base = test_root("failed-base");
        let source = test_root("failed-source");
        let parent = test_root("failed-parent");
        create_valid_efi(&base);
        fs::create_dir_all(&parent).unwrap();

        let config_path = base.join("EFI/OC/config.plist");
        let mut config = plist::Value::from_file(&config_path).unwrap();
        let entry = config
            .as_dictionary_mut()
            .unwrap()
            .get_mut("Kernel")
            .and_then(plist::Value::as_dictionary_mut)
            .and_then(|kernel| kernel.get_mut("Add"))
            .and_then(plist::Value::as_array_mut)
            .and_then(|entries| entries.first_mut())
            .and_then(plist::Value::as_dictionary_mut)
            .unwrap();
        entry.insert(
            "ExecutablePath".into(),
            plist::Value::String("Contents/MacOS/Demo".into()),
        );
        entry.insert(
            "PlistPath".into(),
            plist::Value::String("Contents/Info.plist".into()),
        );
        config.to_file_xml(&config_path).unwrap();

        let imported = source.join("CustomName.kext");
        create_kext(&imported, "com.example.demo", true);
        fs::rename(
            imported.join("Contents/MacOS/Demo"),
            imported.join("Contents/MacOS/Other"),
        )
        .unwrap();
        let info_path = imported.join("Contents/Info.plist");
        let mut info = plist::Value::from_file(&info_path).unwrap();
        info.as_dictionary_mut().unwrap().insert(
            "CFBundleExecutable".into(),
            plist::Value::String("Other".into()),
        );
        info.to_file_xml(&info_path).unwrap();

        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = vec![ComponentSelection {
            item_id: scan.items[0].id.clone(),
            action: "use-imported".into(),
        }];
        let error =
            merge_component_session(&scan.scan_id, &base, &selections, &parent).unwrap_err();

        assert!(error.contains("Contents/MacOS/Demo"));
        assert!(fs::read_dir(&parent).unwrap().next().is_none());
        assert!(base
            .join("EFI/OC/Kexts/Demo.kext/Contents/MacOS/Demo")
            .is_file());
        assert!(imported.join("Contents/MacOS/Other").is_file());

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn supports_chinese_paths_and_rejects_empty_component_folders() {
        let base = test_root("中文基础");
        let source = test_root("用户组件");
        let empty = test_root("空目录");
        create_valid_efi(&base);
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&empty).unwrap();
        fs::write(source.join("用户定制.aml"), valid_aml()).unwrap();

        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        assert_eq!(scan.items.len(), 1);
        assert_eq!(scan.items[0].name, "用户定制.aml");
        assert!(scan_component_sources(std::slice::from_ref(&empty), &base)
            .unwrap_err()
            .contains("没有通过格式检查"));

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(empty).unwrap();
    }

    #[test]
    fn explicitly_enables_new_kext_acpi_and_driver_in_a_new_config_copy() {
        let base = test_root("enable-base");
        let source = test_root("enable-source");
        let parent = test_root("enable-parent");
        create_valid_efi(&base);
        create_kext(&source.join("Addon.kext"), "com.example.addon", false);
        fs::write(source.join("SSDT-ADDON.aml"), valid_aml()).unwrap();
        fs::write(source.join("Addon.efi"), valid_driver()).unwrap();
        fs::create_dir_all(&parent).unwrap();
        let source_hash_before = hash_directory(&source, &mut ScanBudget::default())
            .unwrap()
            .0;
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = scan
            .items
            .iter()
            .map(|item| ComponentSelection {
                item_id: item.id.clone(),
                action: "add-enabled".into(),
            })
            .collect::<Vec<_>>();

        let result = merge_component_session_with_validator(
            &scan.scan_id,
            &base,
            &selections,
            &parent,
            |_| Ok(()),
        )
        .unwrap();
        let output = PathBuf::from(&result.output_path);
        let config = plist::Value::from_file(output.join("EFI/OC/config.plist")).unwrap();

        assert!(result.config_modified);
        assert_ne!(result.config_before_sha256, result.config_after_sha256);
        assert_eq!(result.config_changes.len(), 3);
        assert_eq!(result.validation_level, "ocvalidate-passed");
        assert!(config_array(&config, "Kernel", "Add")
            .unwrap()
            .iter()
            .any(|entry| {
                entry
                    .as_dictionary()
                    .and_then(|dictionary| dictionary.get("BundlePath"))
                    .and_then(plist::Value::as_string)
                    == Some("Addon.kext")
            }));
        assert!(config_array(&config, "ACPI", "Add")
            .unwrap()
            .iter()
            .any(|entry| {
                entry
                    .as_dictionary()
                    .and_then(|dictionary| dictionary.get("Path"))
                    .and_then(plist::Value::as_string)
                    == Some("SSDT-ADDON.aml")
            }));
        assert!(config_array(&config, "UEFI", "Drivers")
            .unwrap()
            .iter()
            .any(|entry| {
                entry
                    .as_dictionary()
                    .and_then(|dictionary| dictionary.get("Path"))
                    .and_then(plist::Value::as_string)
                    == Some("Addon.efi")
            }));
        assert_eq!(
            hash_directory(&source, &mut ScanBudget::default())
                .unwrap()
                .0,
            source_hash_before
        );

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn orders_new_kexts_after_their_dependencies_even_when_names_sort_the_other_way() {
        let base = test_root("order-base");
        let source = test_root("order-source");
        let parent = test_root("order-parent");
        create_valid_efi(&base);
        create_kext(&source.join("APlugin.kext"), "com.example.plugin", true);
        set_kext_dependencies(&source.join("APlugin.kext"), &["com.example.library"]);
        create_kext(&source.join("ZLibrary.kext"), "com.example.library", true);
        fs::create_dir_all(&parent).unwrap();
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = scan
            .items
            .iter()
            .map(|item| ComponentSelection {
                item_id: item.id.clone(),
                action: "add-enabled".into(),
            })
            .collect::<Vec<_>>();

        let result = merge_component_session_with_validator(
            &scan.scan_id,
            &base,
            &selections,
            &parent,
            |_| Ok(()),
        )
        .unwrap();
        let config =
            plist::Value::from_file(PathBuf::from(result.output_path).join("EFI/OC/config.plist"))
                .unwrap();
        let order = config_array(&config, "Kernel", "Add")
            .unwrap()
            .iter()
            .filter_map(|entry| {
                entry
                    .as_dictionary()
                    .and_then(|dictionary| dictionary.get("BundlePath"))
                    .and_then(plist::Value::as_string)
            })
            .collect::<Vec<_>>();

        assert_eq!(order, vec!["Demo.kext", "ZLibrary.kext", "APlugin.kext"]);
        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn missing_kext_dependency_or_validator_failure_leaves_no_output() {
        let base = test_root("dependency-base");
        let source = test_root("dependency-source");
        let parent = test_root("dependency-parent");
        create_valid_efi(&base);
        create_kext(&source.join("Broken.kext"), "com.example.broken", true);
        set_kext_dependencies(&source.join("Broken.kext"), &["com.example.missing"]);
        fs::create_dir_all(&parent).unwrap();
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = vec![ComponentSelection {
            item_id: scan.items[0].id.clone(),
            action: "add-enabled".into(),
        }];

        let dependency_error = merge_component_session_with_validator(
            &scan.scan_id,
            &base,
            &selections,
            &parent,
            |_| Ok(()),
        )
        .unwrap_err();
        assert!(dependency_error.contains("com.example.missing"));
        assert!(fs::read_dir(&parent).unwrap().next().is_none());

        set_kext_dependencies(&source.join("Broken.kext"), &[]);
        let scan = scan_component_sources(std::slice::from_ref(&source), &base).unwrap();
        let selections = vec![ComponentSelection {
            item_id: scan.items[0].id.clone(),
            action: "add-enabled".into(),
        }];
        let validator_error = merge_component_session_with_validator(
            &scan.scan_id,
            &base,
            &selections,
            &parent,
            |_| Err("test ocvalidate failure".into()),
        )
        .unwrap_err();
        assert!(validator_error.contains("ocvalidate"));
        assert!(fs::read_dir(&parent).unwrap().next().is_none());

        fs::remove_dir_all(base).unwrap();
        fs::remove_dir_all(source).unwrap();
        fs::remove_dir_all(parent).unwrap();
    }
}
