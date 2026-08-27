# 安全策略

## 支持范围

| 版本 | 安全修复 |
| --- | --- |
| `main` / 当前 Alpha | 支持 |
| 最新 GitHub Release | 支持 |
| 更早版本 | 仅在仍可复现时评估 |

当前 Alpha 会从固定上游地址下载锁定组件，但不请求管理员权限、不格式化磁盘、不创建分区，只能向空目录复制。下载内容必须同时通过固定大小与 SHA-256 校验。

## 私密报告

请使用 GitHub 的 [Private vulnerability reporting](https://github.com/dnqf/efi-forge/security/advisories/new) 提交组件供应链、路径逃逸、符号链接/重解析点绕过、非空目录覆盖、任意命令执行或隐私泄露问题。请附最小复现和受影响版本，不要公开发布利用细节。

请不要在公开 Issue 中提交未脱敏的 EFI、SMBIOS、MLB、ROM、SystemUUID、完整 ACPI 转储、磁盘/设备序列号或含用户名的日志。项目不会索取真实 Apple 身份字段。

## 不属于安全证明的检查

- 社区索引命中不代表仓库内容安全。
- EFI 结构检查和 `ocvalidate` 不代表真机可启动。
- 用户回传证据是绑定到具体硬件、BIOS 和 config 哈希的观察记录，不自动成为官方推荐。
