use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareReport {
    schema_version: u8,
    captured_at: String,
    system: SystemInfo,
    cpu: CpuInfo,
    board: BoardInfo,
    gpus: Vec<PciDevice>,
    network: Vec<PciDevice>,
    audio: Vec<PciDevice>,
    storage: Vec<PciDevice>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    kind: String,
    firmware: String,
    secure_boot: bool,
    manufacturer: String,
    product_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CpuInfo {
    vendor: String,
    name: String,
    generation: String,
    family: u32,
    model: u32,
    cores: u32,
    threads: u32,
    features: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardInfo {
    vendor: String,
    model: String,
    bios_version: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PciDevice {
    id: String,
    name: String,
    vendor_id: String,
    device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    subsystem_id: Option<String>,
}

const WINDOWS_HARDWARE_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding

function Convert-Device {
  param([object]$Item, [string]$Prefix, [int]$Index)
  $pnp = [string]$Item.PNPDeviceID
  $vendorId = ''
  $deviceId = ''
  $subsystemId = $null
  if ($pnp -match '(?:VEN|VID)_([0-9A-Fa-f]{4})') { $vendorId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match '(?:DEV|PID)_([0-9A-Fa-f]{4})') { $deviceId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match 'SUBSYS_([0-9A-Fa-f]{8})') { $subsystemId = $Matches[1].ToUpperInvariant() }
  $deviceName = if ($Item.Model) { [string]$Item.Model } elseif ($Item.Name) { [string]$Item.Name } else { 'Unknown device' }
  [PSCustomObject]@{
    id = "$Prefix-$Index"
    name = $deviceName
    vendorId = $vendorId
    deviceId = $deviceId
    subsystemId = $subsystemId
  }
}

$computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$processor = Get-CimInstance Win32_Processor | Select-Object -First 1
$baseBoard = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$bios = Get-CimInstance Win32_BIOS | Select-Object -First 1

$firmwareValue = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control').PEFirmwareType
$firmware = if ($firmwareValue -eq 2) { 'uefi' } else { 'legacy' }
$secureBootValue = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State').UEFISecureBootEnabled
$secureBoot = $secureBootValue -eq 1
$portableTypes = @(2, 8, 9, 10)
$kind = if ($portableTypes -contains [int]$computer.PCSystemType) { 'laptop' } else { 'desktop' }
$cpuVendor = if ([string]$processor.Manufacturer -match 'Intel') { 'intel' } elseif ([string]$processor.Manufacturer -match 'AMD') { 'amd' } else { 'unknown' }

$gpus = @()
$index = 0
foreach ($item in @(Get-CimInstance Win32_VideoController)) {
  $gpus += Convert-Device $item 'gpu' $index
  $index++
}

$network = @()
$index = 0
foreach ($item in @(Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -and $_.PNPDeviceID })) {
  $network += Convert-Device $item 'network' $index
  $index++
}

$audio = @()
$index = 0
foreach ($item in @(Get-CimInstance Win32_SoundDevice)) {
  $audio += Convert-Device $item 'audio' $index
  $index++
}

$storage = @()
$index = 0
foreach ($item in @(Get-CimInstance Win32_DiskDrive)) {
  $storage += Convert-Device $item 'storage' $index
  $index++
}

$report = [PSCustomObject]@{
  schemaVersion = 1
  capturedAt = (Get-Date).ToString('o')
  system = [PSCustomObject]@{
    kind = $kind
    firmware = $firmware
    secureBoot = $secureBoot
    manufacturer = [string]$computer.Manufacturer
    productName = [string]$computer.Model
  }
  cpu = [PSCustomObject]@{
    vendor = $cpuVendor
    name = [string]$processor.Name
    generation = 'unknown'
    family = [int]$processor.Family
    model = 0
    cores = [int]$processor.NumberOfCores
    threads = [int]$processor.NumberOfLogicalProcessors
    features = @()
  }
  board = [PSCustomObject]@{
    vendor = [string]$baseBoard.Manufacturer
    model = [string]$baseBoard.Product
    biosVersion = [string]$bios.SMBIOSBIOSVersion
  }
  gpus = @($gpus)
  network = @($network)
  audio = @($audio)
  storage = @($storage)
}

$report | ConvertTo-Json -Depth 6 -Compress
"#;

fn detect_cpu_generation(name: &str) -> String {
    let lowercase = name.to_ascii_lowercase();

    if lowercase.contains("ryzen") {
        let series = lowercase
            .split_whitespace()
            .find_map(|part| {
                let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
                (digits.len() == 4).then_some(digits)
            })
            .unwrap_or_default();
        return match series.chars().next() {
            Some('1' | '2') => "zen-1".to_string(),
            Some('3') => "zen-2".to_string(),
            Some('4' | '5') => "zen-3".to_string(),
            Some('7' | '8' | '9') => "zen-4".to_string(),
            _ => "amd-zen".to_string(),
        };
    }

    for marker in ["i3-", "i5-", "i7-", "i9-"] {
        let Some(start) = lowercase.find(marker) else {
            continue;
        };
        let series: String = lowercase[start + marker.len()..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();

        if series.len() == 4 && (series.starts_with('8') || series.starts_with('9')) {
            return "coffee-lake".to_string();
        }
        if series.len() == 5 && series.starts_with("10") {
            return "comet-lake".to_string();
        }
    }

    "unknown".to_string()
}

fn detected_cpu_features() -> Vec<String> {
    let mut features = Vec::new();

    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        if std::is_x86_feature_detected!("sse4.2") {
            features.push("sse4.2".to_string());
        }
        if std::is_x86_feature_detected!("avx") {
            features.push("avx".to_string());
        }
        if std::is_x86_feature_detected!("avx2") {
            features.push("avx2".to_string());
        }
    }

    features
}

fn validate_required_hardware(report: &HardwareReport) -> Result<(), String> {
    let mut missing = Vec::new();
    if report.cpu.name.trim().is_empty() || report.cpu.cores == 0 {
        missing.push("CPU 型号/核心数");
    }
    if report.board.vendor.trim().is_empty() || report.board.model.trim().is_empty() {
        missing.push("主板厂商/型号");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Windows 硬件扫描缺少关键字段：{}。请检查 WMI/CIM 服务与权限，或导入硬件报告后继续。",
            missing.join("、")
        ))
    }
}

#[cfg(target_os = "windows")]
fn run_hardware_scan() -> Result<HardwareReport, String> {
    use std::process::Command;

    let output = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WINDOWS_HARDWARE_SCRIPT,
        ])
        .output()
        .map_err(|error| format!("无法启动 Windows 硬件扫描：{error}"))?;

    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Windows 硬件扫描失败：{}", details.trim()));
    }

    let json = String::from_utf8(output.stdout)
        .map_err(|_| "硬件扫描返回了无法识别的文本编码。".to_string())?;
    let mut report: HardwareReport = serde_json::from_str(json.trim())
        .map_err(|error| format!("无法解析硬件扫描结果：{error}"))?;

    validate_required_hardware(&report)?;
    report.cpu.generation = detect_cpu_generation(&report.cpu.name);
    report.cpu.features = detected_cpu_features();
    Ok(report)
}

#[cfg(not(target_os = "windows"))]
fn run_hardware_scan() -> Result<HardwareReport, String> {
    Err("真实硬件扫描当前只支持 Windows。".to_string())
}

#[tauri::command]
pub async fn scan_hardware() -> Result<HardwareReport, String> {
    tauri::async_runtime::spawn_blocking(run_hardware_scan)
        .await
        .map_err(|error| format!("硬件扫描任务意外停止：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        detect_cpu_generation, run_hardware_scan, validate_required_hardware, HardwareReport,
    };

    #[test]
    fn detects_supported_intel_generations() {
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-8700 CPU"),
            "coffee-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i9-9900K CPU"),
            "coffee-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-10700 CPU"),
            "comet-lake"
        );
    }

    #[test]
    fn leaves_unknown_generations_unclassified() {
        assert_eq!(detect_cpu_generation("Intel Core Ultra 7 155H"), "unknown");
    }

    #[test]
    fn detects_amd_zen_generations() {
        assert_eq!(
            detect_cpu_generation("AMD Ryzen 5 5600X 6-Core Processor"),
            "zen-3"
        );
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 3700X"), "zen-2");
    }

    #[test]
    fn rejects_incomplete_cim_reports_with_a_clear_error() {
        let report: HardwareReport = serde_json::from_str(
            r#"{
                "schemaVersion":1,
                "capturedAt":"2026-08-25T00:00:00Z",
                "system":{"kind":"desktop","firmware":"uefi","secureBoot":false,"manufacturer":"","productName":""},
                "cpu":{"vendor":"unknown","name":"","generation":"unknown","family":0,"model":0,"cores":0,"threads":0,"features":[]},
                "board":{"vendor":"","model":"","biosVersion":""},
                "gpus":[],"network":[],"audio":[],"storage":[]
            }"#,
        )
        .unwrap();

        let error = validate_required_hardware(&report).unwrap_err();
        assert!(error.contains("CPU 型号/核心数"));
        assert!(error.contains("主板厂商/型号"));
        assert!(error.contains("导入硬件报告"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn scans_the_current_windows_machine() {
        let report = run_hardware_scan().expect("the local Windows scan should succeed");

        assert_eq!(report.schema_version, 1);
        assert!(!report.cpu.name.trim().is_empty());
        assert!(!report.board.model.trim().is_empty());
        assert!(!report.gpus.is_empty());
        assert!(!report.storage.is_empty());
    }
}
