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
    #[serde(skip_serializing_if = "Option::is_none")]
    evidence: Option<HardwareEvidence>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemInfo {
    kind: String,
    firmware: String,
    secure_boot: bool,
    manufacturer: String,
    product_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    machine_type: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    bios_date: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    subsystem_vendor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subsystem_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    class_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_vendor_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_class_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity_source: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HardwareEvidence {
    storage_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chipset: Option<PciDevice>,
    storage_controllers: Vec<PciDevice>,
    usb_controllers: Vec<PciDevice>,
    thunderbolt_controllers: Vec<PciDevice>,
    bluetooth: Vec<PciDevice>,
    input_controllers: Vec<PciDevice>,
    laptop: LaptopEvidence,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaptopEvidence {
    battery_detected: bool,
    i2c_detected: bool,
    ps2_detected: bool,
    intel_sst_detected: bool,
    camera_detected: bool,
    fingerprint_detected: bool,
    card_reader_detected: bool,
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
  $subsystemVendorId = $null
  $subsystemDeviceId = $null
  $revisionId = $null
  if ($pnp -match 'VEN_([0-9A-Fa-f]{4})') { $vendorId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match 'DEV_([0-9A-Fa-f]{4})') { $deviceId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match 'SUBSYS_([0-9A-Fa-f]{8})') {
    $subsystemId = $Matches[1].ToUpperInvariant()
    $subsystemDeviceId = $subsystemId.Substring(0, 4)
    $subsystemVendorId = $subsystemId.Substring(4, 4)
  }
  if ($pnp -match 'REV_([0-9A-Fa-f]{2})') { $revisionId = $Matches[1].ToUpperInvariant() }
  $deviceName = if ($Item.Model) { [string]$Item.Model } elseif ($Item.Name) { [string]$Item.Name } else { 'Unknown device' }
  [PSCustomObject]@{
    id = "$Prefix-$Index"
    name = $deviceName
    vendorId = $vendorId
    deviceId = $deviceId
    subsystemId = $subsystemId
    subsystemVendorId = $subsystemVendorId
    subsystemDeviceId = $subsystemDeviceId
    revisionId = $revisionId
    classCode = $null
    parentVendorId = $null
    parentDeviceId = $null
    parentClassCode = $null
    identitySource = if ($pnp -match '^PCI\\') { 'direct-pci' } else { 'name-only' }
  }
}

function Convert-PnpEvidence {
  param([object]$Item, [string]$Prefix, [int]$Index)
  $pnp = [string]$Item.PNPDeviceID
  $vendorId = ''
  $deviceId = ''
  $subsystemId = $null
  $subsystemVendorId = $null
  $subsystemDeviceId = $null
  $revisionId = $null
  $classCode = $null
  if ($pnp -match 'VEN_([0-9A-Fa-f]{4})') { $vendorId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match 'DEV_([0-9A-Fa-f]{4})') { $deviceId = $Matches[1].ToUpperInvariant() }
  if ($pnp -match 'SUBSYS_([0-9A-Fa-f]{8})') {
    $subsystemId = $Matches[1].ToUpperInvariant()
    $subsystemDeviceId = $subsystemId.Substring(0, 4)
    $subsystemVendorId = $subsystemId.Substring(4, 4)
  }
  if ($pnp -match 'REV_([0-9A-Fa-f]{2})') { $revisionId = $Matches[1].ToUpperInvariant() }
  foreach ($compatibleId in @($Item.CompatibleID) + @($Item.HardwareID)) {
    if ([string]$compatibleId -match 'CC_([0-9A-Fa-f]{6})') {
      $classCode = $Matches[1].ToUpperInvariant()
      break
    }
  }
  [PSCustomObject]@{
    id = "$Prefix-$Index"
    name = if ($Item.Name) { [string]$Item.Name } else { 'Unknown device' }
    vendorId = $vendorId
    deviceId = $deviceId
    subsystemId = $subsystemId
    subsystemVendorId = $subsystemVendorId
    subsystemDeviceId = $subsystemDeviceId
    revisionId = $revisionId
    classCode = $classCode
    parentVendorId = $null
    parentDeviceId = $null
    parentClassCode = $null
    identitySource = if ($pnp -match '^PCI\\') { 'direct-pci' } else { 'name-only' }
  }
}

$computer = Get-CimInstance Win32_ComputerSystem | Select-Object -First 1
$computerProduct = Get-CimInstance Win32_ComputerSystemProduct | Select-Object -First 1
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
$biosDate = if ($bios.ReleaseDate) { ([datetime]$bios.ReleaseDate).ToString('yyyy-MM-dd') } else { $null }
$machineType = $null
if ([string]$computer.Manufacturer -match 'Lenovo') {
  $systemSku = [string]$computer.SystemSKUNumber
  $productCode = [string]$computerProduct.Name
  if ($systemSku -match '(?i)LENOVO_MT_([0-9A-Z]{4})(?:_|$)') {
    $machineType = $Matches[1].ToUpperInvariant()
  } elseif ($productCode -match '(?i)^([0-9A-Z]{4})[0-9A-Z]*$') {
    $machineType = $Matches[1].ToUpperInvariant()
  }
}

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

$pnpDevices = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID })

$storageControllers = @()
$index = 0
foreach ($item in @($pnpDevices | Where-Object {
  $_.PNPClass -in @('SCSIAdapter', 'HDC', 'IDEController') -or
  [string]$_.Name -match '(?i)NVMe|VMD|Volume Management|Rapid Storage|RST|RAID|SATA|AHCI'
} | Select-Object -First 16)) {
  $storageControllers += Convert-PnpEvidence $item 'storage-controller' $index
  $index++
}

$usbControllers = @()
$index = 0
foreach ($item in @($pnpDevices | Where-Object {
  [string]$_.Name -match '(?i)xHCI|USB.*Host Controller|Host Controller.*USB' -or
  ([string]$_.PNPDeviceID -match '^PCI\\' -and (@($_.CompatibleID) + @($_.HardwareID)) -match '(?i)CC_0C03')
} | Select-Object -First 16)) {
  $usbControllers += Convert-PnpEvidence $item 'usb-controller' $index
  $index++
}

$thunderboltControllers = @()
$index = 0
foreach ($item in @($pnpDevices | Where-Object {
  [string]$_.Name -match '(?i)Thunderbolt|USB4'
} | Select-Object -First 16)) {
  $thunderboltControllers += Convert-PnpEvidence $item 'thunderbolt-controller' $index
  $index++
}

$bluetooth = @()
$index = 0
foreach ($item in @($pnpDevices | Where-Object {
  $_.PNPClass -eq 'Bluetooth' -or [string]$_.Name -match '(?i)Bluetooth'
} | Select-Object -First 16)) {
  $bluetooth += Convert-PnpEvidence $item 'bluetooth' $index
  $index++
}

$inputControllers = @()
$index = 0
foreach ($item in @($pnpDevices | Where-Object {
  [string]$_.Name -match '(?i)I2C|PS/2|PS2|GPIO.*Controller|Serial IO'
} | Select-Object -First 16)) {
  $inputControllers += Convert-PnpEvidence $item 'input-controller' $index
  $index++
}

$chipsetItem = $pnpDevices | Where-Object {
  [string]$_.PNPDeviceID -match '^PCI\\' -and [string]$_.Name -match '(?i)LPC|PCH|ISA Bridge'
} | Select-Object -First 1
$chipset = if ($chipsetItem) { Convert-PnpEvidence $chipsetItem 'chipset' 0 } else { $null }

$storageMode = 'unknown'
if (@($storageControllers | Where-Object {
  $_.classCode -like '0104*' -or [string]$_.name -match '(?i)VMD|Volume Management|Rapid Storage|RST|RAID'
}).Count -gt 0) {
  $storageMode = 'raid-vmd'
} elseif (@($storageControllers | Where-Object {
  $_.classCode -like '0106*' -or [string]$_.name -match '(?i)AHCI'
}).Count -gt 0) {
  $storageMode = 'ahci'
}

$batteryDetected = @(Get-CimInstance Win32_Battery).Count -gt 0
$i2cDetected = @($inputControllers | Where-Object { [string]$_.name -match '(?i)I2C|Serial IO' }).Count -gt 0
$ps2Detected = @($inputControllers | Where-Object { [string]$_.name -match '(?i)PS/2|PS2' }).Count -gt 0
$intelSstDetected = @($pnpDevices | Where-Object { [string]$_.Name -match '(?i)Intel.*Smart Sound|Intel.*SST' }).Count -gt 0
$cameraDetected = @($pnpDevices | Where-Object { $_.PNPClass -eq 'Camera' -or [string]$_.Name -match '(?i)Integrated Camera|Webcam' }).Count -gt 0
$fingerprintDetected = @($pnpDevices | Where-Object { [string]$_.Name -match '(?i)Fingerprint|Goodix|Synaptics.*WBDI' }).Count -gt 0
$cardReaderDetected = @($pnpDevices | Where-Object { [string]$_.Name -match '(?i)Card Reader|SD Host|SDXC|Realtek.*Card' }).Count -gt 0

$report = [PSCustomObject]@{
  schemaVersion = 2
  capturedAt = (Get-Date).ToString('o')
  system = [PSCustomObject]@{
    kind = $kind
    firmware = $firmware
    secureBoot = $secureBoot
    manufacturer = [string]$computer.Manufacturer
    productName = [string]$computer.Model
    machineType = $machineType
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
    biosDate = $biosDate
  }
  gpus = @($gpus)
  network = @($network)
  audio = @($audio)
  storage = @($storage)
  evidence = [PSCustomObject]@{
    storageMode = $storageMode
    chipset = $chipset
    storageControllers = @($storageControllers)
    usbControllers = @($usbControllers)
    thunderboltControllers = @($thunderboltControllers)
    bluetooth = @($bluetooth)
    inputControllers = @($inputControllers)
    laptop = [PSCustomObject]@{
      batteryDetected = $batteryDetected
      i2cDetected = $i2cDetected
      ps2Detected = $ps2Detected
      intelSstDetected = $intelSstDetected
      cameraDetected = $cameraDetected
      fingerprintDetected = $fingerprintDetected
      cardReaderDetected = $cardReaderDetected
    }
  }
}

$report | ConvertTo-Json -Depth 8 -Compress
"#;

fn detect_cpu_generation(name: &str) -> String {
    let lowercase = name.to_ascii_lowercase();

    if lowercase.contains("core ultra") {
        return "meteor-lake".to_string();
    }

    if lowercase.contains("xeon") {
        if lowercase.contains("w-11") {
            return "tiger-lake".to_string();
        }
        if lowercase.contains("w-10") {
            return "comet-lake".to_string();
        }
        if lowercase.contains("e-21") || lowercase.contains("e-22") {
            return "coffee-lake".to_string();
        }
    }

    if lowercase.contains("ryzen ai") {
        return "zen-5".to_string();
    }

    if lowercase.contains("ryzen") {
        let model_token = lowercase
            .split_whitespace()
            .find(|part| {
                let digits: String = part.chars().take_while(char::is_ascii_digit).collect();
                digits.len() == 4
            })
            .unwrap_or_default();
        let series: String = model_token
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        let suffix = model_token.strip_prefix(&series).unwrap_or_default();
        let digits = series.chars().collect::<Vec<_>>();
        let mobile_suffix = suffix.starts_with('u') || suffix.starts_with('h');
        return match series.chars().next() {
            Some('1') => "zen-1".to_string(),
            Some('3') if suffix.starts_with('x') => "zen-2".to_string(),
            Some('4') => "zen-2".to_string(),
            Some('5')
                if mobile_suffix
                    && digits
                        .get(1)
                        .is_some_and(|digit| matches!(*digit, '3' | '5' | '7')) =>
            {
                "zen-2".to_string()
            }
            Some('5') => "zen-3".to_string(),
            Some('6') if mobile_suffix => "zen-3".to_string(),
            Some('7') if mobile_suffix && digits.get(2) == Some(&'2') => "zen-2".to_string(),
            Some('7') if mobile_suffix && digits.get(2) == Some(&'3') => "zen-3".to_string(),
            Some('7') if mobile_suffix && digits.get(2) == Some(&'5') => "zen-3".to_string(),
            Some('7') if mobile_suffix && digits.get(2) == Some(&'4') => "zen-4".to_string(),
            Some('7') if !mobile_suffix => "zen-4".to_string(),
            Some('8') if suffix.starts_with('x') || suffix.starts_with('g') => "zen-4".to_string(),
            Some('8')
                if digits
                    .get(2)
                    .is_some_and(|digit| matches!(*digit, '3' | '4')) =>
            {
                if digits.get(2) == Some(&'3') {
                    "zen-3".to_string()
                } else {
                    "zen-4".to_string()
                }
            }
            Some('9') if suffix.starts_with('x') => "zen-5".to_string(),
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
        let model_token = lowercase[start + marker.len()..]
            .split_whitespace()
            .next()
            .unwrap_or_default();
        let suffix = model_token.strip_prefix(&series).unwrap_or_default();

        if series.len() == 4 {
            if series.starts_with("10") {
                return "ice-lake".to_string();
            }
            if series.starts_with("11") {
                return "tiger-lake".to_string();
            }
            if series.starts_with("12") {
                return "alder-lake".to_string();
            }
            if series.starts_with("13") {
                return "raptor-lake".to_string();
            }
            return match series.chars().next() {
                Some('2') => "sandy-bridge".to_string(),
                Some('3') => "ivy-bridge".to_string(),
                Some('4') => "haswell".to_string(),
                Some('5') => "broadwell".to_string(),
                Some('6') => "skylake".to_string(),
                Some('7') => "kaby-lake".to_string(),
                Some('8') if suffix.contains('u') => "kaby-lake-r".to_string(),
                Some('8' | '9') => "coffee-lake".to_string(),
                _ => "unknown".to_string(),
            };
        }
        if series.len() == 5 && series.starts_with("10") {
            return "comet-lake".to_string();
        }
        if series.len() == 5 && series.starts_with("11") {
            return if suffix.contains('h') || suffix.contains('u') || suffix.contains('g') {
                "tiger-lake".to_string()
            } else {
                "rocket-lake".to_string()
            };
        }
        if series.len() == 5 && series.starts_with("12") {
            return "alder-lake".to_string();
        }
        if series.len() == 5 && series.starts_with("13") {
            return "raptor-lake".to_string();
        }
        if series.len() == 5 && series.starts_with("14") {
            return "raptor-lake-refresh".to_string();
        }
    }

    "unknown".to_string()
}

fn decode_cpuid_signature(eax: u32) -> (u32, u32) {
    let base_family = (eax >> 8) & 0x0f;
    let extended_family = (eax >> 20) & 0xff;
    let family = if base_family == 0x0f {
        base_family + extended_family
    } else {
        base_family
    };
    let base_model = (eax >> 4) & 0x0f;
    let extended_model = (eax >> 16) & 0x0f;
    let model = if matches!(base_family, 0x06 | 0x0f) {
        base_model | (extended_model << 4)
    } else {
        base_model
    };
    (family, model)
}

fn detected_cpu_family_model() -> Option<(u32, u32)> {
    #[cfg(target_arch = "x86")]
    {
        // SAFETY: Windows targets supported by EFI Forge run on x86 CPUs that
        // provide the architectural CPUID leaf 1 signature.
        let leaf = unsafe { std::arch::x86::__cpuid(1) };
        return Some(decode_cpuid_signature(leaf.eax));
    }
    #[cfg(target_arch = "x86_64")]
    {
        let leaf = std::arch::x86_64::__cpuid(1);
        return Some(decode_cpuid_signature(leaf.eax));
    }
    #[allow(unreachable_code)]
    None
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
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Windows 硬件扫描缺少关键字段：{}。请检查 WMI/CIM 服务与权限，或导入硬件报告后继续。",
            missing.join("、")
        ))
    }
}

fn normalize_optional_hardware(report: &mut HardwareReport) {
    if report.board.vendor.trim().is_empty() {
        report.board.vendor = "Unknown".to_string();
    }
    if report.board.model.trim().is_empty() {
        report.board.model = "Unknown".to_string();
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

    normalize_optional_hardware(&mut report);
    validate_required_hardware(&report)?;
    report.cpu.generation = detect_cpu_generation(&report.cpu.name);
    report.cpu.features = detected_cpu_features();
    if let Some((family, model)) = detected_cpu_family_model() {
        report.cpu.family = family;
        report.cpu.model = model;
    }
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
        decode_cpuid_signature, detect_cpu_generation, normalize_optional_hardware,
        run_hardware_scan, validate_required_hardware, HardwareReport,
    };

    #[test]
    fn detects_supported_intel_generations() {
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-2600 CPU"),
            "sandy-bridge"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-3770 CPU"),
            "ivy-bridge"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-4790K CPU"),
            "haswell"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-5775C CPU"),
            "broadwell"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-6700K CPU"),
            "skylake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-7700K CPU"),
            "kaby-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-8700 CPU"),
            "coffee-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i5-8350U CPU"),
            "kaby-lake-r"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i9-9900K CPU"),
            "coffee-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-10700 CPU"),
            "comet-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i5-1035G1 CPU"),
            "ice-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-1165G7 CPU"),
            "tiger-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-11700K CPU"),
            "rocket-lake"
        );
        assert_eq!(
            detect_cpu_generation("Intel(R) Core(TM) i7-14700K CPU"),
            "raptor-lake-refresh"
        );
        assert_eq!(
            detect_cpu_generation("Intel Core Ultra 7 155H"),
            "meteor-lake"
        );
        assert_eq!(detect_cpu_generation("Intel Xeon E-2176M"), "coffee-lake");
        assert_eq!(detect_cpu_generation("Intel Xeon W-10855M"), "comet-lake");
        assert_eq!(detect_cpu_generation("Intel Xeon W-11955M"), "tiger-lake");
    }

    #[test]
    fn leaves_unknown_generations_unclassified() {
        assert_eq!(detect_cpu_generation("Intel Pentium Gold G6400"), "unknown");
    }

    #[test]
    fn detects_amd_zen_generations() {
        assert_eq!(
            detect_cpu_generation("AMD Ryzen 5 5600X 6-Core Processor"),
            "zen-3"
        );
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 3700X"), "zen-2");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 7730U"), "zen-3");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 7840U"), "zen-4");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 7700X"), "zen-4");
        assert_eq!(detect_cpu_generation("AMD Ryzen 9 9950X"), "zen-5");
        assert_eq!(detect_cpu_generation("AMD Ryzen 3 5300U"), "zen-2");
        assert_eq!(detect_cpu_generation("AMD Ryzen 5 5500U"), "zen-2");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 5700U"), "zen-2");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 5800H"), "zen-3");
        assert_eq!(detect_cpu_generation("AMD Ryzen 7 7735HS"), "zen-3");
        assert_eq!(detect_cpu_generation("AMD Ryzen AI 9 HX 370"), "zen-5");
    }

    #[test]
    fn decodes_architectural_cpuid_family_and_model() {
        let signature = (0x0a << 16) | (0x06 << 8) | (0x05 << 4);
        assert_eq!(decode_cpuid_signature(signature), (6, 0xa5));
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
        assert!(error.contains("导入硬件报告"));
    }

    #[test]
    fn keeps_scanning_when_only_board_identity_is_missing() {
        let mut report: HardwareReport = serde_json::from_str(
            r#"{
                "schemaVersion":1,
                "capturedAt":"2026-08-25T00:00:00Z",
                "system":{"kind":"desktop","firmware":"uefi","secureBoot":false,"manufacturer":"OEM","productName":"Model"},
                "cpu":{"vendor":"intel","name":"Intel Core i5-9600K","generation":"unknown","family":6,"model":158,"cores":6,"threads":6,"features":[]},
                "board":{"vendor":"","model":"","biosVersion":""},
                "gpus":[],"network":[],"audio":[],"storage":[]
            }"#,
        )
        .unwrap();

        normalize_optional_hardware(&mut report);

        validate_required_hardware(&report).unwrap();
        assert_eq!(report.board.vendor, "Unknown");
        assert_eq!(report.board.model, "Unknown");
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "requires a real Windows session with accessible WMI/CIM hardware providers"]
    fn scans_the_current_windows_machine() {
        let report = run_hardware_scan().expect("the local Windows scan should succeed");

        assert_eq!(report.schema_version, 2);
        assert!(!report.cpu.name.trim().is_empty());
        assert!(!report.board.model.trim().is_empty());
        assert!(!report.gpus.is_empty());
        assert!(!report.storage.is_empty());
        assert!(report
            .gpus
            .iter()
            .chain(&report.network)
            .chain(&report.audio)
            .chain(&report.storage)
            .all(|device| device.identity_source.is_some()));
        let evidence = report.evidence.as_ref().expect("schema v2 evidence");
        assert!(!evidence.storage_controllers.is_empty());
        assert!(matches!(
            evidence.storage_mode.as_str(),
            "ahci" | "raid-vmd" | "unknown"
        ));
        let exported = serde_json::to_string(&report).expect("serialize report");
        assert!(!exported.contains("PNPDeviceID"));
        assert!(!exported.contains("instanceId"));
    }
}
