import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import type { Prisma, UserRole } from "../generated/prisma/client.js";
import { AppError } from "../utils/app-error.js";
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

async function loadUnloadingDocument(reportId: string, actor: BaPdfActor) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, reportNo: true, shipmentNumber: true, voyageNumber: true,
      unloadingMasterId: true,
      baDocuments: { where: { phase: "UNLOADING" }, include: { pdfArtifact: true } },
    },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  if (!report.shipmentNumber) throw new AppError(400, "PDF BA UNLOADING hanya tersedia untuk shipment/voyage canonical");
  assertUnloadingAccess(report, actor);
  const document = report.baDocuments[0];
  if (!document || document.status !== "FINALIZED" || !document.snapshot) {
    throw new AppError(409, "BA UNLOADING harus difinalisasi sebelum PDF dibuat atau dibaca");
  }
  return { report, document, snapshot: parseUnloadingSnapshot(document.snapshot) };
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

async function loadLoadingDocument(reportId: string, actor: BaPdfActor) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: {
      id: true, reportNo: true, shipmentNumber: true, voyageNumber: true,
      createdById: true, loadingMasterId: true,
      baDocuments: { where: { phase: "LOADING" }, include: { pdfArtifact: true } },
    },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  if (!report.shipmentNumber) throw new AppError(400, "PDF BA LOADING hanya tersedia untuk shipment/voyage canonical");
  assertLoadingAccess(report, actor);
  const document = report.baDocuments[0];
  if (!document || document.status !== "FINALIZED" || !document.snapshot) {
    throw new AppError(409, "BA LOADING harus difinalisasi sebelum PDF dibuat atau dibaca");
  }
  return { report, document, snapshot: parseLoadingSnapshot(document.snapshot) };
}

export async function generateLoadingBaPdf(reportId: string, actor: BaPdfActor) {
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
      const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "beritaAcaraDocument" | "beritaAcaraPdfArtifact" | "auditLog">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const document = await tx.beritaAcaraDocument.findUnique({
        where: { sealingReportId_phase: { sealingReportId: reportId, phase: "LOADING" } },
        include: { pdfArtifact: true },
      });
      if (!document || document.status !== "FINALIZED" || !document.snapshot) throw new AppError(409, "BA LOADING belum difinalisasi");
      const snapshot = parseLoadingSnapshot(document.snapshot);
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
      const tx = rawTransaction as unknown as Pick<typeof prisma, "$queryRawUnsafe" | "beritaAcaraDocument" | "beritaAcaraPdfArtifact" | "auditLog">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const document = await tx.beritaAcaraDocument.findUnique({
        where: { sealingReportId_phase: { sealingReportId: reportId, phase: "UNLOADING" } },
        include: { pdfArtifact: true },
      });
      if (!document || document.status !== "FINALIZED" || !document.snapshot) throw new AppError(409, "BA UNLOADING belum difinalisasi");
      const snapshot = parseUnloadingSnapshot(document.snapshot);
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
