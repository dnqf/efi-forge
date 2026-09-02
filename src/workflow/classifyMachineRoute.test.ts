import { describe, expect, it } from "vitest";
import { sampleHardware } from "../data/sampleHardware";
import { classifyMachineRoute } from "./classifyMachineRoute";

describe("machine strategy routing", () => {
  it("keeps common retail desktop on the DIY route", () => {
    expect(classifyMachineRoute(sampleHardware).id).toBe("diy-desktop");
  });

  it.each([
    ["ThinkPad T480", "intel", "thinkpad"],
    ["Dell OptiPlex 7060", "intel", "oem-desktop"],
    ["Intel NUC10i7FNH", "intel", "mini-pc"],
    ["Generic Laptop", "amd", "amd-laptop"],
  ] as const)("routes %s through %s evidence as %s", (productName, cpuVendor, expected) => {
    const report = {
      ...sampleHardware,
      system: {
        ...sampleHardware.system,
        kind: productName.includes("Laptop") || productName.includes("ThinkPad") ? "laptop" as const : "desktop" as const,
        manufacturer: productName.split(" ")[0],
        productName,
      },
      cpu: { ...sampleHardware.cpu, vendor: cpuVendor },
    };
    expect(classifyMachineRoute(report).id).toBe(expected);
  });
});
