import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTarget } from "../../src/core/target.js";
import { PackageConsumerCheckError } from "../../src/errors.js";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(owned.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pcc-target-test-"));
  owned.push(path);
  return path;
}

describe("resolveTarget", () => {
  it("classifies a directory", async () => {
    const path = await tempDirectory();
    expect(await resolveTarget(path)).toMatchObject({ kind: "directory", resolvedPath: path });
  });

  it("classifies a tgz file", async () => {
    const path = await tempDirectory();
    const tarball = join(path, "thing.tgz");
    await writeFile(tarball, "fixture");
    expect(await resolveTarget(tarball)).toMatchObject({ kind: "tarball", resolvedPath: tarball });
  });

  it("classifies uppercase TGZ extensions", async () => {
    const path = await tempDirectory();
    const tarball = join(path, "thing.TGZ");
    await writeFile(tarball, "fixture");
    expect((await resolveTarget(tarball)).kind).toBe("tarball");
  });

  it("resolves relative input against an explicit cwd", async () => {
    const path = await tempDirectory();
    expect((await resolveTarget(".", path)).resolvedPath).toBe(path);
  });

  it("defaults to the current directory", async () => {
    expect((await resolveTarget()).resolvedPath).toBe(process.cwd());
  });

  it("rejects a missing target", async () => {
    await expect(resolveTarget("definitely-missing-package-target")).rejects.toMatchObject({
      code: "INVALID_TARGET",
    });
  });

  it("rejects a non-tarball file", async () => {
    const path = await tempDirectory();
    const file = join(path, "package.zip");
    await writeFile(file, "fixture");
    await expect(resolveTarget(file)).rejects.toBeInstanceOf(PackageConsumerCheckError);
  });
});
