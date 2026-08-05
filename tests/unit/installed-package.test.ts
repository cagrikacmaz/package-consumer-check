import { describe, expect, it } from "vitest";
import { installedPackagePath } from "../../src/core/installed-package.js";

describe("installedPackagePath", () => {
  it("resolves an unscoped package", () => {
    expect(installedPackagePath("C:\\consumer", "tool")).toContain("node_modules");
    expect(installedPackagePath("C:\\consumer", "tool")).toMatch(/tool$/);
  });

  it("resolves a scoped package into nested directories", () => {
    const path = installedPackagePath("C:\\consumer", "@scope/tool");
    expect(path).toContain("@scope");
    expect(path).toMatch(/tool$/);
  });
});
