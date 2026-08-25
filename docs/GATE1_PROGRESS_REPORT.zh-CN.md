# EFI Forge v0.1.4 Gate 1 修复进度

复核日期：2026-08-25

## 本轮结论

Gate 0 的三项安全/AMD 启动修复继续保留。本轮进一步修复了会造成错误自动配置或错误置信度的常见硬件判断，并坚持“信息不足警告但不阻止、明确不兼容降低可信度但允许实验、结构损坏或数据风险停止”的产品原则。

Gate 1 尚不能整体关闭：I225/I226 的真实网络驱动路径、专属 DSDT/RTC0、更多 Vega/工作站显卡、NVMeFix 自动策略仍缺少足够实机证据。本轮不会把这些缺口伪装成已支持。

## 已完成

### AMD 显卡 PCI ID

- 标准 RX 470/480/570/580/590 `67DF` 与相关原生 Polaris PCI ID进入支持规则。
- RX 580 2048SP / RX 590 GME `6FDF` 明确标记为不支持。
- RX 5000、RX 6800 系列、RX 6600 等原生 Navi 只在审核 PCI ID 命中时加入 `agdpmod=pikera`。
- 需要 spoof 的 Navi 型号标记为部分支持，不自动写入未经核对的 DeviceProperties。
- Navi 22 标记为社区实验方案；Navi 24、Navi 3x 标记为无原生支持。
- 未知独显不再因为规则缺失就自动加入 `-wegnoegpu`；只有命中明确阻断规则且存在可用 UHD 630 时才默认禁用。

官方依据：<https://dortania.github.io/GPU-Buyers-Guide/modern-gpus/amd-gpu.html>

### I225 / I226

- I219 与 I225/I226 拆分，不再把三者统一显示为完整支持。
- I225 标记为部分支持，明确 macOS 13+ DEXT、VT-d、旧 Kext 回退及主板差异；Gigabyte 保留官方文档中的 `e1000=0` 回退参数。
- I226 标记为部分支持；当前不自动加入尚未由本工具实机验证的 AppleIGC。
- 清单会显示非完整支持警告，但仍允许用户继续或导入自有 EFI。

官方依据：<https://dortania.github.io/OpenCore-Install-Guide/ktext.html#ethernet>

### NVMe 风险识别

- 存储规则不再依赖 `Win32_DiskDrive` 经常缺失的 PCI Vendor ID，可按完整型号命中。
- 新增 Samsung PM991、Micron 2200S、Intel Optane/3D XPoint、Intel 600p。
- Samsung 970 EVO Plus 继续提示固件核对。

官方依据：<https://dortania.github.io/OpenCore-Install-Guide/macos-limits.html#storage-support>

### BIOS / ACPI 自由选择

- AMD Zen 组装页新增 `SetupVirtualMap` 选择：默认开启，也允许用户为部分新版 B450/X470 BIOS 选择关闭。
- 选择会写入构建计划、manifest 和最终 `config.plist`，不是只显示说明文字。
- Coffee/Comet 使用预编译 SSDT-AWAC 时明确提示：若 DSDT 没有可恢复的 Legacy RTC，应使用 SSDTTime 生成专属 RTC0 并导入自有 EFI。
- 这类信息不足只产生警告，不设置覆盖率门槛。

### 扫描可靠性

- CIM 权限或服务异常导致 CPU/主板关键字段为空时，不再返回看似有效的硬件报告。
- 错误会明确指出缺少字段，并提示检查 WMI/CIM 或导入报告继续。

## 验证结果

| 检查 | 结果 |
|---|---|
| Vitest | 5 个文件、27/27 通过 |
| Rust 常规测试 | 12/12 通过，2 项联网测试默认忽略 |
| Rust 真实下载构建 | 2/2 通过；AMD B450、Coffee Lake、Comet Lake |
| TypeScript + Vite production | 通过；44 modules |
| Clippy `--all-targets -- -D warnings` | 通过 |
| OpenCore 1.0.7 ocvalidate | 三条真实构建路径均通过 |

## 0.1.4 安装包

- 文件：`src-tauri/target-gate1-release/release/bundle/nsis/EFI Forge_0.1.4_x64-setup.exe`
- 大小：3,443,785 bytes
- ProductVersion / FileVersion：0.1.4
- SHA-256：`A99F02068F99E78FECD4775F1DE55886EB45CC57A139893EBE310983D1DAF68F`
- Authenticode：未签名

## 仍需处理

1. I225/I226 需要按主板、VT-d/DMAR 和 macOS 版本建立可复现的实机网络矩阵。
2. 导入 SSDTTime 结果并验证专属 AWAC/RTC0，而不是永远使用预编译 SSDT。
3. 扩展 Vega、Radeon Pro、spoof 型号和更多精确 PCI ID。
4. 建立 NVMeFix 锁定组件与“警告、禁用设备、换盘”用户选择，但不能把高风险盘伪装为安全安装目标。
5. 完成 USB Map、Wi-Fi/蓝牙、RTL8111、I211、笔记本电池/输入/亮度/睡眠闭环。
6. GitHub、CI、许可证通知与 Windows 代码签名仍未完成。

软件验证不等于真实电脑启动、Recovery 或安装验证；当前实机安装验证平台仍为 0。
