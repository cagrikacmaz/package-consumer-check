import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProcessResult } from "../../src/process/run-process.js";

const runNpmMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/process/run-process.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/process/run-process.js")>();
  return { ...original, runNpm: runNpmMock };
});

import { packDirectory } from "../../src/core/pack.js";
import { installTarball } from "../../src/core/install.js";

const owned: string[] = [];
afterEach(async () => {
  runNpmMock.mockReset();
  await Promise.all(owned.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pcc-mocked-npm-"));
  owned.push(path);
  return path;
}

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    command: "npm",
    args: [],
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 10,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

describe("pack failure classification", () => {
  it("reports a missing npm executable", async () => {
    runNpmMock.mockResolvedValue(undefined);
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "NPM_NOT_FOUND" }],
    });
  });

  it("reports npm pack failures", async () => {
    runNpmMock.mockResolvedValue(processResult({ exitCode: 1, stderr: "pack broke" }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "PACK_FAILED", message: "pack broke" }],
    });
  });

  it("classifies a Unix-style spawn ENOENT as npm missing", async () => {
    runNpmMock.mockResolvedValue(
      processResult({ exitCode: null, errorCode: "ENOENT", errorMessage: "spawn npm ENOENT" }),
    );
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check).toMatchObject({
      summary: "npm could not be located",
      diagnostics: [{ code: "NPM_NOT_FOUND" }],
    });
  });

  it("reports npm pack timeouts", async () => {
    runNpmMock.mockResolvedValue(processResult({ exitCode: null, timedOut: true }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, true)).check).toMatchObject({
      summary: "npm pack timed out",
      diagnostics: [{ code: "TIMEOUT" }],
    });
  });

  it("rejects malformed npm JSON", async () => {
    runNpmMock.mockResolvedValue(processResult({ stdout: "not-json" }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check).toMatchObject({
      diagnostics: [{ code: "PACK_OUTPUT_INVALID" }],
    });
  });

  it("rejects ambiguous npm JSON", async () => {
    runNpmMock.mockResolvedValue(processResult({ stdout: "[]" }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check.summary).toContain("ambiguous");
  });

  it("rejects a pack record without a filename", async () => {
    runNpmMock.mockResolvedValue(processResult({ stdout: "[{}]" }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check.summary).toContain("identify");
  });

  it("rejects a reported tarball that is absent", async () => {
    runNpmMock.mockResolvedValue(processResult({ stdout: '[{"filename":"missing.tgz"}]' }));
    const path = await temporaryDirectory();
    expect((await packDirectory(path, path, 1000, false)).check.summary).toContain(
      "does not exist",
    );
  });

  it("returns parsed package size details", async () => {
    const path = await temporaryDirectory();
    await writeFile(join(path, "fixture.tgz"), "packed");
    runNpmMock.mockResolvedValue(
      processResult({
        stdout:
          '[{"filename":"fixture.tgz","size":6,"unpackedSize":10,"files":[{"path":"index.js"}]}]',
      }),
    );
    const packed = await packDirectory(path, path, 1000, false);
    expect(packed.check).toMatchObject({
      status: "passed",
      details: { size: 6, unpackedSize: 10, fileCount: 1 },
    });
    expect(packed.tarballPath).toBe(join(path, "fixture.tgz"));
  });
});

describe("install failure classification", () => {
  it("reports a missing npm executable", async () => {
    runNpmMock.mockResolvedValue(undefined);
    const path = await temporaryDirectory();
    expect(await installTarball("fixture.tgz", path, 1000, false)).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "NPM_NOT_FOUND" }],
    });
  });

  it("reports npm install failures", async () => {
    runNpmMock.mockResolvedValue(processResult({ exitCode: 1, stderr: "install broke" }));
    const path = await temporaryDirectory();
    expect(await installTarball("fixture.tgz", path, 1000, false)).toMatchObject({
      status: "failed",
      diagnostics: [{ code: "INSTALL_FAILED", message: "install broke" }],
    });
  });

  it("classifies install spawn ENOENT as npm missing", async () => {
    runNpmMock.mockResolvedValue(
      processResult({ exitCode: null, errorCode: "ENOENT", errorMessage: "spawn npm ENOENT" }),
    );
    const path = await temporaryDirectory();
    expect(await installTarball("fixture.tgz", path, 1000, false)).toMatchObject({
      summary: "npm could not be located",
      diagnostics: [{ code: "NPM_NOT_FOUND" }],
    });
  });

  it("reports npm install timeouts", async () => {
    runNpmMock.mockResolvedValue(processResult({ exitCode: null, timedOut: true }));
    const path = await temporaryDirectory();
    expect(await installTarball("fixture.tgz", path, 1000, true)).toMatchObject({
      summary: "npm install timed out",
      diagnostics: [{ code: "TIMEOUT" }],
    });
  });

  it("reports a successful installation", async () => {
    runNpmMock.mockResolvedValue(processResult({ stdout: "added 1 package" }));
    const path = await temporaryDirectory();
    const check = await installTarball("fixture.tgz", path, 1000, false);
    expect(check.status).toBe("passed");
    expect(check.summary).toContain("clean consumer");
  });
});
