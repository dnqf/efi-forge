# EFI Forge v0.1.3 Gate 0 修复复核

复核日期：2026-08-25

## 结论

v0.1.2 全面审计中发现的三项 P0 已完成软件层修复，定向测试、全量测试、真实锁定组件下载构建、OpenCore 1.0.7 `ocvalidate`、严格 Clippy、TypeScript 和生产构建均通过。Gate 0 可以在“软件验证”层关闭。

当前仍没有外部真实电脑的启动、Recovery 和完整安装证据，因此 AMD B450、Coffee Lake、Comet Lake 仍只能标记为候选配置，不能标记为“实机安装完善”。

## P0-1 不可信程序执行：已修复

- 自有/社区 EFI 校验只解析目录结构、`config.plist` 和文件引用。
- 即使用户 EFI 包含 `_tools/ocvalidate.exe`，工具也不会执行它。
- 生成链中的 `ocvalidate` 仍只来自新建暂存目录内、经过内置清单大小和 SHA-256 校验的 OpenCore 1.0.7 官方包。
- 回归测试 `never_executes_ocvalidate_from_a_custom_efi` 使用伪造的不可执行占位文件，结构校验仍安全完成并返回明确警告。

## P0-2 AMD DummyPowerManagement：已修复

- AMD 自动生成器强制写入 `Kernel/Emulate/DummyPowerManagement=true`。
- B450 真实下载构建测试解析最终 `config.plist` 并断言该值为 `true`。
- 最终配置通过同版本 OpenCore 1.0.7 `ocvalidate`。

## P0-3 AppleMCEReporterDisabler：已修复

- AMD Zen + MacPro7,1 + 当前支持的 macOS 13/14/15 构建强制加入 `AppleMCEReporterDisabler.kext`。
- 来源为 Dortania 指南指向的 GitHub 附件；锁定版本 1.2、大小 3,091 bytes、SHA-256 `470417c4958dd6ecb982182140a6b76cf85f847c15f1b0f6f59617d5abcc5f76`。
- 该 kext 没有二进制可执行文件，生成器使用空 `ExecutablePath`，并设置 `MinKernel=21.4.0`。
- 后端拒绝缺少该锁定 kext 的 AMD 自动构建清单。
- 上游附件没有声明明确许可证；工具界面如实标记，许可证复核仍属于后续发布阻断项。

## 验证结果

| 检查 | 结果 |
|---|---|
| Rust 常规测试 | 11/11 通过；2 项联网测试默认忽略 |
| 不可信 ocvalidate 回归 | 通过 |
| AMD B450 真实下载与构建 | 通过；哈希、config、kext、ocvalidate 均通过 |
| Coffee/Comet Lake 真实回归 | 通过 |
| Clippy `--all-targets -- -D warnings` | 通过 |
| Vitest | 5 个文件、21/21 通过 |
| TypeScript + Vite production | 通过；44 modules |

## 新安装包

- 版本：0.1.3
- 文件：`src-tauri/target-gate0-release/release/bundle/nsis/EFI Forge_0.1.3_x64-setup.exe`
- 大小：3,441,087 bytes
- SHA-256：`13891D4AD904365105A9A9F3B6058B8B35ADE8BB1BE697FEC5673C544FFFDA45`
- Authenticode：未签名

## 下一门槛

进入 Gate 1 前优先修复显卡识别矩阵、I225/I226 分版本策略、NVMe 风险识别，以及 Coffee Lake AWAC/RTC 与 AMD `SetupVirtualMap` 的 BIOS/ACPI 条件。信息不足仍应警告并允许继续；EFI 结构损坏或可能破坏数据时必须停止。
