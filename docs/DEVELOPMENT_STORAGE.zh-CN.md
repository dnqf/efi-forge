# EFI Forge 开发数据与历史连续性

EFI Forge 的源码与 `.git` 必须继续保存在同一个仓库目录中。提交、分支、标签和远端跟踪都留在原仓库，因此迁移缓存或安装包不会切断开发历史。

开发机可以把大型数据放到空间充足的非系统盘，例如 `D:\EFI-Forge-Development-Data`：

- `build/cargo-target-current`：当前 Rust 与 Tauri 编译产物；迁移前生成且包含旧绝对路径的 Cargo target 只保留在归档中，不直接复用；
- `cache/npm`：本项目后续 npm 缓存；
- `temp`：测试、Vite、NSIS 和本地构建临时文件；
- `artifacts/release-candidates`：本地和 CI 候选安装包、哈希及元数据；
- `archive/legacy-temp-builds`：从系统临时目录迁出的旧构建数据，仅用于故障追溯。

本机路径写在不会提交的 `.efi-forge-workspace.local.json` 中；仓库只提交格式示例。其他维护者可以复制 `.efi-forge-workspace.example.json` 并修改为自己的非系统盘路径。

## 使用方式

```powershell
powershell -ExecutionPolicy Bypass -File scripts/invoke-dev-workspace.ps1 -Task check
powershell -ExecutionPolicy Bypass -File scripts/invoke-dev-workspace.ps1 -Task native
powershell -ExecutionPolicy Bypass -File scripts/invoke-dev-workspace.ps1 -Task full
```

脚本只在当前进程中设置 `TEMP`、`TMP`、`npm_config_cache` 和 `CARGO_TARGET_DIR`，不会永久修改 Windows 的全局环境变量。`desktop-build` 与 `full` 会先检查目标盘至少还有 12 GB 可用空间，避免再次把系统盘或数据盘写满。

## 可恢复性

开发数据目录中的 `cache`、`build` 和 `temp` 都可由依赖安装与构建重新生成；`artifacts/release-candidates` 应保留到对应 GitHub Release 发布并完成官方下载复验。源码恢复始终以 Git 仓库和 GitHub 远端为准，不能把缓存目录当作源码备份。
