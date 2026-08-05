import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PackageConsumerCheckError } from "../errors.js";

export interface ResolvedTarget {
  input: string;
  resolvedPath: string;
  kind: "directory" | "tarball";
}

export async function resolveTarget(input = ".", cwd = process.cwd()): Promise<ResolvedTarget> {
  const resolvedPath = resolve(cwd, input);
  let targetStat;
  try {
    targetStat = await stat(resolvedPath);
  } catch {
    throw new PackageConsumerCheckError("INVALID_TARGET", `Target does not exist: ${resolvedPath}`);
  }
  if (targetStat.isDirectory()) return { input, resolvedPath, kind: "directory" };
  if (targetStat.isFile() && resolvedPath.toLowerCase().endsWith(".tgz")) {
    return { input, resolvedPath, kind: "tarball" };
  }
  throw new PackageConsumerCheckError(
    "INVALID_TARGET",
    `Target must be a package directory or .tgz file: ${resolvedPath}`,
  );
}
