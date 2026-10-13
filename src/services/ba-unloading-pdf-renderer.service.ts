import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import sharp from "sharp";

import { resolveFile } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType } from "../utils/uploaded-file.js";

export const UNLOADING_PDF_RENDERER_VERSION = "ba-unloading-native-v2-signature-validity";
export const UNLOADING_PDF_LAYOUT_SHA256 = createHash("sha256")
  .update("ba-unloading-native-layout-v2-signature-validity")
  .digest("hex");

type SnapshotSignature = {
  id: string;
  phase: "LOADING" | "UNLOADING";
  role: "CHIEF_OFFICER" | "SURVEYOR" | "TERMINAL_REPRESENTATIVE";
  name: string;
  signedAt: string | null;
  signatureMimeType: string | null;
  signatureChecksumSha256: string | null;
  isSigned?: boolean;
  signatureStatus?: "MISSING" | "UNSIGNED" | "INVALID_FILE" | "SIGNED";
};

type SnapshotAttachment = {
  id: string;
  type?: string | null;
  caption?: string | null;
  sequence?: number | null;
  fileName: string;
  mimeType: string;
  checksumSha256?: string | null;
  createdAt?: string | null;
  uploadedAt?: string | null;
  sealingRecordId?: string | null;
  sealId?: string | null;
  verificationId?: string | null;
  provenance?: {
    phase?: string | null;
    ownerType?: string | null;
    sealingRecordId?: string | null;
    sealId?: string | null;
    verificationId?: string | null;
    uploadedAt?: string | null;
    uploadedById?: string | null;
  } | null;
};

type SnapshotVerification = {
  id: string;
  condition: string;
  verifiedAt: string;
  remarks?: string | null;
  attachments?: SnapshotAttachment[];
};

type SnapshotSeal = {
  id: string;
  sealNumber: string;
  status: string;
  loadingStatus?: string;
  unloadingStatus?: string;
  verifications?: SnapshotVerification[];
};

type SnapshotRecord = {
  id?: string;
  vesselSealingPointId: string;
  pointSnapshot?: unknown;
  status: string;
  seals: SnapshotSeal[];
};

export type UnloadingPdfSnapshot = {
  schemaVersion: number;
  documentType: "BERITA_ACARA";
  phase: "UNLOADING";
  capturedAt: string;
  finalizedById?: string | null;
  loadingSnapshotReference: {
    baDocumentId: string;
    snapshotVersion: number;
    finalizedAt: string;
    snapshotChecksumSha256: string;
  };
  report: {
    id: string;
    reportNo: string;
    shipmentNumber: string | null;
    voyageNumber: string | null;
    vessel: { name: string; imoNumber?: string | null };
    product?: { name: string } | null;
    products?: Array<{ id?: string; name: string }>;
    loadingPlant?: { code?: string; name: string } | null;
    loadingJetty?: { name: string } | null;
    dischargePlant?: { code?: string; name: string } | null;
    dischargeJetty?: { name: string } | null;
    reportDateTime: string;
  };
  formConfigurationSnapshot: {
    sections: unknown[];
    points: Array<{
      vesselSealingPointId: string;
      code?: string | null;
      displayName?: string | null;
      locationName?: string | null;
      section?: { code?: string | null } | null;
    }>;
  };
  records: SnapshotRecord[];
  loadingAttachments: SnapshotAttachment[];
  unloadingAttachments: SnapshotAttachment[];
  loadingSignatures: SnapshotSignature[];
  unloadingSignatures: SnapshotSignature[];
  signatures: SnapshotSignature[];
  signatureValidation?: {
    isComplete: boolean;
    incompleteRoles: SnapshotSignature["role"][];
    roles?: Array<Record<string, unknown>>;
  };
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 36;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ROLE_ORDER = ["CHIEF_OFFICER", "SURVEYOR", "TERMINAL_REPRESENTATIVE"] as const;
const ROLE_LABELS: Record<(typeof ROLE_ORDER)[number], string> = {
  CHIEF_OFFICER: "Chief Officer",
  SURVEYOR: "Surveyor",
  TERMINAL_REPRESENTATIVE: "Terminal Representative",
};
const COLORS = {
  ink: rgb(0.08, 0.1, 0.14),
  muted: rgb(0.38, 0.42, 0.48),
  line: rgb(0.2, 0.24, 0.3),
  header: rgb(0.89, 0.94, 0.98),
  pale: rgb(0.96, 0.98, 0.99),
  white: rgb(1, 1, 1),
};
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

function clean(value: unknown) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function parseSnapshot(value: unknown): UnloadingPdfSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot BA UNLOADING tidak tersedia");
  const snapshot = value as Partial<UnloadingPdfSnapshot>;
  if (snapshot.schemaVersion !== 1 || snapshot.documentType !== "BERITA_ACARA" || snapshot.phase !== "UNLOADING" ||
      !snapshot.report || !snapshot.loadingSnapshotReference || !snapshot.formConfigurationSnapshot ||
      !Array.isArray(snapshot.records) || !Array.isArray(snapshot.loadingAttachments) ||
      !Array.isArray(snapshot.unloadingAttachments) || !Array.isArray(snapshot.loadingSignatures) ||
      !Array.isArray(snapshot.unloadingSignatures) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot BA UNLOADING tidak didukung generator PDF");
  }
  if (snapshot.loadingSignatures.some((item) => item.phase !== "LOADING") ||
      snapshot.unloadingSignatures.some((item) => item.phase !== "UNLOADING")) {
    throw new AppError(409, "Snapshot BA UNLOADING mencampurkan signature antar phase");
  }
  for (const phase of [snapshot.loadingSignatures, snapshot.unloadingSignatures]) {
    const roles = new Set(phase.map((item) => item.role));
    if (roles.size !== phase.length || phase.some((item) => !ROLE_ORDER.includes(item.role))) {
      throw new AppError(409, "Snapshot BA UNLOADING mempunyai signature role duplikat atau tidak didukung");
    }
  }
  for (const [label, phase] of [["LOADING", snapshot.loadingSignatures], ["UNLOADING", snapshot.unloadingSignatures]] as const) {
    const roles = new Set(phase.map((item) => item.role));
    if (phase.length !== ROLE_ORDER.length || ROLE_ORDER.some((role) => !roles.has(role))) {
      throw new AppError(409, `Snapshot BA UNLOADING tidak mempunyai tiga slot signature ${label} lengkap`);
    }
  }
  return snapshot as UnloadingPdfSnapshot;
}

function wrap(font: PDFFont, value: unknown, maxWidth: number, size: number) {
  const words = clean(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const previous = lines.at(-1);
    const candidate = previous ? `${previous} ${word}` : word;
    if (!previous || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      if (previous) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else lines.push(word);
  }
  return lines;
}

function drawBoxText(page: PDFPage, regular: PDFFont, bold: PDFFont, value: unknown, x: number, y: number, width: number, height: number, options: { bold?: boolean; center?: boolean; fill?: ReturnType<typeof rgb>; size?: number } = {}) {
  page.drawRectangle({ x, y, width, height, color: options.fill ?? COLORS.white, borderColor: COLORS.line, borderWidth: 0.55 });
  const font = options.bold ? bold : regular;
  let size = options.size ?? 7;
  let lines = wrap(font, value, width - 6, size);
  while (size > 4.5 && lines.length * (size + 1.2) > height - 5) {
    size -= 0.25;
    lines = wrap(font, value, width - 6, size);
  }
  const visible = lines.slice(0, Math.max(1, Math.floor((height - 5) / (size + 1.2))));
  const start = y + (height + visible.length * (size + 1.2)) / 2 - size;
  visible.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, size);
    page.drawText(line, { x: options.center ? x + (width - textWidth) / 2 : x + 3, y: start - index * (size + 1.2), size, font, color: COLORS.ink });
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
}

function pointLabel(record: SnapshotRecord) {
  const point = record.pointSnapshot && typeof record.pointSnapshot === "object" && !Array.isArray(record.pointSnapshot)
    ? record.pointSnapshot as Record<string, unknown>
    : {};
  return clean(point.displayName ?? point.locationName ?? point.name ?? point.code ?? record.vesselSealingPointId) || "-";
}

function drawChrome(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: UnloadingPdfSnapshot, pageNumber: number, pageCount: number, title: string) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE.width, height: PAGE.height, color: COLORS.white });
  page.drawText("PT PERTAMINA PATRA NIAGA", { x: MARGIN, y: 804, size: 8.5, font: bold, color: COLORS.ink });
  const phase = "BERITA ACARA UNLOADING / FINAL";
  page.drawText(phase, { x: PAGE.width - MARGIN - bold.widthOfTextAtSize(phase, 8.5), y: 804, size: 8.5, font: bold, color: COLORS.ink });
  page.drawLine({ start: { x: MARGIN, y: 794 }, end: { x: PAGE.width - MARGIN, y: 794 }, thickness: 0.8, color: COLORS.line });
  page.drawText(title, { x: MARGIN, y: 766, size: 15, font: bold, color: COLORS.ink });
  page.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE.width - MARGIN, y: 30 }, thickness: 0.45, color: COLORS.line });
  const footer = `${snapshot.report.shipmentNumber ?? snapshot.report.reportNo} • ${snapshot.report.vessel.name}`;
  page.drawText(footer, { x: MARGIN, y: 18, size: 6.2, font, color: COLORS.muted });
  const pagination = `Halaman ${pageNumber}/${pageCount}`;
  page.drawText(pagination, { x: PAGE.width - MARGIN - font.widthOfTextAtSize(pagination, 6.2), y: 18, size: 6.2, font, color: COLORS.muted });
}

type VerificationRow = {
  point: string;
  sealNumber: string;
  loadingStatus: string;
  unloadingStatus: string;
  condition: string;
  verifiedAt: string;
  remarks: string;
};

function verificationRows(snapshot: UnloadingPdfSnapshot): VerificationRow[] {
  const recordByPoint = new Map(snapshot.records.map((record) => [record.vesselSealingPointId, record]));
  const pointIds = new Set(snapshot.formConfigurationSnapshot.points.map((point) => point.vesselSealingPointId));
  const configured = snapshot.formConfigurationSnapshot.points.flatMap((point): VerificationRow[] => {
    const record = recordByPoint.get(point.vesselSealingPointId);
    const configuredLabel = clean(point.displayName ?? point.locationName ?? point.code ?? point.vesselSealingPointId) || "-";
    if (!record || record.seals.length === 0) {
      return [{
        point: configuredLabel,
        sealNumber: "-",
        loadingStatus: record?.status ?? "NOT_RECORDED",
        unloadingStatus: "-",
        condition: "-",
        verifiedAt: "-",
        remarks: "-",
      }];
    }
    return record.seals.map((seal) => {
      const verification = seal.verifications?.[0];
      return {
        point: configuredLabel,
        sealNumber: seal.sealNumber,
        loadingStatus: seal.loadingStatus ?? seal.status,
        unloadingStatus: seal.unloadingStatus ?? seal.status,
        condition: verification?.condition ?? "-",
        verifiedAt: formatDate(verification?.verifiedAt),
        remarks: verification?.remarks ?? "-",
      };
    });
  });
  const legacyOrOrphaned = snapshot.records
    .filter((record) => !pointIds.has(record.vesselSealingPointId))
    .flatMap((record): VerificationRow[] => record.seals.length === 0
      ? [{ point: pointLabel(record), sealNumber: "-", loadingStatus: record.status, unloadingStatus: "-", condition: "-", verifiedAt: "-", remarks: "-" }]
      : record.seals.map((seal) => {
        const verification = seal.verifications?.[0];
        return {
          point: pointLabel(record),
          sealNumber: seal.sealNumber,
          loadingStatus: seal.loadingStatus ?? seal.status,
          unloadingStatus: seal.unloadingStatus ?? seal.status,
          condition: verification?.condition ?? "-",
          verifiedAt: formatDate(verification?.verifiedAt),
          remarks: verification?.remarks ?? "-",
        };
      }));
  return [...configured, ...legacyOrOrphaned];
}

function renderSummary(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: UnloadingPdfSnapshot) {
  const report = snapshot.report;
  const productNames = report.products?.length
    ? report.products.map((product) => product.name).join(", ")
    : (report.product?.name ?? "-");
  const fields: Array<[string, string]> = [
    ["Shipment / Voyage", `${report.shipmentNumber ?? "-"} / ${report.voyageNumber ?? "-"}`],
    ["Vessel / IMO", `${report.vessel.name} / ${report.vessel.imoNumber ?? "-"}`],
    ["Product", productNames],
    ["Loading", `${report.loadingPlant?.name ?? "-"} / ${report.loadingJetty?.name ?? "-"}`],
    ["Destination", `${report.dischargePlant?.name ?? "-"} / ${report.dischargeJetty?.name ?? "-"}`],
    ["Tanggal laporan", formatDate(report.reportDateTime)],
  ];
  fields.forEach(([label, value], index) => {
    const y = 732 - index * 24;
    drawBoxText(page, font, bold, label, MARGIN, y, 112, 24, { bold: true, fill: COLORS.pale, size: 7 });
    drawBoxText(page, font, bold, value, MARGIN + 112, y, CONTENT_WIDTH - 112, 24, { size: 7.4 });
  });
}

function renderVerificationTable(page: PDFPage, font: PDFFont, bold: PDFFont, rows: VerificationRow[], chunkIndex: number) {
  const startY = chunkIndex === 0 ? 545 : 742;
  const widths = [112, 72, 63, 68, 75, 73, 60];
  const headers = ["Titik Segel", "Nomor", "Kondisi Awal", "Status Bongkar", "Hasil Periksa", "Waktu", "Catatan"];
  let x = MARGIN;
  headers.forEach((header, index) => {
    drawBoxText(page, font, bold, header, x, startY, widths[index]!, 30, { bold: true, center: true, fill: COLORS.header, size: 6 });
    x += widths[index]!;
  });
  const visible = rows.slice(chunkIndex * 15, (chunkIndex + 1) * 15);
  if (visible.length === 0) visible.push({ point: "Tidak ada segel aktif", sealNumber: "-", loadingStatus: "-", unloadingStatus: "-", condition: "-", verifiedAt: "-", remarks: "-" });
  visible.forEach((row, rowIndex) => {
    let cellX = MARGIN;
    const values = [row.point, row.sealNumber, row.loadingStatus, row.unloadingStatus, row.condition, row.verifiedAt, row.remarks];
    values.forEach((value, index) => {
      drawBoxText(page, font, bold, value, cellX, startY - (rowIndex + 1) * 36, widths[index]!, 36, { center: index > 0 && index < 6, size: 5.8 });
      cellX += widths[index]!;
    });
  });
}

function signatureStorageKey(signature: SnapshotSignature) {
  if (!signature.signatureMimeType) return null;
  return `signature-${signature.phase.toLowerCase()}-${signature.id}.${extensionForMimeType(signature.signatureMimeType)}`;
}

async function readVerifiedBytes(key: string, expectedChecksum: string | null | undefined) {
  let bytes: Buffer;
  try {
    bytes = await readFile(resolveFile(key));
  } catch {
    throw new AppError(409, `File snapshot ${key} tidak tersedia`);
  }
  if (expectedChecksum && hash(bytes) !== expectedChecksum) throw new AppError(409, `Checksum file snapshot ${key} tidak sesuai`);
  return bytes;
}

async function embedImage(document: PDFDocument, key: string, mimeType: string, checksum: string | null | undefined): Promise<PDFImage> {
  let bytes = await readVerifiedBytes(key, checksum);
  if (mimeType === "image/webp") bytes = await sharp(bytes).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  return mimeType === "image/jpeg" ? document.embedJpg(bytes) : document.embedPng(bytes);
}

async function renderSignature(document: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont, signature: SnapshotSignature | undefined, label: string, x: number, y: number, width: number, height: number) {
  drawBoxText(page, font, bold, label, x, y + height - 21, width, 21, { bold: true, center: true, fill: COLORS.header, size: 6.7 });
  page.drawRectangle({ x, y, width, height: height - 21, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.55 });
  if (!signature || signature.isSigned === false) {
    const invalid = "BA TIDAK VALID";
    const unsigned = "BELUM DITANDATANGANI";
    page.drawText(invalid, { x: x + (width - bold.widthOfTextAtSize(invalid, 8)) / 2, y: y + 66, size: 8, font: bold, color: rgb(0.78, 0.04, 0.04) });
    page.drawText(unsigned, { x: x + (width - bold.widthOfTextAtSize(unsigned, 6.2)) / 2, y: y + 52, size: 6.2, font: bold, color: rgb(0.78, 0.04, 0.04) });
    return;
  }
  const key = signatureStorageKey(signature);
  if (key && signature.signatureMimeType === "application/pdf") {
    const bytes = await readVerifiedBytes(key, signature.signatureChecksumSha256);
    const source = await PDFDocument.load(bytes, { updateMetadata: false });
    if (source.getPageCount() < 1) throw new AppError(409, `File tanda tangan ${key} tidak mempunyai halaman`);
    const embedded = await document.embedPage(source.getPage(0));
    const scale = Math.min((width - 22) / embedded.width, 59 / embedded.height);
    page.drawPage(embedded, { x: x + (width - embedded.width * scale) / 2, y: y + 42, width: embedded.width * scale, height: embedded.height * scale });
  } else if (key && signature.signatureMimeType && IMAGE_MIME_TYPES.has(signature.signatureMimeType)) {
    const image = await embedImage(document, key, signature.signatureMimeType, signature.signatureChecksumSha256);
    const scale = Math.min((width - 22) / image.width, 59 / image.height);
    page.drawImage(image, { x: x + (width - image.width * scale) / 2, y: y + 42, width: image.width * scale, height: image.height * scale });
  }
  drawBoxText(page, font, bold, signature.name, x + 3, y + 18, width - 6, 20, { center: true, size: 6.5 });
  drawBoxText(page, font, bold, formatDate(signature.signedAt), x + 3, y + 2, width - 6, 16, { center: true, size: 5.5 });
}

async function renderSignatureGroup(document: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont, title: string, signatures: SnapshotSignature[], top: number) {
  page.drawText(title, { x: MARGIN, y: top, size: 10, font: bold, color: COLORS.ink });
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * 2) / 3;
  for (let index = 0; index < ROLE_ORDER.length; index += 1) {
    const role = ROLE_ORDER[index]!;
    const signature = signatures.find((item) => item.role === role);
    await renderSignature(document, page, font, bold, signature, ROLE_LABELS[role], MARGIN + index * (width + gap), top - 164, width, 145);
  }
}

type PhotoContext = SnapshotAttachment & { point: string; sealNumber: string; condition: string; verifiedAt: string };

function photoGroups(snapshot: UnloadingPdfSnapshot) {
  const recordById = new Map(snapshot.records.map((record) => [record.id, record]));
  const sealById = new Map(snapshot.records.flatMap((record) => record.seals.map((seal) => [seal.id, { seal, record }] as const)));
  const verificationById = new Map(snapshot.records.flatMap((record) => record.seals.flatMap((seal) => (seal.verifications ?? []).map((verification) => [verification.id, { verification, seal, record }] as const))));
  const seen = new Set<string>();
  const prepare = (items: SnapshotAttachment[]) => items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return item.type === "PHOTO" && IMAGE_MIME_TYPES.has(item.mimeType);
    })
    .map((item): PhotoContext => {
      const verification = verificationById.get(item.verificationId ?? item.provenance?.verificationId ?? "");
      const sealed = sealById.get(item.sealId ?? item.provenance?.sealId ?? "");
      const record = verification?.record ?? sealed?.record ?? recordById.get(item.sealingRecordId ?? item.provenance?.sealingRecordId ?? "");
      return {
        ...item,
        point: record ? pointLabel(record) : "-",
        sealNumber: verification?.seal.sealNumber ?? sealed?.seal.sealNumber ?? "-",
        condition: verification?.verification.condition ?? "-",
        verifiedAt: formatDate(verification?.verification.verifiedAt),
      };
    })
    .sort((left, right) => (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) || clean(left.createdAt ?? left.uploadedAt).localeCompare(clean(right.createdAt ?? right.uploadedAt)) || left.id.localeCompare(right.id));
  return { loading: prepare(snapshot.loadingAttachments), unloading: prepare(snapshot.unloadingAttachments) };
}

async function renderPhotoPage(document: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont, photos: PhotoContext[], title: string) {
  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index]!;
    const column = index % 2;
    const row = Math.floor(index / 2);
    const width = 253;
    const height = 222;
    const x = MARGIN + column * 270;
    const y = 730 - row * 238 - height;
    page.drawRectangle({ x, y, width, height, color: COLORS.white, borderColor: COLORS.line, borderWidth: 0.6 });
    const key = `${photo.id}.${extensionForMimeType(photo.mimeType)}`;
    const image = await embedImage(document, key, photo.mimeType, photo.checksumSha256);
    const scale = Math.min((width - 12) / image.width, 145 / image.height);
    page.drawImage(image, { x: x + (width - image.width * scale) / 2, y: y + 69 + (145 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
    const caption = photo.caption ?? photo.fileName;
    drawBoxText(page, font, bold, caption, x + 4, y + 43, width - 8, 24, { bold: true, center: true, size: 6.5 });
    drawBoxText(page, font, bold, `Titik: ${photo.point} | Segel: ${photo.sealNumber}`, x + 4, y + 23, width - 8, 20, { center: true, size: 5.8 });
    const eventTime = title.includes("UNLOADING") ? photo.verifiedAt : formatDate(photo.uploadedAt ?? photo.createdAt);
    drawBoxText(page, font, bold, `Kondisi: ${photo.condition} | ${eventTime}`, x + 4, y + 3, width - 8, 20, { center: true, size: 5.5 });
  }
}

export async function buildUnloadingBaPdf(snapshotInput: unknown) {
  const snapshot = parseSnapshot(snapshotInput);
  const rows = verificationRows(snapshot);
  const verificationPageCount = Math.max(1, Math.ceil(rows.length / 15));
  const photos = photoGroups(snapshot);
  const loadingPhotoPageCount = Math.ceil(photos.loading.length / 6);
  const unloadingPhotoPageCount = Math.ceil(photos.unloading.length / 6);
  const formPageCount = verificationPageCount + 1;
  const pageCount = formPageCount + loadingPhotoPageCount + unloadingPhotoPageCount;
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);

  for (let index = 0; index < verificationPageCount; index += 1) {
    const page = output.addPage([PAGE.width, PAGE.height]);
    drawChrome(page, font, bold, snapshot, index + 1, pageCount, index === 0 ? "PEMERIKSAAN SEGEL" : "PEMERIKSAAN SEGEL (LANJUTAN)");
    if (index === 0) renderSummary(page, font, bold, snapshot);
    renderVerificationTable(page, font, bold, rows, index);
  }

  const signaturePage = output.addPage([PAGE.width, PAGE.height]);
  drawChrome(signaturePage, font, bold, snapshot, verificationPageCount + 1, pageCount, "TANDA TANGAN");
  await renderSignatureGroup(output, signaturePage, font, bold, "LOADING", snapshot.loadingSignatures, 730);
  await renderSignatureGroup(output, signaturePage, font, bold, "UNLOADING", snapshot.unloadingSignatures, 430);
  signaturePage.drawText(`Snapshot loading: ${snapshot.loadingSnapshotReference.snapshotChecksumSha256}`, { x: MARGIN, y: 68, size: 5.5, font, color: COLORS.muted });
  signaturePage.drawText(`Snapshot unloading: ${hash(canonicalJson(snapshot))}`, { x: MARGIN, y: 54, size: 5.5, font, color: COLORS.muted });

  let pageNumber = formPageCount;
  for (const [title, group] of [["DOKUMENTASI LOADING", photos.loading], ["DOKUMENTASI UNLOADING", photos.unloading]] as const) {
    const groupPages = Math.ceil(group.length / 6);
    for (let index = 0; index < groupPages; index += 1) {
      pageNumber += 1;
      const page = output.addPage([PAGE.width, PAGE.height]);
      drawChrome(page, font, bold, snapshot, pageNumber, pageCount, title);
      await renderPhotoPage(output, page, font, bold, group.slice(index * 6, (index + 1) * 6), title);
    }
  }

  const capturedAt = new Date(snapshot.capturedAt);
  if (!Number.isNaN(capturedAt.getTime())) {
    output.setCreationDate(capturedAt);
    output.setModificationDate(capturedAt);
  }
  output.setTitle(`BA UNLOADING ${snapshot.report.shipmentNumber ?? snapshot.report.reportNo}`);
  output.setSubject("Berita Acara Unloading / Final dari snapshot immutable");
  output.setProducer(UNLOADING_PDF_RENDERER_VERSION);
  output.setCreator(UNLOADING_PDF_RENDERER_VERSION);
  const buffer = Buffer.from(await output.save({ useObjectStreams: false, addDefaultPage: false }));
  const nonImageAttachmentCount = [...snapshot.loadingAttachments, ...snapshot.unloadingAttachments]
    .filter((item) => item.type !== "PHOTO" || !IMAGE_MIME_TYPES.has(item.mimeType)).length;
  return {
    buffer,
    snapshotChecksumSha256: hash(canonicalJson(snapshot)),
    templateChecksumSha256: UNLOADING_PDF_LAYOUT_SHA256,
    formPageCount,
    appendixPageCount: loadingPhotoPageCount + unloadingPhotoPageCount,
    loadingAppendixPageCount: loadingPhotoPageCount,
    unloadingAppendixPageCount: unloadingPhotoPageCount,
    loadingPhotoCount: photos.loading.length,
    unloadingPhotoCount: photos.unloading.length,
    nonImageAttachmentCount,
    pageCount,
  };
}
