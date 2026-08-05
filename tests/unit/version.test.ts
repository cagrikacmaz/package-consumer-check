import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../src/version.js";

describe("package version", () => {
  it("matches the root package metadata", async () => {
    const packageJson = fileURLToPath(new URL("../../package.json", import.meta.url));
    const metadata: unknown = JSON.parse(await readFile(packageJson, "utf8"));
    expect(metadata).toMatchObject({ version: PACKAGE_VERSION });
  });
});
