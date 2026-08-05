import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { checkPackageConsumer } from "./core/check-package-consumer.js";
import { asPackageConsumerCheckError } from "./errors.js";
import { formatJsonResult } from "./format/json.js";
import { formatTextResult } from "./format/text.js";
import { parseCliArgs } from "./cli-options.js";
import { PACKAGE_VERSION } from "./version.js";

export const HELP = `package-consumer-check ${PACKAGE_VERSION}

Test a packed npm package from clean ESM, CommonJS, TypeScript, and CLI consumers.

Usage:
  package-consumer-check [target] [options]

Target:
  A local npm package directory or local .tgz tarball. Default: .

Options:
  --format <text|json>              Output format; default text
  --timeout <milliseconds>          Per-process timeout; default 10000
  --keep-temp                       Preserve the temporary consumer directory
  --allow-scripts                   Permit npm lifecycle scripts during pack/install
  --require-types                   Fail if type declarations are not advertised
  --skip-esm                        Skip the ESM import check
  --skip-cjs                        Skip the CommonJS require check
  --skip-types                      Skip the TypeScript declaration check
  --skip-cli                        Skip installed CLI execution
  --cli-arg <value>                 CLI argument; repeatable; default --help
  --accepted-cli-exit-code <number> Accepted CLI exit code (0-255); repeatable; default 0
  --help                            Show help
  --version                         Show version

Safety:
  Only test packages you trust. Importing, requiring or running a package executes its code.
  This tool is not a sandbox. Lifecycle scripts are suppressed unless --allow-scripts is used.
`;

export async function runCli(args: string[]): Promise<number> {
  let format: "text" | "json" = "text";
  try {
    const parsed = parseCliArgs(args);
    format = parsed.format;
    if (parsed.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (parsed.version) {
      process.stdout.write(`${PACKAGE_VERSION}\n`);
      return 0;
    }
    const result = await checkPackageConsumer(parsed.target, parsed.checkOptions);
    process.stdout.write(format === "json" ? formatJsonResult(result) : formatTextResult(result));
    return result.passed ? 0 : 1;
  } catch (error) {
    const normalized = asPackageConsumerCheckError(error);
    if (
      format === "json" ||
      (args.includes("--format") && args[args.indexOf("--format") + 1] === "json")
    ) {
      process.stdout.write(`${JSON.stringify({ error: normalized.toJSON() }, null, 2)}\n`);
    } else {
      process.stderr.write(`package-consumer-check: ${normalized.message}\n`);
    }
    return 2;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
