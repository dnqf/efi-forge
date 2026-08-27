import { describe, expect, it } from "vitest";
import type { HardwareReport } from "../domain/types";
import { sampleHardware } from "../data/sampleHardware";
import { assessThinkPad } from "./assessThinkPad";
import { thinkPadCatalog } from "./catalog";

function thinkPad(overrides: Partial<HardwareReport> = {}): HardwareReport {
  return {
    ...sampleHardware,
    ...overrides,
    system: {
      kind: "laptop",
      firmware: "uefi",
      secureBoot: false,
      manufacturer: "LENOVO",
      productName: "ThinkPad T480",
      machineType: "20L5",
      ...overrides.system,
    },
    cpu: {
      ...sampleHardware.cpu,
      name: "Intel Core i5-8350U",
      generation: "coffee-lake",
      cores: 4,
      threads: 8,
      ...overrides.cpu,
    },
    board: { ...sampleHardware.board, vendor: "LENOVO", model: "20L5", ...overrides.board },
    gpus: overrides.gpus ?? [
      { id: "gpu-0", name: "Intel UHD Graphics 620", vendorId: "8086", deviceId: "5917" },
    ],
  };
}

describe("ThinkPad model routing", () => {
  it("prefers an exact Lenovo machine type over a family name", () => {
    const result = assessThinkPad(thinkPad(), "14");
    expect(result).toMatchObject({ match: "machine-type", tier: "guided-candidate" });
    expect(result?.profile?.id).toBe("coffee-80");
  });

  it("keeps the T480 seventh-generation variant visible", () => {
    const result = assessThinkPad(
      thinkPad({ cpu: { ...sampleHardware.cpu, name: "Intel Core i5-7200U", generation: "kaby-lake" } }),
      "14",
    );
    expect(result?.checks.find((check) => check.id === "cpu")?.status).toBe("passed");
  });

  it("routes an unknown ThinkPad without blocking user imports", () => {
    const result = assessThinkPad(
      thinkPad({
        system: {
          kind: "laptop",
          firmware: "uefi",
          secureBoot: false,
          manufacturer: "LENOVO",
          productName: "ThinkPad Mystery 900",
          machineType: undefined,
        },
      }),
      "15",
    );
    expect(result).toMatchObject({ match: "family-only", tier: "research-only" });
    expect(result?.route).toContain("用户可导入");
  });

  it("flags discrete graphics and known risky ThinkPad storage", () => {
    const result = assessThinkPad(
      thinkPad({
        gpus: [
          { id: "gpu-0", name: "Intel UHD Graphics 620", vendorId: "8086", deviceId: "5917" },
          { id: "gpu-1", name: "NVIDIA GeForce MX150", vendorId: "10DE", deviceId: "1D10" },
        ],
        storage: [
          { id: "storage-0", name: "Samsung PM981 NVMe", vendorId: "144D", deviceId: "A808" },
        ],
      }),
      "14",
    );
    expect(result?.checks.find((check) => check.id === "graphics")?.status).toBe("warning");
    expect(result?.checks.find((check) => check.id === "storage")?.status).toBe("warning");
  });

  it("does not treat Tiger Lake or AMD ThinkPads as automatic candidates", () => {
    expect(
      assessThinkPad(
        thinkPad({ cpu: { ...sampleHardware.cpu, name: "Intel Core i7-1165G7", generation: "tiger-lake" } }),
        "15",
      )?.tier,
    ).toBe("unsupported-generation");
    expect(
      assessThinkPad(
        thinkPad({
          cpu: { ...sampleHardware.cpu, vendor: "amd", name: "AMD Ryzen 7 PRO 4750U", generation: "zen-2" },
        }),
        "15",
      )?.tier,
    ).toBe("unsupported-generation");
  });

  it("ignores non-ThinkPad machines", () => {
    expect(assessThinkPad(sampleHardware, "14")).toBeNull();
  });
});

describe("ThinkPad catalog integrity", () => {
  it("keeps ids and machine types unique and sources HTTPS-only", () => {
    expect(new Set(thinkPadCatalog.map((profile) => profile.id)).size).toBe(thinkPadCatalog.length);
    const machineTypes = thinkPadCatalog.flatMap((profile) => profile.machineTypes);
    expect(new Set(machineTypes).size).toBe(machineTypes.length);
    expect(
      thinkPadCatalog.flatMap((profile) => profile.sources).every((source) => source.url.startsWith("https://")),
    ).toBe(true);
  });
});
