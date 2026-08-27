# ThinkPad 专项支持范围

EFI Forge v0.1.8 的 ThinkPad 能力是“型号与变体路由”，不是把一份 EFI 宣称为所有 ThinkPad 通用。

## 当前已实现

- Windows 扫描 Lenovo 四位 Machine Type（例如 T480 的 `20L5`），报告不保存序列号或完整 MTM。
- 机型码优先、产品名称其次、ThinkPad 系列兜底的三级识别。
- Ivy Bridge、Haswell、Broadwell、Skylake、Kaby Lake、Coffee/Whiskey Lake、Comet Lake 的分层目录。
- 对 CPU 代际、Intel 核显、NVIDIA/AMD 独显、无线网卡、PM981/PM991 等存储和 UEFI/Secure Boot 分别检查。
- T480/T480s/T580/X280、T490/T590/X390、X1 Carbon Gen 6–8 等常见系列的候选证据入口。
- 未收录型号、信息不足或组件不同只会降低可信度；用户仍可导入完整 EFI、融合副本或使用组件工作台。

## 分层含义

- `有同系列候选`：存在公开技术资料和社区实践，但仍需逐项核对硬件变体。
- `需要旧硬件补丁`：目标 macOS 对该代核显已取消原生支持，通常涉及 OCLP、伪装或额外验证。
- `研究路径`：只有部分同代/同系列证据，不作为精确推荐。
- `不进入自动推荐`：AMD 笔记本或 Tiger Lake 及更新 Intel 核显等不在当前官方指南支持路径；不阻止用户研究导入。

## 仍然不能自动断言的项目

同一零售型号可能包含不同 CPU、屏幕、触屏、无线网卡、声卡、NVMe、雷电控制器和独显。社区仓库只作为候选证据，不会被自动下载或标记为已验证；真正进入整包注册表仍必须固定 commit、检查许可证、清除 SMBIOS 身份、替换官方二进制并通过真机启动/Recovery/安装验证。
