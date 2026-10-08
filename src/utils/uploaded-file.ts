import { createHash } from "node:crypto";
import path from "node:path";

import { AppError } from "./app-error.js";

const formats = {
  "image/jpeg": {
    extension: "jpg",
    matches: (buffer: Buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  "image/png": {
    extension: "png",
    matches: (buffer: Buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/webp": {
    extension: "webp",
    matches: (buffer: Buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
  "application/pdf": {
    extension: "pdf",
    matches: (buffer: Buffer) => buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-",
  },
} as const;

export type SupportedDocumentationMimeType = keyof typeof formats;

export function validateDocumentationFile(file: Express.Multer.File) {
  const format = formats[file.mimetype as SupportedDocumentationMimeType];
  if (!format || !format.matches(file.buffer)) {
    throw new AppError(400, "Isi file tidak sesuai dengan format JPEG, PNG, WebP, atau PDF yang dinyatakan");
  }
  return {
    extension: format.extension,
    checksumSha256: createHash("sha256").update(file.buffer).digest("hex"),
  };
}

export function extensionForMimeType(mimeType: string) {
  const format = formats[mimeType as SupportedDocumentationMimeType];
  if (!format) throw new AppError(500, "Format file tersimpan tidak dikenali");
  return format.extension;
}

export function sanitizeUploadedFileName(originalName: string) {
  const basename = path.basename(originalName)
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/^\.+/, "_")
    .trim()
    .slice(0, 255);
  return basename || "file";
}
