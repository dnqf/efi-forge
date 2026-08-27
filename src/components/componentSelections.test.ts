import { describe, expect, it } from "vitest";
import type { ComponentItem } from "../native/efiBuilder";
import {
  createComponentSelections,
  createDefaultComponentActions,
} from "./componentSelections";

function item(
  id: string,
  defaultAction: ComponentItem["defaultAction"],
): ComponentItem {
  return {
    id,
    name: `${id}.kext`,
    kind: "kext",
    identity: `com.example.${id}`,
    sha256: id.repeat(64).slice(0, 64),
    size: 1024,
    sourcePath: `${id}.kext`,
    targetPath: `EFI/OC/Kexts/${id}.kext`,
    comparison: "new",
    baseEnabled: false,
    dependencies: [],
    configPreview: [`Kernel/Add · BundlePath=${id}.kext`],
    defaultAction,
    allowedActions: [defaultAction, "skip"],
    warnings: [],
  };
}

describe("component selection helpers", () => {
  it("creates an explicit default decision for every scanned component", () => {
    const items = [item("a", "add-inactive"), item("b", "keep-base")];

    expect(createDefaultComponentActions(items)).toEqual({
      a: "add-inactive",
      b: "keep-base",
    });
  });

  it("uses user overrides while preserving defaults for untouched rows", () => {
    const items = [item("a", "add-inactive"), item("b", "keep-base")];

    expect(createComponentSelections(items, { a: "skip" })).toEqual([
      { itemId: "a", action: "skip" },
      { itemId: "b", action: "keep-base" },
    ]);
  });
});
