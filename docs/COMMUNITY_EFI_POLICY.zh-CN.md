# 社区 EFI 整包接入规范

## 定位

社区整包用于补充笔记本、电池、触控板、USB 映射、特殊 ACPI 和冷门主板配置。它是构建输入之一，不是跳过验证的成品。

## 三种匹配结果

- 精确匹配：机型、CPU 平台、关键 PCI ID、BIOS 和目标 macOS 全部一致，且来源已经审核；允许自动采用。
- 近似匹配：机型相同但 BIOS、网卡、屏幕、触控板或其他关键设备不同；只展示参考，不自动写入。
- 不匹配：不参与当前机器的构建。

笔记本整包必须额外记录屏幕分辨率、触控板类型、无线网卡、独显状态、电池控制器和 BIOS 版本。

## 来源准入

来源必须满足：

1. 公开 GitHub 仓库。
2. 存在明确的开源许可证，且允许所需的使用和再分发；没有 LICENSE 的仓库默认拒绝。
3. 锁定完整 40 位 commit，而不是跟踪 `main` 或只保存分支链接。
4. README 明确标注电脑型号、主要硬件、BIOS、OpenCore 和 macOS 版本。
5. 不含安装器、闭源脚本或来源无法解释的可执行文件。
6. 通过人工审核和自动扫描后才可标为 `verified`。

GitHub 上的 ThinkPad T480 EFI 项目可以作为候选来源范例，但是否进入正式注册表仍需独立审核：<https://github.com/tetenc555/Opencore-ThinkPad-T480>

## 导入流水线

```text
GitHub URL
  → 解析仓库和 commit
  → 检查许可证
  → 下载源码归档
  → 拒绝路径穿越和可疑脚本
  → 读取 EFI 目录和 config.plist
  → 清除 SMBIOS / MLB / ROM / SystemUUID
  → 识别 OpenCore、Kext 和 Driver 版本
  → 用官方锁定版本替换核心二进制
  → 保留审核后的 ACPI、USB Map 和设备属性
  → 迁移到当前 Sample.plist
  → ocvalidate
  → 输出差异报告
  → 人工审核
  → 加入注册表
```

## 必须清除

- `SystemSerialNumber`
- `MLB`
- `SystemUUID`
- `ROM`
- OpenCore Debug 日志
- 用户名和本机路径
- NVRAM 导出
- 仓库作者的个人设备标识

## 二进制处理

- `BOOTx64.efi`、`OpenCore.efi`、`OpenRuntime.efi`：总是替换为项目锁定的官方版本。
- 常见 Kext：按名称映射到官方 Release，再下载和校验；不沿用整包二进制。
- SSDT/USB Map：保留前必须核对许可证、目标设备和 ACPI 特征。
- 未知 `.efi`、可执行文件或 Kext：默认隔离并要求人工审核。
- 仓库自带脚本：绝不自动执行。

## 更新与撤销

社区来源必须记录最后验证日期和已知问题。OpenCore、macOS 或 BIOS 版本变化后，该记录自动降为 `candidate`，重新验证前不能作为工具推荐或静默自动采用；用户仍可明确选择本地实验使用。上游删除许可证、出现恶意文件或身份泄漏时立即撤销。
