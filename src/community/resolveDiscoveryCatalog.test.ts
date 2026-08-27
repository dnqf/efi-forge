import { describe, expect, it } from "vitest";
import { dalianskyCatalog } from "../data/dalianskyCatalog";
import { hardwareFixtures } from "../data/hardwareFixtures";
import { compatibilityRules } from "../data/rules";
import { sampleHardware } from "../data/sampleHardware";
import type { HardwareReport } from "../domain/types";
import { createBuildPlan } from "../engine/createBuildPlan";
import { evaluateCompatibility } from "../engine/evaluateCompatibility";
import { resolveDiscoveryCatalog } from "./resolveDiscoveryCatalog";

const thinkPadT480 = hardwareFixtures.find((fixture) => fixture.id === "thinkpad-t480-20l5")!.report;

function machine(model: string, manufacturer = "LENOVO", kind: "desktop" | "laptop" = "laptop"): HardwareReport {
  return {
    ...thinkPadT480,
    system: {
      ...thinkPadT480.system,
      kind,
      manufacturer,
      productName: model,
      machineType: undefined,
    },
    board: {
      ...thinkPadT480.board,
      vendor: manufacturer,
      model,
    },
  };
}

describe("daliansky discovery snapshot", () => {
  it("keeps a fixed, not-declared-license discovery snapshot internally consistent", () => {
    expect(dalianskyCatalog.schemaVersion).toBe(1);
    expect(dalianskyCatalog.source.repository).toBe("https://github.com/daliansky/Hackintosh");
    expect(dalianskyCatalog.source.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(dalianskyCatalog.source.licenseStatus).toBe("not-declared");
    expect(dalianskyCatalog.source.trust).toBe("discovery-only");
    expect(dalianskyCatalog.stats.entries).toBe(dalianskyCatalog.entries.length);
    expect(dalianskyCatalog.stats.laptopEntries).toBeGreaterThan(0);
    expect(dalianskyCatalog.stats.desktopEntries).toBeGreaterThan(0);
    expect(dalianskyCatalog.stats.repositories).toBeGreaterThan(0);
    expect(new Set(dalianskyCatalog.entries.map((entry) => entry.id)).size).toBe(dalianskyCatalog.entries.length);
    expect(dalianskyCatalog.entries.every((entry) => entry.repositories.length > 0)).toBe(true);
    expect(dalianskyCatalog.entries.flatMap((entry) => entry.repositories).every((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url))).toBe(true);
    expect(dalianskyCatalog.entries.flatMap((entry) => entry.guides).every((url) => /^https:\/\/github\.com\/[^?#]+$/.test(url))).toBe(true);
    expect(dalianskyCatalog.entries.every((entry) => entry.note.length <= 120)).toBe(true);
    expect(dalianskyCatalog.entries.every((entry) => !/(?:\.exe|powershell|cmd\.exe|<script)/i.test(entry.note))).toBe(true);
  });

  it.each([
    "ThinkPad T490",
    "ThinkPad E480",
    "ThinkPad L490",
    "ThinkPad P51",
    "ThinkPad X260",
  ])("finds a bounded strong candidate for %s", (model) => {
    const matches = resolveDiscoveryCatalog(machine(model), dalianskyCatalog, 5);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches.some((match) => match.confidence === "strong-clue")).toBe(true);
  });

  it("supports the same discovery layer for a Dell OptiPlex desktop", () => {
    const matches = resolveDiscoveryCatalog(
      machine("Dell OptiPlex 7050", "Dell Inc.", "desktop"),
      dalianskyCatalog,
    );
    expect(matches.some((match) => match.entry.model === "Dell OptiPlex 7050")).toBe(true);
    expect(matches.find((match) => match.entry.model === "Dell OptiPlex 7050")?.confidence).toBe("strong-clue");
  });

  it("finds T480 without confusing the adjacent T480s model", () => {
    const matches = resolveDiscoveryCatalog(thinkPadT480, dalianskyCatalog, 12);
    expect(matches.some((match) => match.entry.model === "ThinkPad T480")).toBe(true);
    expect(matches.some((match) => match.entry.model === "ThinkPad T480s")).toBe(false);
    expect(matches.find((match) => match.entry.model === "ThinkPad T480")?.confidence).toBe("strong-clue");
  });

  it("provides desktop board clues but never labels them as verified EFI", () => {
    const matches = resolveDiscoveryCatalog(sampleHardware, dalianskyCatalog);
    expect(matches.some((match) => match.entry.model.toUpperCase().includes("Z490"))).toBe(true);
    expect(matches.every((match) => match.confidence === "possible-clue")).toBe(true);
    expect(matches.every((match) => match.reasons.some((reason) => reason.includes("未经")))).toBe(true);
  });

  it("returns no misleading result for an unknown model", () => {
    const unknown: HardwareReport = {
      ...thinkPadT480,
      system: { ...thinkPadT480.system, productName: "ThinkPad Mystery 900", machineType: "ZZZZ" },
      board: { ...thinkPadT480.board, model: "ZZZZ" },
    };
    expect(resolveDiscoveryCatalog(unknown, dalianskyCatalog)).toEqual([]);
  });

  it("does not mutate compatibility permissions or the build plan", () => {
    const report = evaluateCompatibility(sampleHardware, "14", compatibilityRules);
    const plan = createBuildPlan(sampleHardware, report);
    const before = JSON.stringify({ report, plan });
    resolveDiscoveryCatalog(sampleHardware, dalianskyCatalog);
    expect(JSON.stringify({ report, plan })).toBe(before);
  });
});
