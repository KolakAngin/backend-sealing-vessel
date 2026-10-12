import { createHash, randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { BeritaAcaraPhase, Prisma, ReportStatus, SealingProcessStatus, UserRole } from "../generated/prisma/client.js";
import type { BeritaAcaraPhaseInput, SignatureInput, UpdateSignatureInput, UpsertSignatureInput } from "../schemas/transaction.schema.js";
import { resolveVerifiedFile, stageFileRemoval, stageFileReplacement } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType, sanitizeUploadedFileName, validateDocumentationFile } from "../utils/uploaded-file.js";

export type SignatureActor = { id: string; role: UserRole };

type SignatureReport = {
  id: string;
  shipmentNumber: string | null;
  createdById: string;
  loadingMasterId: string | null;
  unloadingMasterId: string | null;
  status: ReportStatus;
  sealingProcessStatus: SealingProcessStatus;
};

type SignatureTransactionClient = Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "reportSignature" | "beritaAcaraDocument" | "plantJettyAssignment" | "auditLog">;

const signatureInclude = {
  user: { select: { id: true, username: true, fullName: true, role: true } },
} satisfies Prisma.ReportSignatureInclude;
const requiredSignatureRoles = ["CHIEF_OFFICER", "SURVEYOR", "TERMINAL_REPRESENTATIVE"] as const;
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const snapshotChecksum = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");

type LoadingSnapshotAttachment = Record<string, unknown> & {
  id: string;
  ownerType?: string;
  uploadedById?: string;
  createdAt?: string;
};
type LoadingSnapshotSeal = Record<string, unknown> & { id: string; sealNumber: string; status: string };
type LoadingSnapshotRecord = Record<string, unknown> & {
  id: string;
  vesselSealingPointId: string;
  attachments?: LoadingSnapshotAttachment[];
  seals: LoadingSnapshotSeal[];
};
type LoadingBaSnapshot = Record<string, unknown> & {
  schemaVersion: number;
  documentType: string;
  phase: string;
  report: Record<string, unknown>;
  formConfigurationSnapshot: unknown;
  attachments: LoadingSnapshotAttachment[];
  records: LoadingSnapshotRecord[];
  signatures: Array<Record<string, unknown> & { phase: string; role: string }>;
};

function parseLoadingBaSnapshot(value: unknown): LoadingBaSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot BA LOADING tidak tersedia");
  const snapshot = value as Partial<LoadingBaSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.documentType !== "BERITA_ACARA" || snapshot.phase !== "LOADING" ||
      !snapshot.report || !snapshot.formConfigurationSnapshot || !Array.isArray(snapshot.attachments) ||
      !Array.isArray(snapshot.records) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot BA LOADING tidak valid untuk finalisasi UNLOADING");
  }
  const roles = new Set(snapshot.signatures.filter((item) => item.phase === "LOADING").map((item) => item.role));
  if (requiredSignatureRoles.some((role) => !roles.has(role))) {
    throw new AppError(409, "Snapshot BA LOADING tidak mempunyai tiga signature LOADING lengkap");
  }
  for (const record of snapshot.records) {
    if (!record || typeof record !== "object" || typeof record.id !== "string" ||
        typeof record.vesselSealingPointId !== "string" || !Array.isArray(record.seals)) {
      throw new AppError(409, "Record pada snapshot BA LOADING tidak valid");
    }
  }
  return snapshot as LoadingBaSnapshot;
}

const reportSelect = {
  id: true,
  shipmentNumber: true,
  createdById: true,
  loadingMasterId: true,
  unloadingMasterId: true,
  status: true,
  sealingProcessStatus: true,
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

function assertLegacyWritable(report: SignatureReport, actor: SignatureActor) {
  if (report.status === "FINISH") throw new AppError(400, "Tanda tangan laporan FINISH telah dikunci");
  if (canManage(actor)) return;
  const assignedLoadingMaster = actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) === actor.id;
  const assignedUnloadingMaster = actor.role === "UNLOADING_MASTER" && report.unloadingMasterId === actor.id;
  if (!assignedLoadingMaster && !assignedUnloadingMaster) {
    throw new AppError(403, "Hanya petugas yang ditugaskan, Supervisor, atau Admin yang dapat mengubah tanda tangan");
  }
}

function assertPhaseWritable(
  report: SignatureReport,
  phase: BeritaAcaraPhase,
  actor: SignatureActor,
  documentStatus?: "DRAFT" | "FINALIZED",
) {
  if (!report.shipmentNumber) throw new AppError(400, "Berita Acara phase-aware hanya tersedia untuk shipment/voyage canonical");
  if (documentStatus === "FINALIZED") throw new AppError(400, `Berita Acara ${phase} telah difinalisasi dan dikunci`);
  if (phase === "LOADING") {
    if (report.status !== "DRAFT") throw new AppError(400, "Tanda tangan BA LOADING hanya dapat dikelola ketika shipment masih DRAFT");
    if (!canManage(actor) && !(actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) === actor.id)) {
      throw new AppError(403, "Hanya assigned Loading Master, Supervisor, atau Admin yang dapat mengelola BA LOADING");
    }
    return;
  }
  if (report.status !== "SANDAR") throw new AppError(400, "Tanda tangan BA UNLOADING hanya dapat dikelola ketika kapal sudah SANDAR");
  if (!canManage(actor) && !(actor.role === "UNLOADING_MASTER" && report.unloadingMasterId === actor.id)) {
    throw new AppError(403, "Hanya assigned Unloading Master, Supervisor, atau Admin yang dapat mengelola BA UNLOADING");
  }
}

async function lockWritableReport(
  tx: SignatureTransactionClient,
  reportId: string,
  actor: SignatureActor,
  phase?: BeritaAcaraPhase,
) {
  await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
  const report = await tx.sealingReport.findUnique({ where: { id: reportId }, select: reportSelect });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  if (!phase) {
    assertLegacyWritable(report, actor);
    return { report, document: null };
  }
  const document = await tx.beritaAcaraDocument.findUnique({
    where: { sealingReportId_phase: { sealingReportId: reportId, phase } },
  });
  assertPhaseWritable(report, phase, actor, document?.status);
  return { report, document };
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
    include: { ...signatureInclude, baDocument: true, sealingReport: { select: reportSelect } },
  });
  if (!signature) throw new AppError(404, "Tanda tangan tidak ditemukan");
  return signature;
}

function signatureStorageKey(id: string, mimeType: string, phase?: BeritaAcaraPhase | null) {
  const phasePrefix = phase ? `${phase.toLowerCase()}-` : "";
  return `signature-${phasePrefix}${id}.${extensionForMimeType(mimeType)}`;
}

async function ensureBaDocument(tx: SignatureTransactionClient, reportId: string, phase: BeritaAcaraPhase) {
  const existing = await tx.beritaAcaraDocument.findUnique({
    where: { sealingReportId_phase: { sealingReportId: reportId, phase } },
  });
  if (existing) return existing;
  return tx.beritaAcaraDocument.create({
    data: { id: randomUUID(), sealingReportId: reportId, phase },
  });
}

export async function listSignatures(reportId: string, actor: SignatureActor) {
  const report = await loadReport(reportId);
  assertReadable(report, actor);
  return prisma.reportSignature.findMany({ where: { sealingReportId: reportId, phase: null }, include: signatureInclude, orderBy: { role: "asc" } });
}

export async function getSignature(id: string, actor: SignatureActor) {
  const signature = await loadSignature(id);
  assertReadable(signature.sealingReport, actor);
  const { sealingReport: _report, baDocument: _document, ...metadata } = signature;
  return metadata;
}

export async function createSignature(reportId: string, input: SignatureInput, actor: SignatureActor) {
  const report = await loadReport(reportId);
  assertLegacyWritable(report, actor);
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

export async function upsertSignature(
  reportId: string,
  role: SignatureInput["role"],
  input: UpsertSignatureInput,
  actor: SignatureActor,
) {
  const report = await loadReport(reportId);
  assertLegacyWritable(report, actor);
  await validateUser(input.userId);
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    await lockWritableReport(tx, reportId, actor);
    const existing = await tx.reportSignature.findFirst({
      where: { sealingReportId: reportId, phase: null, role },
    });
    const data = {
      name: input.name,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.signatureUrl === undefined ? {} : { signatureUrl: input.signatureUrl }),
      ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    };
    const id = existing?.id ?? randomUUID();
    const signature = existing
      ? await tx.reportSignature.update({ where: { id }, data, include: signatureInclude })
      : await tx.reportSignature.create({
        data: { id, sealingReportId: reportId, role, ...data },
        include: signatureInclude,
      });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "REPORT_SIGNATURE",
        entityId: id,
        ...(existing ? {
          oldData: { userId: existing.userId, name: existing.name, signatureUrl: existing.signatureUrl, signedAt: existing.signedAt },
        } : {}),
        newData: { ...data, ...(existing ? {} : { sealingReportId: reportId, role, id }) } as Prisma.InputJsonValue,
      },
    });
    return signature;
  });
}

export async function listBaSignatures(reportId: string, phase: BeritaAcaraPhaseInput, actor: SignatureActor) {
  const report = await loadReport(reportId);
  if (!report.shipmentNumber) throw new AppError(400, "Berita Acara phase-aware hanya tersedia untuk shipment/voyage canonical");
  assertReadable(report, actor);
  return prisma.reportSignature.findMany({
    where: { sealingReportId: reportId, phase },
    include: signatureInclude,
    orderBy: { role: "asc" },
  });
}

export async function getBaDocument(reportId: string, phase: BeritaAcaraPhaseInput, actor: SignatureActor) {
  const report = await loadReport(reportId);
  if (!report.shipmentNumber) throw new AppError(400, "Berita Acara phase-aware hanya tersedia untuk shipment/voyage canonical");
  assertReadable(report, actor);
  const document = await prisma.beritaAcaraDocument.findUnique({
    where: { sealingReportId_phase: { sealingReportId: reportId, phase } },
    include: {
      finalizedBy: { select: { id: true, username: true, fullName: true, role: true } },
      signatures: { include: signatureInclude, orderBy: { role: "asc" } },
      pdfArtifact: true,
    },
  });
  if (!document) throw new AppError(404, `Berita Acara ${phase} belum dibuat`);
  return document;
}

export async function upsertBaSignature(
  reportId: string,
  phase: BeritaAcaraPhaseInput,
  role: SignatureInput["role"],
  input: UpsertSignatureInput,
  actor: SignatureActor,
) {
  const report = await loadReport(reportId);
  assertPhaseWritable(report, phase, actor);
  await validateUser(input.userId);
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    const locked = await lockWritableReport(tx, reportId, actor, phase);
    const document = locked.document ?? await ensureBaDocument(tx, reportId, phase);
    const existing = await tx.reportSignature.findUnique({
      where: { sealingReportId_phase_role: { sealingReportId: reportId, phase, role } },
    });
    const data = {
      name: input.name,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.signatureUrl === undefined ? {} : { signatureUrl: input.signatureUrl }),
      ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    };
    const id = existing?.id ?? randomUUID();
    const signature = existing
      ? await tx.reportSignature.update({ where: { id }, data, include: signatureInclude })
      : await tx.reportSignature.create({
        data: { id, sealingReportId: reportId, baDocumentId: document.id, phase, role, ...data },
        include: signatureInclude,
      });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "BA_SIGNATURE",
        entityId: id,
        ...(existing ? { oldData: asJson({ userId: existing.userId, name: existing.name, signatureUrl: existing.signatureUrl, signedAt: existing.signedAt }) } : {}),
        newData: asJson({ id, sealingReportId: reportId, baDocumentId: document.id, phase, role, ...data }),
      },
    });
    return signature;
  });
}

export async function finalizeBaDocument(reportId: string, phase: BeritaAcaraPhaseInput, actor: SignatureActor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    const locked = await lockWritableReport(tx, reportId, actor, phase);
    const document = locked.document ?? await ensureBaDocument(tx, reportId, phase);
    const signatures = await tx.reportSignature.findMany({
      where: { sealingReportId: reportId, phase },
      orderBy: { role: "asc" },
    }) as Prisma.ReportSignatureGetPayload<Record<string, never>>[];
    const availableRoles = new Set(signatures.map((signature) => signature.role));
    const missingRoles = requiredSignatureRoles.filter((role) => !availableRoles.has(role));
    if (missingRoles.length > 0) {
      throw new AppError(400, `Signature BA ${phase} belum lengkap: ${missingRoles.join(", ")}`);
    }

    const source = await tx.sealingReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reportNo: true,
        shipmentNumber: true,
        voyageNumber: true,
        dischargePlantId: true,
        dischargeJettyId: true,
        unloadingMasterId: true,
        reportDateTime: true,
        status: true,
        sealingStatus: true,
        sealingProcessStatus: true,
        departedAt: true,
        arrivedAt: true,
        finishedAt: true,
        remarks: true,
        vessel: { select: { id: true, name: true, imoNumber: true, isActive: true } },
        activity: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, name: true } },
        shipmentProducts: {
          select: { sequence: true, product: { select: { id: true, name: true } } },
          orderBy: { sequence: "asc" },
        },
        loadingPlant: { select: { id: true, code: true, name: true, isActive: true } },
        loadingJetty: { select: { id: true, name: true, isActive: true } },
        dischargePlant: { select: { id: true, code: true, name: true, isActive: true } },
        dischargeJetty: { select: { id: true, name: true, isActive: true } },
        loadingMaster: { select: { id: true, fullName: true, role: true } },
        unloadingMaster: { select: { id: true, fullName: true, role: true } },
        formConfigurationSnapshot: true,
        attachments: {
          select: {
            id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
            vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
            fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
            uploadedById: true, createdAt: true,
          },
          orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
        },
        sealingRecords: {
          select: {
            id: true,
            vesselSealingPointId: true,
            pointSnapshot: true,
            status: true,
            notes: true,
            attachments: {
              select: {
                id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
                vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
                fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
                uploadedById: true, createdAt: true,
              },
              orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
            },
            seals: {
              select: {
                id: true,
                sealNumber: true,
                status: true,
                installedAt: true,
                removedAt: true,
                notes: true,
                verifications: {
                  select: {
                    id: true, condition: true, verifiedAt: true, remarks: true, verifiedById: true,
                    attachments: {
                      select: {
                        id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
                        vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
                        fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
                        uploadedById: true, createdAt: true,
                      },
                      orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
                    },
                  },
                  orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!source) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    type FinalizationAttachment = {
      id: string; ownerType: string; type: string; sectionCode: string | null; compartmentId: string | null;
      vesselSealingPointId: string | null; caption: string | null; sequence: number | null; fileName: string;
      fileUrl: string; mimeType: string; fileSize: bigint | null; checksumSha256: string | null;
      uploadedById: string; createdAt: Date;
    };
    type FinalizationRecord = {
      id: string; vesselSealingPointId: string; pointSnapshot: unknown; status: string; notes: string | null;
      attachments: FinalizationAttachment[];
      seals: Array<{
        id: string; sealNumber: string; status: string; installedAt: Date; removedAt: Date | null; notes: string | null;
        verifications: Array<{
          id: string; condition: string; verifiedAt: Date; remarks: string | null; verifiedById: string;
          attachments: FinalizationAttachment[];
        }>;
      }>;
    };
    const sourceAttachments = source.attachments as FinalizationAttachment[];
    const sourceRecords = source.sealingRecords as FinalizationRecord[];

    if (phase === "UNLOADING") {
      const loadingDocument = await tx.beritaAcaraDocument.findUnique({
        where: { sealingReportId_phase: { sealingReportId: reportId, phase: "LOADING" } },
        select: { id: true, status: true, snapshot: true, snapshotVersion: true, finalizedAt: true },
      });
      if (!loadingDocument || loadingDocument.status !== "FINALIZED" || !loadingDocument.snapshot || !loadingDocument.finalizedAt) {
        throw new AppError(400, "BA LOADING harus difinalisasi sebelum BA UNLOADING");
      }
      const loadingSnapshot = parseLoadingBaSnapshot(loadingDocument.snapshot);
      const currentSeals = new Map(sourceRecords.flatMap((record) => record.seals.map((seal) => [seal.id, {
        ...seal,
        sealingRecordId: record.id,
        vesselSealingPointId: record.vesselSealingPointId,
      }] as const)));
      const activeLoadingSeals = loadingSnapshot.records.flatMap((record) => record.seals
        .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
        .map((seal) => ({ ...seal, sealingRecordId: record.id, vesselSealingPointId: record.vesselSealingPointId })));
      const unverifiedSealNumbers: string[] = [];
      for (const loadingSeal of activeLoadingSeals) {
        const current = currentSeals.get(loadingSeal.id);
        if (!current || current.sealNumber !== loadingSeal.sealNumber) {
          throw new AppError(409, `Segel ${loadingSeal.sealNumber} pada snapshot BA LOADING tidak konsisten dengan data pemeriksaan`);
        }
        if (current.verifications.length === 0) unverifiedSealNumbers.push(loadingSeal.sealNumber);
      }
      if (unverifiedSealNumbers.length > 0) {
        throw new AppError(400, `Seluruh segel aktif BA LOADING harus diverifikasi: ${unverifiedSealNumbers.join(", ")}`);
      }

      const withLoadingProvenance = (attachment: LoadingSnapshotAttachment, sealingRecordId: string | null) => ({
        ...attachment,
        phase: "LOADING",
        sealingRecordId,
        sealId: null,
        verificationId: null,
        uploadedAt: attachment.createdAt ?? null,
        uploadedById: attachment.uploadedById ?? null,
        provenance: {
          phase: "LOADING",
          ownerType: attachment.ownerType ?? (sealingRecordId ? "SEALING_RECORD" : "REPORT"),
          sealingRecordId,
          sealId: null,
          verificationId: null,
          uploadedAt: attachment.createdAt ?? null,
          uploadedById: attachment.uploadedById ?? null,
        },
      });
      const loadingAttachments = [
        ...loadingSnapshot.attachments.map((attachment) => withLoadingProvenance(attachment, null)),
        ...loadingSnapshot.records.flatMap((record) =>
          (record.attachments ?? []).map((attachment) => withLoadingProvenance(attachment, record.id))),
      ];
      const uniqueLoadingAttachments = [...new Map(loadingAttachments.map((attachment) => [attachment.id, attachment])).values()];

      const unloadingAttachments = activeLoadingSeals.flatMap((loadingSeal) => {
        const current = currentSeals.get(loadingSeal.id)!;
        return current.verifications.flatMap((verification) => verification.attachments.map((attachment) => ({
          ...attachment,
          fileSize: attachment.fileSize?.toString() ?? null,
          phase: "UNLOADING",
          sealingRecordId: loadingSeal.sealingRecordId,
          sealId: loadingSeal.id,
          verificationId: verification.id,
          uploadedAt: attachment.createdAt.toISOString(),
          provenance: {
            phase: "UNLOADING",
            ownerType: "VERIFICATION",
            sealingRecordId: loadingSeal.sealingRecordId,
            sealId: loadingSeal.id,
            verificationId: verification.id,
            uploadedAt: attachment.createdAt.toISOString(),
            uploadedById: attachment.uploadedById,
          },
        })));
      });
      const uniqueUnloadingAttachments = [...new Map(unloadingAttachments.map((attachment) => [attachment.id, attachment])).values()];
      const loadingSignatures = loadingSnapshot.signatures.filter((signature) => signature.phase === "LOADING");
      const unloadingSignatures = signatures.map((signature) => ({
        id: signature.id,
        phase: signature.phase,
        role: signature.role,
        userId: signature.userId,
        name: signature.name,
        signatureUrl: signature.signatureUrl,
        signedAt: signature.signedAt,
        signatureFileName: signature.signatureFileName,
        signatureMimeType: signature.signatureMimeType,
        signatureFileSize: signature.signatureFileSize?.toString() ?? null,
        signatureChecksumSha256: signature.signatureChecksumSha256,
      }));
      const finalizedAt = new Date();
      const loadingSnapshotChecksumSha256 = snapshotChecksum(loadingSnapshot);
      const unloadingRecords = loadingSnapshot.records.map((record) => ({
        ...record,
        attachments: (record.attachments ?? []).map((attachment) => withLoadingProvenance(attachment, record.id)),
        seals: record.seals
          .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
          .map((seal) => {
            const current = currentSeals.get(seal.id)!;
            return {
              ...seal,
              loadingStatus: seal.status,
              unloadingStatus: current.status,
              verifications: current.verifications.map((verification) => ({
                id: verification.id,
                condition: verification.condition,
                verifiedAt: verification.verifiedAt,
                remarks: verification.remarks,
                verifiedById: verification.verifiedById,
                attachments: verification.attachments.map((attachment) => {
                  const frozen = uniqueUnloadingAttachments.find((item) => item.id === attachment.id);
                  if (!frozen) throw new AppError(409, "Attachment verification tidak konsisten saat finalisasi");
                  return frozen;
                }),
              })),
            };
          }),
      }));
      const snapshot = asJson({
        schemaVersion: 1,
        documentType: "BERITA_ACARA",
        phase: "UNLOADING",
        capturedAt: finalizedAt.toISOString(),
        finalizedById: actor.id,
        loadingSnapshotReference: {
          baDocumentId: loadingDocument.id,
          snapshotVersion: loadingDocument.snapshotVersion,
          finalizedAt: loadingDocument.finalizedAt.toISOString(),
          snapshotChecksumSha256: loadingSnapshotChecksumSha256,
        },
        report: loadingSnapshot.report,
        formConfigurationSnapshot: loadingSnapshot.formConfigurationSnapshot,
        records: unloadingRecords,
        attachments: uniqueLoadingAttachments,
        loadingAttachments: uniqueLoadingAttachments,
        unloadingAttachments: uniqueUnloadingAttachments,
        loadingSignatures,
        unloadingSignatures,
        signatures: [...loadingSignatures, ...unloadingSignatures],
        verificationSummary: {
          activeSealCount: activeLoadingSeals.length,
          verifiedSealCount: activeLoadingSeals.length,
          unloadingAttachmentCount: uniqueUnloadingAttachments.length,
        },
      });
      const finalized = await tx.beritaAcaraDocument.update({
        where: { id: document.id },
        data: { status: "FINALIZED", snapshot, snapshotVersion: 1, finalizedById: actor.id, finalizedAt },
        include: {
          finalizedBy: { select: { id: true, username: true, fullName: true, role: true } },
          signatures: { include: signatureInclude, orderBy: { role: "asc" } },
          pdfArtifact: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "FINALIZE",
          entityType: "BA_DOCUMENT",
          entityId: document.id,
          oldData: asJson({ status: document.status, phase }),
          newData: asJson({
            status: "FINALIZED",
            phase,
            finalizedById: actor.id,
            finalizedAt,
            loadingBaDocumentId: loadingDocument.id,
            loadingSnapshotChecksumSha256,
            activeSealCount: activeLoadingSeals.length,
            unloadingAttachmentCount: uniqueUnloadingAttachments.length,
          }),
        },
      });
      return finalized;
    }

    if (phase === "LOADING") {
      if (source.sealingProcessStatus !== "READY") {
        throw new AppError(400, "BA LOADING hanya dapat difinalisasi setelah penyegelan loading lengkap (READY)");
      }
      if (!source.dischargePlantId || !source.dischargeJettyId || !source.dischargePlant || !source.dischargeJetty) {
        throw new AppError(400, "Discharge Plant dan Jetty wajib ditetapkan sebelum BA LOADING difinalisasi");
      }
      if (!source.dischargePlant.isActive || !source.dischargeJetty.isActive) {
        throw new AppError(400, "Discharge Plant dan Jetty harus aktif saat BA LOADING difinalisasi");
      }
      const destinationPair = await tx.plantJettyAssignment.findUnique({
        where: { plantId_jettyId: { plantId: source.dischargePlantId, jettyId: source.dischargeJettyId } },
        select: { id: true },
      });
      if (!destinationPair) throw new AppError(400, "Discharge Jetty tidak terdaftar pada Discharge Plant");

      const configuration = source.formConfigurationSnapshot;
      if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) {
        throw new AppError(400, "Snapshot form A-H belum diinisialisasi");
      }
      const points = (configuration as Record<string, unknown>).points;
      if (!Array.isArray(points)) throw new AppError(409, "Snapshot konfigurasi form A-H tidak valid");
      const recordsByPoint = new Map(sourceRecords.map((record) => [record.vesselSealingPointId, record]));
      for (const rawPoint of points) {
        if (!rawPoint || typeof rawPoint !== "object") throw new AppError(409, "Snapshot titik form A-H tidak valid");
        const point = rawPoint as Record<string, unknown>;
        if (point.isRequired === false) continue;
        if (typeof point.vesselSealingPointId !== "string") throw new AppError(409, "Snapshot titik form A-H tidak valid");
        const record = recordsByPoint.get(point.vesselSealingPointId);
        if (record?.status === "NOT_APPLICABLE") continue;
        const hasActiveSeal = record?.status === "SEALED" && record.seals.some((seal) =>
          seal.status === "INSTALLED" || seal.status === "VERIFIED" || seal.status === "BROKEN");
        if (!hasActiveSeal) {
          throw new AppError(400, `Titik required ${String(point.code ?? point.vesselSealingPointId)} belum selesai`);
        }
      }
    }

    const finalizedAt = new Date();
    const snapshotAttachment = (attachment: FinalizationAttachment) => ({
      ...attachment,
      fileSize: attachment.fileSize?.toString() ?? null,
    });
    const snapshot = asJson({
      schemaVersion: 1,
      documentType: "BERITA_ACARA",
      phase,
      capturedAt: finalizedAt.toISOString(),
      finalizedById: actor.id,
      report: {
        id: source.id,
        reportNo: source.reportNo,
        shipmentNumber: source.shipmentNumber,
        voyageNumber: source.voyageNumber,
        reportDateTime: source.reportDateTime,
        journeyStatus: source.status,
        sealingStatus: source.sealingStatus,
        sealingProcessStatus: source.sealingProcessStatus,
        departedAt: source.departedAt,
        arrivedAt: source.arrivedAt,
        finishedAt: source.finishedAt,
        remarks: source.remarks,
        vessel: source.vessel,
        activity: source.activity,
        product: source.shipmentProducts[0]?.product ?? source.product,
        products: source.shipmentProducts.length > 0
          ? source.shipmentProducts.map((item: { product: { id: string; name: string } }) => item.product)
          : (source.product ? [source.product] : []),
        loadingPlant: source.loadingPlant,
        loadingJetty: source.loadingJetty,
        dischargePlant: source.dischargePlant,
        dischargeJetty: source.dischargeJetty,
        destinationAssignment: {
          dischargePlantId: source.dischargePlantId,
          dischargeJettyId: source.dischargeJettyId,
          unloadingMasterId: source.unloadingMasterId,
        },
        loadingMaster: source.loadingMaster,
        unloadingMaster: source.unloadingMaster,
      },
      formConfigurationSnapshot: source.formConfigurationSnapshot,
      attachments: sourceAttachments.map(snapshotAttachment),
      records: sourceRecords.map((record) => ({
        id: record.id,
        vesselSealingPointId: record.vesselSealingPointId,
        pointSnapshot: record.pointSnapshot,
        status: record.status,
        notes: record.notes,
        attachments: record.attachments.map(snapshotAttachment),
        seals: record.seals
          .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
          .map((seal) => ({
            id: seal.id,
            sealNumber: seal.sealNumber,
            status: seal.status,
            installedAt: seal.installedAt,
            removedAt: seal.removedAt,
            notes: seal.notes,
            verifications: seal.verifications,
          })),
      })),
      signatures: signatures.map((signature) => ({
        id: signature.id,
        phase: signature.phase,
        role: signature.role,
        userId: signature.userId,
        name: signature.name,
        signatureUrl: signature.signatureUrl,
        signedAt: signature.signedAt,
        signatureFileName: signature.signatureFileName,
        signatureMimeType: signature.signatureMimeType,
        signatureFileSize: signature.signatureFileSize?.toString() ?? null,
        signatureChecksumSha256: signature.signatureChecksumSha256,
      })),
    });
    const finalized = await tx.beritaAcaraDocument.update({
      where: { id: document.id },
      data: { status: "FINALIZED", snapshot, snapshotVersion: 1, finalizedById: actor.id, finalizedAt },
      include: {
        finalizedBy: { select: { id: true, username: true, fullName: true, role: true } },
        signatures: { include: signatureInclude, orderBy: { role: "asc" } },
        pdfArtifact: true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "FINALIZE",
        entityType: "BA_DOCUMENT",
        entityId: document.id,
        oldData: asJson({ status: document.status, phase }),
        newData: asJson({ status: "FINALIZED", phase, finalizedById: actor.id, finalizedAt }),
      },
    });
    return finalized;
  });
}

export async function updateSignature(id: string, input: UpdateSignatureInput, actor: SignatureActor) {
  const signature = await loadSignature(id);
  if (signature.phase) assertPhaseWritable(signature.sealingReport, signature.phase, actor, signature.baDocument?.status);
  else assertLegacyWritable(signature.sealingReport, actor);
  await validateUser(input.userId);
  const data = {
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.signatureUrl === undefined ? {} : { signatureUrl: input.signatureUrl }),
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
  };
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SignatureTransactionClient;
    await lockWritableReport(tx, signature.sealingReportId, actor, signature.phase ?? undefined);
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
  if (signature.phase) assertPhaseWritable(signature.sealingReport, signature.phase, actor, signature.baDocument?.status);
  else assertLegacyWritable(signature.sealingReport, actor);
  const { checksumSha256 } = validateDocumentationFile(file);
  const newKey = signatureStorageKey(id, file.mimetype, signature.phase);
  const data = {
    signatureUrl: `/api/v1/signatures/${id}/preview`,
    signatureFileName: sanitizeUploadedFileName(file.originalname),
    signatureMimeType: file.mimetype,
    signatureFileSize: BigInt(file.size),
    signatureChecksumSha256: checksumSha256,
  };
  let stagedReplacement: Awaited<ReturnType<typeof stageFileReplacement>> | null = null;
  let stagedPrevious: Awaited<ReturnType<typeof stageFileRemoval>> | null = null;
  try {
    const updated = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as SignatureTransactionClient;
      await lockWritableReport(tx, signature.sealingReportId, actor, signature.phase ?? undefined);
      const current = await tx.reportSignature.findUnique({
        where: { id },
        select: { id: true, signatureMimeType: true },
      });
      if (!current) throw new AppError(404, "Tanda tangan tidak ditemukan");
      const previousKey = current.signatureMimeType
        ? signatureStorageKey(id, current.signatureMimeType, signature.phase)
        : null;
      stagedReplacement = await stageFileReplacement(newKey, file.buffer);
      if (previousKey && previousKey !== newKey) stagedPrevious = await stageFileRemoval(previousKey);
      try {
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
      } catch (error) {
        if (stagedPrevious) await stagedPrevious.rollback();
        stagedPrevious = null;
        await stagedReplacement.rollback();
        stagedReplacement = null;
        throw error;
      }
    });
    const committedPrevious = stagedPrevious as Awaited<ReturnType<typeof stageFileRemoval>> | null;
    const committedReplacement = stagedReplacement as Awaited<ReturnType<typeof stageFileReplacement>> | null;
    if (committedPrevious) await committedPrevious.commit();
    if (committedReplacement) await committedReplacement.commit();
    return updated;
  } catch (error) {
    const failedPrevious = stagedPrevious as Awaited<ReturnType<typeof stageFileRemoval>> | null;
    const failedReplacement = stagedReplacement as Awaited<ReturnType<typeof stageFileReplacement>> | null;
    if (failedPrevious) await failedPrevious.rollback();
    if (failedReplacement) await failedReplacement.rollback();
    throw error;
  }
}

export async function getSignatureFile(id: string, actor: SignatureActor) {
  const signature = await getSignature(id, actor);
  if (!signature.signatureMimeType || !signature.signatureFileName) throw new AppError(404, "File tanda tangan belum tersedia");
  const absolutePath = await resolveVerifiedFile(signatureStorageKey(id, signature.signatureMimeType, signature.phase), {
    fileSize: signature.signatureFileSize,
    checksumSha256: signature.signatureChecksumSha256,
  });
  return { signature, absolutePath };
}

export async function deleteSignature(id: string, actor: SignatureActor) {
  const signature = await loadSignature(id);
  if (signature.phase) assertPhaseWritable(signature.sealingReport, signature.phase, actor, signature.baDocument?.status);
  else assertLegacyWritable(signature.sealingReport, actor);
  const key = signature.signatureMimeType ? signatureStorageKey(id, signature.signatureMimeType, signature.phase) : null;
  let staged: Awaited<ReturnType<typeof stageFileRemoval>> | null = null;
  try {
    const oldData = {
      ...signature,
      signatureFileSize: signature.signatureFileSize?.toString() ?? null,
      createdAt: signature.createdAt.toISOString(),
      updatedAt: signature.updatedAt.toISOString(),
    } as unknown as Prisma.InputJsonValue;
    const deleted = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as SignatureTransactionClient;
      await lockWritableReport(tx, signature.sealingReportId, actor, signature.phase ?? undefined);
      const current = await tx.reportSignature.findUnique({ where: { id }, select: { id: true } });
      if (!current) throw new AppError(404, "Tanda tangan tidak ditemukan");
      staged = key ? await stageFileRemoval(key) : null;
      try {
        const removed = await tx.reportSignature.delete({ where: { id } });
        await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "REPORT_SIGNATURE", entityId: id, oldData } });
        return removed;
      } catch (error) {
        if (staged) await staged.rollback();
        staged = null;
        throw error;
      }
    });
    const committedStage = staged as Awaited<ReturnType<typeof stageFileRemoval>> | null;
    if (committedStage) await committedStage.commit();
    return deleted;
  } catch (error) {
    const failedStage = staged as Awaited<ReturnType<typeof stageFileRemoval>> | null;
    if (failedStage) await failedStage.rollback();
    throw error;
  }
}
