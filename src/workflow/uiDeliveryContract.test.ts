import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("code-side UI delivery contract", () => {
  it("retains narrow viewport and reduced-motion contracts without a browser-only dependency", () => {
    expect(stylesSource).toMatch(/@media \(max-width: 780px\)/);
    expect(stylesSource).toMatch(/@media \(max-width: 480px\)/);
    expect(stylesSource).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
