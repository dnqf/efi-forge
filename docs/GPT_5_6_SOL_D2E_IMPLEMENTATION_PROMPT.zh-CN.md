# 交给 GPT-5.6 sol 的 EFI Forge D2+E 实施提示词

在保留 A/B/C/D1 未提交修改的前提下，继续实施 `NEXT_ITERATION_PLAN.zh-CN.md` 的 D2 与 E 用户硬件补充闭环。不得大规模重写 App，不得修改版本、Rust、组件锁或安装包，不得提交、推送或发布。

## 工程目标

1. 从 App 抽取可测试的硬件覆盖和产物来源选择决策；复用 D1 revision/token 生命周期。
2. 保留当前会话原始扫描/导入报告与有效报告，允许用户补充整机厂商、完整型号、机型码、主板和 BIOS，以及 GPU/网卡/音频/存储 PCI 身份。
3. 手工字段明确标为 manual / `user-provided`，不能冒充 direct-pci 扫描证据、官方支持或实机验证。
4. 所有候选编辑必须经过正式 `parseHardwareReport`；无效 PCI ID、重复设备 ID、错误 Subsystem ID 或破坏结构时拒绝整次编辑并保留旧状态。
5. 编辑成功推进 input revision，使 BuildPlan、EFI、验证和复制结果失效；取消、空输入或解析失败不失效。
6. 报告序列化保留 manualFields 和 `user-provided` 设备来源；旧 v1/v2 报告继续可导入。运行时 UI 来源以 `scanSource` 为准，不信任导入 JSON 自报 `baseSource`。
7. UI 使用默认折叠的高级入口，提供逐类输入、格式示例、帮助、恢复底稿与撤销；不增加默认路径负担。
8. 用纯逻辑与规则回归证明用户 PCI 不会触发 direct-pci 精确规则，并运行 `workspace:check` 与 `git diff --check`。

## 产品边界

信息不足或可能不兼容继续警告并允许手动路径；结构无效只阻止该次编辑。用户补充可以改善线索和候选推导，但不得提升为扫描证据、项目官方验证或实机成功结论。
