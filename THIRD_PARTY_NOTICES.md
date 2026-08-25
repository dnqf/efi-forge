# 第三方组件说明

当前 `v0.1.0-alpha.1` 不随应用分发 OpenCore、Kext、SSDT、Apple Recovery 或其他第三方二进制文件。

仓库已经在 `src/data/components.lock.json` 中记录 OpenCorePkg、Lilu、VirtualSMC、WhateverGreen、AppleALC 和 IntelMausi 的固定版本、官方 Release、资产大小、SHA-256 与许可证。当前应用只读取这些元数据，不下载或分发对应二进制文件。

未来启用组件下载与组装功能时，下载结果必须与该锁定清单逐字节校验；对应许可证文本必须随最终 EFI 构建产物或 Release 提供。
