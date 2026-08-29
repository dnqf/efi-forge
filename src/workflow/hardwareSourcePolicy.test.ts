import { describe, expect, it } from "vitest";
import { canBuildFromHardwareSource } from "./hardwareSourcePolicy";

describe("hardware source policy", () => {
  it("only allows reports tied to the user's machine into the build workflow", () => {
    expect(canBuildFromHardwareSource("native")).toBe(true);
    expect(canBuildFromHardwareSource("imported")).toBe(true);
    expect(canBuildFromHardwareSource("demo")).toBe(false);
    expect(canBuildFromHardwareSource("fixture")).toBe(false);
  });
});
