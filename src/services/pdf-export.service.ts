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
export const NATIVE_PDF_LAYOUT_SHA256 = "248d76c5c7c2018fef914f87330ee5edba2a2c6634b73d83ce8b8c8499409a53";
export const PDF_RENDERER_VERSION = "tko-native-layout-v5";

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
  finalizedById?: string | null;
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
    loadingMaster: { id?: string; fullName: string } | null;
    unloadingMaster: { id?: string; fullName: string } | null;
  };
  formConfigurationSnapshot: { sections: Array<{ code: string; isAvailable: boolean }>; points: SnapshotPoint[] };
  signatures: FinalSignature[];
  records: FinalRecord[];
  attachments?: SnapshotAttachment[];
};
type ExportPoint = SnapshotPoint & { record: FinalRecord | null };

const exportRoot = path.resolve(process.cwd(), env.PDF_EXPORT_DIR);
const brandLogoPath = path.resolve(process.cwd(), "assets/pertamina-patra-niaga-logo.png");
const BRAND_LOGO_SHA256 = "443bd4c8973e23e704212da16312894fb5cbca5cb23747429d50bbb1167c8fe0";
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

const COLOR = {
  white: rgb(1, 1, 1),
  ink: rgb(0.08, 0.1, 0.14),
  muted: rgb(0.38, 0.42, 0.48),
  line: rgb(0.18, 0.22, 0.28),
  header: rgb(0.9, 0.94, 0.98),
  subHeader: rgb(0.96, 0.97, 0.98),
  red: rgb(0.83, 0.08, 0.12),
  blue: rgb(0.03, 0.28, 0.58),
  green: rgb(0.08, 0.56, 0.36),
};

type Box = { x: number; y: number; width: number; height: number };
type CellOptions = {
  align?: "left" | "center" | "right";
  bold?: boolean;
  fill?: ReturnType<typeof rgb>;
  size?: number;
  minSize?: number;
  padding?: number;
  borderWidth?: number;
  color?: ReturnType<typeof rgb>;
};

function wrapLines(font: PDFFont, value: unknown, maxWidth: number, size: number) {
  const text = cleanText(value);
  if (!text) return [];
  const words = text.split(" ");
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      if (current) lines[lines.length - 1] = candidate;
      else lines.push(candidate);
    } else {
      lines.push(word);
    }
  }
  return lines;
}

function drawCell(page: PDFPage, regular: PDFFont, bold: PDFFont, value: unknown, box: Box, options: CellOptions = {}) {
  page.drawRectangle({
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    color: options.fill ?? COLOR.white,
    borderColor: COLOR.line,
    borderWidth: options.borderWidth ?? 0.55,
  });
  const text = cleanText(value);
  if (!text) return;
  const font = options.bold ? bold : regular;
  const padding = options.padding ?? 3;
  const maxWidth = Math.max(1, box.width - padding * 2);
  const maxHeight = Math.max(1, box.height - padding * 2);
  let size = options.size ?? 7;
  const minimum = options.minSize ?? 4.2;
  let lines = wrapLines(font, text, maxWidth, size);
  while (size > minimum && (lines.length * (size + 1.4) > maxHeight || lines.some((line) => font.widthOfTextAtSize(line, size) > maxWidth))) {
    size -= 0.25;
    lines = wrapLines(font, text, maxWidth, size);
  }
  const lineHeight = size + 1.4;
  const visible = lines.slice(0, Math.max(1, Math.floor(maxHeight / lineHeight)));
  const blockHeight = visible.length * lineHeight;
  const firstBaseline = box.y + (box.height + blockHeight) / 2 - size;
  visible.forEach((line, index) => {
    const lineWidth = font.widthOfTextAtSize(line, size);
    const x = options.align === "center"
      ? box.x + (box.width - lineWidth) / 2
      : options.align === "right"
        ? box.x + box.width - padding - lineWidth
        : box.x + padding;
    page.drawText(line, { x, y: firstBaseline - index * lineHeight, size, font, color: options.color ?? COLOR.ink });
  });
}

function drawWrappedText(page: PDFPage, font: PDFFont, value: unknown, x: number, top: number, width: number, size = 8, lineHeight = 11) {
  const lines = wrapLines(font, value, width, size);
  lines.forEach((line, index) => page.drawText(line, { x, y: top - size - index * lineHeight, size, font, color: COLOR.ink }));
  return top - lines.length * lineHeight;
}

type RichTextSegment = { text: string; font: PDFFont; color?: ReturnType<typeof rgb> };

function drawRichWrappedText(page: PDFPage, segments: RichTextSegment[], x: number, top: number, width: number, size = 8, lineHeight = 11) {
  let cursorX = x;
  let baseline = top - size;
  for (const segment of segments) {
    const tokens = segment.text.match(/\s+|\S+/g) ?? [];
    for (const token of tokens) {
      const tokenWidth = segment.font.widthOfTextAtSize(token, size);
      if (/^\s+$/.test(token)) {
        if (cursorX > x) cursorX += tokenWidth;
        continue;
      }
      if (cursorX > x && cursorX + tokenWidth > x + width) {
        cursorX = x;
        baseline -= lineHeight;
      }
      page.drawText(token, { x: cursorX, y: baseline, size, font: segment.font, color: segment.color ?? COLOR.ink });
      cursorX += tokenWidth;
    }
  }
  return baseline - lineHeight + size;
}

async function embedBrandLogo(document: PDFDocument) {
  let bytes: Buffer;
  try {
    bytes = await readFile(brandLogoPath);
  } catch {
    throw new AppError(409, "Aset logo Pertamina Patra Niaga tidak tersedia");
  }
  if (hash(bytes) !== BRAND_LOGO_SHA256) throw new AppError(409, "Integritas aset logo Pertamina Patra Niaga tidak valid");
  return document.embedPng(bytes);
}

function drawPageChrome(page: PDFPage, font: PDFFont, logo: PDFImage, snapshot: PdfFinalSnapshot, pageNumber: number, pageCount: number) {
  page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: COLOR.white });
  const logoWidth = 118;
  const logoHeight = logoWidth * logo.height / logo.width;
  page.drawImage(logo, { x: 36, y: 792, width: logoWidth, height: logoHeight });
  const reference = "Lampiran 6  |  TKO B3.1-612  |  Revisi 0";
  page.drawText(reference, { x: A4.width - 36 - font.widthOfTextAtSize(reference, 7), y: 801, size: 7, font, color: COLOR.muted });
  page.drawLine({ start: { x: 36, y: 787 }, end: { x: A4.width - 36, y: 787 }, thickness: 0.8, color: COLOR.line });
  page.drawLine({ start: { x: 36, y: 31 }, end: { x: A4.width - 36, y: 31 }, thickness: 0.45, color: COLOR.line });
  const footer = `${snapshot.report.shipmentNumber ?? snapshot.report.reportNo} • ${snapshot.report.vessel.name}`;
  page.drawText(footer, { x: 36, y: 18, size: 6.3, font, color: COLOR.muted });
  const pagination = `Halaman ${pageNumber}/${pageCount}`;
  page.drawText(pagination, { x: A4.width - 36 - font.widthOfTextAtSize(pagination, 6.3), y: 18, size: 6.3, font, color: COLOR.muted });
}

function pointValue(point: ExportPoint) {
  if (!point.record || point.record.status !== "SEALED") return "";
  const numbers = point.record.seals.filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status)).map((seal) => seal.sealNumber);
  return numbers.join(", ");
}

function sortPoints(points: ExportPoint[]) {
  return [...points].sort((a, b) => (a.compartment?.sequence ?? 9999) - (b.compartment?.sequence ?? 9999) || (a.sequence ?? 9999) - (b.sequence ?? 9999) || a.template.sequence - b.template.sequence || a.instanceNo - b.instanceNo || a.code.localeCompare(b.code));
}

function hasActiveSeal(point: ExportPoint) {
  return pointValue(point).length > 0;
}

function documentMasterContext(snapshot: PdfFinalSnapshot) {
  const report = snapshot.report;
  const finalizedById = snapshot.finalizedById;
  const matchesUnloadingMaster = Boolean(finalizedById && report.unloadingMaster?.id === finalizedById);
  const matchesLoadingMaster = Boolean(finalizedById && report.loadingMaster?.id === finalizedById);
  const isUnloading = matchesUnloadingMaster || (!matchesLoadingMaster && ["DISCHARGE", "UNLOADING"].includes(report.activity?.code?.toUpperCase() ?? ""));
  const role = isUnloading ? "Unloading Master" : "Loading Master";
  const name = (isUnloading ? report.unloadingMaster?.fullName : report.loadingMaster?.fullName) ?? "-";
  const identity = name.toLocaleLowerCase().startsWith(role.toLocaleLowerCase()) ? name : `${role} ${name}`;
  const port = isUnloading
    ? `${report.dischargePlant?.name ?? "-"} / ${report.dischargeJetty?.name ?? "-"}`
    : `${report.loadingPlant?.name ?? "-"} / ${report.loadingJetty?.name ?? "-"}`;
  return { identity, isUnloading, port };
}

const SECTION_A_HEADERS = [
  "Sounding Hole / Flange Vapor Lock",
  "Tank Cleaning Access DOT / Deck Seal",
  "Hatch Coaming / Tank Dom / Closed Cade / Manhole",
  "Sampling Hole / Sighting Hole / Small Manhole",
  "Emergency Connection (Framo Pump)",
];

function renderNativeHeader(page: PDFPage, font: PDFFont, bold: PDFFont, snapshot: PdfFinalSnapshot, set: number, setCount: number) {
  const report = snapshot.report;
  const master = documentMasterContext(snapshot);
  const title = setCount > 1 ? `SEALING REPORT — CONTINUATION ${set}/${setCount}` : "SEALING REPORT";
  const titleSize = 15;
  page.drawText(title, { x: (A4.width - bold.widthOfTextAtSize(title, titleSize)) / 2, y: 758, size: titleSize, font: bold, color: COLOR.ink });

  const labels = ["Vessel Name", "Terminal", "Cargo", "Date / Time"];
  const values = [report.vessel.name, master.port, report.product?.name ?? "-", new Date(report.reportDateTime).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false })];
  const metadataTop = 744;
  const rowHeight = 18;
  labels.forEach((label, index) => {
    const y = metadataTop - (index + 1) * rowHeight;
    drawCell(page, font, bold, label, { x: 36, y, width: 78, height: rowHeight }, { bold: true, fill: COLOR.subHeader, size: 7 });
    drawCell(page, font, bold, values[index], { x: 114, y, width: 278, height: rowHeight }, { bold: true, size: 7.4 });
  });
  drawCell(page, font, bold, "", { x: 400, y: metadataTop - rowHeight * 4, width: 159, height: rowHeight * 4 }, { fill: COLOR.subHeader });
  const info: Array<[string, string]> = [
    ["Shipment: ", report.shipmentNumber ?? "-"],
    [" Voyage: ", report.voyageNumber ?? "-"],
    [" Activity: ", report.activity?.code ?? "-"],
    [" Status: ", report.sealingStatus ?? "-"],
    [" Loading: ", `${report.loadingPlant?.name ?? "-"} / ${report.loadingJetty?.name ?? "-"}`],
    [" Discharge: ", `${report.dischargePlant?.name ?? "-"} / ${report.dischargeJetty?.name ?? "-"}`],
    [" Report: ", report.reportNo],
  ];
  drawRichWrappedText(page, info.flatMap(([label, value]) => [{ text: label, font }, { text: value, font: bold }]), 405, metadataTop - 5, 149, 6.1, 7.7);

  drawRichWrappedText(page, [
    { text: "We are ", font },
    { text: master.identity, font: bold },
    { text: ", on board the vessel ", font },
    { text: report.vessel.name, font: bold },
    { text: " at port ", font },
    { text: master.port, font: bold },
    { text: ", for and on behalf of PT Pertamina Patra Niaga, conduct ", font },
    { text: report.activity?.code ?? "-", font: bold },
    { text: " inspection and supervision of ", font },
    { text: report.product?.name ?? "cargo", font: bold },
    { text: ". Upon completion, sealing was conducted on board the vessel as follows:", font },
  ], 36, 661, 523, 8.2, 10.5);
}

type SectionAGroup = { compartment: SnapshotCompartment | null; points: ExportPoint[] };

function sectionAGroups(points: ExportPoint[], available: boolean) {
  const groups = new Map<string, { compartment: SnapshotCompartment | null; points: ExportPoint[] }>();
  for (const point of sortPoints(points)) {
    const key = point.compartment?.id ?? point.vesselSealingPointId;
    const group = groups.get(key) ?? { compartment: point.compartment, points: [] };
    group.points.push(point);
    groups.set(key, group);
  }
  return available ? [...groups.values()].filter((group) => group.points.some(hasActiveSeal)) : [];
}

function sectionAPageCount(points: ExportPoint[], available: boolean) {
  const groups = sectionAGroups(points, available);
  if (groups.length === 0) return 1;
  const templateCount = new Set(points.map((point) => point.template.id)).size;
  return Math.ceil(groups.length / 28) * Math.max(1, Math.ceil(templateCount / 5));
}

function renderNativeSectionA(page: PDFPage, font: PDFFont, bold: PDFFont, points: ExportPoint[], pageIndex: number, available: boolean) {
  const allGroups: SectionAGroup[] = sectionAGroups(points, available);
  const templates = [...new Map(points.map((point) => [point.template.id, point.template])).values()].sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const columnChunks = allGroups.length === 0 ? 1 : Math.max(1, Math.ceil(templates.length / 5));
  const rowChunk = Math.floor(pageIndex / columnChunks);
  const columnChunk = pageIndex % columnChunks;
  const visibleGroups = allGroups.slice(rowChunk * 28, (rowChunk + 1) * 28);
  const visibleTemplates = templates.slice(columnChunk * 5, (columnChunk + 1) * 5);
  const title = "A. CLOSED CADE / HATCH COAMING / TANK DOM, TANK CLEANING ACCESS AND SOUNDING HOLE / FLANGE VAPOR LOCK OF SOUNDING HOLE";
  page.drawText(title, { x: 36, y: 596, size: fitText(bold, title, 523, 8.4, 6.5), font: bold, color: COLOR.ink });
  const tableTop = 584;
  const headerHeight = 46;
  const widths = [24, 64, 87, 87, 87, 87, 87];
  const headers = ["No.", "Compartment", ...Array.from({ length: 5 }, (_, index) => visibleTemplates[index]?.name ?? SECTION_A_HEADERS[index]!)];
  let x = 36;
  headers.forEach((header, index) => {
    drawCell(page, font, bold, header, { x, y: tableTop - headerHeight, width: widths[index]!, height: headerHeight }, { bold: true, align: "center", fill: COLOR.header, size: 6.2, minSize: 4.4 });
    x += widths[index]!;
  });
  const rows = visibleGroups;
  const rowCount = rows.length === 0 ? 1 : rows.length + (rows.length < 28 ? 1 : 0);
  const rowHeight = Math.min(22, 500 / rowCount);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const y = tableTop - headerHeight - (rowIndex + 1) * rowHeight;
    const group = rows[rowIndex];
    const values = group
      ? [String(rowChunk * 28 + rowIndex + 1), group.compartment?.code ?? group.points[0]?.locationName ?? group.points[0]?.displayName ?? "", ...Array.from({ length: 5 }, (_, columnIndex) => {
        const template = visibleTemplates[columnIndex];
        return template ? group.points.filter((point) => point.template.id === template.id).map(pointValue).join(" / ") : "";
      })]
      : ["", "", "", "", "", "", ""];
    let cellX = 36;
    values.forEach((value, columnIndex) => {
      drawCell(page, font, bold, value, { x: cellX, y, width: widths[columnIndex]!, height: rowHeight }, {
        align: columnIndex === 1 ? "left" : "center",
        size: 6.4,
        fill: COLOR.white,
      });
      cellX += widths[columnIndex]!;
    });
  }
}

const DUAL_SECTION_TITLES: Record<string, string> = {
  B: "B. MANIFOLD CARGO / BUNKER / MARPOL",
  C: "C. PERMANENT MEANS ACCESS (FPT, APT, WBT)",
  D: "D. CARGO VALVE ON DECK (SUCTION, STRIPPING, DROP, CROSS OVER, GATE & DRAIN MANIFOLD)",
  E: "E. TANK CLEANING / COW VALVE",
  F: "F. BUNKER SOUNDING HOLE (BILA TERDAPAT FLANGE) AND DECK SEAL",
};

type ContentSectionCode = "B" | "C" | "D" | "E" | "F" | "G" | "H";
type ContentSectionBlock = {
  code: ContentSectionCode;
  points: ExportPoint[];
  capacity: number;
  startIndex: number;
  chunkIndex: number;
  chunkCount: number;
  height: number;
};

const SECTION_CAPACITIES: Record<ContentSectionCode, number> = { B: 14, C: 16, D: 16, E: 18, F: 12, G: 14, H: 4 };
const DUAL_ROW_HEIGHT = 14;
const FLAT_ROW_HEIGHT = 14;
const CONTENT_TOP = 746;
const CONTENT_BOTTOM = 45;
const CONTENT_HEIGHT_WITH_SIGNATURES = CONTENT_TOP - 230;

function dualRowCount(pointCount: number, capacity: number) {
  if (pointCount === 0) return 1;
  return Math.ceil(pointCount / 2) + (pointCount < capacity ? 1 : 0);
}

function flatRowCount(pointCount: number, capacity: number) {
  if (pointCount === 0) return 1;
  return pointCount + (pointCount < capacity ? 1 : 0);
}

function sectionBlockHeight(code: ContentSectionCode, pointCount: number, capacity: number) {
  return code <= "F"
    ? 46 + dualRowCount(pointCount, capacity) * DUAL_ROW_HEIGHT
    : 44 + flatRowCount(pointCount, capacity) * FLAT_ROW_HEIGHT;
}

function createContentBlocks(bySection: Record<string, ExportPoint[]>, availability: Map<string, boolean>) {
  const blocks: ContentSectionBlock[] = [];
  for (const code of "BCDEFGH" as Iterable<ContentSectionCode>) {
    const capacity = SECTION_CAPACITIES[code];
    const active = availability.get(code) === false ? [] : sortPoints(bySection[code]!).filter(hasActiveSeal);
    const chunks = active.length === 0
      ? [[]]
      : Array.from({ length: Math.ceil(active.length / capacity) }, (_, index) => active.slice(index * capacity, (index + 1) * capacity));
    chunks.forEach((points, chunkIndex) => blocks.push({
      code,
      points,
      capacity,
      startIndex: chunkIndex * capacity,
      chunkIndex,
      chunkCount: chunks.length,
      height: sectionBlockHeight(code, points.length, capacity),
    }));
  }
  return blocks;
}

function planContentPages(blocks: ContentSectionBlock[]) {
  const pages: ContentSectionBlock[][] = [];
  for (const block of blocks) {
    const current = pages.at(-1);
    const used = current?.reduce((sum, item) => sum + item.height, 0) ?? 0;
    if (!current || used + block.height > CONTENT_TOP - CONTENT_BOTTOM) pages.push([block]);
    else current.push(block);
  }

  const last = pages.at(-1)!;
  const lastHeight = last.reduce((sum, item) => sum + item.height, 0);
  if (lastHeight > CONTENT_HEIGHT_WITH_SIGNATURES && last.length > 1) {
    const preferred = last.findIndex((block) => block.code === "F");
    let splitIndex = preferred > 0 && last.slice(preferred).reduce((sum, item) => sum + item.height, 0) <= CONTENT_HEIGHT_WITH_SIGNATURES
      ? preferred
      : -1;
    if (splitIndex < 0) {
      let suffixHeight = 0;
      for (let index = last.length - 1; index > 0; index -= 1) {
        if (suffixHeight + last[index]!.height > CONTENT_HEIGHT_WITH_SIGNATURES) break;
        suffixHeight += last[index]!.height;
        splitIndex = index;
      }
    }
    if (splitIndex > 0) pages.push(last.splice(splitIndex));
  }
  return pages;
}

function renderNativeDualSection(page: PDFPage, font: PDFFont, bold: PDFFont, block: ContentSectionBlock, top: number) {
  const { code, points, capacity, startIndex, chunkIndex, chunkCount, height } = block;
  const title = DUAL_SECTION_TITLES[code]!;
  const titleText = chunkCount > 1 ? `${title} (${chunkIndex + 1}/${chunkCount})` : title;
  page.drawText(titleText, { x: 36, y: top - 10, size: fitText(bold, titleText, 523, 8.2, 6.2), font: bold, color: COLOR.ink });
  const tableTop = top - 20;
  const headerHeight = 26;
  const rowCount = dualRowCount(points.length, capacity);
  const widths = [24, 157, 72, 24, 157, 89];
  const headers = ["No.", "Equipment / Titik", "Seal No.", "No.", "Equipment / Titik", "Seal No."];
  let headerX = 36;
  headers.forEach((header, index) => {
    drawCell(page, font, bold, header, { x: headerX, y: tableTop - headerHeight, width: widths[index]!, height: headerHeight }, { bold: true, align: "center", fill: COLOR.header, size: 6.5 });
    headerX += widths[index]!;
  });
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const y = tableTop - headerHeight - (rowIndex + 1) * DUAL_ROW_HEIGHT;
    const left = points[rowIndex * 2];
    const right = points[rowIndex * 2 + 1];
    const leftLabel = left ? `${left.displayName ?? left.template.name}${left.instanceNo > 1 ? ` (${left.instanceNo})` : ""}` : "";
    const values = [
      left ? String(startIndex + rowIndex * 2 + 1) : "",
      leftLabel,
      left ? pointValue(left) : "",
      right ? String(startIndex + rowIndex * 2 + 2) : "",
      right ? `${right.displayName ?? right.template.name}${right.instanceNo > 1 ? ` (${right.instanceNo})` : ""}` : "",
      right ? pointValue(right) : "",
    ];
    let cellX = 36;
    values.forEach((value, index) => {
      drawCell(page, font, bold, value, { x: cellX, y, width: widths[index]!, height: DUAL_ROW_HEIGHT }, {
        align: index % 3 === 1 ? "left" : "center",
        size: 6.2,
        fill: COLOR.white,
      });
      cellX += widths[index]!;
    });
  }
  return height;
}

function renderNativeFlatSection(page: PDFPage, font: PDFFont, bold: PDFFont, block: ContentSectionBlock, top: number) {
  const { code, points, capacity, startIndex, chunkIndex, chunkCount, height } = block;
  const rowCount = flatRowCount(points.length, capacity);
  const titleText = code === "G" ? "G. SEALING ACCESS AT PUMP ROOM AND PUMPS" : "H. OTHER";
  const displayTitle = chunkCount > 1 ? `${titleText} (${chunkIndex + 1}/${chunkCount})` : titleText;
  page.drawText(displayTitle, { x: 36, y: top - 10, size: 8.2, font: bold, color: COLOR.ink });
  const tableTop = top - 20;
  const headerHeight = 24;
  const widths = [32, 329, 162];
  const headers = ["No.", "Equipment", "Seal No."];
  let headerX = 36;
  headers.forEach((header, index) => {
    drawCell(page, font, bold, header, { x: headerX, y: tableTop - headerHeight, width: widths[index]!, height: headerHeight }, { bold: true, align: "center", fill: COLOR.header, size: 6.8 });
    headerX += widths[index]!;
  });
  for (let index = 0; index < rowCount; index += 1) {
    const y = tableTop - headerHeight - (index + 1) * FLAT_ROW_HEIGHT;
    const point = points[index];
    const label = point ? `${point.displayName ?? point.template.name}${point.instanceNo > 1 ? ` (${point.instanceNo})` : ""}` : "";
    const value = point ? pointValue(point) : "";
    const fill = COLOR.white;
    drawCell(page, font, bold, point ? String(startIndex + index + 1) : "", { x: 36, y, width: widths[0]!, height: FLAT_ROW_HEIGHT }, { align: "center", size: 6, fill });
    drawCell(page, font, bold, label, { x: 68, y, width: widths[1]!, height: FLAT_ROW_HEIGHT }, { size: 6.1, fill });
    drawCell(page, font, bold, value, { x: 397, y, width: widths[2]!, height: FLAT_ROW_HEIGHT }, { align: "center", size: 6.1, fill });
  }
  return height;
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

async function renderNativeSignatures(document: PDFDocument, page: PDFPage, font: PDFFont, bold: PDFFont, signatures: FinalSignature[]) {
  const roles = ["CHIEF_OFFICER", "TERMINAL_REPRESENTATIVE", "SURVEYOR"] as const;
  const labels = ["Chief Officer", "Terminal Representative", "Surveyor"];
  const gap = 8;
  const width = (523 - gap * 2) / 3;
  const xs = [36, 36 + width + gap, 36 + (width + gap) * 2];
  const boxY = 51;
  const boxHeight = 151;
  for (let index = 0; index < roles.length; index += 1) {
    const signature = signatures.find((item) => item.role === roles[index]);
    const x = xs[index]!;
    drawCell(page, font, bold, labels[index], { x, y: boxY + boxHeight - 22, width, height: 22 }, { bold: true, align: "center", fill: COLOR.header, size: 7 });
    page.drawRectangle({ x, y: boxY, width, height: boxHeight - 22, color: COLOR.white, borderColor: COLOR.line, borderWidth: 0.55 });
    if (!signature) {
      page.drawText("Belum ditandatangani", { x: x + (width - font.widthOfTextAtSize("Belum ditandatangani", 6.5)) / 2, y: boxY + 58, size: 6.5, font, color: COLOR.muted });
      continue;
    }
    const nameY = boxY + 12;
    drawCell(page, font, bold, signature.name, { x: x + 3, y: nameY, width: width - 6, height: 18 }, { align: "center", borderWidth: 0, size: 6.8 });
    if (signature.signedAt) {
      drawCell(page, font, bold, new Date(signature.signedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false }), { x: x + 3, y: nameY + 18, width: width - 6, height: 14 }, { align: "center", borderWidth: 0, size: 5.8, color: COLOR.muted });
    }
    page.drawLine({ start: { x: x + 18, y: nameY + 35 }, end: { x: x + width - 18, y: nameY + 35 }, thickness: 0.45, color: COLOR.line });
    if (signature.signatureMimeType === "application/pdf") {
      const key = `signature-${signature.id}.pdf`;
      let bytes: Buffer;
      try { bytes = await readFile(resolveFile(key)); } catch { throw new AppError(409, `File snapshot ${key} tidak tersedia`); }
      if (signature.signatureChecksumSha256 && hash(bytes) !== signature.signatureChecksumSha256) throw new AppError(409, `Checksum file snapshot ${key} tidak sesuai`);
      const signaturePdf = await PDFDocument.load(bytes, { updateMetadata: false });
      if (signaturePdf.getPageCount() < 1) throw new AppError(409, `File tanda tangan ${key} tidak mempunyai halaman`);
      const embedded = await document.embedPage(signaturePdf.getPage(0));
      const scale = Math.min((width - 30) / embedded.width, 66 / embedded.height);
      page.drawPage(embedded, { x: x + (width - embedded.width * scale) / 2, y: boxY + 61 + (66 - embedded.height * scale) / 2, width: embedded.width * scale, height: embedded.height * scale });
    } else if (signature.signatureMimeType) {
      const image = await embedStoredImage(document, signature.id, signature.signatureMimeType, signature.signatureChecksumSha256, true);
      if (image) {
        const scale = Math.min((width - 30) / image.width, 66 / image.height);
        page.drawImage(image, { x: x + (width - image.width * scale) / 2, y: boxY + 61 + (66 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
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

async function appendPhotoPages(document: PDFDocument, snapshot: PdfFinalSnapshot, font: PDFFont, bold: PDFFont, logo: PDFImage, formPageCount: number, totalPageCount: number) {
  const photos = collectPhotos(snapshot);
  const perPage = 9;
  for (let pageIndex = 0; pageIndex < Math.ceil(photos.length / perPage); pageIndex += 1) {
    const page = document.addPage([A4.width, A4.height]);
    drawPageChrome(page, font, logo, snapshot, formPageCount + pageIndex + 1, totalPageCount);
    page.drawText("APPENDIX DOKUMENTASI", { x: 36, y: 760, size: 13, font: bold, color: COLOR.ink });
    page.drawText(`${snapshot.report.shipmentNumber ?? snapshot.report.reportNo} - ${snapshot.report.vessel.name}`, { x: 36, y: 744, size: 8, font, color: COLOR.muted });
    const chunk = photos.slice(pageIndex * perPage, (pageIndex + 1) * perPage);
    for (let index = 0; index < chunk.length; index += 1) {
      const photo = chunk[index]!;
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 36 + column * 176;
      const top = 718 - row * 220;
      page.drawRectangle({ x, y: top - 198, width: 164, height: 206, borderColor: rgb(0.25, 0.25, 0.25), borderWidth: 0.6 });
      const image = await embedStoredImage(document, photo.id, photo.mimeType, photo.checksumSha256);
      if (image) {
        const scale = Math.min(154 / image.width, 150 / image.height);
        page.drawImage(image, { x: x + 5 + (154 - image.width * scale) / 2, y: top - 154 + (150 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale });
      }
      const caption = `${photo.sequence ?? pageIndex * perPage + index + 1}. ${photo.caption ?? photo.fileName}`;
      drawCell(page, font, bold, caption, { x: x + 4, y: top - 191, width: 156, height: 25 }, { align: "center", size: 6.5, borderWidth: 0 });
      if (photo.sectionCode) page.drawText(`Bagian ${photo.sectionCode}`, { x: x + 6, y: top - 163, size: 5.5, font, color: COLOR.muted });
    }
    page.drawText(`Appendix ${pageIndex + 1}/${Math.ceil(photos.length / perPage)}`, { x: 468, y: 38, size: 6, font, color: COLOR.muted });
  }
  return Math.ceil(photos.length / perPage);
}

export async function buildOfficialPdf(snapshotInput: PdfFinalSnapshot) {
  const snapshot = parseFinalSnapshot(snapshotInput);
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedBrandLogo(output);
  const recordByPoint = new Map(snapshot.records.map((record) => [record.vesselSealingPointId, record]));
  const points = snapshot.formConfigurationSnapshot.points.map((point) => ({ ...point, record: recordByPoint.get(point.vesselSealingPointId) ?? null }));
  const bySection = Object.fromEntries("ABCDEFGH".split("").map((code) => [code, points.filter((point) => point.section.code === code)])) as Record<string, ExportPoint[]>;
  const availability = new Map(snapshot.formConfigurationSnapshot.sections.map((section) => [section.code, section.isAvailable]));
  const aPageCount = sectionAPageCount(bySection.A!, availability.get("A") !== false);
  const contentPages = planContentPages(createContentBlocks(bySection, availability));
  const appendixPageCount = Math.ceil(collectPhotos(snapshot).length / 9);
  const formPageCount = aPageCount + contentPages.length;
  const pageCount = formPageCount + appendixPageCount;
  for (let pageIndex = 0; pageIndex < aPageCount; pageIndex += 1) {
    const pageA = output.addPage([A4.width, A4.height]);
    drawPageChrome(pageA, font, logo, snapshot, pageIndex + 1, pageCount);
    renderNativeHeader(pageA, font, bold, snapshot, pageIndex + 1, aPageCount);
    renderNativeSectionA(pageA, font, bold, bySection.A!, pageIndex, availability.get("A") !== false);
  }
  for (let pageIndex = 0; pageIndex < contentPages.length; pageIndex += 1) {
    const page = output.addPage([A4.width, A4.height]);
    drawPageChrome(page, font, logo, snapshot, aPageCount + pageIndex + 1, pageCount);
    const continuation = contentPages.length > 1 ? ` — CONTINUATION ${pageIndex + 1}/${contentPages.length}` : "";
    page.drawText(`SEALING REPORT — FORM A–H${continuation}`, { x: 36, y: 763, size: 11, font: bold, color: COLOR.ink });
    let top = CONTENT_TOP;
    for (const block of contentPages[pageIndex]!) {
      top -= block.code <= "F"
        ? renderNativeDualSection(page, font, bold, block, top)
        : renderNativeFlatSection(page, font, bold, block, top);
    }
    if (pageIndex === contentPages.length - 1) {
      page.drawText("Kindly acknowledge the above report by signing below.", { x: 36, y: 216, size: 7.2, font, color: COLOR.ink });
      await renderNativeSignatures(output, page, font, bold, snapshot.signatures);
    }
  }
  await appendPhotoPages(output, snapshot, font, bold, logo, formPageCount, pageCount);
  const fixedDate = new Date(snapshot.capturedAt);
  output.setTitle(`Laporan Segel ${snapshot.report.shipmentNumber ?? snapshot.report.reportNo}`);
  output.setSubject("Laporan Segel Kapal TKO B3.1-612");
  output.setAuthor("Sistem Segel Kapal");
  output.setCreator(PDF_RENDERER_VERSION);
  output.setProducer(PDF_RENDERER_VERSION);
  output.setCreationDate(fixedDate);
  output.setModificationDate(fixedDate);
  const buffer = Buffer.from(await output.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false }));
  return { buffer, templateChecksumSha256: NATIVE_PDF_LAYOUT_SHA256, snapshotChecksumSha256: hash(canonicalJson(snapshot)), formPageCount, appendixPageCount, pageCount };
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

function artifactUsesCurrentRenderer(artifact: { rendererVersion: string; templateChecksumSha256: string; snapshotChecksumSha256: string }, snapshot: PdfFinalSnapshot) {
  return artifact.rendererVersion === PDF_RENDERER_VERSION &&
    artifact.templateChecksumSha256 === NATIVE_PDF_LAYOUT_SHA256 &&
    artifact.snapshotChecksumSha256 === hash(canonicalJson(snapshot));
}

export async function generateOfficialPdf(reportId: string, actor: PdfActor) {
  const { report, snapshot } = await loadFinalReport(reportId, actor);
  if (report.pdfArtifact && artifactUsesCurrentRenderer(report.pdfArtifact, snapshot)) {
    await verifiedArtifactFile(report.pdfArtifact);
    return metadata(report.pdfArtifact, true);
  }
  const defaultFileName = `${safeBaseName(report.shipmentNumber ?? report.voyageNumber ?? report.reportNo)}-${report.id}.pdf`;
  const fileName = report.pdfArtifact?.fileName ?? defaultFileName;
  const storageKey = report.pdfArtifact?.storageKey ?? fileName;
  const destination = safeExportPath(storageKey);
  let ownsDestination = false;
  let backupPath: string | null = null;
  try {
    const result = await prisma.$transaction(async (rawTransaction) => {
      const tx = rawTransaction as unknown as Pick<typeof prisma, "pdfArtifact" | "auditLog" | "$queryRawUnsafe">;
      await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
      const existing = await tx.pdfArtifact.findUnique({ where: { sealingReportId: reportId } });
      if (existing && artifactUsesCurrentRenderer(existing, snapshot)) {
        await verifiedArtifactFile(existing);
        return metadata(existing, true);
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
        const artifactData = {
          generatedById: actor.id, fileName, storageKey, fileSize: BigInt(generated.buffer.length), checksumSha256: hash(generated.buffer),
          templateChecksumSha256: generated.templateChecksumSha256, snapshotChecksumSha256: generated.snapshotChecksumSha256, rendererVersion: PDF_RENDERER_VERSION,
          formPageCount: generated.formPageCount, appendixPageCount: generated.appendixPageCount, pageCount: generated.pageCount, generatedAt: new Date(),
        };
        const saved = existing
          ? await tx.pdfArtifact.update({ where: { sealingReportId: report.id }, data: artifactData })
          : await tx.pdfArtifact.create({ data: { sealingReportId: report.id, ...artifactData } });
        await tx.auditLog.create({ data: { userId: actor.id, action: existing ? "UPDATE" : "CREATE", entityType: "PDF_EXPORT", entityId: report.id, newData: {
          fileName, fileSize: generated.buffer.length, checksumSha256: saved.checksumSha256, templateChecksumSha256: saved.templateChecksumSha256,
          snapshotChecksumSha256: saved.snapshotChecksumSha256, rendererVersion: saved.rendererVersion, formPageCount: saved.formPageCount,
          appendixPageCount: saved.appendixPageCount, pageCount: saved.pageCount,
        } as Prisma.InputJsonValue } });
        return metadata(saved, false);
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

export async function getOfficialPdfFile(reportId: string, actor: PdfActor) {
  const { report, snapshot } = await loadFinalReport(reportId, actor);
  if (!report.pdfArtifact) throw new AppError(404, "PDF belum dibuat; panggil endpoint generate terlebih dahulu");
  if (!artifactUsesCurrentRenderer(report.pdfArtifact, snapshot)) throw new AppError(409, "PDF dibuat dengan renderer lama; panggil endpoint generate untuk membuat ulang secara native");
  return { fileName: report.pdfArtifact.fileName, absolutePath: await verifiedArtifactFile(report.pdfArtifact), metadata: metadata(report.pdfArtifact, true) };
}
