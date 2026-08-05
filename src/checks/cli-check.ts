import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ConsumerCheck, ConsumerDiagnostic } from "../types.js";
import { processDetails, runProcess } from "../process/run-process.js";

const SHEBANG_PREFIX_BYTES = 1024;

function isWithin(parent: string, child: string): boolean {
  const local = relative(parent, child);
  return local === "" || (!local.startsWith("..") && !isAbsolute(local));
}

async function hasNodeShebang(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SHEBANG_PREFIX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8");
    const firstLineEnd = prefix.indexOf("\n");
    const firstLine = firstLineEnd === -1 ? prefix : prefix.slice(0, firstLineEnd);
    return firstLine.startsWith("#!") && /\bnode\b/.test(firstLine);
  } finally {
    await handle.close();
  }
}

async function isSupportedNodeScript(path: string): Promise<boolean> {
  if ([".js", ".cjs", ".mjs"].includes(extname(path).toLowerCase())) return true;
  if (extname(path) !== "") return false;
  return await hasNodeShebang(path);
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
  const installedPackageRealPath = await realpath(installedPackageDirectory);
  let executedCount = 0;
  let unsupportedCount = 0;

  for (const [name, target] of Object.entries(bins)) {
    const scriptPath = resolve(installedPackageDirectory, target);
    if (!isWithin(installedPackageDirectory, scriptPath)) {
      diagnostics.push({
        code: "CLI_TARGET_OUTSIDE_PACKAGE",
        message: `Binary ${name} resolves outside the installed package: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }

    let targetStat;
    try {
      targetStat = await stat(scriptPath);
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      diagnostics.push({
        code: missing ? "CLI_TARGET_MISSING" : "CLI_TARGET_UNREADABLE",
        message: missing
          ? `Binary ${name} points to a missing file: ${target}`
          : `Binary ${name} could not be inspected: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }
    if (!targetStat.isFile()) {
      diagnostics.push({
        code: "CLI_TARGET_NOT_FILE",
        message: `Binary ${name} does not point to a regular file: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }

    let scriptRealPath: string;
    try {
      scriptRealPath = await realpath(scriptPath);
    } catch {
      diagnostics.push({
        code: "CLI_TARGET_UNREADABLE",
        message: `Binary ${name} could not be resolved to a real file: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }
    if (!isWithin(installedPackageRealPath, scriptRealPath)) {
      diagnostics.push({
        code: "CLI_TARGET_OUTSIDE_PACKAGE",
        message: `Binary ${name} resolves outside the installed package through a symbolic link: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }

    let supported: boolean;
    try {
      supported = await isSupportedNodeScript(scriptRealPath);
    } catch {
      diagnostics.push({
        code: "CLI_TARGET_UNREADABLE",
        message: `Binary ${name} could not be read: ${target}`,
        severity: "error",
        source: name,
      });
      children.push({ name, target, status: "failed" });
      continue;
    }
    if (!supported) {
      unsupportedCount += 1;
      diagnostics.push({
        code: "CLI_TARGET_UNSUPPORTED",
        message: `Binary ${name} is not a Node.js script supported by this tool: ${target}`,
        severity: "warning",
        source: name,
      });
      children.push({
        name,
        target,
        status: "skipped",
        reason: "Only Node.js CLI scripts are executed in v0.1",
      });
      continue;
    }

    executedCount += 1;
    const result = await runProcess(process.execPath, [scriptRealPath, ...cliArgs], {
      cwd: consumerDirectory,
      timeoutMs,
    });
    const childPassed =
      !result.timedOut && result.exitCode !== null && acceptedExitCodes.includes(result.exitCode);
    children.push({
      name,
      target,
      status: childPassed ? "passed" : "failed",
      ...processDetails(result),
    });
    if (!childPassed) {
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

  const failed = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const durationMs = Math.round(performance.now() - started);
  const details = { arguments: cliArgs, acceptedExitCodes, children };
  if (!failed && executedCount === 0 && unsupportedCount > 0) {
    const reason = "No declared CLI binaries are supported Node.js scripts";
    return {
      id: "cli",
      status: "skipped",
      summary: reason,
      reason,
      durationMs,
      details,
      diagnostics,
    };
  }
  return {
    id: "cli",
    status: failed ? "failed" : "passed",
    summary: failed
      ? "One or more installed CLI binaries failed validation"
      : `Executed ${executedCount} installed CLI ${executedCount === 1 ? "binary" : "binaries"}${unsupportedCount > 0 ? `; skipped ${unsupportedCount} unsupported` : ""}`,
    durationMs,
    details,
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
}
