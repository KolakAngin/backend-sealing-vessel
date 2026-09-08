import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

import { env } from "../config/env.js";
import { prisma } from "../config/prisma.js";
import type { Prisma, UserRole } from "../generated/prisma/client.js";
import { resolveFile } from "../storage/local-storage.js";
import { AppError } from "../utils/app-error.js";
import { extensionForMimeType } from "../utils/uploaded-file.js";

export const OFFICIAL_XLSX_TEMPLATE_SHA256 = "d9a6e738b7551357099f2443207a11396ed2397baf1aeafb1cd4d0c616dae963";
export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type XlsxActor = { id: string; role: UserRole };

type SnapshotSection = { id: string; code: string; name: string; sequence: number; isAvailable: boolean };
type SnapshotCompartment = { id: string; code: string; name: string; side: string | null; sequence: number | null };
type SnapshotPoint = {
  vesselSealingPointId: string;
  code: string;
  displayName?: string | null;
  locationName?: string | null;
  side?: string | null;
  instanceNo: number;
  isRequired?: boolean;
  sequence?: number | null;
  section: { id: string; code: string; name: string; sequence: number };
  template: { id: string; code: string; name: string; sequence: number };
  compartment: SnapshotCompartment | null;
};
type FormSnapshot = {
  schemaVersion: number;
  sections: SnapshotSection[];
  compartments: SnapshotCompartment[];
  points: SnapshotPoint[];
};
type FinalSignature = {
  id: string;
  role: "CHIEF_OFFICER" | "TERMINAL_REPRESENTATIVE" | "SURVEYOR";
  name: string;
  signedAt: string | null;
  signatureUrl: string | null;
  signatureFileName: string | null;
  signatureMimeType: string | null;
  signatureChecksumSha256: string | null;
};
type FinalRecord = {
  vesselSealingPointId: string;
  pointSnapshot: unknown;
  status: "SEALED" | "NOT_SEALED" | "NOT_APPLICABLE";
  notes: string | null;
  seals: Array<{ sealNumber: string; status: string }>;
};
type FinalSnapshot = {
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
  formConfigurationSnapshot: FormSnapshot;
  signatures: FinalSignature[];
  records: FinalRecord[];
};
type ExportPoint = SnapshotPoint & { record: FinalRecord | null };
type PageWrites = Map<string, string>;

const templatePath = path.resolve(process.cwd(), env.SEALING_XLSX_TEMPLATE_PATH);
const exportRoot = path.resolve(process.cwd(), env.XLSX_EXPORT_DIR);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const xmlEscape = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function parseFinalSnapshot(value: unknown): FinalSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(409, "Snapshot final laporan tidak tersedia");
  const snapshot = value as Partial<FinalSnapshot>;
  const form = snapshot.formConfigurationSnapshot;
  if (snapshot.schemaVersion !== 1 || !snapshot.report || !form || !Array.isArray(form.sections) || !Array.isArray(form.points) || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.signatures)) {
    throw new AppError(409, "Struktur snapshot final laporan tidak didukung generator XLSX");
  }
  return snapshot as FinalSnapshot;
}

function assertReadable(report: { createdById: string; loadingMasterId: string | null; unloadingMasterId: string | null }, actor: XlsxActor) {
  if (actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) !== actor.id) throw new AppError(403, "Laporan ditugaskan kepada Loading Master lain");
  if (actor.role === "UNLOADING_MASTER" && report.unloadingMasterId !== actor.id) throw new AppError(403, "Laporan ditugaskan kepada Unloading Master lain");
}

async function loadFinalReport(reportId: string, actor: XlsxActor) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: { id: true, reportNo: true, shipmentNumber: true, voyageNumber: true, status: true, finalSnapshot: true, createdById: true, loadingMasterId: true, unloadingMasterId: true },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertReadable(report, actor);
  if (report.status !== "FINISH") throw new AppError(409, "XLSX resmi hanya dapat dibuat dari laporan FINISH");
  return { report, snapshot: parseFinalSnapshot(report.finalSnapshot) };
}

function safeBaseName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return normalized || "sealing-report";
}

function outputName(report: { id: string; shipmentNumber: string | null; voyageNumber: string | null; reportNo: string }) {
  return `${safeBaseName(report.shipmentNumber ?? report.voyageNumber ?? report.reportNo)}-${report.id}.xlsx`;
}

function outputPath(name: string) {
  const resolved = path.resolve(exportRoot, name);
  if (!resolved.startsWith(`${exportRoot}${path.sep}`)) throw new AppError(400, "Lokasi hasil XLSX tidak valid");
  return resolved;
}

function setCell(xml: string, reference: string, value: string | null) {
  const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inline = value === null || value === "" ? null : `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
  const full = new RegExp(`<c\\b([^>]*\\br="${escapedReference}"[^>]*)>([\\s\\S]*?)<\\/c>`);
  const empty = new RegExp(`<c\\b([^>]*\\br="${escapedReference}"[^>]*)\\/>`);
  const replace = (attributes: string) => {
    const clean = attributes.replace(/\s+t="[^"]*"/g, "");
    return inline ? `<c${clean} t="inlineStr">${inline}</c>` : `<c${clean}/>`;
  };
  if (empty.test(xml)) return xml.replace(empty, (_match, attributes: string) => replace(attributes));
  if (full.test(xml)) return xml.replace(full, (_match, attributes: string) => replace(attributes));
  throw new AppError(500, `Anchor sel ${reference} tidak ditemukan pada template resmi`);
}

function setFormulaCachedValue(xml: string, reference: string, value: string) {
  const expression = new RegExp(`<c\\b([^>]*\\br="${reference}"[^>]*)>([\\s\\S]*?<f[^>]*>[\\s\\S]*?<\\/f>[\\s\\S]*?)<v>[\\s\\S]*?<\\/v>([\\s\\S]*?)<\\/c>`);
  if (!expression.test(xml)) throw new AppError(500, `Formula ${reference} tidak ditemukan pada template resmi`);
  return xml.replace(expression, (_match, attributes: string, before: string, after: string) => {
    const clean = attributes.replace(/\s+t="[^"]*"/g, "");
    return `<c${clean} t="str">${before}<v>${xmlEscape(value)}</v>${after}</c>`;
  });
}

function write(page: PageWrites, reference: string, value: string | null) {
  page.set(reference, value ?? "");
}

function displayValue(point: ExportPoint) {
  if (point.record?.status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (!point.record || point.record.status === "NOT_SEALED") return "NOT_SEALED";
  const seals = point.record.seals.filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status)).map((seal) => seal.sealNumber);
  return seals.length > 0 ? seals.join("\n") : "NOT_SEALED";
}

function sorted(points: ExportPoint[]) {
  return [...points].sort((a, b) =>
    (a.compartment?.sequence ?? Number.MAX_SAFE_INTEGER) - (b.compartment?.sequence ?? Number.MAX_SAFE_INTEGER) ||
    (a.template.sequence ?? 0) - (b.template.sequence ?? 0) ||
    (a.sequence ?? 0) - (b.sequence ?? 0) || a.instanceNo - b.instanceNo || a.code.localeCompare(b.code));
}

function ensurePage(pages: PageWrites[], index: number) {
  while (pages.length <= index) pages.push(new Map());
  return pages[index]!;
}

const A_PORT_ROWS = [43, 46, 49, 52, 55, 58, 61, 64, 67];
const A_STBD_ROWS = [70, 73, 76, 79, 82, 85, 88, 91, 94];
const A_COLUMNS = ["Z", "AO", "BD", "BS", "CH"];

function planSectionA(points: ExportPoint[], pages: PageWrites[]) {
  const compartments = new Map<string, { compartment: SnapshotCompartment; points: ExportPoint[] }>();
  for (const point of sorted(points)) {
    const compartment = point.compartment ?? { id: `POINT-${point.vesselSealingPointId}`, code: point.locationName ?? point.code, name: point.displayName ?? point.template.name, side: point.side ?? null, sequence: point.sequence ?? null };
    const group = compartments.get(compartment.id) ?? { compartment, points: [] };
    group.points.push(point);
    compartments.set(compartment.id, group);
  }
  const groups = [...compartments.values()].sort((a, b) => (a.compartment.sequence ?? 9999) - (b.compartment.sequence ?? 9999) || a.compartment.code.localeCompare(b.compartment.code));
  const port = groups.filter((group) => (group.compartment.side ?? group.points[0]?.side) !== "STBD");
  const stbd = groups.filter((group) => (group.compartment.side ?? group.points[0]?.side) === "STBD");
  const splitSide = (sideGroups: typeof groups) => ({
    regular: sideGroups.filter((group) => !/slop/i.test(`${group.compartment.code} ${group.compartment.name}`)),
    slop: sideGroups.filter((group) => /slop/i.test(`${group.compartment.code} ${group.compartment.name}`)),
  });
  const portSplit = splitSide(port);
  const stbdSplit = splitSide(stbd);
  const templates = [...new Map(points.map((point) => [point.template.id, point.template])).values()].sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const sidePageCount = (side: ReturnType<typeof splitSide>) => Math.max(Math.ceil(side.regular.length / 8), side.slop.length);
  const rowPages = Math.max(1, sidePageCount(portSplit), sidePageCount(stbdSplit));
  const columnPages = Math.max(1, Math.ceil(templates.length / A_COLUMNS.length));
  for (let rowPage = 0; rowPage < rowPages; rowPage += 1) {
    for (let columnPage = 0; columnPage < columnPages; columnPage += 1) {
      const page = ensurePage(pages, rowPage * columnPages + columnPage);
      const templateChunk = templates.slice(columnPage * A_COLUMNS.length, (columnPage + 1) * A_COLUMNS.length);
      for (const [sideGroups, rows] of [[portSplit, A_PORT_ROWS], [stbdSplit, A_STBD_ROWS]] as const) {
        const pageGroups = sideGroups.regular.slice(rowPage * 8, (rowPage + 1) * 8).map((group, rowIndex) => ({ group, rowIndex }));
        const slop = sideGroups.slop[rowPage];
        if (slop) pageGroups.push({ group: slop, rowIndex: 8 });
        pageGroups.forEach(({ group, rowIndex }) => {
          const row = rows[rowIndex]!;
          write(page, `F${row}`, group.compartment.code);
          templateChunk.forEach((template, columnIndex) => {
            const values = group.points.filter((point) => point.template.id === template.id).map(displayValue);
            if (values.length > 0) write(page, `${A_COLUMNS[columnIndex]}${row}`, values.join("\n"));
          });
        });
      }
    }
  }
}

function planMatrix(points: ExportPoint[], pages: PageWrites[], rows: number[], columns: string[], labelColumn?: string) {
  const rowGroups = new Map<string, ExportPoint[]>();
  for (const point of sorted(points)) {
    const key = point.compartment?.id ?? `INSTANCE:${point.locationName ?? ""}:${point.side ?? "NONE"}:${point.instanceNo}`;
    rowGroups.set(key, [...(rowGroups.get(key) ?? []), point]);
  }
  const groups = [...rowGroups.values()];
  const templates = [...new Map(points.map((point) => [point.template.id, point.template])).values()].sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code));
  const rowPages = Math.max(1, Math.ceil(groups.length / rows.length));
  const columnPages = Math.max(1, Math.ceil(templates.length / columns.length));
  for (let rp = 0; rp < rowPages; rp += 1) for (let cp = 0; cp < columnPages; cp += 1) {
    const page = ensurePage(pages, rp * columnPages + cp);
    const templateChunk = templates.slice(cp * columns.length, (cp + 1) * columns.length);
    groups.slice(rp * rows.length, (rp + 1) * rows.length).forEach((group, rowIndex) => {
      const row = rows[rowIndex]!;
      if (labelColumn) write(page, `${labelColumn}${row}`, group[0]?.compartment?.code ?? String(rp * rows.length + rowIndex + 1));
      templateChunk.forEach((template, columnIndex) => {
        const values = group.filter((point) => point.template.id === template.id).map(displayValue);
        if (values.length > 0) write(page, `${columns[columnIndex]}${row}`, values.join("\n"));
      });
    });
  }
}

function planSectionB(points: ExportPoint[], pages: PageWrites[]) {
  const rows = [103, 106, 109, 112, 115];
  const port = sorted(points).filter((point) => point.side !== "STBD");
  const stbd = sorted(points).filter((point) => point.side === "STBD");
  const pageCount = Math.max(1, Math.ceil(port.length / rows.length), Math.ceil(stbd.length / rows.length));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = ensurePage(pages, pageIndex);
    const portChunk = port.slice(pageIndex * rows.length, (pageIndex + 1) * rows.length);
    const stbdChunk = stbd.slice(pageIndex * rows.length, (pageIndex + 1) * rows.length);
    rows.forEach((row, rowIndex) => {
      const left = portChunk[rowIndex];
      const right = stbdChunk[rowIndex];
      if (left || right) write(page, `F${row}`, String(pageIndex * rows.length + rowIndex + 1));
      if (left) write(page, `K${row}`, displayValue(left));
      if (right) write(page, `BD${row}`, displayValue(right));
    });
  }
}

function planFlat(points: ExportPoint[], pages: PageWrites[], slots: Array<{ label: string; value: string; number?: string }>) {
  const ordered = sorted(points);
  const pageCount = Math.max(1, Math.ceil(ordered.length / slots.length));
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = ensurePage(pages, pageIndex);
    ordered.slice(pageIndex * slots.length, (pageIndex + 1) * slots.length).forEach((point, index) => {
      const slot = slots[index]!;
      write(page, slot.label, point.compartment?.code ?? point.displayName ?? point.locationName ?? point.template.name);
      write(page, slot.value, displayValue(point));
      if (slot.number) write(page, slot.number, String(pageIndex * slots.length + index + 1));
    });
  }
}

const DATA_CELLS = [
  ...[...A_PORT_ROWS, ...A_STBD_ROWS].flatMap((row) => [`F${row}`, ...A_COLUMNS.map((column) => `${column}${row}`)]),
  ...[103, 106, 109, 112, 115].flatMap((row) => [`F${row}`, `K${row}`, `BD${row}`]),
  "F124", "K124", "BD124",
  ...[4, 7, 10, 13].flatMap((row) => [`DD${row}`, `DI${row}`, `ED${row}`, `EZ${row}`, `FE${row}`, `FZ${row}`]),
  ...[23, 26, 29, 32, 35, 38, 41, 44].flatMap((row) => [`DD${row}`, `DI${row}`, `EA${row}`, `ES${row}`, `FK${row}`, `GC${row}`]),
  ...[53, 56, 59].flatMap((row) => [`DD${row}`, `DI${row}`, `FB${row}`]),
  ...[68, 71, 74].flatMap((row) => [`DD${row}`, `DI${row}`, `EM${row}`, `FQ${row}`]),
  ...[83, 92, 101, 110, 119].flatMap((row) => [`DD${row}`, `DI${row}`, `DZ${row}`]),
  ...[2, 11, 20, 29, 38, 47, 56, 65, 74].flatMap((row) => [`HB${row}`, `HG${row}`, `HX${row}`]),
  ...[89, 95, 98, 101].flatMap((row) => [`HB${row}`, `HG${row}`, `IW${row}`]),
];

const G_SLOTS = [
  ...[83, 92, 101, 110, 119].map((row) => ({ number: `DD${row}`, label: `DI${row}`, value: `DZ${row}` })),
  ...[2, 11, 20, 29, 38, 47, 56, 65, 74].map((row) => ({ number: `HB${row}`, label: `HG${row}`, value: `HX${row}` })),
];
const H_SLOTS = [89, 95, 98, 101].map((row) => ({ number: `HB${row}`, label: `HG${row}`, value: `IW${row}` }));
const C_SLOTS = [
  { label: "F124", value: "K124" }, { label: "F124", value: "BD124" },
  ...[4, 7, 10, 13].flatMap((row) => [
    { label: `DD${row}`, value: `DI${row}` }, { label: `DD${row}`, value: `ED${row}` },
    { label: `EZ${row}`, value: `FE${row}` }, { label: `EZ${row}`, value: `FZ${row}` },
  ]),
];

function planPages(snapshot: FinalSnapshot) {
  const pages: PageWrites[] = [new Map()];
  const records = new Map(snapshot.records.map((record) => [record.vesselSealingPointId, record]));
  const points = snapshot.formConfigurationSnapshot.points.map((point) => ({ ...point, record: records.get(point.vesselSealingPointId) ?? null }));
  const sections = new Map(snapshot.formConfigurationSnapshot.sections.map((section) => [section.code.toUpperCase(), section]));
  const sectionPoints = (code: string) => sections.get(code)?.isAvailable === false
    ? [] : points.filter((point) => point.section.code.toUpperCase() === code);

  planSectionA(sectionPoints("A"), pages);
  planSectionB(sectionPoints("B"), pages);
  planFlat(sectionPoints("C"), pages, C_SLOTS);
  planMatrix(sectionPoints("D"), pages, [23, 26, 29, 32, 35, 38, 41, 44], ["DI", "EA", "ES", "FK", "GC"], "DD");
  planMatrix(sectionPoints("E"), pages, [53, 56, 59], ["DI", "FB"], "DD");
  planMatrix(sectionPoints("F"), pages, [68, 71, 74], ["EM", "FQ"], "DI");
  planFlat(sectionPoints("G"), pages, G_SLOTS);
  planFlat(sectionPoints("H"), pages, H_SLOTS);

  const unavailableFirstCells: Record<string, string> = { A: "Z43", B: "K103", C: "K124", D: "DI23", E: "DI53", F: "EM68", G: "DZ83", H: "IW89" };
  for (const code of Object.keys(unavailableFirstCells)) {
    if (sections.get(code)?.isAvailable === false) write(pages[0]!, unavailableFirstCells[code]!, "NOT_APPLICABLE");
  }
  return pages;
}

function formatDate(value: string | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(date);
}

function location(plant: { code: string; name: string } | null, jetty: { name: string } | null) {
  return [plant?.name ?? plant?.code, jetty?.name].filter(Boolean).join(" / ");
}

function writeHeader(xml: string, snapshot: FinalSnapshot, pageIndex: number, pageCount: number) {
  const report = snapshot.report;
  const activity = report.activity?.code?.toUpperCase() ?? report.activity?.name ?? "";
  const loading = location(report.loadingPlant, report.loadingJetty);
  const discharge = location(report.dischargePlant, report.dischargeJetty);
  const header = `Voyage: ${report.voyageNumber ?? "-"} | Shipment: ${report.shipmentNumber ?? "-"} | Sealing: ${report.sealingStatus ?? "-"}${pageCount > 1 ? ` | Continuation ${pageIndex + 1}/${pageCount}` : ""}`;
  const values: Record<string, string> = {
    C2: header,
    U9: report.vessel.name,
    U11: `Loading: ${loading || "-"}\nDischarge: ${discharge || "-"}`,
    U13: report.product?.name ?? "",
    U15: formatDate(report.reportDateTime),
    AQ20: activity === "DISCHARGE" ? discharge : loading,
    Y22: activity,
  };
  for (const [cell, value] of Object.entries(values)) xml = setCell(xml, cell, value);
  xml = setFormulaCachedValue(xml, "C20", report.vessel.name);
  xml = setFormulaCachedValue(xml, "BN22", report.vessel.name);
  return xml;
}

const signatureCells = {
  CHIEF_OFFICER: { name: "GY123", box: "GY111", from: "GY", to: "IE" },
  TERMINAL_REPRESENTATIVE: { name: "IE123", box: "IE111", from: "IE", to: "JM" },
  SURVEYOR: { name: "JM123", box: "JM111", from: "JM", to: "KS" },
} as const;

function columnIndex(column: string) {
  return [...column].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
}

type SignatureImage = { signature: FinalSignature; mediaName: string; bytes: Buffer; contentType: string };

async function loadSignatureImages(signatures: FinalSignature[]) {
  const result: SignatureImage[] = [];
  for (const signature of signatures) {
    const mime = signature.signatureMimeType;
    if (!mime || !signature.signatureFileName || !["image/jpeg", "image/png", "image/webp"].includes(mime)) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(resolveFile(`signature-${signature.id}.${extensionForMimeType(mime)}`));
    } catch {
      throw new AppError(409, `File tanda tangan ${signature.role} tidak ditemukan`);
    }
    if (signature.signatureChecksumSha256 && hash(bytes) !== signature.signatureChecksumSha256) throw new AppError(409, `Checksum file tanda tangan ${signature.role} tidak sesuai snapshot final`);
    result.push({ signature, mediaName: `signature-${signature.id}.${extensionForMimeType(mime)}`, bytes, contentType: mime });
  }
  return result;
}

function signatureText(signature: FinalSignature | undefined) {
  if (!signature) return "";
  return `${signature.name}${signature.signedAt ? `\n${formatDate(signature.signedAt)}` : ""}`;
}

function buildDrawing(original: string, images: SignatureImage[]) {
  let drawing = original;
  let relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`;
  images.forEach((item, index) => {
    const relationshipId = index + 2;
    const cells = signatureCells[item.signature.role];
    relationships += `<Relationship Id="rId${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${xmlEscape(item.mediaName)}"/>`;
    const anchor = `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${columnIndex(cells.from)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>110</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${columnIndex(cells.to)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>122</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${relationshipId + 1}" name="Signature ${xmlEscape(item.signature.role)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
    drawing = drawing.replace("</xdr:wsDr>", `${anchor}</xdr:wsDr>`);
  });
  return { drawing, relationships: `${relationships}</Relationships>` };
}

function sheetRelationships(index: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${index}.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/printerSettings" Target="../printerSettings/printerSettings${index}.bin"/></Relationships>`;
}

export async function buildOfficialWorkbook(snapshot: FinalSnapshot) {
  const template = await readFile(templatePath).catch(() => { throw new AppError(500, `Template XLSX resmi tidak ditemukan: ${templatePath}`); });
  const templateSha256 = hash(template);
  if (templateSha256 !== OFFICIAL_XLSX_TEMPLATE_SHA256) throw new AppError(409, "Template XLSX resmi berubah; checksum tidak sesuai sumber kebenaran");
  const zip = await JSZip.loadAsync(template);
  const originalSheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const originalDrawing = await zip.file("xl/drawings/drawing1.xml")!.async("string");
  const printerSettings = await zip.file("xl/printerSettings/printerSettings1.bin")!.async("nodebuffer");
  const pages = planPages(snapshot);
  const signatureImages = await loadSignatureImages(snapshot.signatures);
  const imageRoles = new Set(signatureImages.map((item) => item.signature.role));
  for (const image of signatureImages) zip.file(`xl/media/${image.mediaName}`, image.bytes);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    let sheet = originalSheet;
    for (const cell of DATA_CELLS) sheet = setCell(sheet, cell, null);
    sheet = writeHeader(sheet, snapshot, pageIndex, pages.length);
    for (const signature of snapshot.signatures) {
      const cells = signatureCells[signature.role];
      sheet = setCell(sheet, cells.name, signatureText(signature));
      if (!imageRoles.has(signature.role) && signature.signatureUrl) {
        const label = signature.signatureMimeType === "application/pdf" && signature.signatureFileName
          ? `Dokumen tanda tangan: ${signature.signatureFileName}` : `Tanda tangan: ${signature.signatureUrl}`;
        sheet = setCell(sheet, cells.box, label);
      }
    }
    for (const [cell, value] of pages[pageIndex]!) sheet = setCell(sheet, cell, value);
    const partIndex = pageIndex + 1;
    zip.file(`xl/worksheets/sheet${partIndex}.xml`, sheet);
    const drawing = buildDrawing(originalDrawing, signatureImages);
    zip.file(`xl/drawings/drawing${partIndex}.xml`, drawing.drawing);
    zip.file(`xl/drawings/_rels/drawing${partIndex}.xml.rels`, drawing.relationships);
    zip.file(`xl/worksheets/_rels/sheet${partIndex}.xml.rels`, sheetRelationships(partIndex));
    zip.file(`xl/printerSettings/printerSettings${partIndex}.bin`, printerSettings);
  }

  if (pages.length > 1) {
    let workbook = await zip.file("xl/workbook.xml")!.async("string");
    let workbookRels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    for (let index = 2; index <= pages.length; index += 1) {
      const relationshipId = index + 4;
      workbook = workbook.replace("</sheets>", `<sheet name="Segel Lanjutan ${index - 1}" sheetId="${index + 1}" r:id="rId${relationshipId}"/></sheets>`);
      workbookRels = workbookRels.replace("</Relationships>", `<Relationship Id="rId${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index}.xml"/></Relationships>`);
      contentTypes = contentTypes.replace("</Types>", `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
    zip.file("xl/workbook.xml", workbook);
    zip.file("xl/_rels/workbook.xml.rels", workbookRels);
    zip.file("[Content_Types].xml", contentTypes);
  }
  if (signatureImages.some((item) => item.contentType === "image/jpeg")) {
    let types = await zip.file("[Content_Types].xml")!.async("string");
    if (!types.includes('Extension="jpg"')) types = types.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
    zip.file("[Content_Types].xml", types);
  }
  if (signatureImages.some((item) => item.contentType === "image/webp")) {
    let types = await zip.file("[Content_Types].xml")!.async("string");
    if (!types.includes('Extension="webp"')) types = types.replace("</Types>", '<Default Extension="webp" ContentType="image/webp"/></Types>');
    zip.file("[Content_Types].xml", types);
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { buffer, templateSha256, sheetCount: pages.length };
}

export async function generateOfficialXlsx(reportId: string, actor: XlsxActor) {
  const { report, snapshot } = await loadFinalReport(reportId, actor);
  const generated = await buildOfficialWorkbook(snapshot);
  const fileName = outputName(report);
  const destination = outputPath(fileName);
  await mkdir(exportRoot, { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, generated.buffer, { flag: "wx" });
  try {
    await rename(temporary, destination);
    try {
      await prisma.auditLog.create({ data: {
        userId: actor.id, action: "CREATE", entityType: "XLSX_EXPORT", entityId: reportId,
        newData: { fileName, fileSize: generated.buffer.length, checksumSha256: hash(generated.buffer), templateChecksumSha256: generated.templateSha256, sheetCount: generated.sheetCount } as Prisma.InputJsonValue,
      } });
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return { reportId, fileName, mimeType: XLSX_CONTENT_TYPE, fileSize: generated.buffer.length, checksumSha256: hash(generated.buffer), templateChecksumSha256: generated.templateSha256, sheetCount: generated.sheetCount, previewUrl: `/api/v1/reports/${reportId}/xlsx/preview`, downloadUrl: `/api/v1/reports/${reportId}/xlsx/download` };
}

export async function getOfficialXlsxFile(reportId: string, actor: XlsxActor) {
  const { report } = await loadFinalReport(reportId, actor);
  const fileName = outputName(report);
  const absolutePath = outputPath(fileName);
  try {
    await stat(absolutePath);
  } catch {
    throw new AppError(404, "XLSX belum dibuat; panggil endpoint generate terlebih dahulu");
  }
  return { fileName, absolutePath };
}
