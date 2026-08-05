import { access, rm } from "node:fs/promises";
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
  runEsmCheck: vi.fn().mockRejectedValue(new Error("simulated internal check failure")),
}));

import { checkPackageConsumer } from "../../src/core/check-package-consumer.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

afterEach(async () => {
  await Promise.all(
    workspaceState.paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("unexpected execution cleanup", () => {
  it("removes every owned workspace before rethrowing the original error", async () => {
    await expect(
      checkPackageConsumer(join(fixtures, "dual-good"), { timeoutMs: 15_000 }),
    ).rejects.toThrow("simulated internal check failure");
    expect(workspaceState.paths).toHaveLength(2);
    for (const path of workspaceState.paths) await expect(access(path)).rejects.toThrow();
  });
});
