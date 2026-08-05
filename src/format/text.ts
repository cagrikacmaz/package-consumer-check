import type { ConsumerCheckResult } from "../types.js";

export function formatTextResult(result: ConsumerCheckResult): string {
  const lines = [
    "package-consumer-check 0.1.0",
    "",
    `Target: ${result.target.packageName === undefined ? result.target.resolvedPath : `${result.target.packageName}@${result.target.version ?? "unknown"}`}`,
    "",
  ];
  for (const check of result.checks) {
    const label = check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : "SKIP";
    lines.push(`${label.padEnd(5)} ${check.id.padEnd(18)} ${check.summary}`.trimEnd());
    for (const diagnostic of check.diagnostics ?? []) {
      lines.push(`      ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  const passed = result.checks.filter((check) => check.status === "passed").length;
  const failed = result.checks.filter((check) => check.status === "failed").length;
  const skipped = result.checks.filter((check) => check.status === "skipped").length;
  lines.push("", `${passed} passed, ${failed} failed, ${skipped} skipped`);
  for (const warning of result.warnings) lines.push(`WARN  ${warning}`);
  if (result.temporaryDirectory !== undefined) {
    lines.push(`Temporary consumer preserved at: ${result.temporaryDirectory}`);
  }
  return `${lines.join("\n")}\n`;
}
