# EFI Forge 产品需求文档

## 1. 产品定义

EFI Forge 是面向中文装机用户和 OpenCore 维护者的 Windows 桌面工具。它不下载现成的整包 EFI，而是扫描目标电脑，结合可审计规则和锁定版本的可信上游组件，在本地生成这台电脑的 EFI。

产品的“一键”边界是：完成硬件检查、生成并验证 EFI、下载 Apple Recovery、制作可启动安装介质。macOS 目标磁盘的抹除与系统安装仍在 Recovery 中由用户确认完成。

## 2. 用户目标

1. 在安装前知道当前电脑是否值得尝试。
2. 看懂不兼容的硬件和原因。
3. 得到组件来源、版本和规则均可追踪的 EFI。
4. 不因误选磁盘而破坏 Windows 或数据盘。
5. 首次启动失败后能带着脱敏日志回到工具修正。

## 3. v0.1 范围

### 支持

- Windows 10/11 x64
- Intel 第 8、9、10 代 DIY 台式机
- Coffee Lake / Comet Lake 平台
- Intel UHD 630 和首批明确支持的 AMD GPU
- Ventura 13、Sonoma 14、Sequoia 15 的规则表达
- 硬件报告、兼容性规则、构建预览和诊断导出
- 经过审核的社区 EFI 整包作为精确机型覆盖层

### 不支持

- 笔记本、AMD CPU、Legacy BIOS
- 未经确认的整包 EFI 下载
- 自动修改 BIOS
- 自动登录 Apple 服务
- 自动抹除 macOS 目标硬盘
- 在 v0.1 中执行真实 U 盘写入

## 4. 核心原则

- 生成而不是复制：EFI 由基础平台、设备规则、ACPI 结果和目标系统版本组合产生。
- 社区整包先净化再合并：保留机型特有配置，替换核心二进制并清除机器身份。
- 未知即警告：关键设备无法识别时不得宣称兼容，但允许用户以实验模式继续。
- 自由选择：兼容性规则提供证据和可信度，不代替用户作出最终决定。
- 硬停止最小化：只有 EFI 结构损坏、组件校验失败或可能破坏用户数据时停止。
- 证据可追踪：每个结论包含规则 ID、理由、建议和资料来源。
- 版本必须一致：OpenCore、Sample.plist 与 ocvalidate 使用同一版本。
- 最小权限：普通界面不提权，未来仅独立写盘进程申请管理员权限。
- 隐私优先：默认不收集用户名、磁盘序列号、SMBIOS 身份或网络凭据。

## 5. 用户流程

```text
接受风险说明
  → 扫描硬件
  → 查看兼容性报告
  → 选择目标 macOS
  → 查看 EFI 构建计划
  → 下载并校验上游组件
  → 生成 config.plist / SSDT / Kext 清单
  → ocvalidate 验证
  → 选择可移动 U 盘
  → 下载 Recovery
  → 安全写盘与复验
  → 查看 BIOS 和安装说明
```

## 6. 硬件报告

硬件报告至少包含：

- CPU：厂商、型号、Family、Model、Stepping、核心、线程、指令集
- 主板：厂商、型号、Revision、BIOS 版本
- 固件：UEFI、Secure Boot、CFG Lock 可检测状态
- GPU：PCI ID、Subsystem ID、类型和拓扑
- 网络：以太网、Wi-Fi、蓝牙的 PCI/USB ID
- 音频：控制器和 Codec ID
- 存储：控制器、协议、型号和已知风险
- USB：控制器信息；端口映射作为安装后流程
- ACPI：后续采集 DSDT/SSDT 特征和哈希

导出前移除唯一序列号和用户目录。

## 7. 兼容性结果

每个设备返回：

- `supported`：明确支持
- `partial`：可以继续但存在功能限制
- `blocked`：高风险或已知不兼容；不作为工具推荐，但允许实验构建
- `unknown`：缺少可靠规则，关键设备按阻止处理

整机结果采用最严格结论，并额外计算规则覆盖率。可信度分为：

- A：完全相同的主板、BIOS、硬件和系统版本有完整成功记录
- B：关键设备全部识别，规则与静态验证全部通过
- C：存在实验规则或非关键未知设备
- D：存在冲突、阻止项或关键未知设备

## 8. EFI 来源

- OpenCore 核心、Drivers、Sample.plist、ocvalidate、macserial：Acidanthera/OpenCorePkg Release
- Kext：各项目官方 Release
- 图形资源：Acidanthera/OcBinaryData
- SSDT：Dortania 审核模板或本机 ACPI 分析后生成
- config.plist：基于匹配版本 Sample.plist 在本机生成
- SMBIOS：通过匹配版本 macserial 在本机生成
- Recovery：通过 macrecovery 从 Apple 恢复服务下载
- 社区整包：只接入有许可证、锁定 commit 且通过审核的 GitHub 来源

所有下载项必须出现在 `components.lock.json` 中并校验 SHA-256。

社区整包采用精确、近似、不匹配三级判定。只有精确匹配且状态为 `verified` 的记录可以自动应用；详细流程见 `COMMUNITY_EFI_POLICY.zh-CN.md`。

## 9. v0.1 验收标准

1. 应用可以在 Windows 浏览器开发环境和 Tauri 原生桌面环境运行并生产构建。
2. 固定硬件报告和本机只读扫描报告可以经过规则引擎得到稳定、可测试的结论。
3. UI 显示整机结论、覆盖率、设备结果、规则 ID 和构建计划。
4. 被阻止的硬件无法进入 EFI 构建动作。
5. 不执行网络下载、管理员提权或磁盘写入。
6. TypeScript 类型检查、规则测试、Rust 扫描器测试和原生生产构建全部通过。

## 10. 后续里程碑

- v0.2：Windows 原生硬件扫描与脱敏诊断包
- v0.3：锁定组件下载、缓存、SHA-256 校验
- v0.4：Sample.plist 驱动的 EFI 生成与 ocvalidate
- v0.5：ACPI 导出、分析和 SSDT 构建
- v0.6：Recovery 下载
- v0.7：隔离的安全写盘进程和虚拟磁盘测试
- v1.0：首批 A 级认证机器与稳定发布
