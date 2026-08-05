import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsumerCheck } from "../types.js";
import { processDetails, runProcess } from "../process/run-process.js";

export async function runCommonJsCheck(
  consumerDirectory: string,
  packageName: string,
  timeoutMs: number,
): Promise<ConsumerCheck> {
  const path = join(consumerDirectory, "consumer-commonjs.cjs");
  await writeFile(
    path,
    `const imported = require(${JSON.stringify(packageName)});\nif (imported === undefined) throw new Error("Package require returned undefined");\n`,
  );
  const result = await runProcess(process.execPath, [path], { cwd: consumerDirectory, timeoutMs });
  const passed = result.exitCode === 0 && !result.timedOut;
  return {
    id: "commonjs-require",
    status: passed ? "passed" : "failed",
    summary: passed
      ? "Root CommonJS require succeeded"
      : result.timedOut
        ? "Root CommonJS require timed out"
        : "Root CommonJS require failed",
    durationMs: result.durationMs,
    details: processDetails(result),
    ...(passed
      ? {}
      : {
          diagnostics: [
            {
              code: result.timedOut ? "TIMEOUT" : "CONSUMER_CHECK_FAILED",
              message: result.stderr.trim() || "The installed package could not be required",
              severity: "error" as const,
              source: "CommonJS consumer",
            },
          ],
        }),
  };
}
