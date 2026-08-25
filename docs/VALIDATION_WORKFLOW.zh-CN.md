# EFI Forge 验证流程

## 1. 为什么开发机不需要能安装 macOS

EFI Forge 把“规则正确”“EFI 结构正确”和“目标电脑实际可启动”拆成不同证据。开发机可以负责硬件报告解析、规则测试、组件校验和 `ocvalidate`；只有最后两个等级需要外部支持电脑。

## 2. 硬件报告交换

目标 Windows 电脑运行免安装扫描器后导出 JSON。导出器只保留 schema 中的 CPU、主板、固件、PCI 设备和捕获时间，不保留用户名、磁盘序列号、SMBIOS 序列号、MAC 地址或网络凭据。

导入器执行以下检查：

- `schemaVersion` 必须为 1；
- 设备种类和枚举值必须有效；
- CPU 数字字段必须为非负整数，核心和线程至少为 1；
- PCI Vendor ID / Device ID 必须为空或四位十六进制；
- Subsystem ID 必须为八位十六进制；
- 文件不得超过 1 MB；
- 未在白名单中的 JSON 字段会被删除。

## 3. 固定样本实验室

仓库内首批样本覆盖：

- Comet Lake Z490 可构建路径；
- Coffee Lake Z390 可构建路径；
- NVIDIA Turing/Ampere 与 Samsung PM981 必须阻止的路径。

每个样本都声明预期风险状态，并在测试中经过与桌面应用相同的规则引擎。高风险样本必须保留警告，同时证明用户仍能导出实验清单。

## 4. 候选构建清单

所有结构有效的硬件报告都可以生成清单。没有高风险项时称为“候选清单”；存在信息缺失或可能不兼容硬件时称为“实验清单”。两者都包含硬件键、目标 macOS、基础平台、Kext、SSDT、Drivers、官方组件版本、Release URL、文件大小和 SHA-256。

兼容性警告不会停止导出。只有 EFI 结构无法解析、配置引用的关键文件缺失、组件哈希校验失败或磁盘操作可能破坏用户数据时才能进入硬停止。

同一硬件报告、目标系统和规则版本应得到内容相同的清单。候选清单不是 EFI，也不能证明电脑可启动。

## 5. 四级验证状态

- `candidate`：规则和组件锁检查通过，尚未完成 EFI 静态验证；
- `boot-tested`：目标电脑进入 OpenCore Picker；
- `recovery-tested`：目标电脑进入目标版本 macOS Recovery；
- `install-verified`：完成安装，并记录图形、网络、音频、睡眠和 USB 等验证结果。

只有 `install-verified` 可以作为自动推荐来源。社区整包仍需同时满足许可证、精确硬件匹配和维护者审核策略。

## 6. 下一实现闸门

启用 EFI ZIP 导出前必须完成：

1. 按 `components.lock.json` 下载并校验官方 Release；
2. 从同版本 `Sample.plist` 生成配置；
3. 只复制清单中引用的 Kext、Drivers 和 SSDT；
4. 使用同版本 `ocvalidate` 校验；
5. 输出不含公共 SMBIOS 身份的 ZIP；
6. 将验证结果和工具日志写入构建报告。
