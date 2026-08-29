# EFI Forge · BIOS / ACPI 候选策略

更新日期：2026-08-29

## 目的

静态 Windows 硬件报告不能证明目标机器的 DSDT 中存在 AWAC、STAS 或可重新启用的 Legacy RTC，也不能证明某个 AMD BIOS 的内存映射行为。因此，这些判断属于可撤销的候选默认值，不属于实机兼容证明。

## Intel Coffee Lake / Comet Lake 台式机

对已审核的 B360、B365、H310、H370、Z390、B460 和 Z490 路径，组装页提供三种选择：

1. 自动候选：加入锁定版本的预编译 `SSDT-AWAC`，同时明确提示尚未读取 ACPI 时钟证据。
2. 用户确认 AWAC：用户已经核对 `ACPI000E`、STAS 与 `PNP0B00` 后，显式保留预编译 AWAC 路径。
3. 手动 RTC0 / SSDTTime：不加入预编译 AWAC，不自动生成 `config.plist`，但允许继续导出锁定组件、导入专属 AML 或融合用户 EFI。

Windows 桌面版可以让用户选择从目标 BIOS 导出的 `DSDT.aml`。Rust 原生层只读检查：普通文件、16 MB 上限、ACPI 表头、声明长度、校验和、DSDT 签名和 SHA-256；随后只在 AML 主体中查找 `ACPI000E`、`PNP0B00`、`STAS` 字节令牌。三项同时存在时显示 AWAC“强线索”，否则保持手动核对建议。工具不会自动应用建议，也不会执行、反编译或修改 AML。

令牌共存不证明它们位于正确命名空间，也不证明 `_STA`/STAS 控制关系。用户必须核对 DSDT 来源和哈希，再显式点击应用建议；证据与最终选择都会写入构建 manifest。

Z370 和其他未审核组合不因型号猜测自动加入 AWAC。`SSDT-RHUB` 只对 ASUS 400 系主板自动加入；MSI、Gigabyte、ASRock 等厂商不自动加入。

依据：

- <https://dortania.github.io/Getting-Started-With-ACPI/Universal/awac.html>
- <https://dortania.github.io/Getting-Started-With-ACPI/Universal/awac-methods/manual.html>
- <https://dortania.github.io/Getting-Started-With-ACPI/ssdt-methods/ssdt-prebuilt.html>

## AMD B450 / X470

Dortania 指出，B450 和 X470 的“late 2020 BIOS updates”可能需要关闭 `SetupVirtualMap`，但没有给出适用于所有厂商的精确日期。EFI Forge 使用 `2020-10-01` 作为透明的 Q4 风险代理：日期达到该值时默认关闭，但界面始终允许用户覆盖。该日期不是厂商固件变更日，也不能代替 OpenCore 日志或实机启动验证。

A520、B550、X570 继续使用现有保守默认值；用户的显式选择优先于芯片组或 BIOS 风险默认值。

依据：

- <https://dortania.github.io/OpenCore-Install-Guide/AMD/zen.html#booter>
- <https://dortania.github.io/OpenCore-Install-Guide/troubleshooting/extended/kernel-issues.html#stuck-on-eb-log-exitbs-start>

## 安全语义

- 缺失 BIOS 日期或 ACPI 证据只产生说明和较低可信度，不阻止用户继续。
- 手动 RTC0 路径关闭自动配置，是为了避免生成内部引用不完整的 EFI；用户仍可导出组件并提供自己的 `config.plist`/AML。
- `ocvalidate` 通过只证明 OpenCore 配置结构有效，不证明 AWAC、RTC0、RHUB 或 `SetupVirtualMap` 与该主板 BIOS 匹配。
