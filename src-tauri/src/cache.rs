use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{OnceLock, RwLock},
};
use tauri::{AppHandle, Manager};

const LAYOUT: &str = "runtime-v1";
const CONFIG: &str = "cache-location.txt";

static CACHE_ROOT: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
static FALLBACK_NOTE: OnceLock<RwLock<Option<String>>> = OnceLock::new();
const DOWNLOAD_MARGIN_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    path: String,
    layout_version: String,
    writable: bool,
    available_bytes: Option<u64>,
    custom: bool,
    note: String,
}

fn root_slot() -> &'static RwLock<Option<PathBuf>> {
    CACHE_ROOT.get_or_init(|| RwLock::new(None))
}

fn fallback_note_slot() -> &'static RwLock<Option<String>> {
    FALLBACK_NOTE.get_or_init(|| RwLock::new(None))
}

fn default_root() -> PathBuf {
    std::env::temp_dir().join("efi-forge").join(LAYOUT)
}

fn reject_broad_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|item| matches!(item, Component::ParentDir))
    {
        return Err("缓存位置必须是没有 .. 的绝对路径。".into());
    }
    if path.parent().is_none()
        || path
            .parent()
            .is_some_and(|parent| parent.parent().is_none())
    {
        return Err("不能把磁盘根或其直接子目录作为缓存位置。".into());
    }
    if let Ok(workspace) = std::env::current_dir() {
        let overlaps = |candidate: &Path, workspace: &Path| {
            candidate == workspace
                || workspace.starts_with(candidate)
                || candidate.starts_with(workspace)
        };
        let lexical_overlap = overlaps(path, &workspace);
        let canonical_overlap = fs::canonicalize(&workspace)
            .ok()
            .zip(fs::canonicalize(path).ok())
            .is_some_and(|(workspace, candidate)| overlaps(&candidate, &workspace));
        if lexical_overlap || canonical_overlap {
            return Err("缓存位置不能是源码仓库、其上级或下级目录。".into());
        }
    }
    Ok(())
}

fn reject_existing_reparse_points(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        let Ok(metadata) = fs::symlink_metadata(ancestor) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            return Err(format!("缓存路径不能经过符号链接：{}", ancestor.display()));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err(format!("缓存路径不能经过重解析点：{}", ancestor.display()));
            }
        }
    }
    Ok(())
}

fn prepare_root(path: &Path) -> Result<PathBuf, String> {
    reject_broad_path(path)?;
    reject_existing_reparse_points(path)?;
    fs::create_dir_all(path).map_err(|error| format!("无法创建缓存目录：{error}"))?;
    reject_existing_reparse_points(path)?;
    let canonical = fs::canonicalize(path).map_err(|error| format!("无法解析缓存目录：{error}"))?;
    reject_broad_path(&canonical)?;
    let metadata =
        fs::symlink_metadata(&canonical).map_err(|error| format!("无法检查缓存目录：{error}"))?;
    if metadata.file_type().is_symlink() {
        return Err("缓存目录不能是符号链接或重解析入口。".into());
    }
    let probe = canonical.join(format!(".write-probe-{}", uuid::Uuid::new_v4()));
    fs::write(&probe, b"efi-forge").map_err(|error| format!("缓存目录不可写：{error}"))?;
    fs::remove_file(probe).map_err(|error| format!("缓存目录写入探针无法清理：{error}"))?;
    Ok(canonical)
}

fn reject_sensitive_selection(path: &Path) -> Result<(), String> {
    let is_efi = |candidate: &Path| {
        candidate.join("EFI/OC/config.plist").is_file()
            || candidate.join("OC/config.plist").is_file()
            || candidate.join("BOOT/BOOTx64.efi").is_file()
    };
    let is_workspace = |candidate: &Path| {
        candidate.join(".git").exists() && candidate.join("src-tauri/Cargo.toml").is_file()
    };
    // Only inspect the selected directory, a few ancestors, and fixed marker
    // children. This avoids recursively scanning a large user directory.
    if path
        .ancestors()
        .take(5)
        .any(|item| is_efi(item) || is_workspace(item))
    {
        return Err("不能在 EFI 来源/目标或源码仓库内创建缓存。".into());
    }
    Ok(())
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法取得应用配置目录：{error}"))?;
    let configured = fs::read_to_string(config_dir.join(CONFIG))
        .ok()
        .map(PathBuf::from);
    let (selected, fallback_note) = match configured {
        Some(path) => match prepare_root(&path) {
            Ok(root) => (Some(root), None),
            Err(error) => (
                None,
                Some(format!("已保存的缓存位置不可用，已回退默认位置：{error}")),
            ),
        },
        None => (None, None),
    };
    *root_slot().write().map_err(|_| "缓存路径锁已损坏。")? = selected;
    *fallback_note_slot()
        .write()
        .map_err(|_| "缓存说明锁已损坏。")? = fallback_note;
    Ok(())
}

pub fn managed_root() -> Result<PathBuf, String> {
    let selected = root_slot()
        .read()
        .map_err(|_| "缓存路径锁已损坏。")?
        .clone();
    prepare_root(selected.as_deref().unwrap_or(&default_root()))
}

pub fn component_cache_in(root: &Path) -> Result<PathBuf, String> {
    let path = root.join("components");
    fs::create_dir_all(&path).map_err(|error| format!("无法创建组件缓存：{error}"))?;
    Ok(path)
}

pub fn unique_temp_in(root: &Path, label: &str) -> Result<PathBuf, String> {
    let path = root
        .join("tasks")
        .join(format!("{label}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&path).map_err(|error| format!("无法创建受控暂存目录：{error}"))?;
    Ok(path)
}

fn space_sufficient(available: Option<u64>, expected: u64) -> Option<bool> {
    available.map(|bytes| bytes >= expected.saturating_add(DOWNLOAD_MARGIN_BYTES))
}

pub fn ensure_download_space(root: &Path, expected: u64) -> Result<(), String> {
    if matches!(
        space_sufficient(available_bytes(root), expected),
        Some(false)
    ) {
        return Err(format!(
            "缓存空间不足：组件需要 {} 字节，另需保留 {} 字节安全余量。",
            expected, DOWNLOAD_MARGIN_BYTES
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn available_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            name: *const u16,
            free: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0_u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (ok != 0).then_some(free)
}

#[cfg(not(windows))]
fn available_bytes(_path: &Path) -> Option<u64> {
    None
}

#[tauri::command]
pub fn get_cache_status() -> Result<CacheStatus, String> {
    let root = managed_root()?;
    let custom = root_slot()
        .read()
        .map_err(|_| "缓存路径锁已损坏。")?
        .is_some();
    let available = available_bytes(&root);
    let fallback = fallback_note_slot()
        .read()
        .map_err(|_| "缓存说明锁已损坏。")?
        .clone();
    let mut note = fallback.unwrap_or_else(|| "仅新任务使用此位置；旧缓存不会迁移或删除。".into());
    if available.is_none() {
        note.push_str(" 当前无法读取可用空间；下载仍会执行大小与 SHA-256 完整性校验。");
    }
    Ok(CacheStatus {
        path: root.display().to_string(),
        layout_version: LAYOUT.into(),
        writable: true,
        available_bytes: available,
        custom,
        note,
    })
}

#[tauri::command]
pub fn select_cache_location(app: AppHandle) -> Result<Option<CacheStatus>, String> {
    let Some(parent) = rfd::FileDialog::new()
        .set_title("选择 EFI Forge 缓存位置")
        .pick_folder()
    else {
        return Ok(None);
    };
    reject_sensitive_selection(&parent)?;
    let root = prepare_root(&parent.join("EFI-Forge-Cache").join(LAYOUT))?;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法取得应用配置目录：{error}"))?;
    fs::create_dir_all(&config_dir).map_err(|error| format!("无法创建应用配置目录：{error}"))?;
    let temp = config_dir.join(format!("{CONFIG}.tmp"));
    fs::write(&temp, root.to_string_lossy().as_bytes())
        .map_err(|error| format!("无法暂存缓存设置：{error}"))?;
    atomic_replace(&temp, &config_dir.join(CONFIG))?;
    *root_slot().write().map_err(|_| "缓存路径锁已损坏。")? = Some(root);
    *fallback_note_slot()
        .write()
        .map_err(|_| "缓存说明锁已损坏。")? = None;
    get_cache_status().map(Some)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let ok = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        Err(format!(
            "无法原子保存缓存设置：{}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|error| format!("无法保存缓存设置：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_roots_and_workspace() {
        assert!(reject_broad_path(Path::new("C:\\")).is_err());
        assert!(reject_broad_path(&std::env::current_dir().unwrap()).is_err());
        assert!(reject_broad_path(&std::env::current_dir().unwrap().join("cache")).is_err());
    }
    #[test]
    fn accepts_unicode_nested_cache() {
        let root = std::env::temp_dir()
            .join(format!("efi-forge-中文-{}", uuid::Uuid::new_v4()))
            .join("nested")
            .join(LAYOUT);
        let ready = prepare_root(&root).unwrap();
        assert!(ready.is_absolute());
        fs::remove_dir_all(root.parent().unwrap().parent().unwrap()).unwrap();
    }
    #[test]
    fn read_only_or_file_path_is_rejected() {
        let file = std::env::temp_dir().join(format!("efi-forge-file-{}", uuid::Uuid::new_v4()));
        fs::write(&file, b"x").unwrap();
        assert!(prepare_root(&file).is_err());
        fs::remove_file(file).unwrap();
    }

    #[test]
    fn download_space_keeps_a_safety_margin() {
        assert_eq!(
            space_sufficient(Some(DOWNLOAD_MARGIN_BYTES + 9), 10),
            Some(false)
        );
        assert_eq!(
            space_sufficient(Some(DOWNLOAD_MARGIN_BYTES + 10), 10),
            Some(true)
        );
        assert_eq!(space_sufficient(None, 10), None);
    }

    #[test]
    fn atomic_replace_can_update_an_existing_setting() {
        let dir = std::env::temp_dir().join(format!("efi-forge-config-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("setting");
        for value in [b"first".as_slice(), b"second".as_slice()] {
            let source = dir.join(format!("temp-{}", uuid::Uuid::new_v4()));
            fs::write(&source, value).unwrap();
            atomic_replace(&source, &target).unwrap();
        }
        assert_eq!(fs::read(&target).unwrap(), b"second");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_efi_and_repository_selection_without_recursive_scan() {
        let dir =
            std::env::temp_dir().join(format!("efi-forge-sensitive-{}", uuid::Uuid::new_v4()));
        let efi = dir.join("efi-source");
        fs::create_dir_all(efi.join("EFI/OC")).unwrap();
        fs::write(efi.join("EFI/OC/config.plist"), b"plist").unwrap();
        assert!(reject_sensitive_selection(&efi).is_err());
        assert!(reject_sensitive_selection(&efi.join("nested")).is_err());

        let repo = dir.join("repository");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("src-tauri")).unwrap();
        fs::write(repo.join("src-tauri/Cargo.toml"), b"[package]").unwrap();
        assert!(reject_sensitive_selection(&repo).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn rejects_an_existing_symlink_in_the_path() {
        use std::os::windows::fs::symlink_dir;
        let dir = std::env::temp_dir().join(format!("efi-forge-link-{}", uuid::Uuid::new_v4()));
        let real = dir.join("real");
        let link = dir.join("link");
        fs::create_dir_all(&real).unwrap();
        // Creating links may require Windows Developer Mode. When unavailable,
        // production detection is still compiled and junctions share the same
        // FILE_ATTRIBUTE_REPARSE_POINT check.
        if symlink_dir(&real, &link).is_ok() {
            assert!(prepare_root(&link.join("nested").join(LAYOUT)).is_err());
            fs::remove_dir(&link).unwrap();
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
