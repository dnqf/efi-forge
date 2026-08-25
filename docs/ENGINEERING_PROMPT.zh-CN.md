# EFI Forge 工程实现提示词

你是一名熟悉 Windows 系统编程、Rust、Tauri、React、OpenCore 配置格式、ACPI 和安全磁盘操作的高级工程师。请构建一个名为 EFI Forge 的开源 Windows-first OpenCore 配置与安装介质助手。

## 目标

工具扫描目标电脑的硬件，以 PCI/USB ID、CPUID、主板信息和 ACPI 特征为依据，通过可审计的版本化规则生成兼容性报告和专属 EFI 构建计划。EFI 必须由可信官方上游组件实时组装，不能下载或复用第三方完整 EFI。

## 第一阶段交付

实现 `v0.1.0-alpha.1`：

1. React + TypeScript 界面，可在后续装入 Tauri 2。
2. 明确的 `HardwareReport`、`CompatibilityRule`、`CompatibilityFinding`、`BuildPlan` 类型。
3. 纯函数规则引擎，输入硬件报告和目标 macOS，输出逐设备结论与整机等级。
4. Coffee Lake、Comet Lake、UHD 630、RX 6600、NVIDIA Turing、Intel I219/I225、Samsung PM981 的首批规则。
5. 固定匿名硬件样本与自动化测试。
6. 中文扫描/报告界面，展示证据、规则 ID、风险和候选 EFI 组件。
7. 当前阶段不得调用网络、管理员权限、PowerShell 写盘或物理磁盘 API。
8. 实现社区 EFI Profile 数据模型和精确匹配器；候选来源不得自动执行或下载。

## 架构约束

- 规则引擎与 React 解耦，不访问浏览器或系统 API。
- 未识别的关键 CPU、GPU 或固件状态默认阻止。
- 规则应声明 `id`、`category`、`severity`、匹配条件、系统版本范围、理由、建议和来源。
- 不在源码中保存 SMBIOS、MLB、ROM 或真实机器唯一序列号。
- 不用字符串拼接生成 plist；后续必须从匹配 OpenCore Release 的 Sample.plist 修改。
- 组件下载必须由锁定清单控制，使用固定 Release URL、版本、许可证和 SHA-256。
- 磁盘写入必须在后续独立提权进程中实现，UI 进程不得拥有任意写盘能力。
- 社区整包必须锁定 Git commit、检查许可证、清除 SMBIOS 身份，并用官方组件替换核心二进制。

## 设计方向

界面是一张“固件工作台”，不是营销仪表盘。使用 Windows 本地可用字体：标题 Bahnschrift，正文 Microsoft YaHei UI，数据 Cascadia Mono。色彩使用冷瓷白、石墨黑、PCB 绿、铜色和警示琥珀。左侧表达真实工作流，中间用主板信号路径式结构展示硬件指纹，右侧显示可信度和构建约束。动效仅用于扫描状态和结果切换，并尊重 `prefers-reduced-motion`。

## 完成标准

- `npm test` 通过。
- `npm run build` 通过。
- 阻止规则能够阻止构建计划进入“可生成”状态。
- 每个设备结论都能定位到规则 ID。
- 页面在 1024px 桌面窗口和窄屏下均可使用。
- 键盘焦点可见，颜色不是唯一状态信号。

先完成最小可验证版本，不实现未进入当前里程碑的下载、EFI 二进制拼装、ACPI 编译或写盘功能。
