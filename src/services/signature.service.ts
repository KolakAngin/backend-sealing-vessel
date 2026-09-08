import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import { prisma } from "../config/prisma.js";
import type { Prisma, ReportStatus, UserRole } from "../generated/prisma/client.js";
import type { SignatureInput, UpdateSignatureInput } from "../schemas/transaction.schema.js";
import { removeFile, resolveFile, saveFile, stageFileRemoval } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType, sanitizeUploadedFileName, validateDocumentationFile } from "../utils/uploaded-file.js";

export type SignatureActor = { id: string; role: UserRole };

type SignatureReport = {
  id: string;
  createdById: string;
  loadingMasterId: string | null;
  unloadingMasterId: string | null;
  status: ReportStatus;
};

type SignatureTransactionClient = Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "reportSignature" | "auditLog">;

const signatureInclude = {
  user: { select: { id: true, username: true, fullName: true, role: true } },
} satisfies Prisma.ReportSignatureInclude;

const reportSelect = {
  id: true,
  createdById: true,
  loadingMasterId: true,
  unloadingMasterId: true,
  status: true,
} satisfies Prisma.SealingReportSelect;

function canManage(actor: SignatureActor) {
  return actor.role === "ADMIN" || actor.role === "SUPERVISOR";
}

function assertReadable(report: SignatureReport, actor: SignatureActor) {
  if (actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) !== actor.id) {
    throw new AppError(403, "Laporan ditugaskan kepada Loading Master lain");
  }
  if (actor.role === "UNLOADING_MASTER" && report.unloadingMasterId !== actor.id) {
    throw new AppError(403, "Laporan ditugaskan kepada Unloading Master lain");
  }
}

function assertWritable(report: SignatureReport, actor: SignatureActor) {
  if (report.status === "FINISH") throw new AppError(400, "Tanda tangan laporan FINISH telah dikunci");
  if (canManage(actor)) return;
  const assignedLoadingMaster = actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) === actor.id;
  const assignedUnloadingMaster = actor.role === "UNLOADING_MASTER" && report.unloadingMasterId === actor.id;
  if (!assignedLoadingMaster && !assignedUnloadingMaster) {
    throw new AppError(403, "Hanya petugas yang ditugaskan, Supervisor, atau Admin yang dapat mengubah tanda tangan");
  }
}

async function lockWritableReport(tx: SignatureTransactionClient, reportId: string, actor: SignatureActor) {
  await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
  const report = await tx.sealingReport.findUnique({ where: { id: reportId }, select: reportSelect });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertWritable(report, actor);
  return report;
}

async function validateUser(userId: string | null | undefined) {
  if (!userId) return;
  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
  if (!user) throw new AppError(400, "User penanda tangan tidak tersedia atau tidak aktif");
}

async function loadReport(reportId: string) {
  const report = await prisma.sealingReport.findUnique({ where: { id: reportId }, select: reportSelect });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  return report;
}

async function loadSignature(id: string) {
  const signature = await prisma.reportSignature.findUnique({
    where: { id },
    include: { ...signatureInclude, sealingReport: { select: reportSelect } },
  });
  if (!signature) throw new AppError(404, "Tanda tangan tidak ditemukan");
  return signature;
}

function signatureStorageKey(id: string, mimeType: string) {
  return `signature-${id}.${extensionForMimeType(mimeType)}`;
}

export async function listSignatures(reportId: string, actor: SignatureActor) {
  const report = await loadReport(reportId);
  assertReadable(report, actor);
  return prisma.reportSignature.findMany({ where: { sealingReportId: reportId }, include: signatureInclude, orderBy: { role: "asc" } });
}

export async function getSignature(id: string, actor: SignatureActor) {
  const signature = await loadSignature(id);
  assertReadable(signature.sealingReport, actor);
  const { sealingReport: _report, ...metadata } = signature;
  return metadata;
}

export async function createSignature(reportId: string, input: SignatureInput, actor: SignatureActor) {
  const report = await loadReport(reportId);
  assertWritable(report, actor);
  await validateUser(input.userId);
  const id = randomUUID();
  const data = {
    id,
    sealingReportId: reportId,
    role: input.role,
    name: input.name,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.signatureUrl === undefined ? {} : { signatureUrl: input.signatureUrl }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
  };
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    await lockWritableReport(tx, reportId, actor);
    const created = await tx.reportSignature.create({ data, include: signatureInclude });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", entityType: "REPORT_SIGNATURE", entityId: id, newData: data as Prisma.InputJsonValue } });
    return created;
  });
}

export async function updateSignature(id: string, input: UpdateSignatureInput, actor: SignatureActor) {
  const signature = await loadSignature(id);
  assertWritable(signature.sealingReport, actor);
  await validateUser(input.userId);
  const data = {
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.signatureUrl === undefined ? {} : { signatureUrl: input.signatureUrl }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
  };
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    await lockWritableReport(tx, signature.sealingReportId, actor);
    const updated = await tx.reportSignature.update({ where: { id }, data, include: signatureInclude });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "UPDATE",
        entityType: "REPORT_SIGNATURE",
        entityId: id,
        oldData: { userId: signature.userId, name: signature.name, signatureUrl: signature.signatureUrl, signedAt: signature.signedAt },
        newData: data,
      },
    });
    return updated;
  });
}

export async function uploadSignatureFile(id: string, file: Express.Multer.File | undefined, actor: SignatureActor) {
  if (!file) throw new AppError(400, "Field file wajib diisi");
  const signature = await loadSignature(id);
  assertWritable(signature.sealingReport, actor);
  const { extension, checksumSha256 } = validateDocumentationFile(file);
  const newKey = `signature-${id}.${extension}`;
  const previousKey = signature.signatureMimeType ? signatureStorageKey(id, signature.signatureMimeType) : null;
  const staged = previousKey ? await stageFileRemoval(previousKey) : null;
  try {
    await saveFile(newKey, file.buffer);
  } catch (error) {
    if (staged) await staged.rollback();
    throw error;
  }

  const data = {
    signatureUrl: `/api/v1/signatures/${id}/preview`,
    signatureFileName: sanitizeUploadedFileName(file.originalname),
    signatureMimeType: file.mimetype,
    signatureFileSize: BigInt(file.size),
    signatureChecksumSha256: checksumSha256,
  };
  try {
    const updated = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as SignatureTransactionClient;
      await lockWritableReport(tx, signature.sealingReportId, actor);
      const current = await tx.reportSignature.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw new AppError(404, "Tanda tangan tidak ditemukan");
      const saved = await tx.reportSignature.update({ where: { id }, data, include: signatureInclude });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "UPDATE",
          entityType: "REPORT_SIGNATURE_FILE",
          entityId: id,
          oldData: {
            signatureUrl: signature.signatureUrl,
            signatureFileName: signature.signatureFileName,
            signatureMimeType: signature.signatureMimeType,
            signatureFileSize: signature.signatureFileSize?.toString() ?? null,
            signatureChecksumSha256: signature.signatureChecksumSha256,
          },
          newData: { ...data, signatureFileSize: file.size },
        },
      });
      return saved;
    });
    if (staged) await staged.commit();
    return updated;
  } catch (error) {
    await removeFile(newKey);
    if (staged) await staged.rollback();
    throw error;
  }
}

export async function getSignatureFile(id: string, actor: SignatureActor) {
  const signature = await getSignature(id, actor);
  if (!signature.signatureMimeType || !signature.signatureFileName) throw new AppError(404, "File tanda tangan belum tersedia");
  const absolutePath = resolveFile(signatureStorageKey(id, signature.signatureMimeType));
  try {
    await stat(absolutePath);
  } catch {
    throw new AppError(404, "File tanda tangan tidak ditemukan di penyimpanan");
  }
  return { signature, absolutePath };
}

export async function deleteSignature(id: string, actor: SignatureActor) {
  const signature = await loadSignature(id);
  assertWritable(signature.sealingReport, actor);
  const key = signature.signatureMimeType ? signatureStorageKey(id, signature.signatureMimeType) : null;
  const staged = key ? await stageFileRemoval(key) : null;
  try {
    const oldData = {
      ...signature,
      signatureFileSize: signature.signatureFileSize?.toString() ?? null,
      createdAt: signature.createdAt.toISOString(),
      updatedAt: signature.updatedAt.toISOString(),
    } as unknown as Prisma.InputJsonValue;
    const deleted = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as SignatureTransactionClient;
      await lockWritableReport(tx, signature.sealingReportId, actor);
      const current = await tx.reportSignature.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw new AppError(404, "Tanda tangan tidak ditemukan");
      const removed = await tx.reportSignature.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "REPORT_SIGNATURE", entityId: id, oldData } });
      return removed;
    });
    if (staged) await staged.commit();
    return deleted;
  } catch (error) {
    if (staged) await staged.rollback();
    throw error;
  }
}
