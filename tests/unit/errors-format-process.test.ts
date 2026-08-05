import { access, rm, unlink } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { asPackageConsumerCheckError, PackageConsumerCheckError } from "../../src/errors.js";
import { formatJsonResult } from "../../src/format/json.js";
import { formatTextResult } from "../../src/format/text.js";
import { runProcess } from "../../src/process/run-process.js";
import { cleanupOwnedWorkspaces } from "../../src/core/cleanup.js";
import {
  createOwnedWorkspace,
  OWNERSHIP_FILE,
  ownsWorkspace,
} from "../../src/core/temp-workspace.js";
import { join } from "node:path";
import type { ConsumerCheckResult } from "../../src/types.js";

const sample: ConsumerCheckResult = {
  schemaVersion: 1,
  target: {
    input: ".",
    resolvedPath: "/project",
    kind: "directory",
    packageName: "sample",
    version: "1.0.0",
  },
  passed: true,
  checks: [
    { id: "pack", status: "passed", summary: "Packed", durationMs: 2 },
    {
      id: "typescript",
      status: "skipped",
      summary: "No types",
      reason: "No types",
      durationMs: 0,
    },
  ],
  warnings: ["Ambiguous metadata"],
};

describe("errors", () => {
  it("serializes typed errors", () => {
    const error = new PackageConsumerCheckError("INVALID_TARGET", "bad target", { path: "x" });
    expect(error.toJSON()).toEqual({
      name: "PackageConsumerCheckError",
      code: "INVALID_TARGET",
      message: "bad target",
      details: { path: "x" },
    });
  });

  it("preserves typed errors", () => {
    const error = new PackageConsumerCheckError("TIMEOUT", "late");
    expect(asPackageConsumerCheckError(error)).toBe(error);
  });

  it("normalizes ordinary errors", () => {
    expect(asPackageConsumerCheckError(new Error("boom"))).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "boom",
    });
  });

  it("normalizes non-error throws", () => {
    expect(asPackageConsumerCheckError("boom").message).toBe("boom");
  });
});

describe("formatters", () => {
  it("formats one valid JSON document", () => {
    expect(JSON.parse(formatJsonResult(sample))).toEqual(sample);
  });

  it("formats pass and skip states", () => {
    const text = formatTextResult(sample);
    expect(text).toContain("PASS  pack");
    expect(text).toContain("SKIP  typescript");
    expect(text).toContain("1 passed, 0 failed, 1 skipped");
  });

  it("includes warnings", () => {
    expect(formatTextResult(sample)).toContain("WARN  Ambiguous metadata");
  });

  it("includes preserved temporary paths", () => {
    expect(formatTextResult({ ...sample, temporaryDirectory: "C:\\temp\\consumer" })).toContain(
      "Temporary consumer preserved",
    );
  });

  it("formats diagnostic messages", () => {
    const result: ConsumerCheckResult = {
      ...sample,
      passed: false,
      checks: [
        {
          id: "install",
          status: "failed",
          summary: "Failed",
          durationMs: 1,
          diagnostics: [{ code: "INSTALL_FAILED", message: "npm failed", severity: "error" }],
        },
      ],
    };
    expect(formatTextResult(result)).toContain("INSTALL_FAILED: npm failed");
  });
});

describe("process runner", () => {
  it("captures stdout and an exit code", async () => {
    const result = await runProcess(process.execPath, ["-e", "console.log('hello')"], {
      cwd: process.cwd(),
      timeoutMs: 2_000,
    });
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.stdout.trim()).toBe("hello");
  });

  it("captures stderr and a failing exit code", async () => {
    const result = await runProcess(
      process.execPath,
      ["-e", "console.error('bad'); process.exit(4)"],
      { cwd: process.cwd(), timeoutMs: 2_000 },
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr.trim()).toBe("bad");
  });

  it("classifies timeouts", async () => {
    const result = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      cwd: process.cwd(),
      timeoutMs: 50,
    });
    expect(result.timedOut).toBe(true);
  });

  it("bounds subprocess output", async () => {
    const result = await runProcess(process.execPath, ["-e", "process.stdout.write('abcdef')"], {
      cwd: process.cwd(),
      timeoutMs: 2_000,
      maxOutputBytes: 3,
    });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout).toContain("abc");
    expect(result.stdout).toContain("truncated");
  });
});

describe("owned workspace cleanup", () => {
  it("recognizes its ownership marker", async () => {
    const workspace = await createOwnedWorkspace("consumer");
    expect(await ownsWorkspace(workspace)).toBe(true);
    await cleanupOwnedWorkspaces({ consumerWorkspace: workspace, keepTemp: false });
  });

  it("removes an owned consumer", async () => {
    const workspace = await createOwnedWorkspace("consumer");
    const check = await cleanupOwnedWorkspaces({ consumerWorkspace: workspace, keepTemp: false });
    expect(check.status).toBe("passed");
    await expect(access(workspace.path)).rejects.toThrow();
  });

  it("preserves a consumer when requested", async () => {
    const workspace = await createOwnedWorkspace("consumer");
    const check = await cleanupOwnedWorkspaces({ consumerWorkspace: workspace, keepTemp: true });
    expect(check.details?.preserved).toContain(workspace.path);
    await access(workspace.path);
    await cleanupOwnedWorkspaces({ consumerWorkspace: workspace, keepTemp: false });
  });

  it("always removes pack workspaces", async () => {
    const workspace = await createOwnedWorkspace("pack");
    await cleanupOwnedWorkspaces({ packWorkspace: workspace, keepTemp: true });
    await expect(access(workspace.path)).rejects.toThrow();
  });

  it("refuses a workspace with a missing ownership marker", async () => {
    const workspace = await createOwnedWorkspace("consumer");
    await unlink(join(workspace.path, OWNERSHIP_FILE));
    const check = await cleanupOwnedWorkspaces({ consumerWorkspace: workspace, keepTemp: false });
    expect(check.status).toBe("failed");
    await rm(workspace.path, { recursive: true, force: true });
  });
});
