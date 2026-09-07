# GPT-5.6 sol D2+E 阶段实施结果

日期：2026-09-07
基线：`cea8531d37cd810f0651e83da08bd12f1873f907` / v0.1.14，并保留 A/B/C/D1 未提交修改。

## 结果

完成 D2 的小型模块化与 E 的用户硬件补充闭环。App 没有大规模重写：硬件覆盖解析移入 `hardwareOverrides.ts`，融合优先级后的活动产物选择移入 `workflowDecisions.ts`，并继续使用 D1 的 revision/token 生命周期。

会话内分别保存 `baseHardware` 与当前有效 `hardware`。用户可在默认折叠的高级区域补充整机厂商、完整型号、四位机型码、主板厂商/型号、BIOS 版本，并按 GPU、网卡、音频、存储四类独立填写 PCI JSON 数组。界面给出字段要求和可复制示例；支持取消本次填写、恢复本次会话底稿和撤销最近一次编辑。

## 来源与安全语义

- 原生扫描、导入报告与用户补充在 UI 中分别显示；运行时底稿来源以 `scanSource` 为准，不信任导入文件声明自己来自本机扫描。
- 成功编辑的报告携带 `provenance.baseSource` 和稳定排序的 `manualFields`。所有手工设备强制写为 `identitySource: user-provided`。
- `hasDirectPciIdentity` 明确拒绝 `user-provided`，因此手工填写的 PCI ID 不会命中要求 direct-pci 的精确规则，也不会冒充扫描证据。它仍保留为用户线索，不阻断自有 EFI 或手动路径。
- `hardwareProvenancePolicy.ts` 集中约束 BuildPlan 自动化：手工覆盖的 `board.model` 不能推导自动芯片组；手工 `board.vendor` 不能触发 ASUS/Gigabyte 特例；user-provided 设备不能触发自动组件、启动参数或精确 GPU 路径。若主板型号未被覆盖且真实 chipset evidence 可用，原有证据路径保留。
- 用户填写 Z490/B550 仍保持 manual config；用户填写 ASUS、I225、NVMe 或 UHD630 不会自动加入 `SSDT-RHUB.aml`、`e1000=0`、`NVMeFix.kext` 或 framebuffer。BuildPlan 会加入 user-provided 人工复核 note。恢复扫描底稿后，既有真实 Z490 自动路径仍正常工作。
- 有效报告序列化后可重导并重现手工值、manualFields 和 user-provided 身份。旧 v1/v2 报告没有 provenance 时仍按原解析路径处理。
- 为避免无上限递归或重复嵌入报告，导出文件不嵌套整个原始报告；“恢复原始扫描/导入值”保证当前会话可用，重导文件保留的是有效报告及覆盖标记。

## 编辑与失效行为

候选编辑先建立新对象并交给正式 `parseHardwareReport`。四位 PCI ID、八位 Subsystem ID、设备数组、跨分组重复 ID、机型码和报告结构继续使用统一限制。任何字段错误会定位到具体路径、拒绝整次编辑并保留旧报告、BuildPlan 与产物。取消和空编辑同样不改变有效状态。

编辑成功才推进 D1 `inputRevision`，使 BuildPlan、EFI artifact、验证与复制结果失效。恢复底稿和撤销也作为新的输入 revision 处理，避免旧产物绑定到不同硬件描述。

## 测试与验证

- 硬件覆盖测试验证：来源和 manualFields 可重放；用户 PCI 不属于 direct-pci 且不命中 Intel 无线精确规则；无效 PCI/畸形 JSON 被拒绝且底稿不变；空编辑被拒绝；导入文件自报 scanned 时由可信会话来源覆盖。
- 工作流决策测试验证：融合优先级变化仅使 merged 来源回退至有效 custom 或空，不改动无关活动来源。
- 既有报告解析、身份分类、证据摘要和 D1 生命周期回归一并纳入针对检查。
- 针对资格泄漏的检查：4 个测试文件、77 项测试通过；`npx tsc --noEmit -p tsconfig.app.json` 通过。
- `npm run workspace:check`：最终复跑通过。27 个 Vitest 文件、211 项测试通过；catalog 3 项通过；版本同步、TypeScript app/node 检查与 Vite 生产构建通过。
- `git diff --check`：通过，无空白错误。

## 未包含

没有引入 React DOM/浏览器测试框架；真实文件选择器、键盘焦点和桌面端点击时序仍需 D/H E2E。没有新增硬件支持规则或实机证据，没有改 Rust、版本、组件锁或安装包，没有提交、推送、打标签或发布。
