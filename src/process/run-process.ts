import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BoundedOutput, MAX_OUTPUT_BYTES } from "./bounded-output.js";

export interface ProcessResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  errorMessage?: string;
  errorCode?: string;
}

export interface RunProcessOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export async function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const started = performance.now();
  const stdout = new BoundedOutput(options.maxOutputBytes ?? MAX_OUTPUT_BYTES);
  const stderr = new BoundedOutput(options.maxOutputBytes ?? MAX_OUTPUT_BYTES);

  return await new Promise((resolve) => {
    let timedOut = false;
    let errorMessage: string | undefined;
    let errorCode: string | undefined;
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => stdout.append(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.append(chunk));
    child.on("error", (error) => {
      errorMessage = error.message;
      errorCode = (error as NodeJS.ErrnoException).code;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    timer.unref();
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args: [...args],
        exitCode,
        signal,
        timedOut,
        durationMs: Math.round(performance.now() - started),
        stdout: stdout.value,
        stderr: stderr.value,
        stdoutTruncated: stdout.truncated,
        stderrTruncated: stderr.truncated,
        ...(errorMessage === undefined ? {} : { errorMessage }),
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    });
  });
}

export interface NpmInvocation {
  command: string;
  prefixArgs: string[];
}

export async function resolveNpmInvocation(): Promise<NpmInvocation | undefined> {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath?.endsWith(".js")) {
    try {
      await access(npmExecPath);
      return { command: process.execPath, prefixArgs: [npmExecPath] };
    } catch {
      // Continue to stable installation paths.
    }
  }
  if (process.platform === "win32") {
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    try {
      await access(npmCli);
      return { command: process.execPath, prefixArgs: [npmCli] };
    } catch {
      return undefined;
    }
  }
  return { command: "npm", prefixArgs: [] };
}

export async function runNpm(
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult | undefined> {
  const invocation = await resolveNpmInvocation();
  if (invocation === undefined) return undefined;
  return await runProcess(invocation.command, [...invocation.prefixArgs, ...args], options);
}

export function processDetails(result: ProcessResult): Record<string, unknown> {
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
  };
}
