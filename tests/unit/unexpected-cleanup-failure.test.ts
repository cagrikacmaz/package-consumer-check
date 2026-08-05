import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const workspaceState = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("../../src/core/temp-workspace.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/temp-workspace.js")>();
  return {
    ...original,
    createOwnedWorkspace: async (purpose: "pack" | "consumer") => {
      const workspace = await original.createOwnedWorkspace(purpose);
      workspaceState.paths.push(workspace.path);
      return workspace;
    },
  };
});

vi.mock("../../src/checks/esm-check.js", () => ({
  runEsmCheck: vi.fn().mockRejectedValue(new Error("simulated execution failure")),
}));

vi.mock("../../src/core/cleanup.js", () => ({
  cleanupOwnedWorkspaces: vi.fn().mockResolvedValue({
    id: "cleanup",
    status: "failed",
    summary: "simulated cleanup failure",
    durationMs: 0,
    diagnostics: [{ code: "CLEANUP_FAILED", message: "could not remove", severity: "error" }],
  }),
}));

import { checkPackageConsumer } from "../../src/core/check-package-consumer.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

afterEach(async () => {
  await Promise.all(
    workspaceState.paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("combined execution and cleanup failures", () => {
  it("reports both errors in an AggregateError", async () => {
    try {
      await checkPackageConsumer(join(fixtures, "dual-good"), { timeoutMs: 15_000 });
      throw new Error("Expected the consumer check to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      const errors = error instanceof AggregateError ? error.errors : [];
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatchObject({ message: "simulated execution failure" });
      expect(errors[1]).toMatchObject({ code: "CLEANUP_FAILED" });
    }
  });
});
