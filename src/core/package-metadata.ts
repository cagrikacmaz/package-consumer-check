import { readFile } from "node:fs/promises";
import type { PackageMetadata } from "../types.js";
import { PackageConsumerCheckError } from "../errors.js";

export async function readPackageMetadata(path: string): Promise<PackageMetadata> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new PackageConsumerCheckError(
        "PACKAGE_JSON_NOT_FOUND",
        `package.json was not found at ${path}`,
      );
    }
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(source);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as PackageMetadata;
  } catch {
    throw new PackageConsumerCheckError(
      "INVALID_PACKAGE_JSON",
      `package.json at ${path} is not valid JSON object metadata`,
    );
  }
}

export function validatePackageIdentity(metadata: PackageMetadata): {
  name: string;
  version: string;
} {
  if (typeof metadata.name !== "string" || metadata.name.trim() === "") {
    throw new PackageConsumerCheckError("PACKAGE_NAME_MISSING", "package.json requires a name");
  }
  if (typeof metadata.version !== "string" || metadata.version.trim() === "") {
    throw new PackageConsumerCheckError(
      "PACKAGE_VERSION_MISSING",
      "package.json requires a version",
    );
  }
  return { name: metadata.name, version: metadata.version };
}

export function normalizeBins(metadata: PackageMetadata): Record<string, string> {
  if (typeof metadata.bin === "string") {
    return typeof metadata.name === "string" && metadata.name !== ""
      ? {
          [metadata.name.startsWith("@")
            ? (metadata.name.split("/")[1] ?? metadata.name)
            : metadata.name]: metadata.bin,
        }
      : {};
  }
  if (metadata.bin === null || typeof metadata.bin !== "object" || Array.isArray(metadata.bin))
    return {};
  return Object.fromEntries(
    Object.entries(metadata.bin).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
    ),
  );
}
