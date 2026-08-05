import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import type { ConsumerCheck, ConsumerDiagnostic } from "../types.js";

const MAX_TYPESCRIPT_DIAGNOSTICS = 50;

function normalizeDiagnosticPath(path: string, consumerDirectory: string): string {
  const local = relative(consumerDirectory, path);
  return local.startsWith("..")
    ? path.replaceAll("\\", "/")
    : `<temporary-consumer>/${local.replaceAll("\\", "/")}`;
}

export async function runTypeScriptCheck(
  consumerDirectory: string,
  packageName: string,
): Promise<ConsumerCheck> {
  const started = performance.now();
  const sourcePath = join(consumerDirectory, "consumer-typescript.mts");
  await writeFile(
    sourcePath,
    `import * as consumerTarget from ${JSON.stringify(packageName)};\nvoid consumerTarget;\n`,
  );
  const program = ts.createProgram({
    rootNames: [sourcePath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
  });
  const rawDiagnostics = ts.getPreEmitDiagnostics(program);
  const diagnostics: ConsumerDiagnostic[] = rawDiagnostics
    .slice(0, MAX_TYPESCRIPT_DIAGNOSTICS)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const source = diagnostic.file
        ? normalizeDiagnosticPath(diagnostic.file.fileName, consumerDirectory)
        : "TypeScript";
      const position =
        diagnostic.file !== undefined && diagnostic.start !== undefined
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
          : undefined;
      return {
        code: `TS${diagnostic.code}`,
        message,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        source:
          position === undefined
            ? source
            : `${source}:${position.line + 1}:${position.character + 1}`,
      };
    });
  if (rawDiagnostics.length > MAX_TYPESCRIPT_DIAGNOSTICS) {
    diagnostics.push({
      code: "DIAGNOSTICS_TRUNCATED",
      message: `${rawDiagnostics.length - MAX_TYPESCRIPT_DIAGNOSTICS} additional TypeScript diagnostics were omitted`,
      severity: "info",
      source: "TypeScript",
    });
  }
  const failed = rawDiagnostics.some(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  return {
    id: "typescript",
    status: failed ? "failed" : "passed",
    summary: failed
      ? "TypeScript NodeNext consumer compilation failed"
      : "Type declarations resolved in a TypeScript NodeNext consumer",
    durationMs: Math.round(performance.now() - started),
    details: {
      compilerVersion: ts.version,
      moduleResolution: "NodeNext",
      diagnosticCount: rawDiagnostics.length,
    },
    ...(diagnostics.length === 0 ? {} : { diagnostics }),
  };
}
