import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsumerCheck } from "../types.js";
import { processDetails, runProcess } from "../process/run-process.js";

export async function runEsmCheck(
  consumerDirectory: string,
  packageName: string,
  timeoutMs: number,
): Promise<ConsumerCheck> {
  const path = join(consumerDirectory, "consumer-esm.mjs");
  await writeFile(
    path,
    `const imported = await import(${JSON.stringify(packageName)});\nif (imported === undefined) throw new Error("Package import returned undefined");\n`,
  );
  const result = await runProcess(process.execPath, [path], { cwd: consumerDirectory, timeoutMs });
  const passed = result.exitCode === 0 && !result.timedOut;
  return {
    id: "esm-import",
    status: passed ? "passed" : "failed",
    summary: passed
      ? "Root ESM import succeeded"
      : result.timedOut
        ? "Root ESM import timed out"
        : "Root ESM import failed",
    durationMs: result.durationMs,
    details: processDetails(result),
    ...(passed
      ? {}
      : {
          diagnostics: [
            {
              code: result.timedOut ? "TIMEOUT" : "CONSUMER_CHECK_FAILED",
              message: result.stderr.trim() || "The installed package could not be imported",
              severity: "error" as const,
              source: "ESM consumer",
            },
          ],
        }),
  };
}
