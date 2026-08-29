# EFI Forge v0.1.10 Alpha

v0.1.10 继续完善 EFI Forge 的硬件分析、候选 EFI 组装、安全融合和复制测试链路。本版本仍属于 Alpha：规则命中、社区线索和 `ocvalidate` 通过都不能证明目标电脑能够启动或稳定运行 macOS。

## 主要变化

- 重构四阶段用户流程：取得硬件报告、看懂兼容风险、组装与校验 EFI、复制并启动测试。
- 将演示和固定测试样本与真实硬件报告隔离，测试样本不能进入正式构建或导出链路。
- 增加兼容风险摘要和按优先级排列的处理建议。
- 将单独 Kext、AML、UEFI Driver 导入与双 EFI 融合收纳为高级选项。
- 增加 DSDT 静态时钟证据分析，记录 ACPI000E、PNP0B00、STAS 与文件 SHA-256；只提供字节线索，不替代 ACPI 反编译或真机验证。
- 加强 EFI 目录、符号链接、Windows 重解析点、危险脚本、目录规模、缓存竞争和非空目标保护。
- 完善浅蓝色界面、键盘导航、窄屏布局和操作指引。

## 数据来源与信任边界

- `daliansky/Hackintosh` 快照仍只属于社区候选发现层：1,384 条机型线索，来源固定在提交 `56dafde8a93464365f7aa76fe34b575050f2c07e`，上游许可证状态为 `not-declared`。
- 社区候选不会自动下载、合并、启用，也不会改变 `CompatibilityReport.canContinue`、推荐状态或 `BuildPlan`。
- 锁定的 OpenCore、Kext 和审核 ACPI 组件继续按版本、大小与 SHA-256 校验。

## 发布验证

- 前端测试：101 项通过。
- 社区目录导入测试：2 项通过。
- TypeScript、Vite 生产构建、Rust 格式和严格 Clippy 通过。
- Rust 本地测试：35 项通过；4 项真实固定组件下载/构建测试通过；当前 Windows WMI/CIM 只读扫描测试通过。
- Windows x64 NSIS：安装、首次启动和卸载冒烟测试通过。
- Microsoft Defender 自定义扫描：扫描时未发现匹配威胁；这不是绝对安全保证。

## 安装包

- 文件：`EFI-Forge_0.1.10_x64-setup.exe`
- SHA-256：`8D0FA9D12586183AFEB99738CF5CE4E5DEE19308E2AF6D13B3FE0F2CC5CF9BE7`
- Authenticode：未签名。Windows 可能显示“未知发布者”。

## 已知限制

- 不包含 macOS 镜像，不创建完整 macOS 安装盘，不格式化或分区。
- 只允许向用户选择的空目录复制，不覆盖现有 EFI。
- 当前自动配置只覆盖经过审核的部分 Intel/AMD 台式机路径；其他组合保留手动选择和实验路径。
- ACPI、USB、显卡、无线、睡眠和系统更新仍需对应硬件进行启动后验证。
