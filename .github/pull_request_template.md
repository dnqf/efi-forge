## 变更目的

请说明本次修改解决的单一问题，以及没有扩大的范围。

## 验证

- [ ] `npm test`
- [ ] `npm run test:catalog`
- [ ] `npm run build`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`

## 安全与兼容性声明

- [ ] 未提交 SMBIOS、MLB、ROM、SystemUUID、序列号、凭据或未脱敏日志。
- [ ] 未把社区索引、静态检查或 `ocvalidate` 表述为真机兼容证明。
- [ ] 信息不足只产生警告；结构损坏或数据破坏风险才会停止。
- [ ] 若改变规则、锁文件或自动配置范围，已增加固定硬件样本和失败路径测试。
