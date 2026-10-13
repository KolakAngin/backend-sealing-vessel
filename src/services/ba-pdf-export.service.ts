import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import type {
  Attachment,
  BeritaAcaraDocument,
  BeritaAcaraPdfArtifact,
  Prisma,
  ReportSignature,
  Seal,
  SealingRecord,
  SealingReport,
  SealVerification,
  UserRole,
} from "../generated/prisma/client.js";
import { AppError } from "../utils/app-error.js";
import { evaluateSignatureRoles, REQUIRED_SIGNATURE_ROLES } from "./signature-status.service.js";
import {
  buildUnloadingBaPdf,
  UNLOADING_PDF_LAYOUT_SHA256,
  UNLOADING_PDF_RENDERER_VERSION,
  type UnloadingPdfSnapshot,
} from "./ba-unloading-pdf-renderer.service.js";
import {
  buildOfficialPdf,
  NATIVE_PDF_LAYOUT_SHA256,
  PDF_CONTENT_TYPE,
  PDF_RENDERER_VERSION,
  type PdfFinalSnapshot,
} from "./pdf-export.service.js";

export { PDF_CONTENT_TYPE };

export type BaPdfActor = { id: string; role: UserRole };

const exportRoot = path.resolve(process.cwd(), env.PDF_EXPORT_DIR);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

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

function parseLoadingSnapshot(value: unknown): PdfFinalSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot BA LOADING tidak tersedia");
  const snapshot = value as Partial<PdfFinalSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.documentType !== "BERITA_ACARA" || snapshot.phase !== "LOADING" ||
      !snapshot.report || !snapshot.formConfigurationSnapshot || !Array.isArray(snapshot.formConfigurationSnapshot.points) ||
      !Array.isArray(snapshot.records) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot BA LOADING tidak didukung generator PDF");
  }
  if (snapshot.signatures.some((signature) => signature.phase !== "LOADING")) {
    throw new AppError(409, "Snapshot BA LOADING memuat signature dari phase lain");
  }
  return snapshot as PdfFinalSnapshot;
}

function parseUnloadingSnapshot(value: unknown): UnloadingPdfSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot BA UNLOADING tidak tersedia");
  const snapshot = value as Partial<UnloadingPdfSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.documentType !== "BERITA_ACARA" || snapshot.phase !== "UNLOADING" ||
      !snapshot.report || !snapshot.loadingSnapshotReference || !snapshot.formConfigurationSnapshot ||
      !Array.isArray(snapshot.records) || !Array.isArray(snapshot.loadingAttachments) ||
      !Array.isArray(snapshot.unloadingAttachments) || !Array.isArray(snapshot.loadingSignatures) ||
      !Array.isArray(snapshot.unloadingSignatures) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot BA UNLOADING tidak didukung generator PDF");
  }
  if (snapshot.loadingSignatures.some((signature) => signature.phase !== "LOADING") ||
      snapshot.unloadingSignatures.some((signature) => signature.phase !== "UNLOADING")) {
    throw new AppError(409, "Snapshot BA UNLOADING mencampurkan signature antar phase");
  }
  return snapshot as UnloadingPdfSnapshot;
}

function assertLoadingAccess(report: { createdById: string; loadingMasterId: string | null }, actor: BaPdfActor) {
  if (actor.role === "ADMIN" || actor.role === "SUPERVISOR") return;
  if (actor.role !== "LOADING_MASTER" || (report.loadingMasterId ?? report.createdById) !== actor.id) {
    throw new AppError(403, "Hanya assigned Loading Master, Supervisor, atau Admin yang dapat mengakses PDF BA LOADING");
  }
}

function assertUnloadingAccess(report: { unloadingMasterId: string | null }, actor: BaPdfActor) {
  if (actor.role === "ADMIN" || actor.role === "SUPERVISOR") return;
  if (actor.role !== "UNLOADING_MASTER" || report.unloadingMasterId !== actor.id) {
    throw new AppError(403, "Hanya assigned Unloading Master, Supervisor, atau Admin yang dapat mengakses PDF BA UNLOADING");
  }
}

function safeBaseName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "shipment";
}

function safeExportPath(storageKey: string) {
  const resolved = path.resolve(exportRoot, storageKey);
  if (!resolved.startsWith(`${exportRoot}${path.sep}`)) throw new AppError(400, "Lokasi hasil PDF BA tidak valid");
  return resolved;
}

type Artifact = Prisma.BeritaAcaraPdfArtifactGetPayload<Record<string, never>>;

function artifactDetails(artifact: Artifact, reportId: string, phase: "LOADING" | "UNLOADING", reused: boolean) {
  const details = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
    ? artifact.metadata as Record<string, unknown>
    : {};
  return {
    reportId,
    phase,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
    fileSize: Number(artifact.fileSize),
    checksumSha256: artifact.checksumSha256,
    snapshotChecksumSha256: artifact.snapshotChecksumSha256,
    rendererVersion: artifact.rendererVersion,
    documentStatus: details.documentStatus ?? null,
    documentValidity: details.documentValidity ?? null,
    signatureValidation: details.signatureValidation ?? null,
    templateChecksumSha256: details.templateChecksumSha256 ?? null,
    formPageCount: details.formPageCount ?? null,
    appendixPageCount: details.appendixPageCount ?? null,
    loadingAppendixPageCount: details.loadingAppendixPageCount ?? null,
    unloadingAppendixPageCount: details.unloadingAppendixPageCount ?? null,
    loadingPhotoCount: details.loadingPhotoCount ?? null,
    unloadingPhotoCount: details.unloadingPhotoCount ?? null,
    nonImageAttachmentCount: details.nonImageAttachmentCount ?? null,
    pageCount: details.pageCount ?? null,
    generatedAt: artifact.generatedAt,
    reused,
    previewUrl: `/api/v1/shipments/${reportId}/ba/${phase.toLowerCase()}/pdf/preview`,
    downloadUrl: `/api/v1/shipments/${reportId}/ba/${phase.toLowerCase()}/pdf/download`,
  };
}

const unloadingAttachmentSelect = {
  id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
  vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
  fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
  uploadedById: true, createdAt: true,
} satisfies Prisma.AttachmentSelect;

const unloadingPdfReportSelect = {
  id: true,
  reportNo: true,
  shipmentNumber: true,
  voyageNumber: true,
  unloadingMasterId: true,
  status: true,
  sealingRecords: {
    select: {
      id: true,
      vesselSealingPointId: true,
      status: true,
      seals: {
        select: {
          id: true,
          sealNumber: true,
          status: true,
          verifications: {
            select: {
              id: true,
              condition: true,
              verifiedAt: true,
              remarks: true,
              verifiedById: true,
              attachments: { select: unloadingAttachmentSelect, orderBy: [{ sequence: "asc" as const }, { createdAt: "asc" as const }] },
            },
            orderBy: [{ verifiedAt: "asc" as const }, { id: "asc" as const }],
          },
        },
      },
    },
  },
  signatures: { where: { phase: "UNLOADING" as const }, orderBy: { role: "asc" as const } },
  baDocuments: { include: { pdfArtifact: true } },
} as const satisfies Prisma.SealingReportSelect;

type UnloadingAttachment = Pick<Attachment,
  "id" | "ownerType" | "type" | "sectionCode" | "compartmentId" | "vesselSealingPointId" |
  "caption" | "sequence" | "fileName" | "fileUrl" | "mimeType" | "fileSize" |
  "checksumSha256" | "uploadedById" | "createdAt">;
type UnloadingVerification = Pick<SealVerification, "id" | "condition" | "verifiedAt" | "remarks" | "verifiedById"> & {
  attachments: UnloadingAttachment[];
};
type UnloadingSeal = Pick<Seal, "id" | "sealNumber" | "status"> & { verifications: UnloadingVerification[] };
type UnloadingRecord = Pick<SealingRecord, "id" | "vesselSealingPointId" | "status"> & { seals: UnloadingSeal[] };
type UnloadingDocument = BeritaAcaraDocument & { pdfArtifact: BeritaAcaraPdfArtifact | null };
type UnloadingPdfReport = Pick<SealingReport,
  "id" | "reportNo" | "shipmentNumber" | "voyageNumber" | "unloadingMasterId" | "status"> & {
  sealingRecords: UnloadingRecord[];
  signatures: ReportSignature[];
  baDocuments: UnloadingDocument[];
};
type UnloadingPdfClient = Pick<typeof prisma, "sealingReport">;
type DraftLoadingAttachment = {
  id: string;
  ownerType?: string | null;
  type?: string | null;
  sectionCode?: string | null;
  compartmentId?: string | null;
  vesselSealingPointId?: string | null;
  caption?: string | null;
  sequence?: number | null;
  fileName: string;
  fileUrl?: string | null;
  mimeType: string;
  fileSize?: string | null;
  checksumSha256?: string | null;
  uploadedById?: string | null;
  createdAt?: string | null;
};
type DraftLoadingRecord = Omit<PdfFinalSnapshot["records"][number], "attachments" | "seals"> & {
  id: string;
  attachments?: DraftLoadingAttachment[];
  seals: Array<PdfFinalSnapshot["records"][number]["seals"][number] & { id: string }>;
};
type DraftLoadingSnapshot = Omit<PdfFinalSnapshot, "attachments" | "records"> & {
  attachments?: DraftLoadingAttachment[];
  records: DraftLoadingRecord[];
};

function buildLoadingAttachmentProvenance(attachment: DraftLoadingAttachment, sealingRecordId: string | null) {
  return {
    ...attachment,
    phase: "LOADING",
    sealingRecordId,
    sealId: null,
    verificationId: null,
    uploadedAt: attachment.createdAt ?? null,
    provenance: {
      phase: "LOADING",
      ownerType: attachment.ownerType ?? (sealingRecordId ? "SEALING_RECORD" : "REPORT"),
      sealingRecordId,
      sealId: null,
      verificationId: null,
      uploadedAt: attachment.createdAt ?? null,
      uploadedById: attachment.uploadedById ?? null,
    },
  };
}

async function buildUnloadingDraftSnapshot(report: UnloadingPdfReport, document: UnloadingPdfReport["baDocuments"][number]) {
  if (report.status !== "SANDAR") throw new AppError(409, "Draft PDF BA UNLOADING hanya tersedia ketika shipment SANDAR");
  const loadingDocument = report.baDocuments.find((item) => item.phase === "LOADING");
  if (!loadingDocument || loadingDocument.status !== "FINALIZED" || !loadingDocument.snapshot || !loadingDocument.finalizedAt) {
    throw new AppError(409, "BA LOADING harus difinalisasi sebelum draft PDF BA UNLOADING dibuat");
  }
  const loadingSnapshot = parseLoadingSnapshot(loadingDocument.snapshot) as unknown as DraftLoadingSnapshot;
  const signatureValidation = await evaluateSignatureRoles(report.signatures, "UNLOADING");
  const statusById = new Map(signatureValidation.roles.filter((item) => item.signatureId).map((item) => [item.signatureId, item]));
  const currentSeals = new Map(report.sealingRecords.flatMap((record) => record.seals.map((seal) => [seal.id, {
    ...seal,
    sealingRecordId: record.id,
    vesselSealingPointId: record.vesselSealingPointId,
  }] as const)));
  const activeLoadingSeals = loadingSnapshot.records.flatMap((record) => record.seals
    .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
    .map((seal) => ({ ...seal, sealingRecordId: record.id, vesselSealingPointId: record.vesselSealingPointId })));

  const loadingAttachments = [
    ...(loadingSnapshot.attachments ?? []).map((attachment) => buildLoadingAttachmentProvenance(attachment, null)),
    ...loadingSnapshot.records.flatMap((record) =>
      (record.attachments ?? []).map((attachment) => buildLoadingAttachmentProvenance(attachment, record.id))),
  ];
  const uniqueLoadingAttachments = [...new Map(loadingAttachments.map((attachment) => [attachment.id, attachment])).values()];
  const unloadingAttachments = activeLoadingSeals.flatMap((loadingSeal) => {
    const current = currentSeals.get(loadingSeal.id);
    if (!current || current.sealNumber !== loadingSeal.sealNumber) return [];
    return current.verifications.flatMap((verification) => verification.attachments.map((attachment) => ({
      ...attachment,
      fileSize: attachment.fileSize?.toString() ?? null,
      createdAt: attachment.createdAt.toISOString(),
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
  const records = loadingSnapshot.records.map((record) => ({
    ...record,
    attachments: (record.attachments ?? []).map((attachment) => buildLoadingAttachmentProvenance(attachment, record.id)),
    seals: record.seals
      .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
      .map((seal) => {
        const current = currentSeals.get(seal.id);
        return {
          ...seal,
          loadingStatus: seal.status,
          unloadingStatus: current?.status ?? "NOT_VERIFIED",
          verifications: (current?.verifications ?? []).map((verification) => ({
            id: verification.id,
            condition: verification.condition,
            verifiedAt: verification.verifiedAt.toISOString(),
            remarks: verification.remarks,
            verifiedById: verification.verifiedById,
            attachments: verification.attachments.map((attachment) =>
              uniqueUnloadingAttachments.find((item) => item.id === attachment.id)).filter((item) => item !== undefined),
          })),
        };
      }),
  }));
  const unloadingSignatures = REQUIRED_SIGNATURE_ROLES.map((role) => {
    const signature = report.signatures.find((item) => item.role === role);
    if (!signature) {
      return {
        id: `missing-unloading-${role.toLowerCase()}`,
        phase: "UNLOADING" as const,
        role,
        name: "",
        signedAt: null,
        signatureMimeType: null,
        signatureChecksumSha256: null,
        isSigned: false,
        signatureStatus: "MISSING" as const,
      };
    }
    return {
      id: signature.id,
      phase: "UNLOADING" as const,
      role: signature.role,
      name: signature.name,
      signedAt: signature.signedAt?.toISOString() ?? null,
      signatureMimeType: signature.signatureMimeType,
      signatureChecksumSha256: signature.signatureChecksumSha256,
      isSigned: statusById.get(signature.id)?.isSigned ?? false,
      signatureStatus: statusById.get(signature.id)?.state ?? "UNSIGNED" as const,
    };
  });
  const loadingSignatures = loadingSnapshot.signatures
    .filter((signature) => signature.phase === "LOADING")
    .map((signature) => ({ ...signature, phase: "LOADING" as const, isSigned: signature.isSigned ?? true }));
  return {
    schemaVersion: 1,
    documentType: "BERITA_ACARA" as const,
    phase: "UNLOADING" as const,
    capturedAt: document.createdAt.toISOString(),
    finalizedById: null,
    loadingSnapshotReference: {
      baDocumentId: loadingDocument.id,
      snapshotVersion: loadingDocument.snapshotVersion,
      finalizedAt: loadingDocument.finalizedAt.toISOString(),
      snapshotChecksumSha256: hash(canonicalJson(loadingSnapshot)),
    },
    report: loadingSnapshot.report,
    formConfigurationSnapshot: loadingSnapshot.formConfigurationSnapshot,
    records,
    loadingAttachments: uniqueLoadingAttachments,
    unloadingAttachments: uniqueUnloadingAttachments,
    loadingSignatures,
    unloadingSignatures,
    signatures: [...loadingSignatures, ...unloadingSignatures],
    signatureValidation: {
      isComplete: signatureValidation.isComplete,
      roles: signatureValidation.roles,
      incompleteRoles: signatureValidation.incompleteRoles,
    },
    verificationSummary: {
      activeSealCount: activeLoadingSeals.length,
      verifiedSealCount: activeLoadingSeals.filter((seal) => (currentSeals.get(seal.id)?.verifications.length ?? 0) > 0).length,
      unloadingAttachmentCount: uniqueUnloadingAttachments.length,
    },
  } as unknown as UnloadingPdfSnapshot & Record<string, unknown>;
}

async function ensureUnloadingDocument(reportId: string, actor: BaPdfActor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "beritaAcaraDocument">;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
    const report = await tx.sealingReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        shipmentNumber: true,
        unloadingMasterId: true,
        status: true,
        baDocuments: { where: { phase: "LOADING" }, select: { status: true, snapshot: true }, take: 1 },
      },
    });
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    if (!report.shipmentNumber) throw new AppError(400, "PDF BA UNLOADING hanya tersedia untuk shipment/voyage canonical");
    assertUnloadingAccess(report, actor);
    const existing = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: reportId, phase: "UNLOADING" } },
      select: { id: true },
    });
    if (existing) return existing.id;
    if (report.status !== "SANDAR") throw new AppError(409, "Draft PDF BA UNLOADING hanya tersedia ketika shipment SANDAR");
    const loadingDocument = report.baDocuments[0];
    if (!loadingDocument || loadingDocument.status !== "FINALIZED" || !loadingDocument.snapshot) {
      throw new AppError(409, "BA LOADING harus difinalisasi sebelum draft PDF BA UNLOADING dibuat");
    }
    const created = await tx.beritaAcaraDocument.create({
      data: { id: randomUUID(), sealingReportId: reportId, phase: "UNLOADING" },
      select: { id: true },
    });
    return created.id;
  });
}

async function loadUnloadingDocument(reportId: string, actor: BaPdfActor, database: UnloadingPdfClient = prisma) {
  const report = await database.sealingReport.findUnique({
    where: { id: reportId },
    select: unloadingPdfReportSelect,
  }) as unknown as UnloadingPdfReport | null;
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  if (!report.shipmentNumber) throw new AppError(400, "PDF BA UNLOADING hanya tersedia untuk shipment/voyage canonical");
  assertUnloadingAccess(report, actor);
  const document = report.baDocuments.find((item) => item.phase === "UNLOADING");
  if (!document) throw new AppError(404, "Dokumen BA UNLOADING belum dibuat; panggil endpoint generate terlebih dahulu");
  if (document.status === "FINALIZED") {
    if (!document.snapshot) throw new AppError(409, "Snapshot BA UNLOADING final tidak tersedia");
    return { report, document, snapshot: parseUnloadingSnapshot(document.snapshot), documentValidity: "VALID" as const };
  }
  const snapshot = await buildUnloadingDraftSnapshot(report, document);
  return {
    report,
    document,
    snapshot,
    documentValidity: snapshot.signatureValidation?.isComplete ? "VALID" as const : "INVALID_SIGNATURES" as const,
  };
}

const loadingPdfReportSelect = {
  id: true,
  reportNo: true,
  shipmentNumber: true,
  voyageNumber: true,
  createdById: true,
  loadingMasterId: true,
  unloadingMasterId: true,
  reportDateTime: true,
  status: true,
  sealingStatus: true,
  sealingProcessStatus: true,
  departedAt: true,
  arrivedAt: true,
  finishedAt: true,
  remarks: true,
  vessel: { select: { id: true, name: true, imoNumber: true } },
  activity: { select: { id: true, code: true, name: true } },
  product: { select: { id: true, name: true } },
  shipmentProducts: {
    select: { sequence: true, product: { select: { id: true, name: true } } },
    orderBy: { sequence: "asc" as const },
  },
  loadingPlant: { select: { id: true, code: true, name: true } },
  loadingJetty: { select: { id: true, name: true } },
  dischargePlant: { select: { id: true, code: true, name: true } },
  dischargeJetty: { select: { id: true, name: true } },
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
    orderBy: [{ sequence: "asc" as const }, { createdAt: "asc" as const }],
  },
  sealingRecords: {
    select: {
      id: true, vesselSealingPointId: true, pointSnapshot: true, status: true, notes: true,
      attachments: {
        select: {
          id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
          vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
          fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
          uploadedById: true, createdAt: true,
        },
        orderBy: [{ sequence: "asc" as const }, { createdAt: "asc" as const }],
      },
      seals: {
        select: {
          id: true, sealNumber: true, status: true, installedAt: true, removedAt: true, notes: true,
          verifications: true,
        },
        orderBy: { createdAt: "asc" as const },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
  signatures: {
    where: { phase: "LOADING" as const },
    orderBy: { role: "asc" as const },
  },
  baDocuments: {
    where: { phase: "LOADING" as const },
    include: { pdfArtifact: true },
    take: 1,
  },
} satisfies Prisma.SealingReportSelect;

type LoadingPdfReport = Prisma.SealingReportGetPayload<{ select: typeof loadingPdfReportSelect }>;
type LoadingPdfClient = Pick<typeof prisma, "sealingReport">;

async function buildLoadingDraftSnapshot(report: LoadingPdfReport, document: LoadingPdfReport["baDocuments"][number]) {
  if (report.status !== "DRAFT") throw new AppError(409, "Draft PDF BA LOADING hanya tersedia ketika shipment masih DRAFT");
  const configuration = report.formConfigurationSnapshot;
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration) ||
      !Array.isArray((configuration as Record<string, unknown>).points)) {
    throw new AppError(409, "Form A-H harus diinisialisasi sebelum draft PDF BA LOADING dicetak");
  }
  const validation = await evaluateSignatureRoles(report.signatures, "LOADING");
  const statusById = new Map(validation.roles.filter((item) => item.signatureId).map((item) => [item.signatureId, item]));
  const snapshotAttachment = (attachment: LoadingPdfReport["attachments"][number]) => ({
    ...attachment,
    fileSize: attachment.fileSize?.toString() ?? null,
  });
  return {
    schemaVersion: 1,
    documentType: "BERITA_ACARA" as const,
    phase: "LOADING" as const,
    capturedAt: document.createdAt.toISOString(),
    finalizedById: null,
    report: {
      id: report.id,
      reportNo: report.reportNo,
      shipmentNumber: report.shipmentNumber,
      voyageNumber: report.voyageNumber,
      reportDateTime: report.reportDateTime.toISOString(),
      journeyStatus: report.status,
      sealingStatus: report.sealingStatus,
      sealingProcessStatus: report.sealingProcessStatus,
      departedAt: report.departedAt,
      arrivedAt: report.arrivedAt,
      finishedAt: report.finishedAt,
      remarks: report.remarks,
      vessel: report.vessel,
      activity: report.activity,
      product: report.shipmentProducts[0]?.product ?? report.product,
      products: report.shipmentProducts.length > 0
        ? report.shipmentProducts.map((item: LoadingPdfReport["shipmentProducts"][number]) => item.product)
        : (report.product ? [report.product] : []),
      loadingPlant: report.loadingPlant,
      loadingJetty: report.loadingJetty,
      dischargePlant: report.dischargePlant,
      dischargeJetty: report.dischargeJetty,
      loadingMaster: report.loadingMaster,
      unloadingMaster: report.unloadingMaster,
    },
    formConfigurationSnapshot: configuration as PdfFinalSnapshot["formConfigurationSnapshot"],
    attachments: report.attachments.map(snapshotAttachment),
    records: report.sealingRecords.map((record: LoadingPdfReport["sealingRecords"][number]) => ({
      id: record.id,
      vesselSealingPointId: record.vesselSealingPointId,
      pointSnapshot: record.pointSnapshot,
      status: record.status,
      notes: record.notes,
      attachments: record.attachments.map((attachment: LoadingPdfReport["sealingRecords"][number]["attachments"][number]) => snapshotAttachment(attachment)),
      seals: record.seals
        .filter((seal: LoadingPdfReport["sealingRecords"][number]["seals"][number]) => !["REMOVED", "REPLACED"].includes(seal.status))
        .map((seal: LoadingPdfReport["sealingRecords"][number]["seals"][number]) => ({
          id: seal.id,
          sealNumber: seal.sealNumber,
          status: seal.status,
          installedAt: seal.installedAt,
          removedAt: seal.removedAt,
          notes: seal.notes,
          verifications: seal.verifications,
        })),
    })) as PdfFinalSnapshot["records"],
    signatures: report.signatures.map((signature: LoadingPdfReport["signatures"][number]) => ({
      id: signature.id,
      phase: signature.phase,
      role: signature.role,
      name: signature.name,
      signedAt: signature.signedAt?.toISOString() ?? null,
      signatureMimeType: signature.signatureMimeType,
      signatureChecksumSha256: signature.signatureChecksumSha256,
      isSigned: statusById.get(signature.id)?.isSigned ?? false,
      signatureStatus: statusById.get(signature.id)?.state ?? "UNSIGNED",
    })),
    signatureValidation: {
      isComplete: validation.isComplete,
      roles: validation.roles,
      incompleteRoles: validation.incompleteRoles,
    },
  } satisfies PdfFinalSnapshot & Record<string, unknown>;
}

async function ensureLoadingDocument(reportId: string, actor: BaPdfActor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "beritaAcaraDocument">;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
    const report = await tx.sealingReport.findUnique({
      where: { id: reportId },
      select: { id: true, shipmentNumber: true, createdById: true, loadingMasterId: true, status: true },
    });
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    if (!report.shipmentNumber) throw new AppError(400, "PDF BA LOADING hanya tersedia untuk shipment/voyage canonical");
    assertLoadingAccess(report, actor);
    const existing = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: reportId, phase: "LOADING" } },
      select: { id: true },
    });
    if (existing) return existing.id;
    if (report.status !== "DRAFT") throw new AppError(409, "Draft PDF BA LOADING hanya tersedia ketika shipment masih DRAFT");
    const created = await tx.beritaAcaraDocument.create({
      data: { id: randomUUID(), sealingReportId: reportId, phase: "LOADING" },
      select: { id: true },
    });
    return created.id;
  });
}

async function verifiedArtifactFile(artifact: Artifact) {
  const absolutePath = safeExportPath(artifact.storageKey);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new AppError(409, "Artefak PDF BA tercatat tetapi file tidak tersedia");
  }
  if (BigInt(bytes.length) !== artifact.fileSize || hash(bytes) !== artifact.checksumSha256) {
    throw new AppError(409, "Integritas artefak PDF BA gagal diverifikasi");
  }
  return absolutePath;
}

async function loadLoadingDocument(reportId: string, actor: BaPdfActor, database: LoadingPdfClient = prisma) {
  const report = await database.sealingReport.findUnique({ where: { id: reportId }, select: loadingPdfReportSelect });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  if (!report.shipmentNumber) throw new AppError(400, "PDF BA LOADING hanya tersedia untuk shipment/voyage canonical");
  assertLoadingAccess(report, actor);
  const document = report.baDocuments[0];
  if (!document) throw new AppError(404, "Dokumen BA LOADING belum dibuat; panggil endpoint generate terlebih dahulu");
  if (document.status === "FINALIZED") {
    if (!document.snapshot) throw new AppError(409, "Snapshot BA LOADING final tidak tersedia");
    return { report, document, snapshot: parseLoadingSnapshot(document.snapshot), documentValidity: "VALID" as const };
  }
  const snapshot = await buildLoadingDraftSnapshot(report, document);
  return {
    report,
    document,
    snapshot,
    documentValidity: snapshot.signatureValidation?.isComplete ? "VALID" as const : "INVALID_SIGNATURES" as const,
  };
}

export async function generateLoadingBaPdf(reportId: string, actor: BaPdfActor) {
  await ensureLoadingDocument(reportId, actor);
  const initial = await loadLoadingDocument(reportId, actor);
  const snapshotChecksumSha256 = hash(canonicalJson(initial.snapshot));
  if (initial.document.pdfArtifact &&
      initial.document.pdfArtifact.rendererVersion === PDF_RENDERER_VERSION &&
      initial.document.pdfArtifact.snapshotChecksumSha256 === snapshotChecksumSha256) {
    await verifiedArtifactFile(initial.document.pdfArtifact);
    return artifactDetails(initial.document.pdfArtifact, reportId, "LOADING", true);
  }

  const fileName = initial.document.pdfArtifact?.fileName ??
    `BA-LOADING-${safeBaseName(initial.report.shipmentNumber ?? initial.report.voyageNumber ?? initial.report.reportNo)}-${reportId}.pdf`;
  const storageKey = initial.document.pdfArtifact?.storageKey ?? fileName;
  const destination = safeExportPath(storageKey);
  let backupPath: string | null = null;
  let ownsDestination = false;
  try {
    const result = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "beritaAcaraDocument" | "beritaAcaraPdfArtifact" | "auditLog">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const current = await loadLoadingDocument(reportId, actor, tx);
      const { document, snapshot } = current;
      const currentSnapshotChecksum = hash(canonicalJson(snapshot));
      const existing = document.pdfArtifact;
      if (existing && existing.rendererVersion === PDF_RENDERER_VERSION && existing.snapshotChecksumSha256 === currentSnapshotChecksum) {
        await verifiedArtifactFile(existing);
        return artifactDetails(existing, reportId, "LOADING", true);
      }
      if (existing) await verifiedArtifactFile(existing);

      const generated = await buildOfficialPdf(snapshot);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await mkdir(exportRoot, { recursive: true });
      await writeFile(temporary, generated.buffer, { flag: "wx" });
      try {
        if (existing) {
          backupPath = `${destination}.${randomUUID()}.bak`;
          await rename(destination, backupPath);
        }
        await rename(temporary, destination);
        ownsDestination = true;
        const metadata = {
          phase: "LOADING",
          documentStatus: document.status,
          documentValidity: current.documentValidity,
          signatureValidation: snapshot.signatureValidation ?? null,
          templateChecksumSha256: NATIVE_PDF_LAYOUT_SHA256,
          formPageCount: generated.formPageCount,
          appendixPageCount: generated.appendixPageCount,
          pageCount: generated.pageCount,
        } satisfies Prisma.InputJsonValue;
        const data = {
          generatedById: actor.id,
          fileName,
          storageKey,
          mimeType: PDF_CONTENT_TYPE,
          fileSize: BigInt(generated.buffer.length),
          checksumSha256: hash(generated.buffer),
          snapshotChecksumSha256: currentSnapshotChecksum,
          rendererVersion: PDF_RENDERER_VERSION,
          metadata,
          generatedAt: new Date(),
        };
        const saved = existing
          ? await tx.beritaAcaraPdfArtifact.update({ where: { baDocumentId: document.id }, data })
          : await tx.beritaAcaraPdfArtifact.create({ data: { id: randomUUID(), baDocumentId: document.id, ...data } });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: existing ? "UPDATE" : "CREATE",
            entityType: "BA_LOADING_PDF",
            entityId: document.id,
            newData: {
              reportId,
              phase: "LOADING",
              fileName,
              checksumSha256: saved.checksumSha256,
              snapshotChecksumSha256: saved.snapshotChecksumSha256,
              rendererVersion: saved.rendererVersion,
              documentStatus: document.status,
              documentValidity: current.documentValidity,
            },
          },
        });
        return artifactDetails(saved, reportId, "LOADING", false);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
    if (backupPath) await unlink(backupPath).catch(() => undefined);
    return result;
  } catch (error) {
    if (ownsDestination) await unlink(destination).catch(() => undefined);
    if (backupPath) await rename(backupPath, destination).catch(() => undefined);
    throw error;
  }
}

export async function getLoadingBaPdfFile(reportId: string, actor: BaPdfActor) {
  const { document, snapshot } = await loadLoadingDocument(reportId, actor);
  const artifact = document.pdfArtifact;
  if (!artifact) throw new AppError(404, "PDF BA LOADING belum dibuat; panggil endpoint generate terlebih dahulu");
  const snapshotChecksumSha256 = hash(canonicalJson(snapshot));
  if (artifact.rendererVersion !== PDF_RENDERER_VERSION || artifact.snapshotChecksumSha256 !== snapshotChecksumSha256) {
    throw new AppError(409, "PDF BA LOADING perlu dibuat ulang dari snapshot immutable");
  }
  return {
    fileName: artifact.fileName,
    absolutePath: await verifiedArtifactFile(artifact),
    metadata: artifactDetails(artifact, reportId, "LOADING", true),
  };
}

export async function generateUnloadingBaPdf(reportId: string, actor: BaPdfActor) {
  await ensureUnloadingDocument(reportId, actor);
  const initial = await loadUnloadingDocument(reportId, actor);
  const snapshotChecksumSha256 = hash(canonicalJson(initial.snapshot));
  if (initial.document.pdfArtifact &&
      initial.document.pdfArtifact.rendererVersion === UNLOADING_PDF_RENDERER_VERSION &&
      initial.document.pdfArtifact.snapshotChecksumSha256 === snapshotChecksumSha256) {
    await verifiedArtifactFile(initial.document.pdfArtifact);
    return artifactDetails(initial.document.pdfArtifact, reportId, "UNLOADING", true);
  }

  const fileName = initial.document.pdfArtifact?.fileName ??
    `BA-UNLOADING-${safeBaseName(initial.report.shipmentNumber ?? initial.report.voyageNumber ?? initial.report.reportNo)}-${reportId}.pdf`;
  const storageKey = initial.document.pdfArtifact?.storageKey ?? fileName;
  const destination = safeExportPath(storageKey);
  let backupPath: string | null = null;
  let ownsDestination = false;
  try {
    const result = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "sealingReport" | "beritaAcaraPdfArtifact" | "auditLog">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const current = await loadUnloadingDocument(reportId, actor, tx);
      const { document, snapshot } = current;
      const currentSnapshotChecksum = hash(canonicalJson(snapshot));
      const existing = document.pdfArtifact;
      if (existing && existing.rendererVersion === UNLOADING_PDF_RENDERER_VERSION && existing.snapshotChecksumSha256 === currentSnapshotChecksum) {
        await verifiedArtifactFile(existing);
        return artifactDetails(existing, reportId, "UNLOADING", true);
      }
      if (existing) await verifiedArtifactFile(existing);

      const generated = await buildUnloadingBaPdf(snapshot);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await mkdir(exportRoot, { recursive: true });
      await writeFile(temporary, generated.buffer, { flag: "wx" });
      try {
        if (existing) {
          backupPath = `${destination}.${randomUUID()}.bak`;
          await rename(destination, backupPath);
        }
        await rename(temporary, destination);
        ownsDestination = true;
        const metadata = {
          phase: "UNLOADING",
          documentStatus: document.status,
          documentValidity: current.documentValidity,
          signatureValidation: snapshot.signatureValidation ?? null,
          templateChecksumSha256: UNLOADING_PDF_LAYOUT_SHA256,
          formPageCount: generated.formPageCount,
          appendixPageCount: generated.appendixPageCount,
          loadingAppendixPageCount: generated.loadingAppendixPageCount,
          unloadingAppendixPageCount: generated.unloadingAppendixPageCount,
          loadingPhotoCount: generated.loadingPhotoCount,
          unloadingPhotoCount: generated.unloadingPhotoCount,
          nonImageAttachmentCount: generated.nonImageAttachmentCount,
          pageCount: generated.pageCount,
        } satisfies Prisma.InputJsonValue;
        const data = {
          generatedById: actor.id,
          fileName,
          storageKey,
          mimeType: PDF_CONTENT_TYPE,
          fileSize: BigInt(generated.buffer.length),
          checksumSha256: hash(generated.buffer),
          snapshotChecksumSha256: currentSnapshotChecksum,
          rendererVersion: UNLOADING_PDF_RENDERER_VERSION,
          metadata,
          generatedAt: new Date(),
        };
        const saved = existing
          ? await tx.beritaAcaraPdfArtifact.update({ where: { baDocumentId: document.id }, data })
          : await tx.beritaAcaraPdfArtifact.create({ data: { id: randomUUID(), baDocumentId: document.id, ...data } });
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: existing ? "UPDATE" : "CREATE",
            entityType: "BA_UNLOADING_PDF",
            entityId: document.id,
            newData: {
              reportId,
              phase: "UNLOADING",
              fileName,
              checksumSha256: saved.checksumSha256,
              snapshotChecksumSha256: saved.snapshotChecksumSha256,
              rendererVersion: saved.rendererVersion,
              documentStatus: document.status,
              documentValidity: current.documentValidity,
              pageCount: generated.pageCount,
              loadingAppendixPageCount: generated.loadingAppendixPageCount,
              unloadingAppendixPageCount: generated.unloadingAppendixPageCount,
            },
          },
        });
        return artifactDetails(saved, reportId, "UNLOADING", false);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
    if (backupPath) await unlink(backupPath).catch(() => undefined);
    return result;
  } catch (error) {
    if (ownsDestination) await unlink(destination).catch(() => undefined);
    if (backupPath) await rename(backupPath, destination).catch(() => undefined);
    throw error;
  }
}

export async function getUnloadingBaPdfFile(reportId: string, actor: BaPdfActor) {
  const { document, snapshot } = await loadUnloadingDocument(reportId, actor);
  const artifact = document.pdfArtifact;
  if (!artifact) throw new AppError(404, "PDF BA UNLOADING belum dibuat; panggil endpoint generate terlebih dahulu");
  const snapshotChecksumSha256 = hash(canonicalJson(snapshot));
  if (artifact.rendererVersion !== UNLOADING_PDF_RENDERER_VERSION || artifact.snapshotChecksumSha256 !== snapshotChecksumSha256) {
    throw new AppError(409, "PDF BA UNLOADING perlu dibuat ulang dari snapshot immutable");
  }
  return {
    fileName: artifact.fileName,
    absolutePath: await verifiedArtifactFile(artifact),
    metadata: artifactDetails(artifact, reportId, "UNLOADING", true),
  };
}
