export type OperationFailureKind =
  | "network"
  | "integrity"
  | "structure"
  | "destination"
  | "permission"
  | "unknown";

export interface OperationFailureAdvice {
  kind: OperationFailureKind;
  label: string;
  nextAction: string;
}

const rules: ReadonlyArray<{
  kind: OperationFailureKind;
  label: string;
  nextAction: string;
  patterns: RegExp;
}> = [
  {
    kind: "integrity",
    label: "组件完整性失败",
    nextAction: "不要绕过校验。确认系统时间正确后重试；持续失败时导出构建清单并向项目反馈组件名称。",
    patterns: /sha-?256|哈希|锁定清单|远程文件大小|完整性/i,
  },
  {
    kind: "network",
    label: "组件下载未完成",
    nextAction: "已验证缓存会优先复用。检查系统时间、代理、防火墙与 GitHub 连接后重试，不要使用来历不明的镜像替换组件。",
    patterns: /下载|network|dns|tls|certificate|connect|timeout|timed out|http status/i,
  },
  {
    kind: "destination",
    label: "目标位置不安全",
    nextAction: "改选一个空目录或已挂载的独立 FAT32 EFI 分区；不要选择源 EFI、自身子目录或含有现有文件的位置。",
    patterns: /不是空目录|目标目录|保存位置|互相包含|复制已停止|fat32|保留设备名|重解析点|符号链接/i,
  },
  {
    kind: "structure",
    label: "EFI 结构未通过",
    nextAction: "返回组装页查看缺失文件与 config.plist 引用；修复结构后重新校验，不要直接复制到启动分区。",
    patterns: /config\.plist|ocvalidate|efi 结构|结构校验|kext|driver|acpi|引用/i,
  },
  {
    kind: "permission",
    label: "文件访问失败",
    nextAction: "关闭占用该目录的程序，确认当前账户可读写，然后改选用户文档或独立测试盘中的新目录。",
    patterns: /拒绝访问|access.*denied|permission|无法创建|无法写入|无法读取/i,
  },
];

export function adviseOperationFailure(error: unknown): OperationFailureAdvice {
  const message = error instanceof Error ? error.message : String(error);
  const matched = rules.find((rule) => rule.patterns.test(message));
  return matched ?? {
    kind: "unknown",
    label: "操作未完成",
    nextAction: "保留当前源文件，重新执行一次；若仍失败，请连同完整错误和脱敏硬件报告一起反馈。",
  };
}

export function formatOperationFailure(context: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const advice = adviseOperationFailure(error);
  return `${context}：${message}\n${advice.label} · ${advice.nextAction}`;
}
