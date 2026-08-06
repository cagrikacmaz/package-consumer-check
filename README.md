# package-consumer-check

[![CI](https://github.com/cagrikacmaz/package-consumer-check/actions/workflows/ci.yml/badge.svg)](https://github.com/cagrikacmaz/package-consumer-check/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/package-consumer-check.svg)](https://www.npmjs.com/package/package-consumer-check)

Test a packed npm package from clean ESM, CommonJS, TypeScript, and CLI consumers before publishing.

`package-consumer-check` is a TypeScript library and CLI for exercising the artifact npm users
actually receive. It packs a local package (or accepts a `.tgz`), installs that tarball in a fresh
temporary project, and runs only the consumer checks supported by the installed metadata.

## Why this exists

Repository tests can pass while the published package is unusable. Build output may be absent from
the tarball, an export may point to a missing file, declarations may not resolve, or a `bin` target
may not start. The tarball is the product, so this tool tests the tarball.

Static package validators remain valuable. This tool complements them with dynamic smoke tests in a
real npm installation.

## Installation

Node.js 20 or newer and npm are required.

```bash
npm install --save-dev package-consumer-check
```

## Quick start

Build your package first, then check it:

```bash
npx package-consumer-check .
npx package-consumer-check ./packages/my-library
npx package-consumer-check ./my-library-1.2.3.tgz
```

`package-consumer-check` deliberately does not run the source package's build command. Missing build
artifacts should fail as they would for a consumer.

## What it checks

- Source metadata for directory targets
- `npm pack --json` output and the exact generated tarball
- Installation into a clean temporary npm project
- The installed package's real name and version
- Root ESM import when metadata supports it
- Root CommonJS `require` when metadata supports it
- Advertised declarations with TypeScript's local compiler API and NodeNext resolution
- Every declared Node.js `bin` target, using `--help` by default
- Removal of owned temporary resources and generated pack artifacts

Every check has a stable identifier and one of `passed`, `failed`, or `skipped`. A skip always includes
a reason; it is never counted as a pass.

## Example output

```text
package-consumer-check 0.1.0

Target: example-package@1.0.0

PASS  target-metadata    Read source metadata for example-package@1.0.0
PASS  pack               Packed example-package-1.0.0.tgz
PASS  install            Installed the packed package into a clean consumer
PASS  installed-metadata Verified installed metadata for example-package@1.0.0
PASS  esm-import         Root ESM import succeeded
SKIP  commonjs-require   Root exports declare only ESM import compatibility
PASS  typescript         Type declarations resolved in a TypeScript NodeNext consumer
SKIP  cli                Package does not declare a bin entry
PASS  cleanup            Removed owned temporary resources

6 passed, 0 failed, 3 skipped
```

## CLI usage

```text
package-consumer-check [target] [options]

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
--help
--version
```

Text is the default format. `--format json` writes one JSON document to stdout, including
`schemaVersion: 1`, stable check identifiers, bounded process output, and structured diagnostics.

## Library API

```ts
import { checkPackageConsumer } from "package-consumer-check";

const result = await checkPackageConsumer("./my-package", {
  timeoutMs: 10_000,
  keepTemp: false,
  allowScripts: false,
  requireTypes: false,
});

console.log(result.passed);
```

Public exports are `checkPackageConsumer`, `PackageConsumerCheckError`, `ConsumerCheckOptions`,
`ConsumerCheckResult`, `ConsumerCheck`, `ConsumerCheckId`, `ConsumerCheckStatus`, and
`ConsumerDiagnostic`. Library code does not print or exit the process, and results are JSON-safe.

## Automatic capability detection

The planner reads the installed package's Node-relevant `type`, `main`, `exports`, `types`, `typings`,
and `bin` fields. It understands root string exports and common `import`, `require`, `default`, and
`types` conditions, plus `.mjs`, `.cjs`, `.d.ts`, `.d.mts`, and `.d.cts` conventions. The bundler
convention `module` is observed only to explain that Node.js does not use it for package-root
resolution.

An `exports` map with subpaths but no `"."` does not export the package root. Root ESM, CommonJS, and
TypeScript checks are skipped in that case; v0.1 does not treat an intentionally subpath-only package
as broken.

The planner is intentionally conservative; it does not reproduce every Node.js export-resolution
rule. Ambiguous metadata generates a warning and a plausible smoke test. Explicit skip flags always
win. `--require-types` turns an absent declaration capability into a failure.

## Safety warning

> Only test packages you trust. Importing, requiring or running a package executes its code.

This tool is not a sandbox. ESM, CommonJS, and CLI checks execute installed package code with the
current user's permissions. Packing and installation pass `--ignore-scripts` by default. With current
npm behavior, this suppresses lifecycle scripts such as `prepack`, `prepare`, `postpack`, and install
hooks. `prepublishOnly` is a publish-only event and is not part of `npm pack`.

`--allow-scripts` removes the tool's `--ignore-scripts` flag and increases the execution surface; npm's
own version-specific script policy and configuration still apply. See npm's documentation for
[`npm pack`](https://docs.npmjs.com/cli/pack/),
[`npm install`](https://docs.npmjs.com/cli/install/), and
[lifecycle ordering](https://docs.npmjs.com/cli/using-npm/scripts/).

Subprocesses use argument arrays with shell execution disabled, enforce timeouts, and cap captured
stdout and stderr at 32 KiB each. Package code inherits the current process environment. Captured
output is bounded but not secret-redacted, so avoid testing untrusted code in an environment that
contains credentials it could read or print. No environment dump, npm credentials, or auth
configuration is added to results by the tool itself. A timeout terminates the direct child process;
termination of every descendant process cannot be guaranteed on every operating system.

## Exit codes

| Code | Meaning                                                    |
| ---: | ---------------------------------------------------------- |
|    0 | All applicable checks passed                               |
|    1 | One or more consumer checks failed                         |
|    2 | Invalid usage, invalid target, or internal execution error |

## CI example

Build before checking so the tarball reflects a release candidate:

```yaml
- run: npm ci
- run: npm run build
- run: npx package-consumer-check . --format text
```

No external registry lookup is needed for the target package. npm may still access registries to
resolve dependencies declared inside that package.

## Complementary tools

Static tools such as [publint](https://publint.dev/) and
[Are The Types Wrong?](https://arethetypeswrong.github.io/) inspect package metadata and declaration
resolution in greater depth. Use them alongside dynamic consumer checks when appropriate.

## Limitations

- npm and Node.js only; no pnpm, Yarn, Bun, Deno, browser, or bundler matrix
- Local directories and local `.tgz` files only; no registry names or remote URLs
- Root package entry point only; subpath exports are not exhaustively tested
- No complete implementation of Node.js export conditions
- CLI execution is limited to Node.js scripts; unsupported native binaries are skipped, not called broken
- TypeScript is checked with the package's runtime TypeScript dependency, one NodeNext configuration,
  and its deterministic runtime `@types/node` baseline
- Lifecycle-script suppression depends on the installed npm version's behavior
- Package code still executes during runtime checks even when lifecycle scripts are suppressed
- Native addon ABI compatibility is not tested
- A passing smoke test does not prove semantic correctness, security, or all consumer configurations

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in the private channel described in
[SECURITY.md](SECURITY.md).

## License

MIT © 2026 Çağrı Kaçmaz. See [LICENSE](LICENSE).
