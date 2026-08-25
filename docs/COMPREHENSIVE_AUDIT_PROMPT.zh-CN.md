# EFI Forge 全面审计提示词

你是一名同时熟悉 Windows/Tauri/Rust/TypeScript、OpenCore、Dortania 指南、Acidanthera 组件、AMD Vanilla、Hackintosh 常见硬件和软件供应链安全的高级审计工程师。请对 EFI Forge 进行一次只读、证据驱动的全面审计，不修改源码、不掩盖不确定性，也不能因为 `config.plist` 通过 `ocvalidate` 就宣称 EFI 可以启动或安装 macOS。

项目目标是尽可能给予用户自由选择：信息不足时警告但不阻止；硬件可能不兼容时降低可信度并允许实验继续；EFI 结构损坏、组件完整性失败、执行不可信程序或可能破坏用户数据时必须停止。审计时必须验证实现是否真正遵守这些原则，并严格区分“规则命中”“可生成组件”“完整 EFI 静态有效”“通过同版本 ocvalidate”“进入 OpenCore Picker”“进入 Recovery”“完成安装及图形、网络、音频、睡眠、USB 实测”。没有外部实机证据的配置只能标为候选，不能标为完善或已验证。

请完成以下检查：

1. 盘点源码、测试、组件锁、硬件样本、社区 EFI 注册表、构建器、硬件扫描器、导入导出、EFI 校验、空目标复制、安装包、Git/CI、README、隐私、安全和第三方许可证文档。
2. 建立常见硬件覆盖矩阵，至少包含 Intel Skylake/Kaby Lake/Coffee Lake/Comet Lake 台式机，Intel Coffee/Whiskey/Comet Lake 笔记本，AMD B350/B450/X370/X470/A520/B550/X570 台式机；Intel UHD 630、AMD Polaris/Vega/Navi、现代 NVIDIA；I219/I211/I225/I226、RTL8111/RTL8125；Intel/Broadcom Wi-Fi 与蓝牙；Realtek 音频；SATA/NVMe/PM981/PM991/Micron 2200S/Optane；USB、ACPI、触控板、电池、亮度、睡眠和独显禁用。
3. 对每个平台核对必需 ACPI、Kernel/Booter/UEFI Quirk、SMBIOS、DeviceProperties、Kext 依赖与加载顺序、macOS 版本差异和 BIOS 条件。重点验证 AMD `DummyPowerManagement`、`ProvideCurrentCpuInfo`、四处物理核心数补丁、`AppleMCEReporterDisabler`、`SetupVirtualMap`；Intel AWAC/RTC/PMC/RHUB、CFG-Lock、VT-d、I225 和 framebuffer 策略。
4. 检查识别逻辑是否基于可靠的 Vendor ID、Device ID、Subsystem ID、PCI 路径、机型和 BIOS，而不是仅靠容易误判的名称包含关系；检查扫描失败、空值、权限不足和未知硬件是否被诚实处理。
5. 检查安全边界：构建清单白名单、下载域与重定向、文件大小与 SHA-256、ZIP 路径穿越、缓存竞争、用户选择路径、符号链接/重解析点、源目标包含关系、空目录检查、覆盖与格式化风险、SMBIOS 隐私，以及是否会运行社区或用户 EFI 中未经验证的 `.exe`、脚本、EFI Driver 或 Kext。
6. 重新运行前端测试、TypeScript、生产构建、Rust 测试、联网真实 EFI 构建测试、严格 Clippy、npm audit 和 RustSec audit。环境限制与产品缺陷必须分开；如果因沙箱权限失败，应在安全且获得授权的情况下复跑。
7. 检查生成 EFI 中启用的 ACPI/Kext/Driver 是否都有文件，依赖顺序是否正确，OpenCore/Sample.plist/ocvalidate/macserial 是否同版本，是否生成本机唯一 SMBIOS，以及 `ocvalidate` 没有覆盖的语义启动条件。
8. 检查社区 EFI 策略是否真正实现：许可证、固定 commit、机型/CPU/BIOS/PCI ID/macOS/OpenCore 匹配、二进制替换、身份清除、未知文件隔离、差异报告、撤销和重新验证。规范存在但代码或数据为空时必须判定为“未实现”。
9. 检查开源发布真实性：版本号一致、能力描述与实际联网/写盘行为一致、第三方通知完整、安装包签名、Git 历史、CI、贡献与安全报告渠道。不得把计划中的功能写成已完成。

严重度使用以下定义：

- P0 阻断：可执行不可信代码、可能破坏用户数据、生成已知缺少启动必需项的 EFI、把损坏结构当有效，或严重身份/隐私泄漏。
- P1 高：常见硬件被错误启用/禁用、关键兼容性规则或 macOS 版本策略错误、容易产生不可启动 EFI。
- P2 中：覆盖缺失、扫描精度不足、提示或验证等级可能误导、文档与实现不一致。
- P3 低：工程维护、UI 文案、开发体验和非关键发布完善度问题。

最终报告必须先给出发布结论，再列 P0/P1/P2/P3 发现；每项包含证据位置、影响、可复现方式和通过标准。随后给出常见硬件覆盖矩阵、测试结果、供应链/许可证情况、当前安装包状态和按依赖关系排序的修复路线。必须明确哪些结论来自源码，哪些来自官方资料，哪些只是推断。没有定义分母时不得编造覆盖百分比。只有规则、锁定组件、正确 config、同版本 ocvalidate 和外部实机证据全部存在，才能称为该平台“完善”。
