import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConsumerCheck } from "../types.js";
import { processDetails, runNpm } from "../process/run-process.js";

export async function installTarball(
  tarballPath: string,
  consumerDirectory: string,
  timeoutMs: number,
  allowScripts: boolean,
): Promise<ConsumerCheck> {
  await writeFile(
    join(consumerDirectory, "package.json"),
    `${JSON.stringify({ name: "package-consumer-check-temp-consumer", private: true, version: "0.0.0" }, null, 2)}\n`,
    "utf8",
  );
  const args = [
    "install",
    tarballPath,
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--save-exact",
  ];
  if (!allowScripts) args.push("--ignore-scripts");
  const result = await runNpm(args, { cwd: consumerDirectory, timeoutMs });
  if (result === undefined) {
    return {
      id: "install",
      status: "failed",
      summary: "npm could not be located",
      durationMs: 0,
      diagnostics: [
        { code: "NPM_NOT_FOUND", message: "Unable to locate the npm CLI", severity: "error" },
      ],
    };
  }
  if (result.errorCode === "ENOENT" || result.exitCode !== 0 || result.timedOut) {
    const npmMissing = result.errorCode === "ENOENT";
    return {
      id: "install",
      status: "failed",
      summary: npmMissing
        ? "npm could not be located"
        : result.timedOut
          ? "npm install timed out"
          : "Tarball installation failed",
      durationMs: result.durationMs,
      details: processDetails(result),
      diagnostics: [
        {
          code: npmMissing ? "NPM_NOT_FOUND" : result.timedOut ? "TIMEOUT" : "INSTALL_FAILED",
          message:
            result.stderr.trim() || result.errorMessage || "npm install exited unsuccessfully",
          severity: "error",
          source: "npm install",
        },
      ],
    };
  }
  return {
    id: "install",
    status: "passed",
    summary: "Installed the packed package into a clean consumer",
    durationMs: result.durationMs,
    details: processDetails(result),
  };
}
