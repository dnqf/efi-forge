# Windows 候选版本发布流程

EFI Forge 的公开安装包必须可追溯、可复现检查，并明确区分“未签名候选”与“正式发布”。

## 1. 合并前

确认 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和界面版本一致。运行 CI 中的全部前端、目录导入器和 Rust 检查；涉及组件锁或原生扫描器时还要执行五项 `--ignored` 真实下载/组装/WMI 测试。

## 2. 构建候选

在 GitHub Actions 手动运行 `Release candidate`。工作流从干净 checkout 重新运行版本同步检查、前端测试、完整 npm 依赖审计、格式、Clippy、Rust 与真实锁定组件组装测试，再构建 Windows x64 NSIS。所有外部 Actions 固定到经过核对的完整 commit SHA，Rust 固定为 1.98.0，并由 Dependabot 提醒维护者审查更新。工作流将版本、提交 SHA、文件名、大小、安装包哈希、签名状态和验证范围写入 `RELEASE-METADATA.txt`，同时生成 `SHA256SUMS.txt`，并上传保留 14 天的 Actions Artifact。

该工作流故意不会创建 GitHub Release，也不会自动声明安装包已签名。维护者必须下载候选、核对哈希并完成 Windows Defender、安装、启动和卸载冒烟测试。

## 3. 正式发布

1. 更新 README 中的版本、下载链接和 SHA-256。
2. 创建与应用版本一致的 tag。
3. 上传已人工验收的 NSIS 和 `SHA256SUMS.txt`。
4. Release 正文写明签名状态、已验证范围、已知限制，以及社区索引仍属于 discovery-only。
5. 从全新浏览器会话测试 GitHub 官方资产链接；不要发布第三方 GitHub 加速站链接。

## 4. 回滚

发现安全或数据风险时，撤下受影响资产、在 Release 与安全公告中说明影响范围，并从已知安全提交重新构建。不要覆盖同一 tag 下的文件后沿用旧哈希。
