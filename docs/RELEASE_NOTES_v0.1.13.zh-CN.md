# EFI Forge v0.1.13 Alpha 候选说明

v0.1.13 的主题是 Hardware Evidence 2.0：提升“看见硬件差异”的能力，不把新增线索包装成更多实机兼容。

## 新增

- 硬件报告 schema v2，保留 schema v1 导入兼容。
- PCI Revision、Subsystem 拆分、可选父 PCI、Class Code、芯片组/桥、存储控制器、USB xHCI、Thunderbolt/USB4、蓝牙和输入控制器证据；Windows 扫描优先直接枚举控制器，避免耗时的逐设备父路径追溯。
- 电池、I2C、PS/2、Intel SST、摄像头、指纹和读卡器存在性线索。
- VMD/RST/RAID 与 AHCI 提示；NVMe 控制器 Class Code 可以补足磁盘名称缺失。
- 无线和蓝牙分栏，Intel 无线只允许选择 itlwm 或 AirportItlwm 单一路径；工具仍不自动加入未审核无线组件。
- RX 550 Lexa 精确 PCI ID 风险规则，以及常见 Intel 无线 PCI ID 人工路径。
- DIY/OEM 台式机、ThinkPad、普通/AMD 笔记本、迷你机、工作站和旧平台分路由。
- 浅蓝色 Hardware Evidence 2.0 界面账本，列出证据和缺口，并明确缺失不阻止继续。
- 审核 EFI 配置库要求 GitHub 根仓库、40 位提交、许可证、精确板型/芯片组/SKU/PCI 身份、config SHA-256 与真实验证阶段；生产注册表仍为空，不虚构已验证整包。

## 没有改变的边界

- 社区索引仍是 discovery-only，不下载、不执行、不合并、不改变 BuildPlan、推荐状态或继续权限。
- 自动配置白名单没有因名称或弱线索扩大。
- Windows 扫描、规则命中和 `ocvalidate` 都不能证明目标电脑可启动或安装。
- 信息不足和硬件高风险只警告；EFI 结构、组件完整性、路径与数据安全问题才停止。
- 工具不会制作 macOS 镜像、格式化磁盘、自动写入 EFI 分区或覆盖非空目录。

## 发布门

本版本必须通过前端/目录/TypeScript/Rust/Clippy/格式、真实 Windows 只读扫描、锁定组件、NSIS、SHA-256、Authenticode、Microsoft Defender 与安装/启动/卸载冒烟检查。没有精确目标硬件的 Picker、Recovery、安装和安装后证据，因此继续标记 Alpha prerelease。
