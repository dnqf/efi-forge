# GPT-5.6 sol D1 阶段实施结果

日期：2026-09-07
实施基线：`cea8531d37cd810f0651e83da08bd12f1873f907` / v0.1.14，并保留本地 A/B/C 未提交修改。

## 结果

本轮完成规划 D 的第一部分：为 App 建立可独立测试的工作流产物生命周期，并接入关键输入、计划、产物、验证与复制路径。没有拆分页面或更改视觉布局，也没有声称原生任务已被真正取消；原有 epoch 继续作为底层保险，新的 revision/token 模型负责决定迟到结果是否仍可接纳。

## 实际依赖与失效规则

- `inputRevision` 代表硬件报告和目标 macOS。扫描或报告导入成功、载入固定样本、切换目标 macOS 都推进输入 revision；计划、当前 EFI 产物、验证结果与复制结果全部失效。
- `planRevision` 代表影响 BuildPlan 的用户选择。AMD `SetupVirtualMap`、Intel 时钟模式/DSDT 静态证据、USB Map、明确不兼容显卡的处理方式都会推进计划 revision；硬件输入不变，但 EFI 产物及其验证/复制结果失效。
- `artifact` 记录独立 revision、绑定的 input/plan revision 和活动来源：`generated`、`custom`、`merged` 或 `component-merged`。生成候选、用户 EFI 校验、整包融合、组件融合均只在 operation token 仍匹配时绑定。
- 验证回导和复制结果分别记录所绑定的 artifact revision。进入复制、导出/回导验证证据和复制动作会检查当前 UI 来源与生命周期来源一致，且 artifact 仍绑定当前 input/plan revision。
- 每类异步操作都有 token，包含启动时 input、plan 和 artifact revision。同类较新任务、输入或偏好变化、产物被另一操作替换后，旧结果不能接纳。

## App 行为

- 慢扫描或慢报告读取完成前若生命周期已变化，结果会同时被 token/revision 与既有 epoch 拒绝。
- 构建、用户 EFI 选择、融合、组件扫描/融合、验证证据导入与复制全部接入 token 接纳检查。
- 文件选择器返回空结果只结束对应 pending，不清除现有有效 artifact。报告与验证文件在没有选择文件时不会启动失效流程；扫描或报告解析失败也保留此前输入与有效产物，只有成功接纳新输入后才清理旧下游。
- 操作抛错时结束未完成的 pending 并保留既有来源输入/产物；错误仍按原有受控文案显示。重新构建开始时不预先删除融合/组件来源元数据，成功换源后才清理；成功产生不完整暂存包时会明确丢弃当前可复制 artifact。
- 用户 EFI 校验完成但 `valid=false` 时只记录该次校验结果和错误提示，不替换此前有效活动来源，也不绑定新 artifact。
- 验证证据与当前 binding 不一致时只记录不匹配提示并结束 pending；只有硬件、BIOS、目标系统、OpenCore 和 config 哈希精确绑定的成功或失败实测记录才登记到当前 artifact revision。
- 融合优先级或组件选择改变后，已有融合产物不再沿用；能恢复项目生成或用户来源时会建立新的来源绑定。
- 状态模型不声称终止原生文件操作。它只保证已经过期的返回值不会覆盖当前工作流。

## 测试覆盖

纯状态转换测试覆盖：

1. 慢硬件任务后输入 revision 已改变，旧结果被拒绝。
2. 构建期间目标 macOS 对应的 input revision 改变，旧构建不能绑定 artifact。
3. BuildPlan 偏好改变后 artifact、验证与复制结果同时失效。
4. 文件选择取消保留当前有效 artifact。
5. 失败操作保留来源 artifact，只清未完成目标状态。
6. 复制过程中 artifact 被融合结果替换，旧复制结果被拒绝。
7. 当前硬件结果以原子转换推进 input 与 plan revision，并清理 pending。
8. 无效用户 EFI 和失败的重新构建均保留原活动 artifact。
9. 绑定不匹配的验证证据不会登记 verification artifact revision。

项目目前没有现成的 React DOM 交互测试基础。本轮没有为 D1 引入大型依赖；浏览器/真实桌面 E2E（包含实际点击时序、原生选择器和真正的任务中止）保留为 D/H 后续待办。

## 修改文件

- 生命周期模型：`src/workflow/artifactLifecycle.ts`
- 纯状态回归：`src/workflow/artifactLifecycle.test.ts`
- 关键调用链接入：`src/App.tsx`
- 本结果记录：`docs/SOL_PHASE_D1_RESULT.zh-CN.md`

## 已执行检查

- 针对性测试与 TypeScript：`npm test -- --run src/workflow/artifactLifecycle.test.ts`，1 个文件、10 项测试通过；`npx tsc --noEmit -p tsconfig.app.json` 通过。
- `npm run workspace:check`：最终复跑通过。24 个 Vitest 文件、202 项测试通过；catalog 3 项测试通过；版本同步、TypeScript app/node 检查与 Vite 生产构建通过。
- `git diff --check`：通过，无空白错误。

## 边界

本轮未修改兼容规则结果、Rust 原生层、组件锁、版本号或安装包，未提交、推送、打标签或发布。状态测试与前端构建通过不等于目标机 EFI 可启动、进入 Recovery、完成安装或长期稳定。
