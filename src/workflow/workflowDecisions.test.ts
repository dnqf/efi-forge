import { describe, expect, it } from "vitest";
import { artifactAfterMergePreferenceChange } from "./workflowDecisions";

describe("workflow decisions", () => {
  it("falls back from a stale merged artifact without changing unrelated sources", () => {
    expect(artifactAfterMergePreferenceChange("merged", true)).toBe("custom");
    expect(artifactAfterMergePreferenceChange("merged", false)).toBeNull();
    expect(artifactAfterMergePreferenceChange("generated", true)).toBe("generated");
  });
});
