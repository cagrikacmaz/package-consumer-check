import { rm } from "node:fs/promises";
import type { ConsumerCheck } from "../types.js";
import { ownsWorkspace, type OwnedWorkspace } from "./temp-workspace.js";

export interface CleanupInput {
  packWorkspace?: OwnedWorkspace;
  consumerWorkspace?: OwnedWorkspace;
  keepTemp: boolean;
}

export async function cleanupOwnedWorkspaces(input: CleanupInput): Promise<ConsumerCheck> {
  const started = performance.now();
  const removed: string[] = [];
  const preserved: string[] = [];
  const failures: string[] = [];

  for (const [purpose, workspace] of [
    ["pack", input.packWorkspace],
    ["consumer", input.consumerWorkspace],
  ] as const) {
    if (workspace === undefined) continue;
    if (purpose === "consumer" && input.keepTemp) {
      preserved.push(workspace.path);
      continue;
    }
    if (!(await ownsWorkspace(workspace))) {
      failures.push(`Refused to remove unowned workspace: ${workspace.path}`);
      continue;
    }
    try {
      await rm(workspace.path, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
      removed.push(workspace.path);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  const durationMs = Math.round(performance.now() - started);
  if (failures.length > 0) {
    return {
      id: "cleanup",
      status: "failed",
      summary: "Failed to clean one or more owned temporary resources",
      durationMs,
      details: { removed, preserved },
      diagnostics: failures.map((message) => ({
        code: "CLEANUP_FAILED",
        message,
        severity: "error" as const,
        source: "cleanup",
      })),
    };
  }
  return {
    id: "cleanup",
    status: "passed",
    summary: input.keepTemp
      ? "Removed generated pack artifacts and preserved the consumer workspace"
      : "Removed owned temporary resources",
    durationMs,
    details: { removed, preserved },
  };
}
