import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";

import { prisma } from "../config/prisma.js";
import type { AttachmentOwnerType, AttachmentType, Prisma, ReportStatus, UserRole } from "../generated/prisma/client.js";
import type { AttachmentInput, UpdateAttachmentInput } from "../schemas/attachment.schema.js";
import { resolveFile, saveFileWithRollback, stageFileRemoval } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType, sanitizeUploadedFileName, validateDocumentationFile } from "../utils/uploaded-file.js";

export type AttachmentActor = { id: string; role: UserRole };
export type AttachmentOwner =
  | { kind: "report"; id: string }
  | { kind: "section"; id: string; sectionCode: string }
  | { kind: "record"; id: string }
  | { kind: "verification"; id: string };

type ReportAccess = {
  id: string;
  vesselId: string;
  createdById: string;
  loadingMasterId: string | null;
  unloadingMasterId: string | null;
  status: ReportStatus;
  formConfigurationSnapshot: unknown;
};

type PointContext = {
  vesselSealingPointId: string;
  sectionCode: string | null;
  compartmentId: string | null;
};

type ResolvedOwner = {
  report: ReportAccess;
  ownerType: AttachmentOwnerType;
  relation: { sealingReportId?: string; sealingRecordId?: string; verificationId?: string };
  fixedContext?: PointContext;
  sectionCode?: string;
};

type AttachmentTransactionClient = Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "attachment" | "auditLog">;

const attachmentInclude = {
  uploadedBy: { select: { id: true, username: true, fullName: true, role: true } },
  compartment: { select: { id: true, code: true, name: true, side: true } },
  vesselSealingPoint: { select: { id: true, code: true, displayName: true, side: true, instanceNo: true } },
} satisfies Prisma.AttachmentInclude;

const reportSelect = {
  id: true,
  vesselId: true,
  createdById: true,
  loadingMasterId: true,
  unloadingMasterId: true,
  status: true,
  formConfigurationSnapshot: true,
} satisfies Prisma.SealingReportSelect;

function canManage(actor: AttachmentActor) {
  return actor.role === "ADMIN" || actor.role === "SUPERVISOR";
}

function normalizeSectionCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase();
  return ["A", "B", "C", "D", "E", "F", "G", "H"].includes(code) ? code : null;
}

function assertReportReadable(report: ReportAccess, actor: AttachmentActor) {
  if (actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) !== actor.id) {
    throw new AppError(403, "Dokumentasi ditugaskan kepada Loading Master lain");
  }
  if (actor.role === "UNLOADING_MASTER" && report.unloadingMasterId !== actor.id) {
    throw new AppError(403, "Dokumentasi ditugaskan kepada Unloading Master lain");
  }
}

function assertOwnerWritable(report: ReportAccess, ownerType: AttachmentOwnerType, actor: AttachmentActor) {
  if (report.status === "FINISH") throw new AppError(400, "Dokumentasi laporan FINISH telah dikunci");
  if (ownerType === "VERIFICATION") {
    if (report.status !== "SANDAR") throw new AppError(400, "Dokumentasi verification hanya dapat diubah ketika kapal SANDAR");
    if (!canManage(actor) && actor.role !== "UNLOADING_MASTER") {
      throw new AppError(403, "Hanya Unloading Master, Supervisor, atau Admin yang dapat mengubah dokumentasi verification");
    }
    if (!canManage(actor) && report.unloadingMasterId !== actor.id) {
      throw new AppError(403, "Perjalanan ditugaskan kepada Unloading Master lain");
    }
    return;
  }

  if (report.status !== "DRAFT") throw new AppError(400, "Dokumentasi report, section, dan sealing record hanya dapat diubah saat DRAFT");
  if (!canManage(actor) && actor.role !== "LOADING_MASTER") {
    throw new AppError(403, "Hanya Loading Master, Supervisor, atau Admin yang dapat mengubah dokumentasi loading");
  }
  if (!canManage(actor) && (report.loadingMasterId ?? report.createdById) !== actor.id) {
    throw new AppError(403, "Shipment/voyage ditugaskan kepada Loading Master lain");
  }
}

async function lockWritableReport(
  tx: AttachmentTransactionClient,
  reportId: string,
  ownerType: AttachmentOwnerType,
  actor: AttachmentActor,
) {
  await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
  const report = await tx.sealingReport.findUnique({ where: { id: reportId }, select: reportSelect });
  if (!report) throw new AppError(404, "Laporan dokumentasi tidak ditemukan");
  assertOwnerWritable(report, ownerType, actor);
  return report;
}

function pointContextFromJson(value: unknown): PointContext | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  const section = point.section && typeof point.section === "object" ? point.section as Record<string, unknown> : null;
  const compartment = point.compartment && typeof point.compartment === "object" ? point.compartment as Record<string, unknown> : null;
  return typeof point.vesselSealingPointId === "string"
    ? {
        vesselSealingPointId: point.vesselSealingPointId,
        sectionCode: normalizeSectionCode(section?.code),
        compartmentId: typeof compartment?.id === "string" ? compartment.id : null,
      }
    : null;
}

function snapshotSections(report: ReportAccess) {
  const snapshot = report.formConfigurationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return [] as Array<{ code: string; isAvailable: boolean }>;
  const sections = (snapshot as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const section = value as Record<string, unknown>;
    return typeof section.code === "string"
      ? [{ code: section.code.toUpperCase(), isAvailable: section.isAvailable === true }]
      : [];
  });
}

function snapshotPoints(report: ReportAccess) {
  const snapshot = report.formConfigurationSnapshot;
  if (!snapshot || typeof snapshot !== "object") return [] as PointContext[];
  const points = (snapshot as Record<string, unknown>).points;
  return Array.isArray(points)
    ? points.map(pointContextFromJson).filter((point): point is PointContext => point !== null)
    : [];
}

async function databasePointContext(report: ReportAccess, pointId: string) {
  const point = await prisma.vesselSealingPoint.findUnique({
    where: { id: pointId },
    select: {
      id: true,
      vesselId: true,
      compartmentId: true,
      sealingPointTemplate: { select: { category: { select: { code: true } } } },
    },
  });
  if (!point || point.vesselId !== report.vesselId) throw new AppError(400, "Titik dokumentasi tidak berasal dari vessel laporan");
  return {
    vesselSealingPointId: point.id,
    sectionCode: normalizeSectionCode(point.sealingPointTemplate.category.code),
    compartmentId: point.compartmentId,
  };
}

async function resolvePointContext(report: ReportAccess, pointId: string) {
  const snapshotPoint = snapshotPoints(report).find((point) => point.vesselSealingPointId === pointId);
  if (report.formConfigurationSnapshot && !snapshotPoint) {
    throw new AppError(400, "Titik dokumentasi tidak terdapat pada snapshot laporan");
  }
  return snapshotPoint ?? databasePointContext(report, pointId);
}

async function validateCompartment(report: ReportAccess, compartmentId: string) {
  if (report.formConfigurationSnapshot) {
    const snapshot = report.formConfigurationSnapshot as Record<string, unknown>;
    const compartments = Array.isArray(snapshot.compartments) ? snapshot.compartments : [];
    if (!compartments.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === compartmentId)) {
      throw new AppError(400, "Compartment dokumentasi tidak terdapat pada snapshot laporan");
    }
    return;
  }
  const compartment = await prisma.compartment.findFirst({ where: { id: compartmentId, vesselId: report.vesselId }, select: { id: true } });
  if (!compartment) throw new AppError(400, "Compartment dokumentasi tidak berasal dari vessel laporan");
}

function assertSectionAvailable(report: ReportAccess, sectionCode: string) {
  const section = snapshotSections(report).find((item) => item.code === sectionCode);
  if (!section?.isAvailable) throw new AppError(400, `Section ${sectionCode} tidak tersedia pada snapshot laporan`);
}

async function resolveOwner(owner: AttachmentOwner): Promise<ResolvedOwner> {
  if (owner.kind === "report" || owner.kind === "section") {
    const report = await prisma.sealingReport.findUnique({ where: { id: owner.id }, select: reportSelect });
    if (!report) throw new AppError(404, "Laporan dokumentasi tidak ditemukan");
    if (owner.kind === "section") {
      const sectionCode = owner.sectionCode.toUpperCase();
      assertSectionAvailable(report, sectionCode);
      return { report, ownerType: "SECTION", relation: { sealingReportId: report.id }, sectionCode };
    }
    return { report, ownerType: "REPORT", relation: { sealingReportId: report.id } };
  }

  if (owner.kind === "record") {
    const record = await prisma.sealingRecord.findUnique({
      where: { id: owner.id },
      select: {
        id: true,
        vesselSealingPointId: true,
        pointSnapshot: true,
        sealingReport: { select: reportSelect },
      },
    });
    if (!record) throw new AppError(404, "Sealing record dokumentasi tidak ditemukan");
    const fixedContext = pointContextFromJson(record.pointSnapshot)
      ?? await databasePointContext(record.sealingReport, record.vesselSealingPointId);
    return { report: record.sealingReport, ownerType: "SEALING_RECORD", relation: { sealingRecordId: record.id }, fixedContext };
  }

  const verification = await prisma.sealVerification.findUnique({
    where: { id: owner.id },
    select: {
      id: true,
      seal: {
        select: {
          sealingRecord: {
            select: {
              vesselSealingPointId: true,
              pointSnapshot: true,
              sealingReport: { select: reportSelect },
            },
          },
        },
      },
    },
  });
  if (!verification) throw new AppError(404, "Verification dokumentasi tidak ditemukan");
  const record = verification.seal.sealingRecord;
  const fixedContext = pointContextFromJson(record.pointSnapshot)
    ?? await databasePointContext(record.sealingReport, record.vesselSealingPointId);
  return { report: record.sealingReport, ownerType: "VERIFICATION", relation: { verificationId: verification.id }, fixedContext };
}

async function resolveContext(owner: ResolvedOwner, input: AttachmentInput) {
  const inputSectionCode = input.sectionCode?.toUpperCase();
  if (owner.sectionCode && inputSectionCode && owner.sectionCode !== inputSectionCode) {
    throw new AppError(400, "Section metadata tidak sesuai dengan owner section");
  }

  let pointContext = owner.fixedContext;
  if (input.vesselSealingPointId) {
    if (pointContext && pointContext.vesselSealingPointId !== input.vesselSealingPointId) {
      throw new AppError(400, "Titik metadata tidak sesuai dengan owner sealing record/verification");
    }
    pointContext = pointContext ?? await resolvePointContext(owner.report, input.vesselSealingPointId);
  }

  const sectionCode = owner.sectionCode ?? inputSectionCode ?? pointContext?.sectionCode ?? null;
  if (sectionCode && owner.report.formConfigurationSnapshot) assertSectionAvailable(owner.report, sectionCode);
  if (sectionCode && !owner.report.formConfigurationSnapshot && (inputSectionCode || owner.sectionCode)) {
    throw new AppError(400, "Metadata section memerlukan snapshot form laporan");
  }
  if (owner.sectionCode && pointContext?.sectionCode && owner.sectionCode !== pointContext.sectionCode) {
    throw new AppError(400, "Titik dokumentasi bukan bagian dari owner section");
  }

  const compartmentId = input.compartmentId ?? pointContext?.compartmentId ?? null;
  if (compartmentId) await validateCompartment(owner.report, compartmentId);
  if (input.compartmentId && pointContext?.compartmentId && input.compartmentId !== pointContext.compartmentId) {
    throw new AppError(400, "Compartment metadata tidak sesuai dengan titik dokumentasi");
  }

  return {
    sectionCode,
    compartmentId,
    vesselSealingPointId: pointContext?.vesselSealingPointId ?? null,
  };
}

function attachmentStorageKey(id: string, mimeType: string) {
  return `${id}.${extensionForMimeType(mimeType)}`;
}

function ownerWhere(owner: ResolvedOwner): Prisma.AttachmentWhereInput {
  if (owner.ownerType === "REPORT") return { ownerType: "REPORT", sealingReportId: owner.report.id };
  if (owner.ownerType === "SECTION") return { ownerType: "SECTION", sealingReportId: owner.report.id, sectionCode: owner.sectionCode! };
  if (owner.ownerType === "SEALING_RECORD") return { ownerType: "SEALING_RECORD", sealingRecordId: owner.relation.sealingRecordId! };
  return { ownerType: "VERIFICATION", verificationId: owner.relation.verificationId! };
}

async function loadStoredAttachment(id: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      ...attachmentInclude,
      sealingReport: { select: reportSelect },
      sealingRecord: { select: { sealingReport: { select: reportSelect } } },
      verification: { select: { seal: { select: { sealingRecord: { select: { sealingReport: { select: reportSelect } } } } } } },
    },
  });
  if (!attachment) throw new AppError(404, "Lampiran tidak ditemukan");
  const report = attachment.sealingReport
    ?? attachment.sealingRecord?.sealingReport
    ?? attachment.verification?.seal.sealingRecord.sealingReport;
  if (!report) throw new AppError(409, "Owner lampiran tidak valid");
  return { attachment, report };
}

export async function uploadAttachment(ownerInput: AttachmentOwner, input: AttachmentInput, file: Express.Multer.File | undefined, actor: AttachmentActor) {
  if (!file) throw new AppError(400, "Field file wajib diisi");
  const owner = await resolveOwner(ownerInput);
  assertOwnerWritable(owner.report, owner.ownerType, actor);
  const context = await resolveContext(owner, input);
  const { extension, checksumSha256 } = validateDocumentationFile(file);
  const id = randomUUID();
  const storageKey = `${id}.${extension}`;
  const type: AttachmentType = input.type ?? (file.mimetype === "application/pdf" ? "DOCUMENT" : "PHOTO");
  const caption = input.caption ?? input.description;
  const data = {
    id,
    ...owner.relation,
    ...context,
    ownerType: owner.ownerType,
    uploadedById: actor.id,
    type,
    fileName: sanitizeUploadedFileName(file.originalname),
    fileUrl: `/api/v1/attachments/${id}/preview`,
    mimeType: file.mimetype,
    fileSize: BigInt(file.size),
    checksumSha256,
    ...(caption === undefined ? {} : { caption }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
  };

  return saveFileWithRollback(storageKey, file.buffer, () => prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as AttachmentTransactionClient;
    await lockWritableReport(tx, owner.report.id, owner.ownerType, actor);
    const auditData = { ...data, fileSize: file.size } as unknown as Prisma.InputJsonValue;
    const created = await tx.attachment.create({ data, include: attachmentInclude });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", entityType: "ATTACHMENT", entityId: id, newData: auditData } });
    return created;
  }));
}

export async function listAttachments(ownerInput: AttachmentOwner, actor: AttachmentActor) {
  const owner = await resolveOwner(ownerInput);
  assertReportReadable(owner.report, actor);
  return prisma.attachment.findMany({
    where: ownerWhere(owner),
    include: attachmentInclude,
    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getAttachment(id: string, actor: AttachmentActor) {
  const { attachment, report } = await loadStoredAttachment(id);
  assertReportReadable(report, actor);
  const { sealingReport: _report, sealingRecord: _record, verification: _verification, ...metadata } = attachment;
  return metadata;
}

export async function getAttachmentFile(id: string, actor: AttachmentActor) {
  const attachment = await getAttachment(id, actor);
  const absolutePath = resolveFile(attachmentStorageKey(attachment.id, attachment.mimeType));
  try {
    await stat(absolutePath);
  } catch {
    throw new AppError(404, "File lampiran tidak ditemukan di penyimpanan");
  }
  return { attachment, absolutePath };
}

export async function updateAttachment(id: string, input: UpdateAttachmentInput, actor: AttachmentActor) {
  const { attachment, report } = await loadStoredAttachment(id);
  assertOwnerWritable(report, attachment.ownerType, actor);
  if (attachment.uploadedById !== actor.id && !canManage(actor)) throw new AppError(403, "Hanya pengunggah, Supervisor, atau Admin yang dapat mengubah metadata lampiran");
  const data = {
    ...(input.type === undefined ? {} : { type: input.type }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
  };
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as AttachmentTransactionClient;
    await lockWritableReport(tx, report.id, attachment.ownerType, actor);
    const current = await tx.attachment.findUnique({ where: { id }, select: { uploadedById: true } });
    if (!current) throw new AppError(404, "Lampiran tidak ditemukan");
    if (current.uploadedById !== actor.id && !canManage(actor)) throw new AppError(403, "Hanya pengunggah, Supervisor, atau Admin yang dapat mengubah metadata lampiran");
    const updated = await tx.attachment.update({ where: { id }, data, include: attachmentInclude });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "UPDATE",
        entityType: "ATTACHMENT",
        entityId: id,
        oldData: { type: attachment.type, caption: attachment.caption, sequence: attachment.sequence },
        newData: data,
      },
    });
    return updated;
  });
}

export async function deleteAttachment(id: string, actor: AttachmentActor) {
  const { attachment, report } = await loadStoredAttachment(id);
  assertOwnerWritable(report, attachment.ownerType, actor);
  if (attachment.uploadedById !== actor.id && !canManage(actor)) throw new AppError(403, "Hanya pengunggah, Supervisor, atau Admin yang dapat menghapus lampiran");

  const staged = await stageFileRemoval(attachmentStorageKey(attachment.id, attachment.mimeType));
  try {
    const oldData = {
      ...attachment,
      fileSize: attachment.fileSize?.toString() ?? null,
      createdAt: attachment.createdAt.toISOString(),
      updatedAt: attachment.updatedAt.toISOString(),
    } as unknown as Prisma.InputJsonValue;
    const deleted = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as AttachmentTransactionClient;
      await lockWritableReport(tx, report.id, attachment.ownerType, actor);
      const current = await tx.attachment.findUnique({ where: { id }, select: { uploadedById: true } });
      if (!current) throw new AppError(404, "Lampiran tidak ditemukan");
      if (current.uploadedById !== actor.id && !canManage(actor)) throw new AppError(403, "Hanya pengunggah, Supervisor, atau Admin yang dapat menghapus lampiran");
      const removed = await tx.attachment.delete({ where: { id } });
      await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "ATTACHMENT", entityId: id, oldData } });
      return removed;
    });
    await staged.commit();
    return deleted;
  } catch (error) {
    await staged.rollback();
    throw error;
  }
}
