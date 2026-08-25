# EFI Forge（暂定名）

EFI Forge 是一个 Windows-first 的 OpenCore 配置与安装介质助手。它通过硬件扫描、可追溯的兼容性规则和固定版本的可信上游组件，为目标电脑生成专属 EFI 构建计划。

当前仓库处于 `v0.1.5 alpha`：已经具备 Windows 原生桌面壳、本机只读硬件扫描、兼容性判断、锁定组件下载、候选 EFI 组装、结构检查和向空目录安全复制。它不会格式化磁盘，也不会覆盖非空目录。

项目主页：[github.com/dnqf/efi-forge](https://github.com/dnqf/efi-forge)　Windows 安装包：[Releases](https://github.com/dnqf/efi-forge/releases)

## 当前能力

- 通过 Windows CIM/注册表只读扫描 CPU、主板、固件、GPU、网络、音频和存储
- 在 Tauri 桌面应用中展示本机脱敏硬件报告
- 导入和导出经过白名单清洗的硬件报告，以便在其他电脑上采集、在开发机上分析
- 逐项评估 CPU、GPU、主板、网络和存储兼容性
- 区分已支持、部分支持、阻止和未知结果
- 输出带规则 ID、证据和建议动作的构建计划
- 使用可构建与必须阻止的固定硬件样本验证规则引擎
- 锁定 OpenCore、常见 Kext 与审核 ACPI 的版本、资产大小和 SHA-256
- 导出确定性的候选 EFI 构建清单，并显示静态验证与实机验证闸门
- 为已审核的 AMD B450、Intel Coffee Lake / Comet Lake 台式机组合生成 config.plist 并运行同版本 `ocvalidate`
- 支持安全导入用户自己的 codeless `UTBMap.kext`，拒绝可执行内容、符号链接和 Windows 重解析点
- 支持自有或社区完整 EFI 的只读结构检查；不会执行其中携带的程序
- 使用当前 Windows 机器验证原生扫描器

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

生成 Windows NSIS 安装包：

```powershell
npm run desktop:build
```

## 安全边界

- 不包含 macOS 镜像
- 不分发万能 EFI
- 不生成或上传公共 SMBIOS 身份
- 当前版本不格式化或分区；只允许向用户选择的空目录或空挂载点复制
- 组件只从锁文件中的固定上游地址下载，大小与 SHA-256 不匹配时停止
- 原生扫描器只执行仓库内固定的 PowerShell/CIM 查询，不接收外部命令文本
- 信息不足或硬件可能不兼容时降低可信度并进入实验模式，但保留用户生成和导出权限
- 只有 EFI 结构/组件校验失败或未来的磁盘安全检查失败才会真正停止
- `ocvalidate` 通过只表示配置语法与结构通过，不表示真机 OpenCore、Recovery 或 macOS 安装已经成功

详细范围见 [产品需求文档](docs/PRD.zh-CN.md)、[验证流程](docs/VALIDATION_WORKFLOW.zh-CN.md) 和 [工程实现提示词](docs/ENGINEERING_PROMPT.zh-CN.md)。
