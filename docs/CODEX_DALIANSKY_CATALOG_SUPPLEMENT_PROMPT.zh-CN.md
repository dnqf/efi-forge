# EFI Forge · daliansky/Hackintosh 机型索引全局补充实施提示词

你是 EFI Forge 的主工程代理。请在不削弱现有安全边界、不虚构兼容性、不把公开链接误判为已验证 EFI 的前提下，将 `daliansky/Hackintosh` 的机型整理内容接入 EFI Forge 的“社区候选发现层”。

## 一、项目现状

EFI Forge 是 Windows-first 的 OpenCore 硬件扫描、兼容性判断、EFI 组装和安全融合工具。现有能力包括：

- Windows 只读硬件扫描与脱敏报告；
- CPU、主板、GPU、网络、音频、存储规则；
- AMD/Intel 已审核台式机候选配置生成；
- ThinkPad 四位 Machine Type、系列目录和变体风险路由；
- 固定版本组件、SHA-256、结构校验和同版本 `ocvalidate`；
- 用户完整 EFI、Kext、AML、UEFI Driver 的只读扫描、显式选择与新目录融合；
- 信息不足或硬件风险只警告，EFI 结构损坏或数据破坏风险才停止。

## 二、指定补充来源

- 上游仓库：`https://github.com/daliansky/Hackintosh`
- 本轮固定提交：`56dafde8a93464365f7aa76fe34b575050f2c07e`
- 数据文件：该提交的 `README.md`
- 来源性质：社区维护的机型、EFI 与教程链接索引。
- 许可证状态：仓库根目录未发现许可证文件，必须记录为 `not-declared`。

不得将“出现在索引中”解释为兼容、可启动、适配当前 macOS、代码安全或已获再分发授权。

## 三、目标

1. 建立可重复执行的离线 Markdown 导入器，将上游表格转换为最小、确定性的事实型 JSON 快照。
2. 覆盖上游笔记本与台式机表格，而不是只复制少量热门型号。
3. 只保留机型名称、厂商/章节、设备类型、GitHub 候选仓库、GitHub 教程链接、简短备注和引导器线索。
4. 运行时根据本机厂商、完整型号、主板型号和设备类型寻找社区候选。
5. 匹配结果只能使用“强线索”或“可能相关”，不得使用“精确适配”“支持”“验证通过”等承诺性状态。
6. 将候选显示为独立的来源账本，不参与自动 BuildPlan、组件下载、配置写入或可信度推荐。
7. ThinkPad 专项目录仍是硬件变体路由；daliansky 索引只补充更多 E/L/P/S/T/W/X/Yoga 等候选仓库。
8. 未命中索引不能降低用户权限，也不能成为阻止下一步的条件。

## 四、数据与安全规则

- 导入器默认不联网，只读取用户或维护者明确提供的本地 `README.md`。
- 每次导入必须显式传入 40 位提交哈希。
- 输出包含 schemaVersion、来源仓库、提交哈希、源文件、上游更新时间、许可证状态和统计信息。
- 不把上游 README 原文打包进应用。
- 只接收 `https://github.com/<owner>/<repo>` 形式的候选仓库；分支、文件和 README 深链归入教程链接。
- 去重仓库 URL，删除 URL 查询参数与片段。
- 清除 HTML、Markdown 装饰和销售链接；备注限制长度，不能包含命令或可执行内容。
- 不克隆、不下载、不解压、不执行候选仓库中的任何文件。
- 后续若用户选择某个候选 EFI，仍必须进入现有的结构检查、身份清理、官方二进制替换、许可证和固定 commit 审核流程。

## 五、匹配逻辑

- 厂商标准化：Lenovo、Dell、HP、ASUS、Acer、Gigabyte、MSI、ASRock、Intel 等常见别名归一。
- 设备类型必须优先一致：笔记本报告优先笔记本条目，台式机报告优先台式机条目。
- 使用 `system.productName`、`system.machineType`、`board.model` 和厂商拼接成硬件身份。
- 去除 Hackintosh、EFI、OpenCore、Clover、macOS、Series、Gen 等无区分度词。
- 必须至少命中一个有区分度的型号词；仅命中 ThinkPad、Laptop、Desktop、Lenovo 等通用词不返回候选。
- 完整型号包含关系可形成强线索；厂商一致加型号词重合形成可能相关。
- 返回结果稳定排序并限制数量，避免把几十个近似条目推给用户。

## 六、界面

在兼容判断页增加“社区机型索引 / DISCOVERY LEDGER”区块：

- 显示来源名、固定提交短哈希、匹配条目数和“未审核线索”标签；
- 每条显示机型、设备类型、匹配级别、匹配原因和最多三个候选仓库；
- 明确说明不会自动下载、合并或启用；
- 保持 EFI Forge 现有固件工作台视觉语言，使用来源账本式分栏和细线，而不是新增独立设计体系；
- 响应式、键盘焦点和窄屏布局必须正常。

## 七、验证标准

- 导入同一 README 与 revision 两次产生字节一致的 JSON。
- 快照条目数量、笔记本/台式机数量、GitHub 仓库数量均大于零。
- 所有 ID 唯一，revision 为 40 位十六进制，候选仓库均为 GitHub HTTPS 根地址。
- T480、T490、ThinkPad E/L/P/X 系列能够得到合理候选；未知 ThinkPad 不被错误匹配到所有 ThinkPad。
- ASUS Z490、Dell OptiPlex 等非 ThinkPad 也可以使用同一发现层。
- 候选不改变 `CompatibilityReport.canContinue`、`recommended` 或 BuildPlan。
- 前端测试、Rust 测试、真实锁定组件测试、TypeScript、生产构建、Clippy、格式检查和 NSIS 安装包全部通过。

## 八、交付

- 保存本提示词；
- 提交导入脚本、规范化快照、类型、解析/匹配器、测试、界面和说明文档；
- 版本升级为 v0.1.9 alpha；
- 生成 Windows x64 NSIS 安装包并提供 SHA-256；
- 明确说明安装包是否签名，以及社区索引仍属于候选发现层。
