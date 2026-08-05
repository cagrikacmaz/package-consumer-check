import { access, readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ConsumerCheck, ConsumerDiagnostic } from "../types.js";
import { processDetails, runProcess } from "../process/run-process.js";

function isInside(parent: string, child: string): boolean {
  const local = relative(parent, child);
  return local !== "" && !local.startsWith("..") && !isAbsolute(local);
}

async function isNodeScript(path: string): Promise<boolean> {
  if ([".js", ".cjs", ".mjs"].includes(extname(path).toLowerCase())) return true;
  if (extname(path) !== "") return false;
  const source = await readFile(path, "utf8");
  return source.startsWith("#!") && /\bnode\b/.test(source.slice(0, source.indexOf("\n") + 1));
}

export async function runCliCheck(
  consumerDirectory: string,
  installedPackageDirectory: string,
  bins: Record<string, string>,
  timeoutMs: number,
  cliArgs: string[],
  acceptedExitCodes: number[],
): Promise<ConsumerCheck> {
  const started = performance.now();
  const diagnostics: ConsumerDiagnostic[] = [];
  const children: Record<string, unknown>[] = [];

  for (const [name, target] of Object.entries(bins)) {
    const scriptPath = resolve(installedPackageDirectory, target);
    if (!isInside(installedPackageDirectory, scriptPath)) {
      diagnostics.push({
        code: "CLI_TARGET_OUTSIDE_PACKAGE",
        message: `Binary ${name} resolves outside the installed package: ${target}`,
        severity: "error",
        source: name,
      });
      continue;
    }
    try {
      await access(scriptPath);
    } catch {
      diagnostics.push({
        code: "CLI_TARGET_MISSING",
        message: `Binary ${name} points to a missing file: ${target}`,
        severity: "error",
        source: name,
      });
      continue;
    }
    if (!(await isNodeScript(scriptPath))) {
      diagnostics.push({
        code: "CLI_TARGET_UNSUPPORTED",
        message: `Binary ${name} is not a supported Node.js script: ${target}`,
        severity: "error",
        source: name,
      });
      continue;
    }
    const result = await runProcess(process.execPath, [scriptPath, ...cliArgs], {
      cwd: consumerDirectory,
      timeoutMs,
    });
    children.push({ name, target, ...processDetails(result) });
    if (
      result.timedOut ||
      result.exitCode === null ||
      !acceptedExitCodes.includes(result.exitCode)
    ) {
      diagnostics.push({
        code: result.timedOut ? "TIMEOUT" : "CLI_EXIT_CODE",
        message: result.timedOut
          ? `Binary ${name} timed out`
          : `Binary ${name} exited with ${String(result.exitCode)}; accepted: ${acceptedExitCodes.join(", ")}`,
        severity: "error",
        source: name,
      });
    }
  }

  const passed = diagnostics.length === 0 && children.length === Object.keys(bins).length;
  return {
    id: "cli",
    status: passed ? "passed" : "failed",
    summary: passed
      ? `Executed ${children.length} installed CLI ${children.length === 1 ? "binary" : "binaries"}`
      : "One or more installed CLI binaries failed",
    durationMs: Math.round(performance.now() - started),
    details: { arguments: cliArgs, acceptedExitCodes, children },
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
}
