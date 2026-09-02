import { describe, expect, it } from "vitest";
import { adviseOperationFailure, formatOperationFailure } from "./operationFailure";

describe("operation failure guidance", () => {
  it.each([
    ["下载 OpenCore 失败（TLS handshake）", "network"],
    ["Lilu 的 SHA-256 与锁定清单不一致", "integrity"],
    ["config.plist 引用的 Driver 不存在", "structure"],
    ["目标目录不是空目录", "destination"],
    ["拒绝访问：无法写入文件", "permission"],
  ] as const)("classifies %s as %s", (message, kind) => {
    expect(adviseOperationFailure(new Error(message)).kind).toBe(kind);
  });

  it("keeps the original error and adds one actionable next step", () => {
    const formatted = formatOperationFailure("组件融合已停止", "unexpected failure");

    expect(formatted).toContain("unexpected failure");
    expect(formatted).toContain("重新执行一次");
  });
});
