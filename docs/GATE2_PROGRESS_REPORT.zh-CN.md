# Gate 2 进展报告（v0.1.5）

日期：2026-08-25

## 本轮完成

- 将验证证据拆分为“仅结构检查”“同版本 ocvalidate 已通过”“真机验证仍为候选”，界面不再把软件检查描述成可保证安装。
- 新增用户 USB 映射导入：只接受依赖 `com.dhinakg.USBToolBox.kext` 的 codeless `.kext`，拒绝可执行内容、符号链接、Windows 重解析点和异常文件类型；源目录保持只读，构建时复制到新暂存区。
- 锁定 USBToolBox 1.2.0，并在用户导入映射时自动配对；`XhciPortLimit` 始终保持关闭。
- 按精确 PCI ID `10EC:8168/8161` 加入 RealtekRTL8111 3.0.0。
- 按精确 PCI ID `8086:1539` 识别 Intel I211，但因上游没有可供本工具锁定的正式 Release，不静默加入 AppleIGB，用户仍可使用自有方案。
- 检测到名称明确包含 NVMe 的存储时加入 NVMeFix 1.1.3；PM981/PM991、Micron 2200S、Optane 等既有风险规则继续优先警告，NVMeFix 不被描述为万能修复。

## 锁定资产

| 组件 | 版本 | 大小 | SHA-256 |
|---|---:|---:|---|
| RealtekRTL8111 | 3.0.0 | 180409 | `a0f2e64ac3c76e2d416ff88f35a197ce229e74ea78e968631a736a43b4d8231c` |
| NVMeFix | 1.1.3 | 108136 | `e1d5657ab7ac31f69771708f7b80bf218ab9aa0b8e4c4fe6ff943983037e3dfb` |
| USBToolBox | 1.2.0 | 60756 | `c315a3a5acfd496dd97d0d19b4fbd1d487103d2fd541c5651583d4c9cebcfe07` |

## 验证结果

- 前端：5 个测试文件，31/31 通过。
- Rust：13/13 本地测试通过，3 个真实下载测试单独执行并全部通过。
- AMD B450、Intel Coffee Lake Z390、Intel Comet Lake Z490 的真实锁定组件组装与同版本 `ocvalidate` 通过。
- Gate 2 三个新资产完成真实下载、大小、SHA-256 与 Kext 路径验证。
- 严格 `cargo clippy --all-targets -- -D warnings` 通过。

## 尚未完成的证据

- 真机 OpenCore 启动：0 台。
- Recovery 启动：0 台。
- macOS 安装完成：0 台。
- 睡眠、唤醒、音频、USB 每端口、网络长期稳定性：未验证。
- 安装包代码签名：未配置。
- 笔记本专属 EC、电池、触控板、背光、睡眠和无线方案仍未自动化。

因此 v0.1.5 仍是公开测试候选，不应被描述为“保证一键安装成功”。
