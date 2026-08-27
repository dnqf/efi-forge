# 第三方组件说明

EFI Forge 安装包不预置 OpenCore、Kext 或 SSDT。用户启动真实构建后，应用会从项目审核的上游地址下载所需组件，并严格校验文件大小与 SHA-256。

`src/data/components.lock.json` 是完整的机器可读清单，记录每个组件的固定版本或提交、上游仓库、发布页、资产 URL、大小、SHA-256、许可证标识和输出文件。当前清单包括 OpenCorePkg、AMD Vanilla 补丁、Dortania SSDT、Lilu/VirtualSMC/WhateverGreen/AppleALC、网络、NVMe 与 USB 组件。

这些组件仍受各自上游许可证约束，其中包含 BSD-3-Clause、GPL-2.0 和 CC-BY-NC-SA-4.0；Dortania 预编译 SSDT 的 CC 许可证含非商业限制。`AppleMCEReporterDisabler` 的上游资产未明确声明许可证，因此不应在未完成单独许可审查时用于商业分发。本文不构成法律意见。

## daliansky/Hackintosh 机型索引

`src/data/dalianskyCatalog.snapshot.json` 由 `https://github.com/daliansky/Hackintosh` 的 README 在固定提交 `56dafde8a93464365f7aa76fe34b575050f2c07e` 生成，只保留用于发现相似机型的事实性机型名称、硬件型号提示、GitHub 仓库/教程入口和来源元数据，不复制上游兼容性说明正文。本项目不复制该索引链接指向的 EFI 文件，也不自动下载、执行或视其为已经验证的配置。

在生成当前快照时，上游仓库根目录未声明许可证，因此许可证状态记录为 `not-declared`，信任状态保持 `discovery-only`，不能作为第三方代码或 EFI 的再分发授权。每个链接指向的仓库拥有各自许可证和安全状态，使用前必须分别审查。本文不构成法律意见。
