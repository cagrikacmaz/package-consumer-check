import { isAbsolute, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import type { ConsumerCheck } from "../types.js";
import { processDetails, runNpm } from "../process/run-process.js";

interface NpmPackEntry {
  filename?: unknown;
  size?: unknown;
  unpackedSize?: unknown;
  files?: unknown;
}

export interface PackResult {
  check: ConsumerCheck;
  tarballPath?: string;
}

export async function packDirectory(
  packageDirectory: string,
  packDestination: string,
  timeoutMs: number,
  allowScripts: boolean,
): Promise<PackResult> {
  const args = ["pack", "--json", "--pack-destination", packDestination];
  if (!allowScripts) args.push("--ignore-scripts");
  const result = await runNpm(args, { cwd: packageDirectory, timeoutMs });
  if (result === undefined) {
    return {
      check: {
        id: "pack",
        status: "failed",
        summary: "npm could not be located",
        durationMs: 0,
        diagnostics: [
          { code: "NPM_NOT_FOUND", message: "Unable to locate the npm CLI", severity: "error" },
        ],
      },
    };
  }
  if (result.exitCode !== 0 || result.timedOut) {
    return {
      check: {
        id: "pack",
        status: "failed",
        summary: result.timedOut ? "npm pack timed out" : "npm pack failed",
        durationMs: result.durationMs,
        details: processDetails(result),
        diagnostics: [
          {
            code: result.timedOut ? "TIMEOUT" : "PACK_FAILED",
            message:
              result.stderr.trim() || result.errorMessage || "npm pack exited unsuccessfully",
            severity: "error",
            source: "npm pack",
          },
        ],
      },
    };
  }

  let entries: NpmPackEntry[];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error();
    entries = parsed as NpmPackEntry[];
  } catch {
    return {
      check: {
        id: "pack",
        status: "failed",
        summary: "npm pack returned invalid or ambiguous JSON",
        durationMs: result.durationMs,
        details: processDetails(result),
        diagnostics: [
          {
            code: "PACK_OUTPUT_INVALID",
            message: "Expected npm pack --json to return exactly one package record",
            severity: "error",
            source: "npm pack",
          },
        ],
      },
    };
  }
  const entry = entries[0];
  if (entry === undefined || typeof entry.filename !== "string" || entry.filename === "") {
    return {
      check: {
        id: "pack",
        status: "failed",
        summary: "npm pack JSON did not identify a tarball",
        durationMs: result.durationMs,
        diagnostics: [
          {
            code: "PACK_OUTPUT_INVALID",
            message: "The pack result has no filename",
            severity: "error",
          },
        ],
      },
    };
  }
  const tarballPath = isAbsolute(entry.filename)
    ? resolve(entry.filename)
    : join(packDestination, entry.filename);
  try {
    await access(tarballPath);
  } catch {
    return {
      check: {
        id: "pack",
        status: "failed",
        summary: "npm pack reported a tarball that does not exist",
        durationMs: result.durationMs,
        diagnostics: [{ code: "PACK_OUTPUT_INVALID", message: tarballPath, severity: "error" }],
      },
    };
  }
  return {
    tarballPath,
    check: {
      id: "pack",
      status: "passed",
      summary: `Packed ${entry.filename}`,
      durationMs: result.durationMs,
      details: {
        filename: entry.filename,
        size: typeof entry.size === "number" ? entry.size : undefined,
        unpackedSize: typeof entry.unpackedSize === "number" ? entry.unpackedSize : undefined,
        fileCount: Array.isArray(entry.files) ? entry.files.length : undefined,
      },
    },
  };
}
