import type { ConsumerCheckOptions } from "./types.js";

export interface ParsedCliOptions {
  target: string;
  format: "text" | "json";
  help: boolean;
  version: boolean;
  checkOptions: ConsumerCheckOptions;
}

function nextValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined) throw new TypeError(`${option} requires a value`);
  return value;
}

function positiveInteger(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${option} requires a positive integer`);
  }
  return number;
}

function exitCode(value: string, option: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 255) {
    throw new TypeError(`${option} requires an integer from 0 to 255`);
  }
  return number;
}

export function parseCliArgs(args: string[]): ParsedCliOptions {
  let target = ".";
  let targetSeen = false;
  let format: "text" | "json" = "text";
  let help = false;
  let version = false;
  const checkOptions: ConsumerCheckOptions = {};
  const cliArgs: string[] = [];
  const acceptedCliExitCodes: number[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--format": {
        const value = nextValue(args, index, arg);
        if (value !== "text" && value !== "json") {
          throw new TypeError("--format must be text or json");
        }
        format = value;
        index += 1;
        break;
      }
      case "--timeout":
        checkOptions.timeoutMs = positiveInteger(nextValue(args, index, arg), arg);
        index += 1;
        break;
      case "--keep-temp":
        checkOptions.keepTemp = true;
        break;
      case "--allow-scripts":
        checkOptions.allowScripts = true;
        break;
      case "--require-types":
        checkOptions.requireTypes = true;
        break;
      case "--skip-esm":
        checkOptions.skipEsm = true;
        break;
      case "--skip-cjs":
        checkOptions.skipCommonJs = true;
        break;
      case "--skip-types":
        checkOptions.skipTypes = true;
        break;
      case "--skip-cli":
        checkOptions.skipCli = true;
        break;
      case "--cli-arg":
        cliArgs.push(nextValue(args, index, arg));
        index += 1;
        break;
      case "--accepted-cli-exit-code":
        acceptedCliExitCodes.push(exitCode(nextValue(args, index, arg), arg));
        index += 1;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      case "--version":
      case "-v":
        version = true;
        break;
      case "--": {
        const remaining = args.slice(index + 1);
        if (remaining.length !== 1 || targetSeen) {
          throw new TypeError("Expected exactly one target after --");
        }
        target = remaining[0] as string;
        targetSeen = true;
        index = args.length;
        break;
      }
      default:
        if (arg?.startsWith("-")) throw new TypeError(`Unknown option: ${arg}`);
        if (arg === undefined || targetSeen) throw new TypeError("Only one target may be provided");
        target = arg;
        targetSeen = true;
    }
  }
  if (cliArgs.length > 0) checkOptions.cliArgs = cliArgs;
  if (acceptedCliExitCodes.length > 0) {
    checkOptions.acceptedCliExitCodes = [...new Set(acceptedCliExitCodes)];
  }
  return { target, format, help, version, checkOptions };
}
