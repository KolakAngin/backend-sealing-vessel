import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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

export async function saveFileWithRollback<T>(key: string, content: Buffer, operation: () => Promise<T>) {
  await saveFile(key, content);
  try {
    return await operation();
  } catch (error) {
    await removeFile(key);
    throw error;
  }
}

export function resolveFile(key: string) {
  return safePath(key);
}

export async function resolveVerifiedFile(
  key: string,
  expected: { fileSize?: bigint | null; checksumSha256?: string | null },
) {
  const absolutePath = safePath(key);
  let content: Buffer;
  try {
    content = await readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AppError(404, "File tidak ditemukan di penyimpanan");
    }
    throw error;
  }
  if (expected.fileSize !== null && expected.fileSize !== undefined && BigInt(content.length) !== expected.fileSize) {
    throw new AppError(409, "Ukuran file tersimpan tidak sesuai metadata");
  }
  if (expected.checksumSha256) {
    const actualChecksum = createHash("sha256").update(content).digest("hex");
    if (actualChecksum !== expected.checksumSha256) {
      throw new AppError(409, "Checksum file tersimpan tidak sesuai metadata");
    }
  }
  return absolutePath;
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

/**
 * Mengganti file secara atomik dan menyediakan rollback sampai transaksi
 * database pemanggil berhasil commit. File lama tetap berada di destination
 * sampai rename atomik sehingga preview tidak melihat celah file hilang.
 */
export async function stageFileReplacement(key: string, content: Buffer) {
  await mkdir(root, { recursive: true });
  await mkdir(trash, { recursive: true });
  const destination = safePath(key);
  const nonce = randomUUID();
  const temporary = safePath(`.${path.basename(key)}.${nonce}.tmp`);
  const backup = safePath(`${path.basename(key)}.${nonce}.bak`, trash);
  let hasBackup = false;
  await writeFile(temporary, content, { flag: "wx" });
  try {
    try {
      await copyFile(destination, backup);
      hasBackup = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (hasBackup) await unlink(backup).catch(() => undefined);
    throw error;
  }
  return {
    commit: async () => {
      if (hasBackup) await unlink(backup).catch(() => undefined);
    },
    rollback: async () => {
      if (hasBackup) await rename(backup, destination);
      else await unlink(destination).catch(() => undefined);
    },
  };
}
