import { access } from "node:fs/promises";
import { join } from "node:path";
import type { PackageMetadata } from "../types.js";
import { readPackageMetadata, validatePackageIdentity } from "./package-metadata.js";

export function installedPackagePath(consumerDirectory: string, packageName: string): string {
  return join(consumerDirectory, "node_modules", ...packageName.split("/"));
}

export async function discoverInstalledPackage(
  consumerDirectory: string,
  expected?: { name: string; version: string },
): Promise<{ path: string; metadata: PackageMetadata; name: string; version: string }> {
  let name = expected?.name;
  if (name === undefined) {
    const consumer = await readPackageMetadata(join(consumerDirectory, "package.json"));
    const dependencies = consumer.dependencies;
    if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      throw new Error("npm did not record the installed tarball dependency");
    }
    const names = Object.keys(dependencies);
    if (names.length !== 1 || names[0] === undefined) {
      throw new Error("Unable to identify exactly one installed tarball dependency");
    }
    name = names[0];
  }
  const path = installedPackagePath(consumerDirectory, name);
  await access(path);
  const metadata = await readPackageMetadata(join(path, "package.json"));
  const identity = validatePackageIdentity(metadata);
  return { path, metadata, ...identity };
}
