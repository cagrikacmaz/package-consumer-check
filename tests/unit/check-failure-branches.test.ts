import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommonJsCheck } from "../../src/checks/commonjs-check.js";
import { runCliCheck } from "../../src/checks/cli-check.js";
import * as publicApi from "../../src/index.js";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pcc-check-branch-"));
  owned.push(path);
  return path;
}

describe("consumer failure branches", () => {
  it("exposes the deliberate public API", () => {
    expect(publicApi.checkPackageConsumer).toBeTypeOf("function");
    expect(publicApi.PackageConsumerCheckError).toBeTypeOf("function");
  });

  it("reports a CommonJS resolution failure", async () => {
    const path = await workspace();
    const check = await runCommonJsCheck(path, "package-that-is-not-installed", 2000);
    expect(check).toMatchObject({ status: "failed", id: "commonjs-require" });
  });

  it("rejects a bin target outside the installed package", async () => {
    const consumer = await workspace();
    const packageDirectory = join(consumer, "node_modules", "fixture");
    await mkdir(packageDirectory, { recursive: true });
    const check = await runCliCheck(
      consumer,
      packageDirectory,
      { fixture: "../../../outside.js" },
      1000,
      ["--help"],
      [0],
    );
    expect(check.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CLI_TARGET_OUTSIDE_PACKAGE" }),
    );
  });

  it("rejects a non-Node bin target", async () => {
    const consumer = await workspace();
    const packageDirectory = join(consumer, "node_modules", "fixture");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "native.exe"), "not a Node script");
    const check = await runCliCheck(
      consumer,
      packageDirectory,
      { fixture: "./native.exe" },
      1000,
      ["--help"],
      [0],
    );
    expect(check.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CLI_TARGET_UNSUPPORTED" }),
    );
  });

  it("accepts an extensionless Node shebang script", async () => {
    const consumer = await workspace();
    const packageDirectory = join(consumer, "node_modules", "fixture");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(packageDirectory, "cli"), "#!/usr/bin/env node\nprocess.exitCode = 0;\n");
    const check = await runCliCheck(
      consumer,
      packageDirectory,
      { fixture: "./cli" },
      1000,
      ["--help"],
      [0],
    );
    expect(check.status).toBe("passed");
  });
});
