# 参与 EFI Forge

EFI Forge 接受规则、脱敏硬件样本、真机失败记录、界面和安全修复。项目当前是 Alpha；贡献目标是让结论更可审计，而不是扩大“已支持”数字。

## 开始前

1. Fork 仓库并从 `main` 创建单一目的分支。
2. 使用 Node.js 22、npm 与 stable Rust；Windows 原生构建还需要 WebView2 和 Visual Studio C++ Build Tools。
3. 运行 `npm ci`，不要手工改写锁文件。

## 必须保持的产品边界

- 信息不足或硬件风险只降低可信度并警告，不剥夺实验继续权。
- EFI 结构损坏、哈希不一致、路径逃逸、覆盖非空目录或数据破坏风险必须停止。
- 社区链接仅是候选发现线索，不能进入自动 BuildPlan，也不能写成“已适配”。
- `ocvalidate` 只证明配置结构，不证明 Picker、Recovery 或安装成功。
- 不提交通用 SMBIOS 身份，也不接收含 Serial、MLB、ROM、SystemUUID、个人路径或凭据的日志。

## 规则与硬件数据

每条兼容性规则需要稳定 ID、证据类型、来源、成熟度和至少一个固定样本。旧硬件或小众组合可以进入研究路径，但不得凭机型名称推断完整 EFI 可用。

社区索引更新必须使用本地 README、显式 40 位 revision，并同时运行：

```powershell
npm run test:catalog
```

## 提交前检查

```powershell
npm test
npm run test:catalog
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

涉及真实锁定组件时，再运行带 `--ignored` 的四项网络测试。Pull Request 中应说明未执行的检查及原因。

## 提交真机证据

优先使用应用中的“真机验证回传”导出 JSON。证据必须精确绑定硬件指纹、BIOS、目标 macOS、OpenCore 版本和 `config.plist` SHA-256。失败记录同样应提交；证据不会自动成为项目推荐。
