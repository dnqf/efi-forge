# GPT-5.6 sol 工作包 F 实施结果

日期：2026-09-07。基线仍为 `cea8531`，本批未提交、未推送、未改版本、组件锁或安装包。

## 已完成

- 新增原生缓存服务，默认仍兼容 `%TEMP%/efi-forge/runtime-v1`，自定义位置固定落在用户所选目录下的 `EFI-Forge-Cache/runtime-v1`。
- 状态接口返回解析后的绝对路径、布局版本、可写性与可用空间。坏的持久化配置会回退默认位置且在 `note` 明示原因，不阻止应用启动。
- 拒绝磁盘根和直接子目录、源码仓库及其上下级、`..`，并逐级检查现有路径的符号链接；Windows 同时按 `FILE_ATTRIBUTE_REPARSE_POINT` 拒绝 junction 等重解析点。选择入口还以固定标记、非递归方式拒绝 EFI 来源/目标与源码目录。
- 缓存设置先写临时文件，再用 Windows `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` 原子替换，支持连续切换。首次实现不迁移、也不删除旧缓存，UI 明示只有新任务使用新位置。
- 组件仍使用全局并发锁、唯一 `.part` 文件、锁定大小和 SHA-256 验证后落位；新增下载前“锁定组件大小 + 64 MiB”空间门。系统无法报告空间时不伪报数值，UI 标为未知，完整性校验仍保留。
- builder 与 `ocvalidate` 暂存现在共用受控缓存服务。每次操作先固定一个根路径快照，因此并发切换不会让同一操作跨两个根；不会声称取消已经运行的原生任务。
- 前端高级设置显示路径、版本、空间、可写状态和恢复说明；选择取消保留现状。缓存是独立全局设置，使用自己的 request sequence，而不错误绑定硬件/产物 revision；若原生命令已经持久化但响应变旧，会主动刷新当前真实状态，不声称撤销 native 设置。

## 临时目录审计边界

生产路径中，组件下载缓存和 `ocvalidate` 解压暂存已经统一。`acpi.rs`、`components.rs` 与 `builder.rs` 搜索到的其他 `std::env::temp_dir()` 均位于 `#[cfg(test)]` 测试夹具 helper，不参与用户生产任务，因此本批没有把测试隔离目录强行改为运行时缓存。

## 验证

- Rust 缓存针对性测试 8 项通过，覆盖中文路径、仓库上下级、EFI/源码标记、文件冒充目录、低空间边界、连续原子设置以及 Windows symlink/reparse 检测路径。本机本次成功执行了链接测试。
- 前端缓存请求使用独立 sequence；取消不更新状态，迟到持久化结果触发状态重读。
- `npm run workspace:check` 通过：27 个 Vitest 文件、211 项测试，目录导入 3 项，版本同步、TypeScript 与生产构建均通过。
- `cargo fmt --check` 和 `cargo clippy --all-targets -- -D warnings` 通过；`cargo test` 为 61 项通过、5 项 ignored、0 失败。ignored 项包括 4 项需要网络下载锁定上游组件的集成测试及 1 项真实 Windows WMI 扫描，本批未把它们写成已执行。
- `git diff --check` 通过。

## 明确未做

- 没有迁移或清理旧缓存，没有磁盘清理功能。
- 没有触碰用户 EFI、源码目录、Codex 数据或已有构建输出。
- 没有把“空间未知”当作空间充足证明；也没有在无网络前提下把 ignored 下载测试写成已验证。
