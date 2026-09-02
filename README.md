# EFI Forge（暂定名）

EFI Forge 是一个 Windows-first 的 OpenCore 配置、校验与安全复制工作台。它通过硬件扫描、可追溯的兼容性规则和固定版本的可信上游组件，为目标电脑生成候选 EFI 构建计划。

当前公开测试版为 `v0.1.12 Alpha`：已经具备 Windows 原生桌面壳、本机只读硬件扫描、ThinkPad 专项路由、社区机型线索索引、模块化兼容性判断、锁定组件下载、候选 EFI 组装、自有 EFI 校验、安全融合副本、受控组件配置、ACPI 时钟静态证据、真机验证证据、转移/求助摘要和向空目录复制。工具不会格式化磁盘，也不会覆盖非空目录。

`v0.1.12` 是预发布测试版，不代表任意硬件可以安装成功；下载、哈希和已知边界以 Release 页为准。

`main` 分支正在准备 `v0.1.13 Alpha`：新增 Hardware Evidence 2.0 报告与控制器证据账本，但不会因此扩大未审核自动 EFI 范围。公开安装包在发布验收完成前仍以 v0.1.12 为准。

项目主页：[github.com/dnqf/efi-forge](https://github.com/dnqf/efi-forge)

## 下载

- 版本说明：[EFI Forge v0.1.12 Alpha](https://github.com/dnqf/efi-forge/releases/tag/v0.1.12)
- Windows x64：[直接下载安装包](https://github.com/dnqf/efi-forge/releases/download/v0.1.12/EFI.Forge_0.1.12_x64-setup.exe)
- 校验文件：[SHA256SUMS.txt](https://github.com/dnqf/efi-forge/releases/download/v0.1.12/SHA256SUMS.txt)
- 历史版本：[v0.1.10](https://github.com/dnqf/efi-forge/releases/tag/v0.1.10)、[v0.1.9](https://github.com/dnqf/efi-forge/releases/tag/v0.1.9)、[v0.1.5](https://github.com/dnqf/efi-forge/releases/tag/v0.1.5)

不要使用来源不明的 GitHub 加速站。安装后仍应核对安装程序哈希；当前 Alpha 尚未数字签名，Windows 可能显示未知发布者。

- EXE SHA-256：`C1F64E886B376A1DC1F9298D0ED06DA2703300C1E85FE5BAB73ED3A1F46F386A`

## 当前能力

- 通过 Windows CIM/注册表只读扫描 CPU、主板、固件、GPU、网络、音频和存储
- 在 Tauri 桌面应用中展示本机脱敏硬件报告
- 导入和导出经过白名单清洗的硬件报告，以便在其他电脑上采集、在开发机上分析
- 逐项评估 CPU、GPU、主板、网络和存储兼容性
- 对 ThinkPad 读取四位 Machine Type，按型号/CPU 代际/显卡/无线/存储/BIOS 建立专项候选路径
- 覆盖 Ivy Bridge 到 Comet Lake 常见 ThinkPad 系列的分层目录；未收录型号进入研究路径但不会被阻止
- 从 `daliansky/Hackintosh` 的固定提交生成仅含事实性机型名称、硬件型号提示、仓库和教程入口的本地线索快照，按整机类型、厂商和完整型号提供第三方研究入口
- 机型线索与受审计社区整包严格分层：索引命中不提高构建可信度、不自动下载 EFI，也不写入构建计划
- 区分已支持、部分支持、阻止和未知结果
- 输出带规则 ID、证据和建议动作的构建计划
- 使用可构建与必须阻止的固定硬件样本验证规则引擎
- 锁定 OpenCore、常见 Kext 与审核 ACPI 的版本、资产大小和 SHA-256
- 导出确定性的候选 EFI 构建清单，并显示静态验证与实机验证闸门
- 为已审核的 AMD B450、Intel Coffee Lake / Comet Lake 台式机组合生成 config.plist 并运行同版本 `ocvalidate`
- 可只读校验用户选择的 `DSDT.aml`，记录 ACPI000E/PNP0B00/STAS 静态线索与 SHA-256，并由用户显式决定 AWAC 或手动 RTC0 路径；该能力只提供静态字节线索，不等于 ACPI 语义或实机验证
- 支持安全导入用户自己的 codeless `UTBMap.kext`，拒绝可执行内容、符号链接和 Windows 重解析点
- 支持自有或社区完整 EFI 的只读结构检查；不会执行其中携带的程序
- 支持只读导入单独的 Kext、AML 和 x86_64 UEFI Driver，核验内部格式、逻辑身份、体积与 SHA-256 后再与项目候选逐项比较
- 为每个用户组件提供“保留项目版本、使用导入版本、补入但不启用、加入并写入配置、隔离保留、跳过”的显式选择，并始终输出到新目录
- 用户明确选择启用时，只生成 Kext/ACPI/Driver 的最小配置条目；Kext 会校验非 Apple 依赖、配置路径并按依赖关系稳定排序
- 可选择“项目生成 EFI 优先”或“用户 EFI 优先”，在新目录融合两份完整 EFI；同名冲突保留主来源，缺失文件才补入
- 补入但没有被主 `config.plist` 引用的 ACPI、Kext 和 Driver 会标为“仅保留、未启用”，不会静默加载
- 将现代 UEFI、旧平台手动 UEFI、Legacy/OpenDuet 和 CPU 指令集风险拆分为独立路径
- 在完整 EFI 校验与复制前拒绝 Windows/FAT32 保留名称、不安全字符和大小写碰撞
- 失败时区分网络、组件完整性、EFI 结构、目标位置和文件权限，并给出不绕过安全门禁的恢复动作
- 可导出不包含本机路径、序列号或网络凭据的转移/求助摘要，方便在另一台电脑继续验证
- 社区条目与真机验证证据具备固定 commit、安全审核门和精确硬件/BIOS/config 哈希绑定校验
- 项目生成或受控组件 EFI 会计算真实 `config.plist` SHA-256；用户可记录 Picker、Recovery、安装、桌面与外设观察项，导出并回导精确绑定的脱敏验证证据
- 固定硬件回归矩阵包含 ThinkPad T430/T480/T490、常见 Z390/Z490、ASUS Z490、Dell OptiPlex 与高风险 NVIDIA/PM981 组合；矩阵验证规则决策，不等于这些机器已完成真机安装
- 使用当前 Windows 机器验证原生扫描器

## 推荐使用流程

1. **取得硬件报告**：优先在目标电脑上执行只读扫描；目标电脑无法运行工具时，从另一台电脑导入由 EFI Forge 导出的脱敏报告。演示和固定测试样本只能预览，不能生成或导出 EFI。
2. **看懂兼容风险**：先看“需要关注”摘要，再核对 CPU、显卡、网络、存储、BIOS 和 ACPI 细节。信息不足或可能不兼容只降低可信度，不会阻止继续。
3. **选择 EFI 起点**：普通用户优先选择 A 路径生成项目候选；已有专属 EFI 的用户可选择 B 路径进行只读检查。个人组件与双 EFI 融合位于高级选项中。
4. **完成结构校验**：只有目录结构、组件引用、锁定组件完整性和适用的 `ocvalidate` 检查通过后，才能进入复制步骤。通过不等于真机可启动。
5. **复制并启动测试**：普通空文件夹只能作为导出或备份。如需启动，先自行准备并挂载独立 U 盘的 FAT32 EFI 分区，再选择其空根目录。工具不格式化、不分区、不覆盖文件，也不制作完整 macOS 安装盘。

## 本地运行

Windows 用户可以直接双击项目根目录中的：

```text
启动 EFI Forge.cmd
```

该脚本启动免安装浏览器预览版。首次启动会安装依赖并生成应用文件，随后自动打开浏览器；关闭命令窗口即可停止应用。

开发模式：

```powershell
npm install
npm run dev
```

原生桌面开发模式（需要 Rust、WebView2 和 Visual Studio C++ Build Tools）：

```powershell
npm run desktop:dev
```

运行测试和生产构建：

```powershell
npm test
npm run build
npm run desktop:check
```

更新社区机型线索快照时，先人工审查指定提交，再用本地 README 生成确定性数据：

```powershell
node scripts/import-daliansky-catalog.mjs --source <README.md> --revision <40位提交哈希> --output src/data/dalianskyCatalog.snapshot.json
node scripts/import-daliansky-catalog.mjs --source <README.md> --revision <40位提交哈希> --output src/data/dalianskyCatalog.snapshot.json --check
```

生成 Windows NSIS 安装包：

```powershell
npm run desktop:build
```

## 安全边界

- 不包含 macOS 镜像
- 不分发万能 EFI
- 不生成或上传公共 SMBIOS 身份
- 当前版本不格式化或分区；只允许向用户选择的空目录或空挂载点复制
- 复制过程再次限制目录深度、条目数和总容量，并在提交到目标前重新验证暂存 EFI
- 生成期间使用的 `macserial.exe` 和 `ocvalidate.exe` 不会保留在最终导出目录
- 组件只从锁文件中的固定上游地址下载，大小与 SHA-256 不匹配时停止
- 社区机型索引只保存机型文字、GitHub 仓库入口和固定来源提交，不复制、不执行、不自动下载第三方 EFI；来源仓库未声明许可证时保持“仅发现线索”状态
- 原生扫描器只执行仓库内固定的 PowerShell/CIM 查询，不接收外部命令文本
- 信息不足或硬件可能不兼容时降低可信度并进入实验模式，但保留用户生成和导出权限
- 只有 EFI 结构/组件校验失败或未来的磁盘安全检查失败才会真正停止
- `ocvalidate` 通过只表示配置语法与结构通过，不表示真机 OpenCore、Recovery 或 macOS 安装已经成功
- 融合功能只接受两份结构完整的 EFI，并只做静态复制、结构与引用检查；不会自动理解或启用陌生组件
- 单独组件默认不会修改 `config.plist`；只有逐项明确选择启用才会写入最小条目，并使用锁定 OpenCore 包中的同版本 `ocvalidate` 校验
- 受控写入不会修改 `PlatformInfo`、`DeviceProperties`、NVRAM、Kernel Patch、Emulate 或 Quirks；受保护区域变化即停止

详细范围见 [v0.1.13 候选说明](docs/RELEASE_NOTES_v0.1.13.zh-CN.md)、[Hardware Evidence 2.0 实施提示词](docs/CODEX_HARDWARE_EVIDENCE_2_PROMPT.zh-CN.md)、[v0.1.12 多角度审计](docs/V0.1.12_MULTI_ANGLE_AUDIT.zh-CN.md)、[v0.1.11 深度审计](docs/V0.1.11_DEEP_AUDIT_REPORT.zh-CN.md)、[隐私说明](PRIVACY.md)、[ThinkPad 专项范围](docs/THINKPAD_SUPPORT.zh-CN.md)、[daliansky 目录补充实现提示词](docs/CODEX_DALIANSKY_CATALOG_SUPPLEMENT_PROMPT.zh-CN.md)、[产品需求文档](docs/PRD.zh-CN.md)、[验证流程](docs/VALIDATION_WORKFLOW.zh-CN.md)、[候选版本发布流程](docs/RELEASE_PROCESS.zh-CN.md)、[参与贡献](CONTRIBUTING.md)、[阶段 2–6 进度报告](docs/STAGES_2_6_PROGRESS_REPORT.zh-CN.md) 和 [工程实现提示词](docs/ENGINEERING_PROMPT.zh-CN.md)。
