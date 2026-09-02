# EFI Forge v0.1.11 Alpha 候选说明

> 状态：本地开发候选，尚未创建 tag 或 GitHub Release。公开稳定下载仍为 v0.1.10。

## 本轮重点

v0.1.11 继续把 EFI Forge 收敛为“有证据的候选 EFI 工作台”，而不是无法兑现的通用一键安装器。用户仍拥有最大限度的路径选择权：硬件信息不足或兼容性存疑只会产生警告；只有 EFI 结构损坏、锁定组件完整性失败、路径不安全或可能覆盖数据时才会停止。

### 工作流与界面

- 将用户看到的“覆盖率”改称“规则识别度”，明确它不是启动或安装成功率。
- 兼容判断页同时提供项目候选、完整用户 EFI、单组件补充/替换三条路径。
- 增加证据缺口账本，指出缺少的整机型号、BIOS、PCI ID、Subsystem ID 等信息及补充方法。
- 第 4 步明确区分普通空目录导出与已挂载 FAT32 EFI 系统分区；普通目录不会因此变成可启动介质。
- 重新整理浅蓝色界面、窄屏四步导航、键盘焦点和移动端触控区域。

### 硬件与规则

- 扫描阶段直接读取 CPUID leaf 1 的 CPU Family/Model，减少 WMI 通用值造成的误判。
- 主板厂商或型号读取失败时保留扫描结果并形成证据缺口，不再因为单个可选身份字段缺失而丢弃整份报告。
- 补充 Rocket Lake、Tiger Lake、Alder Lake、Raptor Lake、Raptor Lake Refresh、Meteor Lake、Kaby Lake-R 和 AMD Zen 1–5 的保守识别；细分 Ryzen 6000/7000/8000/9000 常见移动与桌面命名。
- 增加现代 NVIDIA、AMD Vega APU、SK hynix PC711、Tahoe Intel 无线与模拟音频的专项风险提示。
- macOS Tahoe 26 作为研究性手动目标接入；不自动生成 `config.plist`，不将其表述为已适配。
- 增加 Intel 核显与独显混搭、ThinkPad T14 AMD、Vega 7 等固定样本，验证“风险可见但用户路径不被无故关闭”。

### EFI 结构与复制安全

- 校验 OpenCore 顶层字典、`Add` 数组、启用项类型、Kext `PlistPath`、引用文件和大小写无关的重复路径。
- 启用的 ACPI 和 UEFI Driver 必须是普通文件，Kext 必须是目录；同名目录伪装成 `.aml`/`.efi` 会被拒绝。
- 实际复制过程中再次限制目录深度、文件数量和总容量，并拒绝链接、重解析点、特殊文件及 Windows 可执行载荷。
- EFI 先复制到目标内的暂存目录，暂存副本复验成功后再原子迁移到最终 `EFI` 目录。
- 目标必须是用户明确选择的空目录；工具不会分区、格式化或覆盖已有 EFI。
- 构建期 `ocvalidate`、`macserial` 等 Windows 工具不会进入最终导出目录；自动候选也不再携带临时源模板。
- 锁定组件下载遇到临时连接或 HTTP 失败时最多尝试 3 次；任何失败都会清理本次未完成的 `.part` 文件，哈希不符仍立即停止。
- 原生构建边界会复核清单来源、硬件键、采集时间、规则检查、验证阶段以及组件仓库、版本、许可证、发布地址与 SHA-256；被篡改的来源字段或缺失候选闸门会停止。
- 原生构建边界同时限制清单文本长度、CPU 核心数、核显平台 ID，并阻止把 AMD/Intel 专属设置写入错误平台；声明核显或禁用独显时必须锁定 WhateverGreen。
- `ACPI/Add`、`Kernel/Add`、`Misc/Tools` 与 `UEFI/Drivers` 必须是数组，`Enabled` 必须是布尔值；AML/BIN、Kext、UEFI Driver/Tool 的后缀和物理类型必须一致。
- 导入硬件报告限制字段长度、控制字符、设备数量、重复 ID、日期、未来采集时间和 CPU 核心/线程关系，防止异常报告拖垮或误导界面。
- 硬件报告导出文件名和候选目录名加入固定长度上限，避免异常型号形成过长 Windows 路径。
- 完整 EFI 若含已填写 SMBIOS 身份，只给出不回显具体值的隐私警告。

### 社区来源

- daliansky/Hackintosh 索引继续保持 discovery-only：只展示候选线索，不参与自动 BuildPlan、下载、合并或推荐。
- 导入端和运行时双重过滤 `DONT USE THIS`、占位用户名、无效仓库名与非 GitHub 根地址。
- 任何用户或社区 EFI 在融合前仍须经过只读结构扫描、显式选择、新目录输出与最终校验。

### 维护与发布

- 修订隐私说明，准确描述本地硬件扫描、按需锁定组件下载、SMBIOS、验证证据与本地保留范围。
- 候选工作流固定 Rust 1.98.0，新增版本同步检查、完整 npm 依赖漏洞审计和 `RELEASE-METADATA.txt`，降低工具链漂移、错版、错哈希和验证范围描述不一致的风险。
- 修复硬件扫描、候选构建、USB 映射、DSDT、完整 EFI、组件融合、证据导入与复制等异步结果覆盖新工作流状态的竞态条件。
- 真机验证证据要求失败结论至少包含一条失败观察；导出前会再次解析数据，阻止被运行时修改后的无效证据写入文件。

## 明确不包含

- 不下载 macOS Recovery，也不制作完整安装盘。
- 不自动分区、格式化、挂载或替换现有系统 EFI。
- 不保证所有旧平台、笔记本、OEM 或混搭硬件能够启动或安装。
- 不将规则命中、社区链接、`ocvalidate` 通过解释为真机验证。
- 不自动执行或信任用户、社区 EFI 中的 Windows 二进制或脚本。

## 发布前门槛

- 前端单元测试、社区目录导入测试、TypeScript 与生产构建通过。
- Rust 格式、Clippy、普通测试及锁定组件真实下载/组装测试通过。
- Windows x64 NSIS 能从当前提交构建，安装包 SHA-256 已记录。
- 在干净 Windows 环境完成人工安装、启动、导出、卸载和 Defender 检查。
- 若安装包未进行 Authenticode 签名，Release 必须醒目标注“未签名”。

## 已知限制

- 自动 `config.plist` 仍只覆盖已审核的少量 AMD Zen、Intel Coffee Lake 与 Comet Lake 台式机模板。
- ThinkPad、旧平台、绝大多数 OEM 笔记本和小众硬件仍主要依赖社区候选与用户 EFI 的人工审核路径。
- ACPI、USB 映射、核显 framebuffer、BIOS 设置、SMBIOS 身份和安装后功能无法仅凭 Windows 扫描可靠自动化。
- 最终可用性必须在目标电脑上按“OpenCore 菜单 → Recovery → 安装 → 安装后”的顺序逐级记录。

## 本地候选构建记录

- 构建类型：Windows x64 NSIS，本地未发布候选。
- 安装包：`EFI Forge_0.1.11_x64-setup.exe`
- 文件大小：3,496,152 bytes。
- SHA-256：`5C455022D23862E914AD143E154081E054973FA721609AD1ECDB1A943F5FD95E`
- Authenticode：`NotSigned`。
- 文件元数据：ProductName `EFI Forge`，ProductVersion/FileVersion `0.1.11`。
- Microsoft Defender 单文件扫描：未发现威胁（无修复模式，本机引擎结果，不替代签名或多引擎审查）。
- 本机安装烟雾：专用临时目录静默安装成功，应用保持运行 5 秒，静默卸载返回 0，安装目录已移除。

该哈希仅对应本轮本地构建。正式发布必须由干净 CI checkout 重新构建、生成新的 SHA-256，并在人工验收后更新 Release；不能把本地哈希直接当作未来 GitHub 资产哈希。
