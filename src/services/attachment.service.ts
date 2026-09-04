import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../config/prisma.js";
import type { AttachmentType, Prisma, UserRole } from "../generated/prisma/client.js";
import type { AttachmentInput } from "../schemas/attachment.schema.js";
import { removeFile, resolveFile, saveFile, stageFileRemoval } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";

export type AttachmentActor = { id: string; role: UserRole };
export type AttachmentOwner =
  | { kind: "report"; id: string }
  | { kind: "record"; id: string }
  | { kind: "verification"; id: string };

const formats = {
  "image/jpeg": { extension: "jpg", matches: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": { extension: "png", matches: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", matches: (b: Buffer) => b.length >= 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  "application/pdf": { extension: "pdf", matches: (b: Buffer) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-" },
} as const;

function canManage(actor: AttachmentActor) {
  return actor.role === "ADMIN" || actor.role === "SUPERVISOR";
}

function assertOwnerOrManager(ownerId: string, actor: AttachmentActor) {
  if (ownerId !== actor.id && !canManage(actor)) {
    throw new AppError(403, "Anda tidak berhak menambahkan lampiran pada transaksi ini");
  }
}

function validateFile(file: Express.Multer.File) {
  const format = formats[file.mimetype as keyof typeof formats];
  if (!format || !format.matches(file.buffer)) {
    throw new AppError(400, "Isi file tidak sesuai dengan format yang dinyatakan");
  }
  return format.extension;
}

async function resolveOwner(owner: AttachmentOwner, actor: AttachmentActor) {
  let report: { createdById: string; status: string } | null = null;
  if (owner.kind === "report") {
    report = await prisma.sealingReport.findUnique({ where: { id: owner.id }, select: { createdById: true, status: true } });
  } else if (owner.kind === "record") {
    const record = await prisma.sealingRecord.findUnique({ where: { id: owner.id }, select: { sealingReport: { select: { createdById: true, status: true } } } });
    report = record?.sealingReport ?? null;
  } else {
    const verification = await prisma.sealVerification.findUnique({ where: { id: owner.id }, select: { seal: { select: { sealingRecord: { select: { sealingReport: { select: { createdById: true, status: true } } } } } } } });
    report = verification?.seal.sealingRecord.sealingReport ?? null;
  }
  if (!report) throw new AppError(404, "Target lampiran tidak ditemukan");
  assertOwnerOrManager(report.createdById, actor);
  if (!["DRAFT", "SUBMITTED"].includes(report.status)) {
    throw new AppError(400, "Lampiran hanya dapat ditambahkan pada laporan DRAFT atau SUBMITTED");
  }
}

function relationData(owner: AttachmentOwner) {
  if (owner.kind === "report") return { sealingReportId: owner.id };
  if (owner.kind === "record") return { sealingRecordId: owner.id };
  return { verificationId: owner.id };
}

function storageKey(id: string, mimeType: string) {
  const format = formats[mimeType as keyof typeof formats];
  if (!format) throw new AppError(500, "Format lampiran tersimpan tidak dikenali");
  return `${id}.${format.extension}`;
}

function cleanFileName(name: string) {
  const cleaned = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255);
  return cleaned || "attachment";
}

export async function uploadAttachment(owner: AttachmentOwner, input: AttachmentInput, file: Express.Multer.File | undefined, actor: AttachmentActor) {
  if (!file) throw new AppError(400, "Field file wajib diisi");
  await resolveOwner(owner, actor);
  const extension = validateFile(file);
  const id = randomUUID();
  const key = `${id}.${extension}`;
  const type: AttachmentType = input.type ?? (file.mimetype === "application/pdf" ? "DOCUMENT" : "PHOTO");
  const data = {
    id,
    ...relationData(owner),
    uploadedById: actor.id,
    type,
    fileName: cleanFileName(file.originalname),
    fileUrl: `/api/v1/attachments/${id}/file`,
    mimeType: file.mimetype,
    fileSize: BigInt(file.size),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
  };
  await saveFile(key, file.buffer);
  try {
    const auditData: Prisma.InputJsonValue = { ...data, fileSize: file.size };
    const [created] = await prisma.$transaction([
      prisma.attachment.create({ data, include: { uploadedBy: { select: { id: true, username: true, fullName: true } } } }),
      prisma.auditLog.create({ data: { userId: actor.id, action: "CREATE", entityType: "ATTACHMENT", entityId: id, newData: auditData } }),
    ]);
    return created;
  } catch (error) {
    await removeFile(key);
    throw error;
  }
}

export async function getAttachment(id: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id }, include: { uploadedBy: { select: { id: true, username: true, fullName: true } } } });
  if (!attachment) throw new AppError(404, "Lampiran tidak ditemukan");
  return attachment;
}

export async function getAttachmentFile(id: string) {
  const attachment = await getAttachment(id);
  const absolutePath = resolveFile(storageKey(attachment.id, attachment.mimeType));
  try {
    await stat(absolutePath);
  } catch {
    throw new AppError(404, "File lampiran tidak ditemukan di penyimpanan");
  }
  return { attachment, absolutePath };
}

export async function deleteAttachment(id: string, actor: AttachmentActor) {
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) throw new AppError(404, "Lampiran tidak ditemukan");
  if (attachment.uploadedById !== actor.id && !canManage(actor)) {
    throw new AppError(403, "Anda tidak berhak menghapus lampiran ini");
  }
  const staged = await stageFileRemoval(storageKey(attachment.id, attachment.mimeType));
  try {
    const oldData: Prisma.InputJsonValue = { ...attachment, fileSize: attachment.fileSize?.toString() ?? null, createdAt: attachment.createdAt.toISOString() };
    const [deleted] = await prisma.$transaction([
      prisma.attachment.delete({ where: { id } }),
      prisma.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "ATTACHMENT", entityId: id, oldData } }),
    ]);
    await staged.commit();
    return deleted;
  } catch (error) {
    await staged.rollback();
    throw error;
  }
}
