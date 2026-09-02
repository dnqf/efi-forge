# EFI Forge v0.1.13 · Hardware Evidence 2.0 全局实施提示词

你是 EFI Forge 的主工程代理。请结合项目既有安全契约、用户对自由选择的要求和当前 v0.1.12 代码基线，完成 v0.1.13 Hardware Evidence 2.0。工作必须一次闭环完成：先建立失败测试，再实施、复核、修补、打包，并在满足发布门后交付 GitHub Alpha 预发布；不得以规则数量、社区链接或静态校验冒充实机兼容。

## 一、产品边界

- EFI Forge 是 Windows-first 的 OpenCore 硬件扫描、兼容性分析、候选组装和安全融合工作台，不是万能 EFI 下载器。
- 信息不足、未覆盖设备、硬件可能不兼容和缺少社区候选只产生警告、降低可信度并允许继续。
- EFI 结构损坏、固定组件完整性失败、路径逃逸、非空目标或可能破坏用户数据必须停止。
- 社区发现记录不得参与 `BuildPlan`、自动下载、自动融合、`recommended` 或 `canContinue`。
- 不执行用户或社区 EFI 中的二进制、脚本和工具；不自动分区、格式化或覆盖现有 EFI。
- SMBIOS 身份只由最终用户在本机生成，报告不得包含序列号、UUID、原始 PNP 路径或可关联设备实例。

## 二、九个改进目标

### 1. 硬件扫描与报告 schema v2

在保持 schema v1 可导入的前提下新增 v2 证据：PCI Revision ID、Subsystem Vendor/Device ID、父 PCI 身份与 Class Code、芯片组/桥、存储控制器、USB xHCI、Thunderbolt/USB4、独立蓝牙、输入控制器，以及电池、I2C、PS/2、Intel SST、VMD/RST/RAID/AHCI 等布尔或枚举线索。原生扫描只执行固定只读 PowerShell/CIM 查询，不保留原始实例路径。

### 2. 按整机类别分路由

显式区分 DIY 台式机、Dell/HP/Lenovo 等 OEM 台式机、ThinkPad、其他笔记本、NUC/迷你机、HEDT/工作站、AMD 笔记本和旧平台。类别只决定说明、证据缺口和候选路径，不可单凭营销名生成自动配置。

### 3. 图形矩阵与输出关系

继续以 PCI Vendor/Device/Subsystem 证据区分 Intel、AMD Polaris/Vega/Navi、RX 550 Lexa、NVIDIA 世代与混合显卡。NootedRed/NootRX 保持手动研究路径。扫描无法证明显示输出接线时必须明确提示；禁用独显与保留全部显卡始终由用户选择。

### 4. 无线与蓝牙拆分

无线网卡与蓝牙控制器分别展示、分别判断。Intel 无线必须提示按芯片和 macOS 大版本选择，`itlwm` 与 `AirportItlwm` 不得同时启用；Intel Bluetooth、Broadcom、Qualcomm/Atheros 与有线网卡各自保留证据和手动路径。证据不足不得自动添加无线组件。

### 5. 音频证据

Codec 身份、模拟音频、HDMI/DP 音频和 Intel SST 风险分开说明。AppleALC 与 `layout-id` 分离：只把 codec 视为候选，layout-id 进入可审计候选账本并要求耳机、内置扬声器和麦克风逐项实测。

### 6. 存储控制器与安装目标

同时记录磁盘型号和控制器身份，识别 NVMe、AHCI、VMD/RST/RAID 线索。风险必须绑定具体设备；用户尚未选择安装目标时不能把任一磁盘当成目标。NVMeFix 只能改善部分电源管理，不得被描述为修复所有 NVMe。

### 7. 笔记本模块化证据

将图形/显示、dGPU 输出、键盘、PS/2 或 I2C 触控板、电池、背光、音频/麦克风、无线、蓝牙、USB、睡眠、Thunderbolt/USB-C、摄像头、指纹和读卡器拆成独立模块。Windows 线索只允许把“未知”提升为“需校准”，不能提升为“已支持”。

### 8. 审核配置库准入

审核配置必须记录厂商、完整型号、Machine Type/SKU、CPU、芯片组、GPU/网络/音频/存储 PCI 身份、BIOS 范围、目标 macOS、OpenCore 版本、40 位 revision、许可证、config 摘要和验证阶段。许可证缺失、移动分支、身份未清理、未知可执行文件未拒绝或官方二进制未替换的记录不得成为 verified。默认注册表可以为空，禁止虚构条目。

### 9. 实施、验证与发布顺序

依次完成 schema v2、控制器/存储、GPU、无线/蓝牙、音频、笔记本模块、OEM/迷你机路由、配置准入和界面证据账本。自动白名单只有在配置来源、版本、许可证、精确硬件和真实验证齐全时才可扩大。

## 三、可观察验收标准

1. schema v1 报告继续可导入；v2 新字段严格白名单化，未知字段和原始 PNP 路径不会导出。
2. v2 报告能够稳定表达芯片组、控制器、蓝牙和笔记本线索，异常数组、非法 PCI ID、重复 ID 和资源耗尽输入被拒绝。
3. NVMe 控制器 class code 即使磁盘名称不含 NVMe，也能触发 NVMe 组件候选；VMD/RST/RAID 只警告并允许继续。
4. 无线与蓝牙在模块矩阵中分开；笔记本的输入、电池、Thunderbolt 等有证据时为“需校准”，无证据时保持“未覆盖”。
5. EFI 自动配置范围不因新增弱线索扩大；OEM、迷你机、AMD 笔记本和旧平台保留手动路径。
6. 审核配置验证器拒绝未声明许可证、非 40 位提交、不完整硬件身份和越级验证记录。
7. 兼容判断页显示 Hardware Evidence 2.0 账本：报告版本、存储模式、控制器数量、无线/蓝牙拆分和关键缺口，并明确“不阻止继续”。
8. 前端测试、目录测试、TypeScript、生产构建、Rust 格式、Clippy、Rust 测试、Windows 真实只读扫描与脱敏复核、NSIS 打包全部通过；失败必须修补后重跑。
9. 版本同步为 v0.1.13 Alpha。发布说明必须注明安装包签名状态、社区来源仍为 discovery-only、没有目标硬件实机验证时仍仅是候选。

## 四、三轮复验

- 第一轮：数据契约与单元测试。验证 v1/v2、隐私、规则、模块、构建计划和审核准入。
- 第二轮：工程与原生层。运行 TypeScript、Vite、Rust fmt/clippy/test、真实 Windows 扫描，并人工确认不含序列号、UUID、原始 PNP 路径。
- 第三轮：发布候选。干净环境构建 NSIS，计算 SHA-256，检查 Authenticode、Defender、安装/启动/卸载，再核对 Git diff、CI、标签、Release 资产与官方下载。

## 五、交付措辞

最终只陈述实际完成的能力与测试。`ocvalidate` 通过不等于可启动；Windows 扫描通过不等于 macOS 兼容；社区命中不等于适配；没有精确机型的 Picker、Recovery、安装和安装后证据时，v0.1.13 必须保持 Alpha/prerelease。
