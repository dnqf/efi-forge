# GPT-5.6 sol 工作包 G/H 代码侧结果

日期：2026-09-07。基线 `cea8531`；未改版本、组件锁、Rust 组件来源或安装包，未 commit/push/release。

## G：配置证据矩阵

- 新增 12 类配置场景，每类 3 个明确标注 `synthetic` 的可解析输入：正例、信息缺失例、近似反例，共 36 例。
- 场景覆盖：Comet Lake 改名核显、Coffee Lake 未知主板、AMD B450/B550/BIOS 轴、笔记本/台式芯片组边界、混合显卡、ThinkPad 系列/机型码、Legacy/旧指令集、无线接口身份、USB 父控制器、SATA/NVMe/VMD、用户组件/EFI 来源、配置变化后的验证绑定。
- 每个矩阵项携带并执行自己的 `expected` 契约，包括 `canContinue`、`autoConfig`、关键规则命中/禁止、boot-arg 与 note。缺失信息仍允许继续；近似身份、笔记本、未知板与 Legacy 不取得不应有的自动资格。混合显卡正例同时包含核显、可用 AMD 独显与高风险 NVIDIA，明确禁止全局 `-wegnoegpu`；SATA/AHCI、NVMe 多盘与 VMD 分开建例，并验证只给 BIOS 提示、不编码格式化/分区写操作。
- user-provided 设备只形成复核 note，不触发 `e1000=0` 等自动副作用；另以真实组件选择 helper 验证用户可明确 `skip`，而非由硬件线索自动启用。ThinkPad 另执行 T/E/L/P/X 家族线索且未知码不升级为 machine-type；验证配置变化使用两个不同 `configSha256` 的 binding，旧证据明确不再绑定。
- 严格 rule case registry 从 13 例增至 22 例，已迁移规则从 10 条增至 18 条。新增迁移只引用既有规则与既有来源：Legacy、Coffee/Comet/AMD Zen、NVIDIA 分层、Intel 无线精确身份、Intel 600p。没有添加新支持 ID，也没有把索引或 synthetic 案例写成实机反馈。
- 当前仍有 23 条规则未迁移到严格 rule case：`firmware.uefi.required`；5 条 CPU 手动/笔记本规则；7 条 AMD/Tahoe/ThinkPad GPU 规则；5 条无线/I225/I226/I211 网络规则；`audio.realtek.tahoe.manual`；4 条 Samsung 970/Micron/SK hynix/Optane 存储规则。C 报告的“31 条”是 C 阶段当时快照，本报告记录追加迁移后的准确剩余数；本批矩阵覆盖风险行为，不冒充全部规则已审计。

## H：代码侧交付准备

- 未引入 DOM/浏览器大型依赖。提取由 App 实际消费的纯 presentation/decision view-model，行为测试固定首次指南默认展开、警告继续/结构失败停止、精确绑定但失败后保留 EFI 并允许重导，以及融合偏好变化后的来源回退。仅 780/480 窄屏和 reduced-motion 保留小型 CSS 静态契约，不再用全文搜索 App 文案冒充流程测试。
- 这类测试只证明代码结构与文案契约，不等于真实 WebView、键盘遍历、屏幕阅读器或安装包 GUI 验收。

## 验证与边界

- G/H 针对性：4 个文件、54 项测试通过（其中 36 项逐例执行矩阵契约）。
- `npm run workspace:check` 通过：30 个 Vitest 文件、260 项测试，目录导入 3 项，版本同步、TypeScript 与生产构建通过。
- `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 通过；`cargo test` 为 61 项通过、5 项 ignored、0 失败。ignored 是 4 项需网络的锁定组件集成与 1 项真实 WMI 扫描。
- 未执行真实网络锁定组件下载、真实 WMI 扫描、WebView E2E、安装/卸载、启动盘或实机启动；这些仍属于发布前 H 人工/集成验收。
