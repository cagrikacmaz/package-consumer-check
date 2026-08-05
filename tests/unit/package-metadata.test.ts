import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeBins,
  readPackageMetadata,
  validatePackageIdentity,
} from "../../src/core/package-metadata.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

describe("package metadata", () => {
  it("reads package JSON", async () => {
    const metadata = await readPackageMetadata(join(fixtures, "dual-good", "package.json"));
    expect(metadata.name).toBe("fixture-dual-good");
  });

  it("reports missing package JSON", async () => {
    await expect(readPackageMetadata(join(fixtures, "none.json"))).rejects.toMatchObject({
      code: "PACKAGE_JSON_NOT_FOUND",
    });
  });

  it("reports invalid package JSON", async () => {
    await expect(
      readPackageMetadata(join(fixtures, "invalid-package-json", "package.json")),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE_JSON" });
  });

  it("validates identity", () => {
    expect(validatePackageIdentity({ name: "thing", version: "1.0.0" })).toEqual({
      name: "thing",
      version: "1.0.0",
    });
  });

  it("rejects a missing name", () => {
    expect(() => validatePackageIdentity({ version: "1.0.0" })).toThrow("requires a name");
  });

  it("rejects a missing version", () => {
    expect(() => validatePackageIdentity({ name: "thing" })).toThrow("requires a version");
  });

  it("normalizes a string bin using the package name", () => {
    expect(normalizeBins({ name: "tool", bin: "cli.js" })).toEqual({ tool: "cli.js" });
  });

  it("normalizes a scoped string bin using its unscoped portion", () => {
    expect(normalizeBins({ name: "@scope/tool", bin: "cli.js" })).toEqual({ tool: "cli.js" });
  });

  it("filters invalid object bin values", () => {
    expect(normalizeBins({ bin: { good: "cli.js", bad: 42, empty: "" } })).toEqual({
      good: "cli.js",
    });
  });

  it("returns no bins for invalid metadata", () => {
    expect(normalizeBins({ bin: ["cli.js"] })).toEqual({});
  });
});
