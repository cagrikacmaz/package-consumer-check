import { join } from "node:path";
import type {
  ConsumerCheck,
  ConsumerCheckId,
  ConsumerCheckOptions,
  ConsumerCheckResult,
  PackageMetadata,
} from "../types.js";
import { resolveTarget } from "./target.js";
import { readPackageMetadata, validatePackageIdentity } from "./package-metadata.js";
import { createOwnedWorkspace, type OwnedWorkspace } from "./temp-workspace.js";
import { cleanupOwnedWorkspaces } from "./cleanup.js";
import { packDirectory } from "./pack.js";
import { installTarball } from "./install.js";
import { discoverInstalledPackage } from "./installed-package.js";
import { planCapabilities } from "./capability-plan.js";
import { runEsmCheck } from "../checks/esm-check.js";
import { runCommonJsCheck } from "../checks/commonjs-check.js";
import { runTypeScriptCheck } from "../checks/typescript-check.js";
import { runCliCheck } from "../checks/cli-check.js";

const DEFAULT_TIMEOUT_MS = 10_000;

function skipped(id: ConsumerCheckId, reason: string): ConsumerCheck {
  return { id, status: "skipped", summary: reason, reason, durationMs: 0 };
}

function failedFromError(id: ConsumerCheckId, summary: string, error: unknown): ConsumerCheck {
  return {
    id,
    status: "failed",
    summary,
    durationMs: 0,
    diagnostics: [
      {
        code: "CONSUMER_CHECK_FAILED",
        message: error instanceof Error ? error.message : String(error),
        severity: "error",
        source: id,
      },
    ],
  };
}

export async function checkPackageConsumer(
  input = ".",
  options: ConsumerCheckOptions = {},
): Promise<ConsumerCheckResult> {
  const target = await resolveTarget(input);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const keepTemp = options.keepTemp ?? false;
  const checks: ConsumerCheck[] = [];
  const warnings: string[] = [];
  let expected: { name: string; version: string } | undefined;
  let installed:
    { path: string; metadata: PackageMetadata; name: string; version: string } | undefined;
  let packWorkspace: OwnedWorkspace | undefined;
  let consumerWorkspace: OwnedWorkspace | undefined;
  let tarballPath: string | undefined;

  if (target.kind === "directory") {
    const started = performance.now();
    const metadata = await readPackageMetadata(join(target.resolvedPath, "package.json"));
    expected = validatePackageIdentity(metadata);
    checks.push({
      id: "target-metadata",
      status: "passed",
      summary: `Read source metadata for ${expected.name}@${expected.version}`,
      durationMs: Math.round(performance.now() - started),
    });
    packWorkspace = await createOwnedWorkspace("pack");
    const packed = await packDirectory(
      target.resolvedPath,
      packWorkspace.path,
      timeoutMs,
      options.allowScripts ?? false,
    );
    checks.push(packed.check);
    tarballPath = packed.tarballPath;
  } else {
    checks.push(
      skipped("target-metadata", "Source metadata is unavailable for a supplied tarball"),
    );
    checks.push(skipped("pack", "The user supplied a tarball"));
    tarballPath = target.resolvedPath;
  }

  if (tarballPath === undefined) {
    checks.push(skipped("install", "Packing did not produce an installable tarball"));
  } else {
    try {
      consumerWorkspace = await createOwnedWorkspace("consumer");
      checks.push(
        await installTarball(
          tarballPath,
          consumerWorkspace.path,
          timeoutMs,
          options.allowScripts ?? false,
        ),
      );
    } catch (error) {
      checks.push(failedFromError("install", "Could not prepare the consumer installation", error));
    }
  }

  const installPassed = checks.find((check) => check.id === "install")?.status === "passed";
  if (!installPassed || consumerWorkspace === undefined) {
    checks.push(skipped("installed-metadata", "The package was not installed successfully"));
  } else {
    const started = performance.now();
    try {
      installed = await discoverInstalledPackage(consumerWorkspace.path, expected);
      const mismatches: string[] = [];
      if (expected !== undefined && installed.name !== expected.name) {
        mismatches.push(`expected name ${expected.name}, installed ${installed.name}`);
      }
      if (expected !== undefined && installed.version !== expected.version) {
        mismatches.push(`expected version ${expected.version}, installed ${installed.version}`);
      }
      checks.push({
        id: "installed-metadata",
        status: mismatches.length === 0 ? "passed" : "failed",
        summary:
          mismatches.length === 0
            ? `Verified installed metadata for ${installed.name}@${installed.version}`
            : "Installed package identity does not match source metadata",
        durationMs: Math.round(performance.now() - started),
        ...(mismatches.length === 0
          ? {}
          : {
              diagnostics: mismatches.map((message) => ({
                code: "INSTALLED_METADATA_MISMATCH",
                message,
                severity: "error" as const,
              })),
            }),
      });
    } catch (error) {
      checks.push(
        failedFromError("installed-metadata", "Installed metadata could not be read", error),
      );
    }
  }

  const metadataPassed =
    checks.find((check) => check.id === "installed-metadata")?.status === "passed";
  if (!metadataPassed || installed === undefined || consumerWorkspace === undefined) {
    const reason = "Installed package metadata is unavailable";
    checks.push(skipped("esm-import", reason));
    checks.push(skipped("commonjs-require", reason));
    checks.push(skipped("typescript", reason));
    checks.push(skipped("cli", reason));
  } else {
    const plan = planCapabilities(installed.metadata);
    warnings.push(...plan.warnings);

    if (options.skipEsm) {
      checks.push(skipped("esm-import", "Skipped by --skip-esm"));
    } else if (!plan.esm.run) {
      checks.push(skipped("esm-import", plan.esm.reason));
    } else {
      checks.push(await runEsmCheck(consumerWorkspace.path, installed.name, timeoutMs));
    }

    if (options.skipCommonJs) {
      checks.push(skipped("commonjs-require", "Skipped by --skip-cjs"));
    } else if (!plan.commonJs.run) {
      checks.push(skipped("commonjs-require", plan.commonJs.reason));
    } else {
      checks.push(await runCommonJsCheck(consumerWorkspace.path, installed.name, timeoutMs));
    }

    if (options.skipTypes) {
      checks.push(skipped("typescript", "Skipped by --skip-types"));
    } else if (!plan.typescript.run && options.requireTypes) {
      checks.push({
        id: "typescript",
        status: "failed",
        summary: "Type declarations are required but not advertised",
        durationMs: 0,
        diagnostics: [
          {
            code: "TYPES_REQUIRED",
            message: plan.typescript.reason,
            severity: "error",
          },
        ],
      });
    } else if (!plan.typescript.run) {
      checks.push(skipped("typescript", plan.typescript.reason));
    } else {
      checks.push(await runTypeScriptCheck(consumerWorkspace.path, installed.name));
    }

    if (options.skipCli) {
      checks.push(skipped("cli", "Skipped by --skip-cli"));
    } else if (!plan.cli.run) {
      checks.push(skipped("cli", plan.cli.reason));
    } else {
      checks.push(
        await runCliCheck(
          consumerWorkspace.path,
          installed.path,
          plan.bins,
          timeoutMs,
          options.cliArgs?.length ? options.cliArgs : ["--help"],
          options.acceptedCliExitCodes?.length ? options.acceptedCliExitCodes : [0],
        ),
      );
    }
  }

  checks.push(
    await cleanupOwnedWorkspaces({
      ...(packWorkspace === undefined ? {} : { packWorkspace }),
      ...(consumerWorkspace === undefined ? {} : { consumerWorkspace }),
      keepTemp,
    }),
  );

  const identity = installed ?? expected;
  return {
    schemaVersion: 1,
    target: {
      ...target,
      ...(identity === undefined ? {} : { packageName: identity.name, version: identity.version }),
    },
    passed: checks.every((check) => check.status !== "failed"),
    checks,
    warnings,
    ...(keepTemp && consumerWorkspace !== undefined
      ? { temporaryDirectory: consumerWorkspace.path }
      : {}),
  };
}
