import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "package-consumer-check-self-"));
const packDestination = join(temporary, "pack");
const consumer = join(temporary, "consumer");

function command(executable, args, cwd) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) resolveCommand({ stdout, stderr });
      else reject(new Error(stderr || stdout || `${executable} exited with ${exitCode}`));
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
  return command(executable, commandArgs, cwd);
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
      join(consumer, "types.mts"),
    ],
    consumer,
  );

  const installedRoot = join(consumer, "node_modules", "package-consumer-check");
  const installedMetadata = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  if (installedMetadata.version !== "0.1.0") {
    throw new Error(
      `Expected installed version 0.1.0, received ${String(installedMetadata.version)}`,
    );
  }
  const cli = join(installedRoot, "dist", "cli.js");
  const help = await command(process.execPath, [cli, "--help"], consumer);
  const version = await command(process.execPath, [cli, "--version"], consumer);
  if (!help.stdout.includes("Usage:") || version.stdout.trim() !== "0.1.0") {
    throw new Error("Installed CLI help/version validation failed");
  }

  process.stdout.write(`Self-consumer validation passed for ${records[0].filename}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
