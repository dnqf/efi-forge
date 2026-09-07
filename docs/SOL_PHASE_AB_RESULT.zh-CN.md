# GPT-5.6 sol A/B 阶段实施结果

日期：2026-09-06
实施基线：`cea8531d37cd810f0651e83da08bd12f1873f907` / v0.1.14

## 结果

本轮已完成规划中的 A、B 有界范围。没有修改版本号、组件锁、Rust 原生层、发布状态或安装包，也没有修改 `NEXT_ITERATION_PLAN.zh-CN.md` 与实施提示词。

### A：共享身份与网络分类消费者

- 新增轻量共享身份判断，区分 `direct-pci`、`parent-pci`、`name-fallback` 与 `unknown`。旧 schema 未声明 `identitySource` 且具有合法 Vendor/Device ID 时，继续按既有约定视为直接 PCI；显式标为 `name-only` 或 `parent-pci` 时，不信任看似完整的 Vendor/Device ID。
- 仅复用既有规则已经声明的 Intel 无线与精确以太网 PCI ID；没有新增硬件支持 ID。无线 ID 同时供规则和分类器使用，精确以太网 ID 另有测试逐项核对其确实存在于原规则中。
- 硬件摘要和兼容模块已接入同一网络分类。已知无线 PCI ID 即使 Windows 显示为通用 `Network Controller`，仍归入无线；已知以太网不会因误导性的 Wi-Fi 名称进入无线；未分类网卡不会再默认冒充有线。
- Tahoe 的已知 Intel 无线 PCI ID 会通过安全的类别规范名命中现有手动无线规则，不依赖 Windows 驱动显示名称；规则结论仍是手动/部分验证，不会自动加入无线组件。
- 规则匹配不再把 `name-only` 或父控制器字段当作直接 PCI 证据。名称回退仍只是弱分类线索，不等于规则支持或组件选择。
- `buildReadiness` 的弱身份统计现在包含父 PCI 和 `name-only` 矛盾报告。缺口保持警告语义，用户仍可继续项目候选/官方组件路径、导入自有 EFI 或进行受控组件融合。

覆盖边界：GPU 只保留并强化既有 `8086:9BC5` UHD 630 规范身份，且要求直接 PCI；网络分类只覆盖既有规则中的精确 ID 及保守名称线索；存储专用风险规则和 NVMe 逻辑未扩大，本轮只让其设备身份参与统一的 readiness 直接 PCI 缺口判断。分类证据不等于 macOS 支持、组件选择或实机验证。

### B：显式观察项与验证资格入口

- 删除误导性的 `observationsForStage(stage, result, ...)`，替换为只接收显式观察项的 `initializeVerificationObservations(explicit)`。未显式提供的九项检查全部初始化为 `not-tested`，阶段/结果选择不会制造通过或失败观察。
- App 导出调用已切换到新接口；历史证据 schema 不迁移、不重写。
- `mayPromoteVerification` 现在在资格边界重新调用完整解析。解析后被篡改、非法/缺失观察项、错误 schema、数字 macOS、阶段必要观察不成立或任一硬件指纹、BIOS、macOS、OpenCore、config SHA-256 绑定不一致时均返回 `false`。
- 合法、显式且完全绑定当前候选的通过证据仍可序列化、回导并通过资格判断；失败证据仍要求至少一个显式失败观察项。

## 修改文件

- 数据与分类：`src/data/networkIdentities.ts`、`src/data/rules.ts`、`src/engine/deviceIdentity.ts`
- 分类消费者：`src/engine/evaluateCompatibility.ts`、`src/engine/evaluateHardwareModules.ts`、`src/workflow/hardwareEvidenceSummary.ts`、`src/workflow/buildReadiness.ts`
- 验证证据与 App 入口：`src/feedback/verificationEvidence.ts`、`src/App.tsx`
- 回归测试：`src/engine/deviceIdentity.test.ts`、`src/engine/evaluateCompatibility.test.ts`、`src/workflow/hardwareEvidenceSummary.test.ts`、`src/workflow/buildReadiness.test.ts`、`src/feedback/verificationEvidence.test.ts`、`src/workflow/auditRegression.test.ts`

## 已执行检查

1. 针对性回归：
   `npm test -- --run src/engine/deviceIdentity.test.ts src/engine/evaluateCompatibility.test.ts src/workflow/hardwareEvidenceSummary.test.ts src/workflow/buildReadiness.test.ts src/feedback/verificationEvidence.test.ts src/workflow/auditRegression.test.ts`
   结果：6 个测试文件、83 项测试全部通过。
2. 全套前端与生产检查：`npm run workspace:check`
   - 首次沙箱运行因无权创建 `D:\EFI-Forge-Development-Data\temp\...\ssr` 失败；这是本机开发数据目录权限，不是测试断言失败。
   - 按正规权限重跑通过：22 个 Vitest 文件、187 项测试；catalog 3 项测试；版本同步检查；TypeScript app/node 检查；Vite 生产构建。
3. `git diff --check`：通过，无空白错误。

## 未验证与残留边界

- 本轮是软件静态检查与模拟数据回归，不代表目标硬件能够启动、进入 Recovery、完成安装或长期稳定运行。
- 没有进行真实 Windows 硬件扫描、目标机 BIOS/PCI 人工复核、真机启动或安装后功能验证。
- 没有新增 DOM/浏览器流程测试；本轮 App 仅替换验证初始化调用，TypeScript 与 Vite 生产构建已通过，没有进行全 UI 重写或视觉调整。
- v0.1.14 现有安装包没有包含本轮未提交源码更改；本轮未重打包、签名、扫描、提交、推送、打标签或发布。
