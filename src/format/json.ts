import type { ConsumerCheckResult } from "../types.js";

export function formatJsonResult(result: ConsumerCheckResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
