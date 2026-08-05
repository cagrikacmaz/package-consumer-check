import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export const OWNERSHIP_FILE = ".package-consumer-check-owner.json";

export interface OwnedWorkspace {
  path: string;
  token: string;
}

export async function createOwnedWorkspace(purpose: "pack" | "consumer"): Promise<OwnedWorkspace> {
  const path = await mkdtemp(join(tmpdir(), `package-consumer-check-${purpose}-`));
  const token = randomUUID();
  await writeFile(
    join(path, OWNERSHIP_FILE),
    `${JSON.stringify({ token, purpose, createdBy: "package-consumer-check" })}\n`,
    "utf8",
  );
  return { path, token };
}

export async function ownsWorkspace(workspace: OwnedWorkspace): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(workspace.path, OWNERSHIP_FILE), "utf8"),
    );
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).token === workspace.token
    );
  } catch {
    return false;
  }
}
