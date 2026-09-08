import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import type { Prisma, UserRole } from "../generated/prisma/client.js";
import { resolveFile } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType } from "../utils/uploaded-file.js";

export const PDF_CONTENT_TYPE = "application/pdf";
export const OFFICIAL_PDF_TEMPLATE_SHA256 = "231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6";
export const PDF_RENDERER_VERSION = "tko-background-overlay-v1";

export type PdfActor = { id: string; role: UserRole };

type SnapshotCompartment = { id: string; code: string; name: string; side: string | null; sequence: number | null };
type SnapshotPoint = {
  vesselSealingPointId: string;
  code: string;
  displayName?: string | null;
  locationName?: string | null;
  side?: string | null;
  instanceNo: number;
  sequence?: number | null;
  section: { code: string; sequence: number };
  template: { id: string; code: string; name: string; sequence: number };
  compartment: SnapshotCompartment | null;
};
type SnapshotAttachment = {
  id: string;
  type: string;
  sectionCode: string | null;
  caption: string | null;
  sequence: number | null;
  fileName: string;
  mimeType: string;
  checksumSha256: string | null;
  createdAt: string;
};
type FinalRecord = {
  vesselSealingPointId: string;
  status: "SEALED" | "NOT_SEALED" | "NOT_APPLICABLE";
  notes: string | null;
  seals: Array<{ sealNumber: string; status: string; verifications?: Array<{ attachments?: SnapshotAttachment[] }> }>;
  attachments?: SnapshotAttachment[];
};
type FinalSignature = {
  id: string;
  role: "CHIEF_OFFICER" | "TERMINAL_REPRESENTATIVE" | "SURVEYOR";
  name: string;
  signedAt: string | null;
  signatureMimeType: string | null;
  signatureChecksumSha256: string | null;
};
export type PdfFinalSnapshot = {
  schemaVersion: number;
  capturedAt: string;
  report: {
    id: string;
    reportNo: string;
    shipmentNumber: string | null;
    voyageNumber: string | null;
    activity: { code: string; name: string } | null;
    vessel: { id: string; name: string; imoNumber: string | null };
    product: { name: string } | null;
    loadingPlant: { code: string; name: string } | null;
    loadingJetty: { name: string } | null;
    dischargePlant: { code: string; name: string } | null;
    dischargeJetty: { name: string } | null;
    sealingStatus: string | null;
    reportDateTime: string;
    loadingMaster: { fullName: string } | null;
    unloadingMaster: { fullName: string } | null;
  };
  formConfigurationSnapshot: { sections: Array<{ code: string; isAvailable: boolean }>; points: SnapshotPoint[] };
  signatures: FinalSignature[];
  records: FinalRecord[];
  attachments?: SnapshotAttachment[];
};
type ExportPoint = SnapshotPoint & { record: FinalRecord | null };

const templatePath = path.resolve(process.cwd(), env.SEALING_PDF_TEMPLATE_PATH);
const exportRoot = path.resolve(process.cwd(), env.PDF_EXPORT_DIR);
const A4 = { width: 595.4, height: 842 };
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function parseFinalSnapshot(value: unknown): PdfFinalSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot final laporan tidak tersedia");
  const snapshot = value as Partial<PdfFinalSnapshot>;
  if (snapshot.schemaVersion !== 1 || !snapshot.report || !snapshot.formConfigurationSnapshot || !Array.isArray(snapshot.formConfigurationSnapshot.points) || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot final laporan tidak didukung generator PDF");
  }
  return snapshot as PdfFinalSnapshot;
}

function assertReadable(report: { createdById: string; loadingMasterId: string | null; unloadingMasterId: string | null }, actor: PdfActor) {
  if (actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) !== actor.id) throw new AppError(403, "Laporan ditugaskan kepada Loading Master lain");
  if (actor.role === "UNLOADING_MASTER" && report.unloadingMasterId !== actor.id) throw new AppError(403, "Laporan ditugaskan kepada Unloading Master lain");
}

async function loadFinalReport(reportId: string, actor: PdfActor) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: { id: true, reportNo: true, shipmentNumber: true, voyageNumber: true, status: true, finalSnapshot: true, createdById: true, loadingMasterId: true, unloadingMasterId: true, pdfArtifact: true },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertReadable(report, actor);
  if (report.status !== "FINISH") throw new AppError(409, "PDF final hanya dapat dibuat dari laporan FINISH");
  return { report, snapshot: parseFinalSnapshot(report.finalSnapshot) };
}

function safeBaseName(value: string) {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "sealing-report";
}

function safeExportPath(storageKey: string) {
  const resolved = path.resolve(exportRoot, storageKey);
  if (!resolved.startsWith(`${exportRoot}${path.sep}`)) throw new AppError(400, "Lokasi hasil PDF tidak valid");
  return resolved;
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function fitText(font: PDFFont, text: string, maxWidth: number, preferred = 7, minimum = 4.5) {
  let size = preferred;
  while (size > minimum && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  return size;
}

function whiteout(page: PDFPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
}

function drawInBox(page: PDFPage, font: PDFFont, value: unknown, box: { x: number; y: number; width: number; height: number }, options: { size?: number; align?: "left" | "center"; bold?: boolean; erase?: boolean } = {}) {
  const text = cleanText(value);
  if (options.erase) whiteout(page, box.x + 0.7, box.y + 0.7, box.width - 1.4, box.height - 1.4);
  if (!text) return;
  const size = fitText(font, text, box.width - 4, options.size ?? 7);
  const textWidth = font.widthOfTextAtSize(text, size);
  const x = options.align === "center" ? box.x + Math.max(2, (box.width - textWidth) / 2) : box.x + 2;
  page.drawText(text, { x, y: box.y + Math.max(1.5, (box.height - size) / 2), size, font, color: rgb(0, 0, 0), maxWidth: box.width - 4 });
}

function drawWrappedInBox(page: PDFPage, font: PDFFont, value: unknown, box: { x: number; y: number; width: number; height: number }, size = 5.2) {
  const text = cleanText(value);
  whiteout(page, box.x + 0.7, box.y + 0.7, box.width - 1.4, box.height - 1.4);
  if (!text) return;
  const words = text.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= box.width - 4) {
      if (lines.length) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else {
      lines.push(word);
    }
  }
  const lineHeight = size + 1;
  const visible = lines.slice(0, Math.max(1, Math.floor((box.height - 3) / lineHeight)));
  const startY = box.y + (box.height + visible.length * lineHeight) / 2 - lineHeight;
  visible.forEach((line, index) => page.drawText(line, { x: box.x + Math.max(2, (box.width - font.widthOfTextAtSize(line, size)) / 2), y: startY - index * lineHeight, size, font, color: rgb(0, 0, 0) }));
}

function pointValue(point: ExportPoint) {
  if (!point.record || point.record.status === "NOT_SEALED") return "NOT_SEALED";
  if (point.record.status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  const numbers = point.record.seals.filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status)).map((seal) => seal.sealNumber);
  return numbers.length ? numbers.join(", ") : "NOT_SEALED";
}

function sortPoints(points: ExportPoint[]) {
  return [...points].sort((a, b) => (a.compartment?.sequence ?? 9999) - (b.compartment?.sequence ?? 9999) || (a.sequence ?? 9999) - (b.sequence ?? 9999) || a.template.sequence - b.template.sequence || a.instanceNo - b.instanceNo || a.code.localeCompare(b.code));
}

function pageSetCount(points: ExportPoint[]) {
  const bySection = Object.fromEntries("ABCDEFGH".split("").map((code) => [code, points.filter((point) => point.section.code === code)])) as Record<string, ExportPoint[]>;
  const aGroups = new Set(bySection.A!.map((point) => point.compartment?.id ?? point.vesselSealingPointId)).size;
  const aTemplates = new Set(bySection.A!.map((point) => point.template.id)).size;
  const capacities: Record<string, number> = { B: 14, C: 16, D: 16, E: 18, F: 12, G: 14, H: 4 };
  let count = Math.max(1, Math.ceil(aGroups / 28) * Math.ceil(aTemplates / 5));
  for (const code of "BCDEFGH") count = Math.max(count, Math.ceil(bySection[code]!.length / capacities[code]!));
  return count;
}

function renderHeader(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: PdfFinalSnapshot, set: number, setCount: number) {
  const report = snapshot.report;
  const terminal = report.activity?.code === "DISCHARGE"
    ? `${report.dischargePlant?.name ?? ""} / ${report.dischargeJetty?.name ?? ""}`
    : `${report.loadingPlant?.name ?? ""} / ${report.loadingJetty?.name ?? ""}`;
  const values = [report.vessel.name, terminal, report.product?.name ?? "", new Date(report.reportDateTime).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })];
  [728.5, 716.6, 704.7, 692.8].forEach((y, index) => drawInBox(page, font, values[index], { x: 199, y, width: 232, height: 11 }, { erase: true }));
  whiteout(page, 434, 689, 150, 76);
  const info = [
    `Shipment: ${report.shipmentNumber ?? "-"}`,
    `Voyage: ${report.voyageNumber ?? "-"}`,
    `Activity: ${report.activity?.code ?? "-"}`,
    `Status: ${report.sealingStatus ?? "-"}`,
    `Loading: ${report.loadingPlant?.name ?? "-"} / ${report.loadingJetty?.name ?? "-"}`,
    `Discharge: ${report.dischargePlant?.name ?? "-"} / ${report.dischargeJetty?.name ?? "-"}`,
    `Report: ${report.reportNo}`,
    ...(setCount > 1 ? [`Continuation: ${set}/${setCount}`] : []),
  ];
  info.forEach((line, index) => page.drawText(line, { x: 438, y: 753 - index * 10, size: fitText(index === 0 ? bold : font, line, 142, 6.8, 4.5), font: index === 0 ? bold : font, color: rgb(0, 0, 0) }));
  drawInBox(page, font, report.loadingMaster?.fullName ?? report.unloadingMaster?.fullName ?? "", { x: 237, y: 658, width: 153, height: 13 }, { erase: true });
  drawInBox(page, font, report.vessel.name, { x: 84, y: 646, width: 161, height: 12 }, { erase: true });
  drawInBox(page, font, terminal, { x: 247, y: 646, width: 137, height: 12 }, { erase: true });
  drawInBox(page, bold, report.activity?.code ?? "", { x: 243, y: 634, width: 101, height: 12 }, { align: "center", erase: true });
  drawInBox(page, font, `${report.vessel.name} / ${report.product?.name ?? ""}`, { x: 84, y: 622, width: 164, height: 12 }, { erase: true });
}

function renderUnavailableSection(page: PDFPage, font: PDFFont, code: string) {
  if (code === "A") {
    const row = rowsBetween(482.3, 81.8, 28)[0]!;
    drawInBox(page, font, "Bagian A tidak tersedia", { x: 129.7, y: row.y, width: 72.3, height: row.height }, { erase: true, size: 5.5 });
    drawInBox(page, font, "NOT_APPLICABLE", { x: 202.1, y: row.y, width: 61.6, height: row.height }, { erase: true, align: "center", size: 5.5 });
    return;
  }
  const layout = SECTION_LAYOUT[code]!;
  const rowCount = layout.rowsPerSide ?? (code === "G" ? 14 : 4);
  const row = sectionRows(layout, rowCount)[0]!;
  drawInBox(page, font, `Bagian ${code} tidak tersedia`, { x: layout.label[0], y: row.y, width: layout.label[1], height: row.height }, { erase: true, size: 6 });
  drawInBox(page, font, "NOT_APPLICABLE", { x: layout.value[0], y: row.y, width: layout.value[1], height: row.height }, { erase: true, align: "center", size: 6 });
}

const rowsBetween = (top: number, bottom: number, count: number) => Array.from({ length: count }, (_, index) => ({ y: top - ((index + 1) * (top - bottom) / count), height: (top - bottom) / count }));

function renderSectionA(page: PDFPage, font: PDFFont, points: ExportPoint[], setIndex: number) {
  const groups = new Map<string, { compartment: SnapshotCompartment | null; points: ExportPoint[] }>();
  for (const point of sortPoints(points)) {
    const key = point.compartment?.id ?? point.vesselSealingPointId;
    const group = groups.get(key) ?? { compartment: point.compartment, points: [] };
    group.points.push(point);
    groups.set(key, group);
  }
  const allGroups = [...groups.values()];
  const templates = [...new Map(points.map((point) => [point.template.id, point.template])).values()].sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const columnChunks = Math.max(1, Math.ceil(templates.length / 5));
  const rowChunk = Math.floor(setIndex / columnChunks);
  const columnChunk = setIndex % columnChunks;
  const visibleGroups = allGroups.slice(rowChunk * 28, (rowChunk + 1) * 28);
  const visibleTemplates = templates.slice(columnChunk * 5, (columnChunk + 1) * 5);
  const rowBoxes = rowsBetween(482.3, 81.8, 28);
  const columns = [[202.1, 61.6], [263.7, 60], [323.7, 61.4], [385.1, 67], [452.1, 72.1]] as const;
  columns.forEach(([x, width], index) => drawWrappedInBox(page, font, visibleTemplates[index]?.name ?? "", { x, y: 482.3, width, height: 53.5 }));
  visibleGroups.forEach((group, rowIndex) => {
    const row = rowBoxes[rowIndex]!;
    drawInBox(page, font, group.compartment?.code ?? group.points[0]?.locationName ?? group.points[0]?.displayName ?? "", { x: 129.7, y: row.y, width: 72.3, height: row.height }, { align: "center", erase: true });
    visibleTemplates.forEach((template, columnIndex) => {
      const values = group.points.filter((point) => point.template.id === template.id).map(pointValue);
      const [x, width] = columns[columnIndex]!;
      drawInBox(page, font, values.join(" / "), { x, y: row.y, width, height: row.height }, { align: "center", erase: true, size: 6 });
    });
  });
}

type SectionLayout = { page: 1 | 2; top: number; bottom: number; rowsPerSide?: number; edges?: number[]; label: [number, number]; value: [number, number]; rightLabel?: [number, number]; rightValue?: [number, number] };
const SECTION_LAYOUT: Record<string, SectionLayout> = {
  B: { page: 1, top: 724.2, bottom: 624.3, rowsPerSide: 7, label: [136.6, 108.3], value: [245.1, 76.2], rightLabel: [354.3, 94.7], rightValue: [449.4, 74.8] },
  C: { page: 1, top: 565.5, bottom: 451.1, rowsPerSide: 8, label: [138.3, 121], value: [259.7, 61.6], rightLabel: [357, 102.5], rightValue: [459.9, 64.3] },
  D: { page: 1, top: 380.9, bottom: 266.7, rowsPerSide: 8, label: [138.3, 121], value: [259.7, 61.6], rightLabel: [357, 102.5], rightValue: [459.9, 64.3] },
  E: { page: 1, top: 206.3, bottom: 77.8, rowsPerSide: 9, label: [138.3, 121], value: [259.7, 61.6], rightLabel: [357, 102.5], rightValue: [459.9, 64.3] },
  F: { page: 2, top: 712, bottom: 626.3, rowsPerSide: 6, label: [138.3, 121], value: [259.7, 61.6], rightLabel: [357, 102.5], rightValue: [459.9, 64.3] },
  G: { page: 2, top: 579.2, bottom: 396.3, edges: [579.2, 568.4, 557.5, 546.5, 535.7, 524.9, 514.1, 503.1, 492.3, 481.5, 470.7, 459.7, 438.5, 417.3, 396.3], label: [140.7, 194.6], value: [335.7, 188.5] },
  H: { page: 2, top: 350.3, bottom: 264.1, edges: [350.3, 307.1, 296.3, 285.5, 264.1], label: [140.7, 194.6], value: [335.7, 188.5] },
};

function sectionRows(layout: SectionLayout, count: number) {
  if (!layout.edges) return rowsBetween(layout.top, layout.bottom, count);
  return layout.edges.slice(0, -1).map((top, index) => ({ y: layout.edges![index + 1]!, height: top - layout.edges![index + 1]! }));
}

function renderFlatSection(page: PDFPage, font: PDFFont, points: ExportPoint[], code: string, setIndex: number) {
  const layout = SECTION_LAYOUT[code]!;
  const capacity = layout.rowsPerSide ? layout.rowsPerSide * 2 : code === "G" ? 14 : 4;
  const visible = sortPoints(points).slice(setIndex * capacity, (setIndex + 1) * capacity);
  const leftCount = layout.rowsPerSide ?? capacity;
  const rows = sectionRows(layout, leftCount);
  for (let index = 0; index < capacity; index += 1) {
    const right = Boolean(layout.rowsPerSide && index >= layout.rowsPerSide);
    const row = rows[right ? index - layout.rowsPerSide! : index]!;
    const label = right ? layout.rightLabel! : layout.label;
    const value = right ? layout.rightValue! : layout.value;
    drawInBox(page, font, "", { x: label[0], y: row.y, width: label[1], height: row.height }, { erase: true });
    drawInBox(page, font, "", { x: value[0], y: row.y, width: value[1], height: row.height }, { erase: true });
  }
  visible.forEach((point, index) => {
    const right = Boolean(layout.rowsPerSide && index >= layout.rowsPerSide);
    const row = rows[right ? index - layout.rowsPerSide! : index]!;
    const label = right ? layout.rightLabel! : layout.label;
    const value = right ? layout.rightValue! : layout.value;
    const suffix = point.instanceNo > 1 ? ` (${point.instanceNo})` : "";
    drawInBox(page, font, `${point.displayName ?? point.template.name}${suffix}`, { x: label[0], y: row.y, width: label[1], height: row.height }, { erase: true, size: 6.5 });
    drawInBox(page, font, pointValue(point), { x: value[0], y: row.y, width: value[1], height: row.height }, { align: "center", erase: true, size: 6.2 });
  });
}

async function readVerifiedStoredImage(id: string, mimeType: string, expectedChecksum: string | null, signature = false) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return null;
  const key = `${signature ? "signature-" : ""}${id}.${extensionForMimeType(mimeType)}`;
  let bytes: Buffer;
  try { bytes = await readFile(resolveFile(key)); } catch { throw new AppError(409, `File snapshot ${key} tidak tersedia`); }
  if (expectedChecksum && hash(bytes) !== expectedChecksum) throw new AppError(409, `Checksum file snapshot ${key} tidak sesuai`);
  if (mimeType === "image/webp") bytes = await sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  return { bytes, mimeType: mimeType === "image/jpeg" ? "image/jpeg" : "image/png" };
}

async function embedStoredImage(document: PDFDocument, id: string, mimeType: string, checksum: string | null, signature = false): Promise<PDFImage | null> {
  const stored = await readVerifiedStoredImage(id, mimeType, checksum, signature);
  if (!stored) return null;
  return stored.mimeType === "image/jpeg" ? document.embedJpg(stored.bytes) : document.embedPng(stored.bytes);
}

async function renderSignatures(document: PDFDocument, page: PDFPage, font: PDFFont, signatures: FinalSignature[]) {
  const roles = ["CHIEF_OFFICER", "TERMINAL_REPRESENTATIVE", "SURVEYOR"] as const;
  const xs = [85.4, 231.9, 378.3];
  for (let index = 0; index < roles.length; index += 1) {
    const signature = signatures.find((item) => item.role === roles[index]);
    if (!signature) continue;
    whiteout(page, xs[index]! + 2, 106, 141, 91);
    drawInBox(page, font, signature.name, { x: xs[index]!, y: 106, width: 145, height: 14 }, { align: "center" });
    if (signature.signedAt) drawInBox(page, font, new Date(signature.signedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }), { x: xs[index]!, y: 119, width: 145, height: 10 }, { align: "center", size: 5.5 });
    if (signature.signatureMimeType === "application/pdf") {
      const key = `signature-${signature.id}.pdf`;
      let bytes: Buffer;
      try { bytes = await readFile(resolveFile(key)); } catch { throw new AppError(409, `File snapshot ${key} tidak tersedia`); }
      if (signature.signatureChecksumSha256 && hash(bytes) !== signature.signatureChecksumSha256) throw new AppError(409, `Checksum file snapshot ${key} tidak sesuai`);
      const signaturePdf = await PDFDocument.load(bytes, { updateMetadata: false });
      if (signaturePdf.getPageCount() < 1) throw new AppError(409, `File tanda tangan ${key} tidak mempunyai halaman`);
      const embedded = await document.embedPage(signaturePdf.getPage(0));
      const scale = Math.min(125 / embedded.width, 62 / embedded.height);
      page.drawPage(embedded, { x: xs[index]! + (145 - embedded.width * scale) / 2, y: 130 + (62 - embedded.height * scale) / 2, width: embedded.width * scale, height: embedded.height * scale });
    } else if (signature.signatureMimeType) {
      const image = await embedStoredImage(document, signature.id, signature.signatureMimeType, signature.signatureChecksumSha256, true);
      if (image) {
        const scale = Math.min(125 / image.width, 62 / image.height);
        page.drawImage(image, { x: xs[index]! + (145 - image.width * scale) / 2, y: 130 + (62 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
      }
    }
  }
}

function collectPhotos(snapshot: PdfFinalSnapshot) {
  const items: SnapshotAttachment[] = [...(snapshot.attachments ?? [])];
  for (const record of snapshot.records) {
    items.push(...(record.attachments ?? []));
    for (const seal of record.seals) for (const verification of seal.verifications ?? []) items.push(...(verification.attachments ?? []));
  }
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .filter((item) => item.type === "PHOTO" && ["image/jpeg", "image/png", "image/webp"].includes(item.mimeType))
    .sort((a, b) => (a.sequence ?? 2_147_483_647) - (b.sequence ?? 2_147_483_647) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function appendPhotoPages(document: PDFDocument, snapshot: PdfFinalSnapshot, font: PDFFont, bold: PDFFont) {
  const photos = collectPhotos(snapshot);
  const perPage = 9;
  for (let pageIndex = 0; pageIndex < Math.ceil(photos.length / perPage); pageIndex += 1) {
    const page = document.addPage([A4.width, A4.height]);
    page.drawText("APPENDIX DOKUMENTASI", { x: 36, y: 806, size: 13, font: bold });
    page.drawText(`${snapshot.report.shipmentNumber ?? snapshot.report.reportNo} - ${snapshot.report.vessel.name}`, { x: 36, y: 790, size: 8, font });
    const chunk = photos.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    for (let index = 0; index < chunk.length; index += 1) {
      const photo = chunk[index]!;
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 36 + column * 176;
      const top = 765 - row * 240;
      page.drawRectangle({ x, y: top - 205, width: 164, height: 213, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.6 });
      const image = await embedStoredImage(document, photo.id, photo.mimeType, photo.checksumSha256);
      if (image) {
        const scale = Math.min(154 / image.width, 166 / image.height);
        page.drawImage(image, { x: x + 5 + (154 - image.width * scale) / 2, y: top - 171 + (166 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
      }
      const caption = `${photo.sequence ?? pageIndex * perPage + index + 1}. ${photo.caption ?? photo.fileName}`;
      drawInBox(page, font, caption, { x: x + 4, y: top - 202, width: 156, height: 25 }, { align: "center", size: 6.5 });
      if (photo.sectionCode) page.drawText(`Bagian ${photo.sectionCode}`, { x: x + 6, y: top - 184, size: 5.5, font });
    }
    page.drawText(`Appendix ${pageIndex + 1}/${Math.ceil(photos.length / perPage)}`, { x: 480, y: 20, size: 6, font });
  }
  return Math.ceil(photos.length / perPage);
}

export async function buildOfficialPdf(snapshotInput: PdfFinalSnapshot) {
  const snapshot = parseFinalSnapshot(snapshotInput);
  const templateBytes = await readFile(templatePath);
  const templateChecksumSha256 = hash(templateBytes);
  if (templateChecksumSha256 !== OFFICIAL_PDF_TEMPLATE_SHA256) throw new AppError(409, "Checksum template PDF TKO berubah; generator dihentikan");
  const source = await PDFDocument.load(templateBytes, { updateMetadata: false });
  if (source.getPageCount() !== 3) throw new AppError(409, "Template PDF TKO wajib terdiri dari 3 halaman");
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const recordByPoint = new Map(snapshot.records.map((record) => [record.vesselSealingPointId, record]));
  const points = snapshot.formConfigurationSnapshot.points.map((point) => ({ ...point, record: recordByPoint.get(point.vesselSealingPointId) ?? null }));
  const bySection = Object.fromEntries("ABCDEFGH".split("").map((code) => [code, points.filter((point) => point.section.code === code)])) as Record<string, ExportPoint[]>;
  const availability = new Map(snapshot.formConfigurationSnapshot.sections.map((section) => [section.code, section.isAvailable]));
  const sets = pageSetCount(points);
  for (let setIndex = 0; setIndex < sets; setIndex += 1) {
    const pages = await output.copyPages(source, [0, 1, 2]);
    pages.forEach((page) => output.addPage(page));
    renderHeader(pages[0]!, font, bold, snapshot, setIndex + 1, sets);
    renderSectionA(pages[0]!, font, bySection.A!, setIndex);
    for (const code of "BCDE") renderFlatSection(pages[1]!, font, bySection[code]!, code, setIndex);
    for (const code of "FGH") renderFlatSection(pages[2]!, font, bySection[code]!, code, setIndex);
    if (setIndex === 0) {
      if (availability.get("A") === false) renderUnavailableSection(pages[0]!, font, "A");
      for (const code of "BCDE") if (availability.get(code) === false) renderUnavailableSection(pages[1]!, font, code);
      for (const code of "FGH") if (availability.get(code) === false) renderUnavailableSection(pages[2]!, font, code);
    }
    if (setIndex === sets - 1) await renderSignatures(output, pages[2]!, font, snapshot.signatures);
  }
  const appendixPageCount = await appendPhotoPages(output, snapshot, font, bold);
  const fixedDate = new Date(snapshot.capturedAt);
  output.setTitle(`Laporan Segel ${snapshot.report.shipmentNumber ?? snapshot.report.reportNo}`);
  output.setSubject("Laporan Segel Kapal TKO B3.1-612");
  output.setAuthor("Sistem Segel Kapal");
  output.setCreator(PDF_RENDERER_VERSION);
  output.setProducer(PDF_RENDERER_VERSION);
  output.setCreationDate(fixedDate);
  output.setModificationDate(fixedDate);
  const buffer = Buffer.from(await output.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  return { buffer, templateChecksumSha256, snapshotChecksumSha256: hash(canonicalJson(snapshot)), formPageCount: sets * 3, appendixPageCount, pageCount: sets * 3 + appendixPageCount };
}

function metadata(artifact: { sealingReportId: string; fileName: string; mimeType: string; fileSize: bigint; checksumSha256: string; templateChecksumSha256: string; snapshotChecksumSha256: string; rendererVersion: string; formPageCount: number; appendixPageCount: number; pageCount: number; generatedAt: Date }, reused: boolean) {
  return {
    reportId: artifact.sealingReportId, fileName: artifact.fileName, mimeType: artifact.mimeType, fileSize: Number(artifact.fileSize), checksumSha256: artifact.checksumSha256,
    templateChecksumSha256: artifact.templateChecksumSha256, snapshotChecksumSha256: artifact.snapshotChecksumSha256, rendererVersion: artifact.rendererVersion,
    formPageCount: artifact.formPageCount, appendixPageCount: artifact.appendixPageCount, pageCount: artifact.pageCount, generatedAt: artifact.generatedAt, reused,
    previewUrl: `/api/v1/reports/${artifact.sealingReportId}/pdf/preview`, downloadUrl: `/api/v1/reports/${artifact.sealingReportId}/pdf/download`,
  };
}

async function verifiedArtifactFile(artifact: { storageKey: string; fileSize: bigint; checksumSha256: string }) {
  const absolutePath = safeExportPath(artifact.storageKey);
  let bytes: Buffer;
  try { bytes = await readFile(absolutePath); } catch { throw new AppError(409, "Artefak PDF tercatat tetapi file tidak tersedia"); }
  if (BigInt(bytes.length) !== artifact.fileSize || hash(bytes) !== artifact.checksumSha256) throw new AppError(409, "Integritas artefak PDF gagal diverifikasi");
  return absolutePath;
}

export async function generateOfficialPdf(reportId: string, actor: PdfActor) {
  const { report, snapshot } = await loadFinalReport(reportId, actor);
  if (report.pdfArtifact) {
    await verifiedArtifactFile(report.pdfArtifact);
    return metadata(report.pdfArtifact, true);
  }
  const fileName = `${safeBaseName(report.shipmentNumber ?? report.voyageNumber ?? report.reportNo)}-${report.id}.pdf`;
  const storageKey = fileName;
  const destination = safeExportPath(storageKey);
  let ownsDestination = false;
  try {
    return await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as Pick<typeof prisma, "pdfArtifact" | "auditLog" | "$queryRawUnsafe">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const existing = await tx.pdfArtifact.findUnique({ where: { sealingReportId: reportId } });
      if (existing) {
        await verifiedArtifactFile(existing);
        return metadata(existing, true);
      }
      const generated = await buildOfficialPdf(snapshot);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await mkdir(exportRoot, { recursive: true });
      await writeFile(temporary, generated.buffer, { flag: "wx" });
      try {
        await rename(temporary, destination);
        ownsDestination = true;
        const created = await tx.pdfArtifact.create({ data: {
          sealingReportId: report.id, generatedById: actor.id, fileName, storageKey, fileSize: BigInt(generated.buffer.length), checksumSha256: hash(generated.buffer),
          templateChecksumSha256: generated.templateChecksumSha256, snapshotChecksumSha256: generated.snapshotChecksumSha256, rendererVersion: PDF_RENDERER_VERSION,
          formPageCount: generated.formPageCount, appendixPageCount: generated.appendixPageCount, pageCount: generated.pageCount,
        } });
        await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", entityType: "PDF_EXPORT", entityId: report.id, newData: {
          fileName, fileSize: generated.buffer.length, checksumSha256: created.checksumSha256, templateChecksumSha256: created.templateChecksumSha256,
          snapshotChecksumSha256: created.snapshotChecksumSha256, rendererVersion: created.rendererVersion, formPageCount: created.formPageCount,
          appendixPageCount: created.appendixPageCount, pageCount: created.pageCount,
        } as Prisma.InputJsonValue } });
        return metadata(created, false);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    }, { maxWait: 10_000, timeout: 120_000 });
  } catch (error) {
    if (ownsDestination) await unlink(destination).catch(() => undefined);
    throw error;
  }
}

export async function getOfficialPdfFile(reportId: string, actor: PdfActor) {
  const { report } = await loadFinalReport(reportId, actor);
  if (!report.pdfArtifact) throw new AppError(404, "PDF belum dibuat; panggil endpoint generate terlebih dahulu");
  return { fileName: report.pdfArtifact.fileName, absolutePath: await verifiedArtifactFile(report.pdfArtifact), metadata: metadata(report.pdfArtifact, true) };
}
