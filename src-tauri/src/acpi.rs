use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

const ACPI_HEADER_LENGTH: usize = 36;
const MAX_ACPI_TABLE_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct ValidatedAcpiTable {
    pub(crate) bytes: Vec<u8>,
    pub(crate) signature: String,
    pub(crate) oem_id: String,
    pub(crate) oem_table_id: String,
    pub(crate) revision: u8,
    pub(crate) sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AcpiClockEvidence {
    source_name: String,
    signature: String,
    oem_id: String,
    oem_table_id: String,
    revision: u8,
    length: usize,
    sha256: String,
    has_awac_device_id: bool,
    has_legacy_rtc_id: bool,
    has_stas_symbol: bool,
    suggested_mode: &'static str,
    confidence: &'static str,
    reasons: Vec<String>,
    warnings: Vec<String>,
}

#[tauri::command]
pub fn select_acpi_clock_evidence() -> Result<Option<AcpiClockEvidence>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("选择从当前 BIOS 导出的 DSDT.aml")
        .add_filter("ACPI DSDT", &["aml", "bin"])
        .pick_file()
    else {
        return Ok(None);
    };

    analyze_acpi_clock_file(&path).map(Some)
}

pub(crate) fn read_valid_acpi_table(path: &Path) -> Result<ValidatedAcpiTable, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("无法读取 ACPI 文件元数据：{error}"))?;
    if !metadata.file_type().is_file() {
        return Err("ACPI 输入必须是普通文件。".into());
    }
    if metadata.file_type().is_symlink() || is_windows_reparse_point(&metadata) {
        return Err("ACPI 输入不能是符号链接或 Windows 重解析点。".into());
    }
    if metadata.len() < ACPI_HEADER_LENGTH as u64 {
        return Err("AML 小于 ACPI 标准表头长度。".into());
    }
    if metadata.len() > MAX_ACPI_TABLE_BYTES {
        return Err("ACPI 表超过 16 MB，分析已停止。".into());
    }

    let bytes = fs::read(path).map_err(|error| format!("无法读取 ACPI 文件：{error}"))?;
    if bytes.len() as u64 != metadata.len() {
        return Err("ACPI 文件在读取过程中发生变化，请重新导出后再试。".into());
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared < ACPI_HEADER_LENGTH || declared != bytes.len() {
        return Err("AML 表头声明长度与文件大小不一致。".into());
    }
    if bytes.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)) != 0 {
        return Err("AML ACPI 校验和无效。".into());
    }

    let signature = ascii_field(&bytes[0..4], "AML Signature")?;
    let oem_id = ascii_field(&bytes[10..16], "AML OEM ID")?;
    let oem_table_id = ascii_field(&bytes[16..24], "AML OEM Table ID")?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    Ok(ValidatedAcpiTable {
        revision: bytes[8],
        bytes,
        signature,
        oem_id,
        oem_table_id,
        sha256,
    })
}

fn analyze_acpi_clock_file(path: &Path) -> Result<AcpiClockEvidence, String> {
    let table = read_valid_acpi_table(path)?;
    if table.signature != "DSDT" {
        return Err(format!(
            "时钟证据分析只接受 DSDT，当前 ACPI 签名为 {}。",
            table.signature
        ));
    }
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "DSDT 文件名不是有效 Unicode。".to_string())?
        .to_string();
    Ok(analyze_clock_tokens(source_name, table))
}

fn analyze_clock_tokens(source_name: String, table: ValidatedAcpiTable) -> AcpiClockEvidence {
    let body = &table.bytes[ACPI_HEADER_LENGTH..];
    let has_awac_device_id = contains_token(body, b"ACPI000E");
    let has_legacy_rtc_id = contains_token(body, b"PNP0B00");
    let has_stas_symbol = contains_token(body, b"STAS");

    let (suggested_mode, confidence, summary) = match (
        has_awac_device_id,
        has_legacy_rtc_id,
        has_stas_symbol,
    ) {
        (true, true, true) => (
            "awac",
            "strong-clue",
            "同时找到 AWAC、Legacy RTC 与 STAS 字节线索，可把预编译 AWAC 作为强候选。",
        ),
        (true, _, _) => (
            "manual",
            "possible-clue",
            "找到 AWAC，但没有同时找到 Legacy RTC 与 STAS；应改用专属 RTC0/SSDTTime 或人工核对。",
        ),
        (false, true, _) => (
            "manual",
            "possible-clue",
            "找到 Legacy RTC 且没有 AWAC 字节线索；当前工具不会据此自动省略时钟 SSDT，应人工核对。",
        ),
        (false, false, _) => (
            "manual",
            "insufficient",
            "没有找到 AWAC 或 Legacy RTC 设备 ID，证据不足，应导出反编译结果后人工核对。",
        ),
    };

    AcpiClockEvidence {
        source_name,
        signature: table.signature,
        oem_id: table.oem_id,
        oem_table_id: table.oem_table_id,
        revision: table.revision,
        length: table.bytes.len(),
        sha256: table.sha256,
        has_awac_device_id,
        has_legacy_rtc_id,
        has_stas_symbol,
        suggested_mode,
        confidence,
        reasons: vec![summary.into()],
        warnings: vec![
            "这里只检查 AML 字节令牌，不能证明设备路径、_STA 方法或 STAS 控制关系。".into(),
            "工具不能证明所选 DSDT 来自当前电脑或当前 BIOS；请核对导出来源与 SHA-256。".into(),
        ],
    }
}

fn contains_token(bytes: &[u8], token: &[u8]) -> bool {
    bytes.windows(token.len()).any(|window| window == token)
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

#[cfg(windows)]
fn is_windows_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_windows_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_file(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("efi-forge-acpi-{label}-{nanos}.aml"))
    }

    fn valid_table(signature: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0u8; ACPI_HEADER_LENGTH + body.len()];
        let declared_length = bytes.len() as u32;
        bytes[0..4].copy_from_slice(signature);
        bytes[4..8].copy_from_slice(&declared_length.to_le_bytes());
        bytes[8] = 2;
        bytes[10..16].copy_from_slice(b"EFIFRG");
        bytes[16..24].copy_from_slice(b"CLOCKTST");
        bytes[ACPI_HEADER_LENGTH..].copy_from_slice(body);
        let sum = bytes
            .iter()
            .fold(0u8, |value, byte| value.wrapping_add(*byte));
        bytes[9] = 0u8.wrapping_sub(sum);
        bytes
    }

    #[test]
    fn returns_a_strong_awac_clue_only_when_all_three_tokens_exist() {
        let path = test_file("strong");
        fs::write(
            &path,
            valid_table(b"DSDT", b"Device ACPI000E Name STAS Device PNP0B00"),
        )
        .unwrap();

        let result = analyze_acpi_clock_file(&path).unwrap();
        assert_eq!(result.suggested_mode, "awac");
        assert_eq!(result.confidence, "strong-clue");
        assert!(result.has_awac_device_id);
        assert!(result.has_legacy_rtc_id);
        assert!(result.has_stas_symbol);
        assert_eq!(result.sha256.len(), 64);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn keeps_incomplete_or_missing_clock_tokens_on_the_manual_path() {
        for (label, body, confidence) in [
            ("awac-only", b"ACPI000E".as_slice(), "possible-clue"),
            ("rtc-only", b"PNP0B00".as_slice(), "possible-clue"),
            ("unknown", b"NO CLOCK IDS".as_slice(), "insufficient"),
        ] {
            let path = test_file(label);
            fs::write(&path, valid_table(b"DSDT", body)).unwrap();
            let result = analyze_acpi_clock_file(&path).unwrap();
            assert_eq!(result.suggested_mode, "manual");
            assert_eq!(result.confidence, confidence);
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn rejects_non_dsdt_and_corrupt_acpi_tables() {
        let ssdt = test_file("ssdt");
        fs::write(&ssdt, valid_table(b"SSDT", b"ACPI000E STAS PNP0B00")).unwrap();
        assert!(analyze_acpi_clock_file(&ssdt)
            .unwrap_err()
            .contains("只接受 DSDT"));
        fs::remove_file(ssdt).unwrap();

        let corrupt = test_file("corrupt");
        let mut bytes = valid_table(b"DSDT", b"ACPI000E STAS PNP0B00");
        *bytes.last_mut().unwrap() ^= 1;
        fs::write(&corrupt, bytes).unwrap();
        assert!(read_valid_acpi_table(&corrupt)
            .unwrap_err()
            .contains("校验和无效"));
        fs::remove_file(corrupt).unwrap();
    }
}
