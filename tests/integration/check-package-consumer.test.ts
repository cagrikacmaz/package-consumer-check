import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPackageConsumer } from "../../src/core/check-package-consumer.js";
import { packDirectory } from "../../src/core/pack.js";
import { cleanupOwnedWorkspaces } from "../../src/core/cleanup.js";
import { createOwnedWorkspace } from "../../src/core/temp-workspace.js";
import { runCli } from "../../src/cli.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));
const externallyOwned: string[] = [];
const options = { timeoutMs: 15_000 } as const;

afterEach(async () => {
  await Promise.all(
    externallyOwned.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function fixture(name: string): string {
  return join(fixtures, name);
}

function status(result: Awaited<ReturnType<typeof checkPackageConsumer>>, id: string): string {
  return result.checks.find((check) => check.id === id)?.status ?? "missing";
}

describe("real package consumer checks", () => {
  it("packs, installs, and checks a dual package", async () => {
    const result = await checkPackageConsumer(fixture("dual-good"), options);
    expect(result.passed).toBe(true);
    expect(result.target).toMatchObject({ packageName: "fixture-dual-good", version: "1.2.3" });
    expect(result.checks.map((check) => check.id)).toEqual([
      "target-metadata",
      "pack",
      "install",
      "installed-metadata",
      "esm-import",
      "commonjs-require",
      "typescript",
      "cli",
      "cleanup",
    ]);
    expect(result.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("skips CommonJS for an ESM-only package", async () => {
    const result = await checkPackageConsumer(fixture("esm-only-good"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "esm-import")).toBe("passed");
    expect(status(result, "commonjs-require")).toBe("skipped");
  });

  it("skips ESM for a CommonJS-only package", async () => {
    const result = await checkPackageConsumer(fixture("cjs-only-good"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "esm-import")).toBe("skipped");
    expect(status(result, "commonjs-require")).toBe("passed");
  });

  it("fails broken declarations", async () => {
    const result = await checkPackageConsumer(fixture("types-broken"), options);
    expect(result.passed).toBe(false);
    expect(status(result, "typescript")).toBe("failed");
    expect(
      result.checks.find((check) => check.id === "typescript")?.diagnostics?.[0]?.code,
    ).toMatch(/^TS/);
    expect(
      result.checks.find((check) => check.id === "typescript")?.diagnostics?.[0]?.source,
    ).toMatch(/^<temporary-consumer>\//);
  });

  it("fails a missing packed root export", async () => {
    const result = await checkPackageConsumer(fixture("missing-export-file"), options);
    expect(result.passed).toBe(false);
    expect(status(result, "esm-import")).toBe("failed");
  });

  it("fails a missing bin target", async () => {
    const result = await checkPackageConsumer(fixture("missing-bin-file"), options);
    expect(result.passed).toBe(false);
    expect(status(result, "cli")).toBe("failed");
    expect(result.checks.find((check) => check.id === "cli")?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CLI_TARGET_MISSING" }),
    );
  });

  it("returns a structured failure and cleans up for a directory bin target", async () => {
    const result = await checkPackageConsumer(fixture("bin-target-directory"), options);
    expect(result.passed).toBe(false);
    expect(status(result, "cli")).toBe("failed");
    expect(result.checks.find((check) => check.id === "cli")?.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CLI_TARGET_NOT_FILE" }),
    );
    const cleanup = result.checks.find((check) => check.id === "cleanup");
    expect(cleanup?.status).toBe("passed");
    const removedPaths = Array.isArray(cleanup?.details?.removed)
      ? cleanup.details.removed.filter((value): value is string => typeof value === "string")
      : [];
    expect(removedPaths).toHaveLength(2);
    for (const path of removedPaths) await expect(access(path)).rejects.toThrow();

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await runCli([fixture("bin-target-directory"), "--format", "json"])).toBe(1);
    } finally {
      stdout.mockRestore();
    }
  });

  it("passes a subpath-only package with root checks skipped", async () => {
    const result = await checkPackageConsumer(fixture("subpath-only"), options);
    expect(result.passed).toBe(true);
    expect([
      status(result, "esm-import"),
      status(result, "commonjs-require"),
      status(result, "typescript"),
    ]).toEqual(["skipped", "skipped", "skipped"]);
    expect(result.checks.find((check) => check.id === "esm-import")?.reason).toBe(
      "Package does not export a root entry point",
    );
    expect(status(result, "cleanup")).toBe("passed");
  });

  it("passes a package whose root export is null", async () => {
    const result = await checkPackageConsumer(fixture("exports-null"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "esm-import")).toBe("skipped");
    expect(status(result, "commonjs-require")).toBe("skipped");
  });

  it("imports and requires a cjs root under type module", async () => {
    const result = await checkPackageConsumer(fixture("type-module-cjs-root"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "esm-import")).toBe("passed");
    expect(status(result, "commonjs-require")).toBe("passed");
  });

  it("imports and requires a legacy CommonJS root", async () => {
    const result = await checkPackageConsumer(fixture("legacy-cjs-root"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "esm-import")).toBe("passed");
    expect(status(result, "commonjs-require")).toBe("passed");
  });

  it("accepts Node globals in advertised declarations", async () => {
    const result = await checkPackageConsumer(fixture("node-types-good"), options);
    expect(result.passed).toBe(true);
    expect(status(result, "typescript")).toBe("passed");
    expect(result.checks.find((check) => check.id === "typescript")?.details).toMatchObject({
      typeBaseline: "@types/node",
    });
  });

  it("resolves and imports a scoped package", async () => {
    const result = await checkPackageConsumer(fixture("scoped-dual-good"), options);
    expect(result.passed).toBe(true);
    expect(result.target.packageName).toBe("@consumer-check/fixture-scoped-dual");
    expect(status(result, "esm-import")).toBe("passed");
    expect(status(result, "commonjs-require")).toBe("passed");
  });

  it("executes every declared binary", async () => {
    const result = await checkPackageConsumer(fixture("multiple-bins"), options);
    expect(result.passed).toBe(true);
    const children = result.checks.find((check) => check.id === "cli")?.details?.children;
    expect(children).toHaveLength(2);
  });

  it("supports accepted CLI exit-code overrides", async () => {
    const failed = await checkPackageConsumer(fixture("cli-failing"), options);
    const accepted = await checkPackageConsumer(fixture("cli-failing"), {
      ...options,
      acceptedCliExitCodes: [7],
    });
    expect(status(failed, "cli")).toBe("failed");
    expect(status(accepted, "cli")).toBe("passed");
  });

  it("fails when declarations are required but absent", async () => {
    const result = await checkPackageConsumer(fixture("cjs-only-good"), {
      ...options,
      requireTypes: true,
    });
    expect(status(result, "typescript")).toBe("failed");
  });

  it("honors explicit skip overrides", async () => {
    const result = await checkPackageConsumer(fixture("dual-good"), {
      ...options,
      skipEsm: true,
      skipCommonJs: true,
      skipTypes: true,
      skipCli: true,
    });
    expect(result.passed).toBe(true);
    expect(result.checks.slice(4, 8).every((check) => check.status === "skipped")).toBe(true);
  });

  it("preserves a requested consumer workspace", async () => {
    const result = await checkPackageConsumer(fixture("dual-good"), {
      ...options,
      keepTemp: true,
    });
    expect(result.temporaryDirectory).toBeDefined();
    const temporaryDirectory = result.temporaryDirectory as string;
    externallyOwned.push(temporaryDirectory);
    await access(temporaryDirectory);
    expect(result.checks.at(-1)).toMatchObject({ id: "cleanup", status: "passed" });
  });

  it("accepts a user-supplied tarball and skips packing", async () => {
    const packWorkspace = await createOwnedWorkspace("pack");
    try {
      const packed = await packDirectory(
        fixture("dual-good"),
        packWorkspace.path,
        options.timeoutMs,
        false,
      );
      if (packed.tarballPath === undefined)
        throw new Error("Fixture packing did not produce a tarball");
      const result = await checkPackageConsumer(packed.tarballPath, options);
      expect(result.passed).toBe(true);
      expect(status(result, "target-metadata")).toBe("skipped");
      expect(status(result, "pack")).toBe("skipped");
      expect(result.target.packageName).toBe("fixture-dual-good");
    } finally {
      await cleanupOwnedWorkspaces({ packWorkspace, keepTemp: false });
    }
  });

  it("handles source paths containing spaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "pcc path with spaces "));
    externallyOwned.push(root);
    const copied = join(root, "dual package");
    await cp(fixture("dual-good"), copied, { recursive: true });
    const result = await checkPackageConsumer(copied, options);
    expect(result.passed).toBe(true);
  });

  it("handles source paths containing Turkish Unicode characters", async () => {
    const root = await mkdtemp(join(tmpdir(), "pcc-unicode-"));
    externallyOwned.push(root);
    const copied = join(root, "Çağrı paket");
    await cp(fixture("dual-good"), copied, { recursive: true });
    const result = await checkPackageConsumer(copied, options);
    expect(result.passed).toBe(true);
    expect(status(result, "pack")).toBe("passed");
    expect(status(result, "install")).toBe("passed");
    expect(status(result, "cleanup")).toBe("passed");
  });
});
