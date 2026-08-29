# EFI Forge v0.1.2 全面审计报告

审计日期：2026-08-25  
审计方式：按 `COMPREHENSIVE_AUDIT_PROMPT.zh-CN.md` 执行只读检查；除新增审计文档外未修改产品源码、规则或安装包。

> 修复状态更新：本报告记录的是 v0.1.2 审计快照。三项 P0 已在 v0.1.3 完成软件层修复与回归验证，原始发现保留用于追溯；复核证据见 `GATE0_REMEDIATION_REPORT.zh-CN.md`。这不等同于外部实机启动、Recovery 或完整安装验证。

## 发布结论

当前版本适合作为内部开发验证版，不适合作为“常见电脑一键安装黑苹果”的公开稳定版，也不建议继续分发当前安装包给不具备风险判断能力的普通用户。

软件工程基础总体可靠：测试、类型检查、生产构建、组件哈希、ZIP 路径保护、空目标复制和 `ocvalidate` 链路均正常。但审计发现 3 项 P0：用户自有 EFI 可以触发不可信 `ocvalidate.exe`、AMD 自动配置没有启用必需的 `DummyPowerManagement`、AMD `MacPro7,1` 方案没有加入 macOS 12.3+ 所需的 `AppleMCEReporterDisabler`。因此“通过 ocvalidate”的 AMD EFI 仍可能无法启动，而社区 EFI 校验存在本机代码执行风险。

当前可称为“软件验证候选”的平台路径为 3 条；可称为“实机安装完善”的平台为 0 条。

## P0 阻断问题

### P0-1 自有/社区 EFI 可执行不可信程序

- 证据类型：源码。
- 位置：`src-tauri/src/builder.rs:1191-1194`。
- 现状：`validate_efi_root` 在用户选择的 EFI 根目录发现 `_tools/ocvalidate.exe` 后直接调用 `run_ocvalidate`；后者通过 `Command::new` 执行该文件。
- 影响：恶意 GitHub EFI 整包可以携带伪造的 `_tools/ocvalidate.exe`，用户一点击“校验”就可能执行任意 Windows 代码。这违反“未知可执行文件必须隔离”和“可能破坏数据必须停止”的产品原则。
- 可复现方式：构造包含基本 EFI 目录和自定义 `_tools/ocvalidate.exe` 的测试目录，选择“使用我自己的完整 EFI”。审计未实际执行恶意样本，以免造成外部副作用。
- 通过标准：用户目录中的 `.exe`、脚本、EFI Driver、Kext 均不得作为 Windows 程序运行；校验只能调用 EFI Forge 从内置锁文件下载并通过大小和 SHA-256 验证的官方 `ocvalidate`。新增恶意占位程序测试，证明其不会被执行。

### P0-2 AMD 自动配置缺少 `DummyPowerManagement=true`

- 证据类型：源码 + 官方资料。
- 位置：`src-tauri/src/builder.rs:445-619`；OpenCore 1.0.7 `Sample.plist` 中该值为 `false`。
- 现状：AMD 生成器写入 AMD Vanilla 补丁和部分 Quirk，但没有设置 `Kernel/Emulate/DummyPowerManagement`。
- 官方依据：Dortania AMD Ryzen 指南将 `DummyPowerManagement=YES` 标为所有 AMD CPU 的必需项：<https://dortania.github.io/OpenCore-Install-Guide/AMD/zen.html#emulate>。
- 影响：生成的 B450 EFI 可以通过 `ocvalidate`，但可能无法启动 macOS；软件却返回 `readyForInstall=true`。
- 可复现方式：生成 AMD B450 候选 EFI，读取 `EFI/OC/config.plist` 的上述键。目前真实构建测试只断言核心数补丁和 `ocvalidate`，未断言该键。
- 通过标准：AMD config 强制写入 `true`；真实构建测试解析最终 plist 并断言；缺失或为 `false` 时构建必须停止。

### P0-3 AMD `MacPro7,1` 缺少 `AppleMCEReporterDisabler`

- 证据类型：源码 + 官方资料。
- 位置：`src/engine/createBuildPlan.ts:130-136` 固定 AMD SMBIOS 为 `MacPro7,1`；`src/data/components.lock.json` 没有该 Kext。
- 官方依据：Dortania Kext 指南要求 macOS 12.3+ 的 AMD 系统在 MacPro6,1、MacPro7,1、iMacPro1,1 下使用 `AppleMCEReporterDisabler`：<https://dortania.github.io/OpenCore-Install-Guide/ktext.html#extras>。
- 影响：当前目标 macOS 13/14/15 全部在受影响范围内，可能发生启动内核崩溃。
- 可复现方式：检查 AMD 构建清单和最终 `Kernel/Add`，不存在该 Kext。
- 通过标准：锁定可信上游版本、哈希、许可证和文件大小；AMD 13/14/15 清单自动包含该 Kext，并通过依赖/文件引用测试。

## P1 高优先级问题

### P1-1 常见 AMD 显卡被误判，可能被错误禁用

- 证据类型：源码 + 官方资料。
- 位置：`src/data/rules.ts:67-75` 只覆盖 RX 6600；`src/engine/createBuildPlan.ts:96-111` 会对未命中规则的独显应用 `-wegnoegpu`。
- 影响：受支持的 RX 570、标准 RX 580、RX 590、Vega、部分 RX 5000/6000 会成为“未知显卡”；与 UHD 630 共存时甚至可能被禁用。
- 官方依据：<https://dortania.github.io/GPU-Buyers-Guide/modern-gpus/amd-gpu.html>。标准 RX 580 `67DF` 支持，但 RX 580 2048SP `6FDF` 不支持，说明必须以 Device ID 为主而不能只匹配名称。
- 通过标准：建立按 Device ID、Subsystem ID、macOS 版本和是否需要 spoof/boot-arg 划分的 GPU 矩阵；新增“标准 RX 580 保留”和“2048SP 警告”测试。

### P1-2 I225 在 macOS 13+ 的驱动策略没有闭环

- 证据类型：源码 + 官方资料。
- 位置：`src/engine/createBuildPlan.ts:42-46`；`src-tauri/src/builder.rs:770-772`。
- 现状：I225 被统一标为支持；Gigabyte 添加 `e1000=0`，同时 Intel config 固定 `DisableIoMapper=true`，但没有完整处理 macOS 13+ DEXT、VT-d、旧 AppleIntelI210Ethernet 或 AppleIGC 路径。
- 官方依据：<https://dortania.github.io/OpenCore-Install-Guide/ktext.html#ethernet>。
- 影响：界面可能显示支持，但安装后没有有线网络，Recovery 联网也可能失败。
- 通过标准：按 macOS 版本、I225/I226 Device ID、主板厂商、VT-d/DMAR 能力选择明确路径；无法决定时显示警告，不标记为已支持。

### P1-3 Coffee Lake 对 AWAC 的自动选择过宽

- 证据类型：源码 + 官方资料。
- 位置：`src/engine/createBuildPlan.ts:71-74`。
- 现状：B360/B365/H310/H370/Z390 全部加入 `SSDT-AWAC`。
- 官方依据：Dortania 说明多数上述主板需要 AWAC，但部分系统需要 `SSDT-RTC0`：<https://dortania.github.io/OpenCore-Install-Guide/config.plist/coffee-lake.html#acpi>。
- 影响：少数主板可能早期启动失败。
- 通过标准：读取/导入 ACPI 特征判断 AWAC、RTC、STAS；无法判断时让用户选择或降为实验候选，不自动宣称完整。

### P1-4 AMD `SetupVirtualMap` 未结合 BIOS

- 证据类型：源码 + 官方资料。
- 位置：`src-tauri/src/builder.rs:566-568` 固定为 `true`。
- 官方依据：AMD 指南指出 X570/B550/A520/TRx40 以及部分 2020 年后 BIOS 的 X470/B450 需要关闭：<https://dortania.github.io/OpenCore-Install-Guide/AMD/zen.html#booter>。
- 影响：某些 B450 BIOS 组合可能在早期内存映射阶段失败。
- 通过标准：平台/BIOS规则或启动反馈能够覆盖 true/false 两条路径；没有证据时不得标为实机验证。

### P1-5 高风险 NVMe 可能漏检

- 证据类型：源码 + 推断。
- 位置：`src-tauri/src/hardware.rs:117-121` 使用 `Win32_DiskDrive`；`src/data/rules.ts:130-137` 同时要求 Vendor ID `144D` 和名称 PM981。
- 影响：Windows 磁盘 PNP 字符串不保证提供 PCI Vendor ID，PM981 可能以空 Vendor ID 进入报告，从而跳过阻止规则。PM991、Micron 2200S、Optane 没有规则。
- 通过标准：通过 `Get-PnpDeviceProperty`、PCI 父设备或受控型号表获得稳定标识；用真实脱敏报告覆盖上述设备；已知可能导致崩溃或数据风险的目标盘必须进入停止/强风险确认流程。

### P1-6 第三方许可证输出不完整

- 证据类型：源码/文档 + 许可证元数据。
- 现状：锁文件含 13 个组件，包括 GPL-2.0 与 CC-BY-NC-SA-4.0；`THIRD_PARTY_NOTICES.md` 仍只描述早期 6 项，生成 EFI 不附带完整许可证和来源清单。
- 影响：GitHub Release 和用户生成物的再分发条件不清晰，CC 非商业条款还会限制某些使用方式。
- 通过标准：逐项审查分发方式和许可证义务；安装包、仓库和生成物包含准确通知；商业/非商业边界清楚。此项需要维护者进行正式法律/许可证复核，本报告不构成法律意见。

## P2 中优先级问题

1. 扫描 PowerShell 使用 `SilentlyContinue`，CIM 权限不足时可能生成空报告；沙箱内复现 CPU 名为空，沙箱外测试正常。通过标准是关键 CIM 为空时明确报错并提示权限/服务状态。
2. 界面覆盖率只是“本报告的设备命中规则数/设备数”，不是市场覆盖率。主板规则为 0，因此它不能用于决定是否进入下一步。
3. 用户 EFI 没有同版本 `ocvalidate` 时，只有顶层键和文件引用检查也会得到 `valid=true`。允许继续符合用户自由原则，但状态必须叫“结构检查通过”，不能叫完整验证。
4. 社区 EFI 注册表为 0；匹配算法和政策测试存在，但真实来源下载、许可证检查、身份清除、二进制替换、隔离和撤销流水线未实现。
5. Intel 笔记本、Wi-Fi/蓝牙、RTL8111、I211/I226、USB Map、电池、触控板、亮度、睡眠均无自动闭环。
6. “复制与测试”步骤只复制 EFI 到用户事先准备的空目录，不创建分区、不格式化、不下载 Recovery，也不创建完整 macOS 安装盘。因此产品暂时不是完整的一键安装器。
7. 当前只支持 macOS 13/14/15；没有 Tahoe 26 规则与验证。

## P3 工程与发布问题

1. 当前目录没有 `.git`，无法证明提交历史、回滚和可重复发布。
2. 没有 GitHub Actions 或其他 CI。
3. `Cargo.toml` 的 repository 为空。
4. README、PRIVACY、SECURITY、THIRD_PARTY_NOTICES 仍描述 v0.1.0，声称不会联网、下载或组装，与 v0.1.2 实现不一致。
5. Windows 安装包未进行 Authenticode 签名。
6. 缺少公开支持版本表、正式安全联系方式、贡献指南和社区样本审核记录。

## 常见硬件覆盖矩阵

| 类别 | 当前自动能力 | 审计等级 |
|---|---|---|
| Intel Skylake/Kaby Lake 台式机 | 无 | 未实现 |
| Coffee Lake B360/B365/H310/H370/Z390 | 生成并通过 ocvalidate | 软件候选；AWAC/RTC 与实机验证缺失 |
| Coffee Lake Z370 | 组件导出，不自动 config | 实验/自有 EFI |
| Comet Lake B460/Z490 | 生成并通过 ocvalidate | 软件候选；I225 与实机验证缺失 |
| Comet H410/H470 | 组件导出 | 实验/自有 EFI |
| AMD B450 | 生成并通过 ocvalidate | P0 未通过，不可标 ready |
| AMD B350/X370/X470/A520/B550/X570 | 无自动 config | 未实现 |
| Intel Coffee/Whiskey/Comet 笔记本 | 无 | 未实现 |
| Intel UHD 630 | 有基础 framebuffer | 部分覆盖，接口/显存/主板差异未实测 |
| AMD Polaris/Vega/Navi | 仅 RX 6600 | 大量缺失且可能误禁用 |
| NVIDIA RTX/GTX16 | 警告无图形加速 | 风险判断基本正确，允许实验继续 |
| I219 | IntelMausi | 软件候选 |
| I225 | 原生/e1000 简化逻辑 | 未闭环 |
| RTL8125 | LucyRTL8125Ethernet | 软件候选 |
| RTL8111、I211、I226 | 无 | 未实现 |
| Intel/Broadcom Wi-Fi、蓝牙 | 无 | 未实现 |
| Realtek 音频 | AppleALC，无 layout-id | 部分覆盖 |
| NVMe/SATA | 970 EVO Plus、PM981 两条规则 | 明显不足 |
| USB | 固定关闭 XhciPortLimit，提示手工 Map | 安全但不完整 |
| 笔记本电池/输入/亮度/睡眠 | 无 | 未实现 |

## 测试与构建结果

| 检查 | 结果 |
|---|---|
| Vitest | 5 个文件、21/21 通过 |
| TypeScript app/node | 通过 |
| Vite 临时生产构建 | 通过；44 modules，JS 241.66 kB |
| Rust 常规测试 | 10/10 通过，2 项联网测试默认忽略 |
| Rust 联网真实构建 | 2/2 通过：B450、Coffee、Comet；完成下载、哈希、config、ocvalidate |
| Clippy `-D warnings` | 通过 |
| npm audit | 168 依赖，0 已知漏洞 |
| RustSec audit | 535 锁定依赖，0 已知漏洞 |
| RustSec 信息警告 | 16 个 unmaintained、1 个 glib unsound；glib 不在 Windows 目标依赖树中 |

测试绿灯只证明当前断言覆盖的行为正确。`ocvalidate` 不判断显卡是否加速、AMD 必需语义 Quirk、ACPI 是否匹配具体 BIOS、网络是否工作、能否进入 Recovery 或完成安装。

## 供应链与写入安全

已确认的优点：

- manifest 组件必须与内置锁完全一致；未知组件停止。
- 组件下载限制文件大小并校验 SHA-256。
- ZIP 使用 `enclosed_name` 防止路径穿越。
- 官方 `macserial` 和生成链中的 `ocvalidate` 来自哈希锁定 OpenCore 包。
- 构建输出使用新目录，不覆盖同名目录。
- EFI 复制要求目标为空，拒绝源/目标互相包含，拒绝符号链接。
- 工具不格式化磁盘、不删除目标已有数据。

尚未通过的部分：

- 自有 EFI 的不可信 `ocvalidate.exe` 执行问题。
- Windows 重解析点/junction 需要增加专门测试。
- 社区整包的未知二进制隔离尚未实现。
- 生成物许可证通知不完整。

## 当前安装包

- 文件：`EFI Forge_0.1.2_x64-setup.exe`
- 大小：3,440,253 bytes
- ProductVersion：0.1.2
- SHA-256：`FEF92A18C477AEA692925795257527C5511E22F1F392B4603FEB017D0D19DCFC`
- Authenticode：NotSigned
- 结论：哈希与既有发布物一致，但在 P0 修复并重新构建前不应作为稳定版继续分发。

## 修复路线和放行门槛

### Gate 0：安全与 AMD 启动正确性

1. 禁止执行用户 EFI 中任何程序。
2. 修复 AMD DummyPowerManagement。
3. 加入 AppleMCEReporterDisabler。
4. 为三项加入失败优先测试。

通过后才能重新生成安装包。

### Gate 1：常见台式机正确性

1. 完成 AMD GPU Device ID 矩阵。
2. 完成 I225/I226 分版本策略。
3. 改进 NVMe 风险识别。
4. AWAC/RTC 和 AMD SetupVirtualMap 引入 ACPI/BIOS证据或明确用户选择。

### Gate 2：安装闭环

1. USBToolBox 报告导入和 Map 校验。
2. RTL8111、I211、Wi-Fi、蓝牙、NVMeFix。
3. 区分“结构通过”“ocvalidate 通过”“启动通过”“Recovery 通过”“安装验证”。

### Gate 3：笔记本与社区来源

1. 先支持有限的精确机型注册表，不做泛型笔记本万能模板。
2. 实现固定 commit、许可证、身份清除、二进制替换、隔离、差异和撤销。
3. 至少使用两台不同厂商的外部支持机完成验证。

### Gate 4：GitHub 发布

1. 初始化 Git，建立 CI 和可重复构建。
2. 更新 README、隐私、安全、第三方通知。
3. 完成许可证审查和安装包签名策略。
4. 只有 `install-verified` 的精确硬件组合才可显示为工具推荐；其余均保留用户选择但清楚标注候选或实验。
