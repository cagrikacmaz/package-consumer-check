export type ConsumerCheckId =
  | "target-metadata"
  | "pack"
  | "install"
  | "installed-metadata"
  | "esm-import"
  | "commonjs-require"
  | "typescript"
  | "cli"
  | "cleanup";

export type ConsumerCheckStatus = "passed" | "failed" | "skipped";

export interface ConsumerDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  source?: string;
}

export interface ConsumerCheck {
  id: ConsumerCheckId;
  status: ConsumerCheckStatus;
  summary: string;
  durationMs: number;
  reason?: string;
  details?: Record<string, unknown>;
  diagnostics?: ConsumerDiagnostic[];
}

export interface ConsumerCheckOptions {
  timeoutMs?: number;
  keepTemp?: boolean;
  allowScripts?: boolean;
  requireTypes?: boolean;
  skipEsm?: boolean;
  skipCommonJs?: boolean;
  skipTypes?: boolean;
  skipCli?: boolean;
  cliArgs?: string[];
  acceptedCliExitCodes?: number[];
}

export interface ConsumerCheckResult {
  schemaVersion: 1;
  target: {
    input: string;
    resolvedPath: string;
    kind: "directory" | "tarball";
    packageName?: string;
    version?: string;
  };
  passed: boolean;
  checks: ConsumerCheck[];
  warnings: string[];
  temporaryDirectory?: string;
}

export type PackageConsumerCheckErrorCode =
  | "INVALID_TARGET"
  | "PACKAGE_JSON_NOT_FOUND"
  | "INVALID_PACKAGE_JSON"
  | "PACKAGE_NAME_MISSING"
  | "PACKAGE_VERSION_MISSING"
  | "NPM_NOT_FOUND"
  | "PACK_FAILED"
  | "PACK_OUTPUT_INVALID"
  | "INSTALL_FAILED"
  | "CONSUMER_CHECK_FAILED"
  | "TIMEOUT"
  | "CLEANUP_FAILED"
  | "INTERNAL_ERROR";

export interface PackageMetadata {
  name?: unknown;
  version?: unknown;
  type?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
  bin?: unknown;
  [key: string]: unknown;
}
