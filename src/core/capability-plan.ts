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

type RootExport =
  | { kind: "legacy" }
  | { kind: "unavailable"; reason: string }
  | { kind: "present"; value: unknown };

interface ResolvedTarget {
  target: string;
  explicitModeCondition: boolean;
}

function classifyRootExport(metadata: PackageMetadata): RootExport {
  if (!Object.hasOwn(metadata, "exports")) return { kind: "legacy" };
  const exportsField = metadata.exports;
  if (exportsField === null) {
    return { kind: "unavailable", reason: "Package does not export a root entry point" };
  }
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return { kind: "present", value: exportsField };
  }
  if (typeof exportsField !== "object") {
    return { kind: "unavailable", reason: "Package root exports metadata is unsupported" };
  }
  const record = exportsField as Record<string, unknown>;
  if (Object.hasOwn(record, ".")) {
    return record["."] === null
      ? { kind: "unavailable", reason: "Package does not export a root entry point" }
      : { kind: "present", value: record["."] };
  }
  if (Object.keys(record).some((key) => key.startsWith("."))) {
    return { kind: "unavailable", reason: "Package does not export a root entry point" };
  }
  return { kind: "present", value: exportsField };
}

function resolveConditionalTarget(
  value: unknown,
  mode: "import" | "require",
  explicitModeCondition = false,
): ResolvedTarget | undefined {
  if (typeof value === "string" && value !== "") {
    return { target: value, explicitModeCondition };
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveConditionalTarget(item, mode, explicitModeCondition);
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;

  const activeConditions = new Set(["node-addons", "node", mode, "default"]);
  for (const [condition, target] of Object.entries(value)) {
    if (condition.startsWith(".") || !activeConditions.has(condition)) continue;
    const resolved = resolveConditionalTarget(
      target,
      mode,
      explicitModeCondition || condition === mode,
    );
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

function findTypesTarget(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTypesTarget(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.types === "string" && record.types !== "") return record.types;
  for (const [condition, nested] of Object.entries(record)) {
    if (condition.startsWith(".")) continue;
    const found = findTypesTarget(nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function canRequireTarget(
  resolved: ResolvedTarget,
  packageType: string | undefined,
): CapabilityDecision {
  if (resolved.explicitModeCondition) {
    return { run: true, reason: "Root exports declare a require condition" };
  }
  const extension = extname(resolved.target).toLowerCase();
  if (extension === ".cjs") {
    return { run: true, reason: "The resolved root target is CommonJS" };
  }
  if (extension === ".mjs") {
    return { run: false, reason: "The resolved root target is an ES module" };
  }
  if (packageType === "module" && (extension === ".js" || extension === "")) {
    return { run: false, reason: "The resolved root target is an ES module" };
  }
  return { run: true, reason: "The resolved root target permits CommonJS require" };
}

export function planCapabilities(metadata: PackageMetadata): CapabilityPlan {
  const warnings: string[] = [];
  const root = classifyRootExport(metadata);
  const packageType = stringField(metadata.type);
  const moduleField = stringField(metadata.module);
  if (moduleField !== undefined) {
    warnings.push("The module field is not used for Node.js package-root resolution.");
  }

  let esm: CapabilityDecision;
  let commonJs: CapabilityDecision;
  let rootValue: unknown;

  if (root.kind === "unavailable") {
    esm = { run: false, reason: root.reason };
    commonJs = { run: false, reason: root.reason };
  } else {
    rootValue = root.kind === "legacy" ? (stringField(metadata.main) ?? "./index.js") : root.value;
    const importTarget = resolveConditionalTarget(rootValue, "import");
    const requireTarget = resolveConditionalTarget(rootValue, "require");
    esm =
      importTarget === undefined
        ? { run: false, reason: "Package root has no import-compatible export target" }
        : {
            run: true,
            reason: importTarget.explicitModeCondition
              ? "Root exports declare an import condition"
              : "Node.js can import the resolved root target",
          };
    commonJs =
      requireTarget === undefined
        ? { run: false, reason: "Package root has no require-compatible export target" }
        : canRequireTarget(requireTarget, packageType);
    if (root.kind === "legacy" && metadata.main === undefined) {
      warnings.push("Root support is inferred from Node.js legacy index resolution.");
    }
  }

  const declaredTypes =
    root.kind === "unavailable"
      ? undefined
      : (stringField(metadata.types) ??
        stringField(metadata.typings) ??
        findTypesTarget(rootValue));
  const typescript: CapabilityDecision =
    root.kind === "unavailable"
      ? { run: false, reason: root.reason }
      : declaredTypes === undefined
        ? { run: false, reason: "Package does not declare root type declarations" }
        : { run: true, reason: `Root type declarations are advertised at ${declaredTypes}` };
  const bins = normalizeBins(metadata);

  return {
    esm,
    commonJs,
    typescript,
    cli:
      Object.keys(bins).length === 0
        ? { run: false, reason: "Package does not declare a bin entry" }
        : { run: true, reason: `Package declares ${Object.keys(bins).length} binary entry` },
    bins,
    warnings,
  };
}
