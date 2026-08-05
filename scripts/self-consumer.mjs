import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROCESS_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 32 * 1024;
const TRUNCATION_MARKER = "\n… output truncated by self-consumer validation …";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryMetadata = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
const expectedVersion = repositoryMetadata.version;
const temporary = await mkdtemp(join(tmpdir(), "package-consumer-check-self-"));
const packDestination = join(temporary, "pack");
const consumer = join(temporary, "consumer");

function appendBounded(current, chunk) {
  if (current.truncated) return current;
  const remaining = MAX_OUTPUT_BYTES - Buffer.byteLength(current.value);
  if (chunk.length <= remaining)
    return { value: current.value + chunk.toString(), truncated: false };
  return {
    value: current.value + chunk.subarray(0, Math.max(0, remaining)).toString(),
    truncated: true,
  };
}

function command(executable, args, cwd) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = { value: "", truncated: false };
    let stderr = { value: "", truncated: false };
    let spawnError;
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout = appendBounded(stdout, chunk)));
    child.stderr.on("data", (chunk) => (stderr = appendBounded(stderr, chunk)));
    child.on("error", (error) => (spawnError = error));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, PROCESS_TIMEOUT_MS);
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const stdoutValue = stdout.value + (stdout.truncated ? TRUNCATION_MARKER : "");
      const stderrValue = stderr.value + (stderr.truncated ? TRUNCATION_MARKER : "");
      if (!timedOut && spawnError === undefined && exitCode === 0) {
        resolveCommand({ stdout: stdoutValue, stderr: stderrValue });
        return;
      }
      const reason = timedOut
        ? `${executable} timed out after ${PROCESS_TIMEOUT_MS}ms`
        : (spawnError?.message ?? `${executable} exited with ${exitCode}`);
      reject(new Error([reason, stderrValue, stdoutValue].filter(Boolean).join("\n")));
    });
  });
}

function npmArguments(args) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath?.endsWith(".js")) return [process.execPath, [npmExecPath, ...args]];
  if (process.platform !== "win32") return ["npm", args];
  return [
    process.execPath,
    [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), ...args],
  ];
}

async function npm(args, cwd) {
  const [executable, commandArgs] = npmArguments(args);
  return await command(executable, commandArgs, cwd);
}

async function installedBinary(args) {
  const binBase = join(consumer, "node_modules", ".bin", "package-consumer-check");
  if (process.platform === "win32") {
    const powershellShim = `${binBase}.ps1`;
    await access(powershellShim);
    return await command(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        powershellShim,
        ...args,
      ],
      consumer,
    );
  }
  await access(binBase);
  return await command(binBase, args, consumer);
}

try {
  await mkdir(packDestination);
  await mkdir(consumer);
  const packed = await npm(
    ["pack", "--json", "--ignore-scripts", "--pack-destination", packDestination],
    repository,
  );
  const records = JSON.parse(packed.stdout);
  if (!Array.isArray(records) || records.length !== 1 || typeof records[0]?.filename !== "string") {
    throw new Error("npm pack did not return exactly one tarball");
  }
  const tarball = join(packDestination, records[0].filename);
  await access(tarball);

  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "self-consumer", version: "0.0.0", private: true, type: "module" }, null, 2)}\n`,
  );
  await npm(
    ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"],
    consumer,
  );

  await writeFile(
    join(consumer, "esm.mjs"),
    'const value = await import("package-consumer-check");\nif (!value.checkPackageConsumer) throw new Error("missing ESM export");\n',
  );
  await writeFile(
    join(consumer, "commonjs.cjs"),
    'const value = require("package-consumer-check");\nif (!value.checkPackageConsumer) throw new Error("missing CJS export");\n',
  );
  await writeFile(
    join(consumer, "types.mts"),
    'import { checkPackageConsumer, type ConsumerCheckResult } from "package-consumer-check";\nconst result: Promise<ConsumerCheckResult> = checkPackageConsumer(".");\nvoid result;\n',
  );

  await command(process.execPath, [join(consumer, "esm.mjs")], consumer);
  await command(process.execPath, [join(consumer, "commonjs.cjs")], consumer);
  await command(
    process.execPath,
    [
      join(consumer, "node_modules", "typescript", "bin", "tsc"),
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--types",
      "node",
      "--typeRoots",
      join(consumer, "node_modules", "@types"),
      join(consumer, "types.mts"),
    ],
    consumer,
  );

  const installedRoot = join(consumer, "node_modules", "package-consumer-check");
  const installedMetadata = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  if (installedMetadata.version !== expectedVersion) {
    throw new Error(
      `Expected installed version ${String(expectedVersion)}, received ${String(installedMetadata.version)}`,
    );
  }
  const help = await installedBinary(["--help"]);
  const version = await installedBinary(["--version"]);
  if (!help.stdout.includes("Usage:") || version.stdout.trim() !== expectedVersion) {
    throw new Error("Installed npm binary help/version validation failed");
  }

  process.stdout.write(`Self-consumer validation passed for ${records[0].filename}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
