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

## 全链路复验修正

- 硬件验证绑定键新增固件模式、Secure Boot、线程数、PCI 父子/子系统信息和 Hardware Evidence 2.0 控制器/笔记本证据，避免不同 VMD、USB、蓝牙或输入拓扑误用同一实测记录。
- 切换硬件、目标系统或 config.plist 哈希后自动清空上一份 EFI 的验证表单；DSDT 分析成功后不再残留“处理中”锁定状态。
- GPU、网络、音频或存储缺失时保留明确的“未识别”检查项，不通过缩小分母制造更高规则覆盖度。
- 只有存在受支持 Intel 核显时才提供全局禁用不兼容独显选项；AMD 可用独显与 NVIDIA 不兼容独显并存时改走设备级人工方案，避免 `-wegnoegpu` 连可用显卡一起关闭。
- 旧 ThinkPad 仍进入 ThinkPad 机型专项，再叠加 OCLP/旧系统路径；T480/T480s/X1C6/T490/X1C7 接纳原生扫描器的 `kaby-lake-r` 分类。
- ThinkPad 高风险存储提示与全局 PM981/PM991、Micron 2200S、SK hynix PC711、Optane/3D XPoint 规则保持一致。
- 导入报告拒绝跨分组重复设备 ID 和相互矛盾的 Subsystem ID；社区审核日期必须是真实日历日期。
- 固定测试样本在步骤栏中明确标注“样本预览”，不再误写为仍在等待报告。
- 真机验证绑定改用版本化 SHA-256 硬件指纹；PCI 设备枚举顺序、扫描时临时 ID 和驱动显示名称变化不再把同一台电脑误判为另一台。旧候选导出的验证证据不会被静默套用到新指纹。
- 新增非系统盘开发数据工作区脚本，把 npm 缓存、Cargo target 和构建临时目录与源码仓库分离，并在大型构建前检查可用空间。

## 没有改变的边界

- 社区索引仍是 discovery-only，不下载、不执行、不合并、不改变 BuildPlan、推荐状态或继续权限。
- 自动配置白名单没有因名称或弱线索扩大。
- Windows 扫描、规则命中和 `ocvalidate` 都不能证明目标电脑可启动或安装。
- 信息不足和硬件高风险只警告；EFI 结构、组件完整性、路径与数据安全问题才停止。
- 工具不会制作 macOS 镜像、格式化磁盘、自动写入 EFI 分区或覆盖非空目录。

## 发布门

本版本必须通过前端/目录/TypeScript/Rust/Clippy/格式、真实 Windows 只读扫描、锁定组件、NSIS、SHA-256、Authenticode、Microsoft Defender 与安装/启动/卸载冒烟检查。没有精确目标硬件的 Picker、Recovery、安装和安装后证据，因此继续标记 Alpha prerelease。
