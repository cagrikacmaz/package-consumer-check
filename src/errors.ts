import type { PackageConsumerCheckErrorCode } from "./types.js";

export class PackageConsumerCheckError extends Error {
  readonly code: PackageConsumerCheckErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PackageConsumerCheckErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PackageConsumerCheckError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function asPackageConsumerCheckError(error: unknown): PackageConsumerCheckError {
  if (error instanceof PackageConsumerCheckError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new PackageConsumerCheckError("INTERNAL_ERROR", message);
}
