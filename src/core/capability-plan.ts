import { extname } from "node:path";
import type { PackageMetadata } from "../types.js";
import { normalizeBins } from "./package-metadata.js";

export interface CapabilityDecision {
  run: boolean;
  reason: string;
}

export interface CapabilityPlan {
  esm: CapabilityDecision;
  commonJs: CapabilityDecision;
  typescript: CapabilityDecision;
  cli: CapabilityDecision;
  bins: Record<string, string>;
  warnings: string[];
}

function rootExport(exportsField: unknown): unknown {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) return exportsField;
  if (exportsField === null || typeof exportsField !== "object") return undefined;
  const record = exportsField as Record<string, unknown>;
  return Object.hasOwn(record, ".") ? record["."] : exportsField;
}

function findCondition(value: unknown, condition: string): string | undefined {
  if (typeof value === "string") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCondition(item, condition);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record[condition] === "string") return record[condition];
  for (const nested of Object.values(record)) {
    const found = findCondition(nested, condition);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function planCapabilities(metadata: PackageMetadata): CapabilityPlan {
  const warnings: string[] = [];
  const root = rootExport(metadata.exports);
  const rootString = stringField(root);
  const importTarget = findCondition(root, "import");
  const requireTarget = findCondition(root, "require");
  const defaultTarget = findCondition(root, "default");
  const main = stringField(metadata.main);
  const moduleField = stringField(metadata.module);
  const type = stringField(metadata.type);
  const effective = rootString ?? defaultTarget ?? main;

  let esm: CapabilityDecision;
  let commonJs: CapabilityDecision;

  if (importTarget !== undefined) {
    esm = { run: true, reason: "Root exports declare an import condition" };
  } else if (
    moduleField !== undefined ||
    type === "module" ||
    extname(effective ?? "") === ".mjs"
  ) {
    esm = { run: true, reason: "Metadata declares an ES module entry point" };
  } else if (requireTarget !== undefined && defaultTarget === undefined) {
    esm = { run: false, reason: "Root exports declare only CommonJS compatibility" };
  } else if (effective !== undefined && extname(effective) === ".cjs") {
    esm = { run: false, reason: "The root entry point is explicitly CommonJS" };
  } else {
    esm = { run: true, reason: "Root import compatibility is plausible" };
    warnings.push("ESM support is ambiguous; the root import smoke test will run conservatively.");
  }

  if (requireTarget !== undefined) {
    commonJs = { run: true, reason: "Root exports declare a require condition" };
  } else if (importTarget !== undefined && defaultTarget === undefined) {
    commonJs = { run: false, reason: "Root exports declare only ESM import compatibility" };
  } else if (type === "module" || extname(effective ?? "") === ".mjs") {
    commonJs = { run: false, reason: "Metadata describes an ESM-only root entry point" };
  } else {
    commonJs = { run: true, reason: "Metadata permits CommonJS resolution" };
    if (effective === undefined) {
      warnings.push("CommonJS support is inferred from Node's default package entry behavior.");
    }
  }

  const declaredTypes =
    stringField(metadata.types) ?? stringField(metadata.typings) ?? findCondition(root, "types");
  const bins = normalizeBins(metadata);

  return {
    esm,
    commonJs,
    typescript:
      declaredTypes === undefined
        ? { run: false, reason: "Package does not declare type declarations" }
        : { run: true, reason: `Type declarations are advertised at ${declaredTypes}` },
    cli:
      Object.keys(bins).length === 0
        ? { run: false, reason: "Package does not declare a bin entry" }
        : { run: true, reason: `Package declares ${Object.keys(bins).length} binary entry` },
    bins,
    warnings,
  };
}
