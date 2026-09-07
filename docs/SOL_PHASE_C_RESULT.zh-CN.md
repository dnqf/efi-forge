# GPT-5.6 sol C 阶段实施结果

日期：2026-09-07
实施基线：`cea8531d37cd810f0651e83da08bd12f1873f907` / v0.1.14

## 结果

本轮完成规划 C 的首批严格迁移，没有把既有 `testSampleIds` 字符串继续当作已验证案例。新增独立的规则案例注册表与跨库验证器；案例先经硬件报告解析，再运行真实兼容性评估，检查预期规则命中与禁止规则不命中。案例数据与整机 UI 夹具分离，避免两类测试承担混淆的职责。

所有本轮新建案例均明确标记为 `synthetic`。没有使用或声称 `user-redacted`、`real-machine-feedback`，没有把软件回归包装成实机证据，也没有改变任何兼容性规则的选择器、优先级、状态或操作。

## 严格覆盖范围

当前共有 41 条兼容规则，其中 10 条已把 `registry.testSampleIds` 迁移到可执行 `case.*` ID，并纳入双向严格验证：

- 自动配置相关 8 条：`gpu.intel.uhd630`、`gpu.intel.hd-uhd620-laptop`、`gpu.amd.polaris.native`、`gpu.amd.navi-native`、`network.intel.i219`、`network.realtek.rtl8125`、`network.realtek.rtl8111`、`audio.realtek.applealc-candidate`。
- 高风险 2 条：`gpu.amd.polaris-2048sp.blocked`、`storage.samsung.pm98x.blocked`。

共 13 个 synthetic 案例，覆盖上述规则的正例，并加入近似设备反例、缺失设备反例，以及 `parent-pci` / `name-only` 身份反例。近似反例包括 RX 580 与 2048SP、RTL8125 与 RTL8111、Intel 600p 与 660p 的隔离；身份反例证明父控制器或仅名称证据不能触发已迁移的直接 PCI/组合身份规则。

验证器检查：案例 ID 唯一且格式稳定；来源运行时值属于三种允许分类；同一规则不能同时列为预期和禁止命中；案例引用的规则存在；已迁移规则引用的案例存在；规则与案例预期关系双向一致；硬件输入可由正式解析器解析；预期规则实际命中；禁止规则没有命中。`validateCompatibilityRegistry` 保持原有规则结构职责，没有导入案例注册表或评估引擎，因此没有形成循环导入。

故障测试明确覆盖：拼错规则中的案例引用、删除被规则引用的案例、错误的 `expectedRuleIds`、错误的 `forbiddenRuleIds`、预期/禁止规则矛盾，以及非法来源运行时值。这些错误均会产生可定位的验证问题。

## 审计 backlog

剩余 31 条规则仍保留旧 `testSampleIds`，不在本轮严格案例覆盖统计内：

`firmware.uefi.required`、`firmware.legacy.blocked`、`cpu.intel.coffee-lake`、`cpu.intel.kaby-lake-laptop`、`cpu.intel.legacy-laptop`、`cpu.intel.ice-lake-laptop`、`cpu.intel.comet-lake`、`cpu.intel.post-comet.manual`、`cpu.tahoe.manual-known`、`cpu.amd.zen`、`gpu.amd.lexa-rx550.blocked`、`gpu.amd.navi-spoof.partial`、`gpu.amd.navi22.partial`、`gpu.amd.vega-apu.partial`、`gpu.amd.modern-unsupported.blocked`、`gpu.tahoe.intel-amd.manual`、`gpu.nvidia.turing.blocked`、`gpu.nvidia.thinkpad-dgpu.blocked`、`gpu.nvidia.modern-macos.blocked`、`network.intel.wireless-laptop`、`network.intel.wireless-exact`、`network.intel.wireless-tahoe.manual`、`network.intel.i225.partial`、`network.intel.i226.partial`、`network.intel.i211.partial`、`audio.realtek.tahoe.manual`、`storage.samsung.970-evo-plus`、`storage.micron.2200s.blocked`、`storage.skhynix.pc711.blocked`、`storage.intel.optane.blocked`、`storage.intel.600p.partial`。

这些旧引用没有被宣称为真实可执行案例或严格覆盖。后续应按来源和风险逐条迁移，优先补齐无线身份来源、NVIDIA/现代 AMD 排除、Tahoe 手动路径与剩余存储高风险规则；在没有可核验材料时继续使用 synthetic，并把用户脱敏报告和实机反馈作为不同来源单独记录。

## 修改文件

- 新增案例数据：`src/data/ruleCases.ts`
- 新增跨库验证：`src/data/validateRuleCases.ts`
- 新增故障与行为测试：`src/data/ruleCases.test.ts`
- 迁移 10 条规则的案例引用：`src/data/rules.ts`

## 已执行检查

- 针对性测试：`npm test -- --run src/data/ruleRegistry.test.ts src/data/ruleCases.test.ts`，2 个文件、7 项测试通过。
- `npm run workspace:check`：首次因沙箱不能写入项目配置的 `D:\EFI-Forge-Development-Data\temp` 而在 Vitest 建立临时目录时失败；按正规权限重跑通过。最终复跑为 23 个 Vitest 文件、192 项测试通过；catalog 3 项测试通过；版本同步、TypeScript app/node 检查与 Vite 生产构建通过。
- `git diff --check`：通过，无空白错误。

## 边界

本轮没有修改版本号、Rust、组件锁、安装包、兼容结果或 UI；没有提交、推送、打标签或发布。案例通过仅证明当前 TypeScript 规则在合成输入上的确定性行为，不证明目标硬件可启动、进入 Recovery、完成安装或长期稳定。
