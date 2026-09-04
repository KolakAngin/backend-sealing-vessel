import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

const root = path.resolve(process.cwd(), env.UPLOAD_DIR);
const trash = path.join(root, ".trash");

function safePath(key: string, base = root) {
  const resolved = path.resolve(base, key);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new AppError(400, "Lokasi file tidak valid");
  }
  return resolved;
}

export async function saveFile(key: string, content: Buffer) {
  await mkdir(root, { recursive: true });
  const destination = safePath(key);
  await writeFile(destination, content, { flag: "wx" });
  return destination;
}

export function resolveFile(key: string) {
  return safePath(key);
}

export async function removeFile(key: string) {
  await unlink(safePath(key)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function stageFileRemoval(key: string) {
  await mkdir(trash, { recursive: true });
  const source = safePath(key);
  const staged = safePath(`${key}.${Date.now()}`, trash);
  try {
    await rename(source, staged);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { commit: async () => undefined, rollback: async () => undefined };
    }
    throw error;
  }
  return {
    commit: async () => unlink(staged).catch(() => undefined),
    rollback: async () => rename(staged, source),
  };
}
