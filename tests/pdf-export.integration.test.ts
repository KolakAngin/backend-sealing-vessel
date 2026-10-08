import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { buildOfficialPdf, NATIVE_PDF_LAYOUT_SHA256, PDF_RENDERER_VERSION } from "../src/services/pdf-export.service.js";
import { removeFile, saveFile } from "../src/storage/local-storage.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Anchor = { page: number; text: string; x: number; y: number; tolerance: number };
type Golden = {
  layoutSha256: string;
  formPageCount: number;
  appendixPageCount: number;
  pageCount: number;
  pageSize: { width: number; height: number; tolerance: number };
  anchors: Anchor[];
};
type Api<T> = { success: boolean; message: string; data: T };
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const standardFontDataUrl = `${path.resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}${path.sep}`;

test("PDF final Queen Sofia deterministik, tersimpan, A4, dan mempunyai appendix foto", async () => {
  await prisma.$connect();
  const golden = JSON.parse(await readFile(new URL("./fixtures/queen-sofia-pdf.visual.json", import.meta.url), "utf8")) as Golden;
  assert.equal(golden.layoutSha256, NATIVE_PDF_LAYOUT_SHA256);

  const admin = await createTestIdentity("ADMIN");
  const viewer = await createTestIdentity("VIEWER");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const xlsx = await JSZip.loadAsync(await readFile(path.resolve(process.cwd(), env.SEALING_XLSX_TEMPLATE_PATH)));
  const image = await xlsx.file("xl/media/image1.png")!.async("nodebuffer");
  const signatureId = randomUUID();
  const fileKeys: string[] = [`signature-${signatureId}.png`];
  let vesselId = "";
  let reportId = "";
  let pdfPath = "";

  const sections = "ABCDEFGH".split("").map((code, index) => ({ id: `section-${code}`, code, name: `Bagian ${code}`, sequence: index + 1, isAvailable: true }));
  const compartmentCodes = ["1P", "2P", "3P", "4P", "5P", "6P", "7P", "Slop Port", "1S", "2S", "3S", "4S", "5S", "6S", "7S", "Slop Starboard"];
  const compartments = compartmentCodes.map((code, index) => ({ id: `comp-${index}`, code, name: code, side: index < 8 ? "PORT" : "STBD", sequence: index + 1 }));
  const points: Array<Record<string, unknown>> = [];
  const records: Array<Record<string, unknown>> = [];
  const addPoint = (sectionCode: string, name: string, number: string, compartment: typeof compartments[number] | null = null, sequence = 1) => {
    const id = `point-${sectionCode}-${points.length + 1}`;
    const point = { vesselSealingPointId: id, code: id, displayName: name, locationName: null, side: compartment?.side ?? null, instanceNo: 1, isRequired: true, sequence, section: sections.find((item) => item.code === sectionCode), template: { id: `template-${sectionCode}-${name}`, code: name, name, sequence }, compartment };
    points.push(point);
    records.push({ vesselSealingPointId: id, status: "SEALED", notes: null, pointSnapshot: point, attachments: [], seals: [{ sealNumber: number, status: "VERIFIED", verifications: [] }] });
  };
  const aTemplates = ["Sounding Hole", "Tank Cleaning Access", "Hatch Coaming", "Sampling Hole", "Emergency Connection"];
  compartments.forEach((compartment) => aTemplates.forEach((name, index) => addPoint("A", name, `QS-A-${compartment.code.replaceAll(" ", "-")}-${index + 1}`, compartment, index + 1)));
  const equipment: Record<string, string[]> = {
    B: ["Cargo Manifold Port", "Cargo Manifold Starboard"], C: ["Fore Peak Tank", "After Peak Tank"], D: ["Suction Valve", "Stripping Valve"],
    E: ["Tank Cleaning Valve", "COW Valve"], F: ["Bunker Sounding Hole", "Bunker Deck Seal"], G: ["Cargo Sea Chest Valve", "Spool Piece"], H: ["Sampling Bottle", "Measurement Tool Box"],
  };
  for (const code of "BCDEFGH") equipment[code]!.forEach((name, index) => addPoint(code, name, `QS-${code}-${String(index + 1).padStart(3, "0")}`, null, index + 1));
  const photos = Array.from({ length: 10 }, (_, index) => {
    const id = randomUUID();
    fileKeys.push(`${id}.png`);
    return { id, ownerType: "REPORT", type: "PHOTO", sectionCode: String.fromCharCode(65 + (index % 8)), compartmentId: null, vesselSealingPointId: null, caption: `Foto Queen Sofia ${index + 1}`, sequence: index + 1, fileName: `queen-sofia-${index + 1}.png`, fileUrl: `/api/v1/attachments/${id}/preview`, mimeType: "image/png", fileSize: String(image.length), checksumSha256: sha256(image), uploadedById: admin.user.id, createdAt: `2026-07-29T00:${String(index).padStart(2, "0")}:00.000Z` };
  });
  const finalSnapshot = {
    schemaVersion: 1, capturedAt: "2026-07-29T00:00:00.000Z", finalizedById: "snapshot-loading-master",
    report: {
      id: "snapshot-report", reportNo: "RPT-QS-PDF", shipmentNumber: `SHP-QS-PDF-${suffix}`, voyageNumber: "VOY-QS-2026-01",
      activity: { code: "LOADING", name: "LOADING" }, vessel: { id: "snapshot-vessel", name: "OB. QUEEN SOFIA", imoNumber: null }, product: { name: "B40" },
      loadingPlant: { code: "TAB", name: "STS TABONEO" }, loadingJetty: { name: "MT. GLOBAL TOP" }, dischargePlant: { code: "MKS", name: "INTEGRATED TERMINAL MAKASSAR" }, dischargeJetty: { name: "JETTY 1" },
      sealingStatus: "COMPLETED", journeyStatus: "FINISH", sealingProcessStatus: "FINALIZED", reportDateTime: "2026-07-28T08:30:00.000Z", departedAt: null, arrivedAt: null, finishedAt: "2026-07-29T00:00:00.000Z",
      loadingMaster: { id: "snapshot-loading-master", fullName: "Loading Master Queen Sofia" }, unloadingMaster: { id: "snapshot-unloading-master", fullName: "Unloading Master Queen Sofia" }, remarks: null,
    },
    formConfigurationSnapshot: { schemaVersion: 1, sections, compartments, points },
    signatures: [{ id: signatureId, role: "CHIEF_OFFICER", name: "Chief Officer Queen Sofia", signedAt: "2026-07-29T01:00:00.000Z", signatureUrl: `/api/v1/signatures/${signatureId}/preview`, signatureFileName: "chief.png", signatureMimeType: "image/png", signatureFileSize: String(image.length), signatureChecksumSha256: sha256(image) }],
    records, attachments: photos,
  };

  try {
    await Promise.all(fileKeys.map((key) => saveFile(key, image)));
    const vessel = await prisma.vessel.create({ data: { name: `OB. QUEEN SOFIA PDF ${suffix}` } });
    vesselId = vessel.id;
    finalSnapshot.report.vessel.id = vessel.id;
    const report = await prisma.sealingReport.create({ data: {
      reportNo: `RPT-QS-PDF-${suffix}`, shipmentNumber: `SHP-QS-PDF-${suffix}`, voyageNumber: "VOY-QS-2026-01", vesselId: vessel.id, createdById: admin.user.id,
      reportDateTime: new Date("2026-07-28T08:30:00.000Z"), status: "FINISH", finalSnapshot,
    } as Prisma.SealingReportUncheckedCreateInput });
    reportId = report.id;

    const directA = await buildOfficialPdf(finalSnapshot as never);
    const directB = await buildOfficialPdf(finalSnapshot as never);
    assert.equal(sha256(directA.buffer), sha256(directB.buffer), "renderer harus deterministik untuk snapshot dan file sumber yang sama");
    const withoutG = structuredClone(finalSnapshot);
    withoutG.formConfigurationSnapshot.sections.find((section) => section.code === "G")!.isAvailable = false;
    const gPointIds = new Set(withoutG.formConfigurationSnapshot.points.filter((point) => (point.section as { code: string }).code === "G").map((point) => point.vesselSealingPointId));
    withoutG.formConfigurationSnapshot.points = withoutG.formConfigurationSnapshot.points.filter((point) => !gPointIds.has(point.vesselSealingPointId));
    withoutG.records = withoutG.records.filter((record) => !gPointIds.has(record.vesselSealingPointId));
    withoutG.attachments = [];
    const unavailablePdf = await buildOfficialPdf(withoutG as never);
    const unavailableParsed = await getDocument({ data: new Uint8Array(unavailablePdf.buffer), useSystemFonts: false, standardFontDataUrl }).promise;
    const unavailableText = (await (await unavailableParsed.getPage(2)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    assert.doesNotMatch(unavailableText, /Bagian G tidak tersedia/);
    assert.doesNotMatch(unavailableText, /NOT_APPLICABLE/);

    const unloadingSnapshot = structuredClone(finalSnapshot);
    unloadingSnapshot.finalizedById = "snapshot-unloading-master";
    unloadingSnapshot.attachments = [];
    const unloadingPdf = await buildOfficialPdf(unloadingSnapshot as never);
    const unloadingParsed = await getDocument({ data: new Uint8Array(unloadingPdf.buffer), useSystemFonts: false, standardFontDataUrl }).promise;
    const unloadingText = (await (await unloadingParsed.getPage(1)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    assert.match(unloadingText, /We are\s+Unloading Master Queen Sofia/);
    assert.match(unloadingText, /at port\s+INTEGRATED TERMINAL MAKASSAR \/ JETTY 1/);

    const emptySealSnapshot = structuredClone(finalSnapshot);
    emptySealSnapshot.attachments = [];
    emptySealSnapshot.records.forEach((record) => {
      record.status = "NOT_APPLICABLE";
      record.seals = [];
    });
    const compactPdf = await buildOfficialPdf(emptySealSnapshot as never);
    assert.equal(compactPdf.formPageCount, 2, "A-H tanpa nomor segel harus dipadatkan menjadi dua halaman form");
    assert.equal(compactPdf.pageCount, 2);
    const compactParsed = await getDocument({ data: new Uint8Array(compactPdf.buffer), useSystemFonts: false, standardFontDataUrl }).promise;
    const compactPage2Text = (await (await compactParsed.getPage(2)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    for (const code of "BCDEFGH") assert.match(compactPage2Text, new RegExp(`${code}\\.`));
    assert.doesNotMatch(compactPage2Text, /NOT_APPLICABLE|QS-[B-H]-/);

    const generatedResponse = await fetch(`${api}/shipments/${report.id}/pdf`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    const generated = await generatedResponse.json() as Api<{ fileName: string; checksumSha256: string; templateChecksumSha256: string; rendererVersion: string; formPageCount: number; appendixPageCount: number; pageCount: number; reused: boolean }>;
    assert.equal(generatedResponse.status, 201, JSON.stringify(generated));
    assert.equal(generated.data.reused, false);
    assert.equal(generated.data.templateChecksumSha256, golden.layoutSha256);
    assert.equal(generated.data.rendererVersion, PDF_RENDERER_VERSION);
    assert.equal(generated.data.formPageCount, golden.formPageCount);
    assert.equal(generated.data.appendixPageCount, golden.appendixPageCount);
    assert.equal(generated.data.pageCount, golden.pageCount);
    pdfPath = path.resolve(process.cwd(), env.PDF_EXPORT_DIR, generated.data.fileName);

    const preview = await fetch(`${api}/reports/${report.id}/pdf/preview`, { headers: authorizationHeaders(admin.accessToken) });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(preview.headers.get("x-checksum-sha256"), generated.data.checksumSha256);
    const bytes = Buffer.from(await preview.arrayBuffer());
    assert.equal(sha256(bytes), generated.data.checksumSha256);
    const download = await fetch(`${api}/voyages/${report.id}/pdf/download`, { headers: authorizationHeaders(admin.accessToken) });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

    const reusedResponse = await fetch(`${api}/reports/${report.id}/pdf`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    const reused = await reusedResponse.json() as Api<{ checksumSha256: string; reused: boolean }>;
    assert.equal(reusedResponse.status, 200);
    assert.equal(reused.data.reused, true);
    assert.equal(reused.data.checksumSha256, generated.data.checksumSha256);
    assert.equal(await prisma.pdfArtifact.count({ where: { sealingReportId: report.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityType: "PDF_EXPORT", entityId: report.id } }), 1);

    await prisma.pdfArtifact.update({
      where: { sealingReportId: report.id },
      data: { rendererVersion: "tko-background-overlay-v1", templateChecksumSha256: "231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6" },
    });
    const stalePreview = await fetch(`${api}/reports/${report.id}/pdf/preview`, { headers: authorizationHeaders(admin.accessToken) });
    assert.equal(stalePreview.status, 409, "artefak renderer lama tidak boleh dipreview sebagai hasil native");
    const regeneratedResponse = await fetch(`${api}/reports/${report.id}/pdf`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    const regenerated = await regeneratedResponse.json() as Api<{ checksumSha256: string; rendererVersion: string; reused: boolean }>;
    assert.equal(regeneratedResponse.status, 201, JSON.stringify(regenerated));
    assert.equal(regenerated.data.reused, false);
    assert.equal(regenerated.data.rendererVersion, PDF_RENDERER_VERSION);
    assert.equal(regenerated.data.checksumSha256, generated.data.checksumSha256, "regenerasi layout native harus deterministik");
    assert.equal(await prisma.pdfArtifact.count({ where: { sealingReportId: report.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { entityType: "PDF_EXPORT", entityId: report.id } }), 2);

    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), golden.pageCount);
    for (const page of pdf.getPages()) {
      assert.ok(Math.abs(page.getWidth() - golden.pageSize.width) <= golden.pageSize.tolerance);
      assert.ok(Math.abs(page.getHeight() - golden.pageSize.height) <= golden.pageSize.tolerance);
    }
    const parsed = await getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
      standardFontDataUrl,
    }).promise;
    const page2Text = (await (await parsed.getPage(2)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    const page3Text = (await (await parsed.getPage(3)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    const page1Text = (await (await parsed.getPage(1)).getTextContent()).items.filter((item) => "str" in item).map((item) => item.str).join(" ");
    assert.match(page1Text, /We are\s+Loading Master Queen Sofia/);
    assert.match(page1Text, /at port\s+STS TABONEO \/ MT\. GLOBAL TOP/);
    for (const code of "BCDE") assert.match(page2Text, new RegExp(`QS-${code}-001`));
    for (const code of "FGH") assert.match(page3Text, new RegExp(`QS-${code}-001`));
    const imageOperators = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintSolidColorImageMask]);
    const page1Images = (await (await parsed.getPage(1)).getOperatorList()).fnArray.filter((operator) => imageOperators.has(operator)).length;
    const page3Images = (await (await parsed.getPage(3)).getOperatorList()).fnArray.filter((operator) => imageOperators.has(operator)).length;
    const page4Images = (await (await parsed.getPage(4)).getOperatorList()).fnArray.filter((operator) => imageOperators.has(operator)).length;
    assert.equal(page1Images, 1, "halaman form native hanya boleh membawa satu citra logo, bukan citra halaman template");
    assert.ok(page3Images >= 1, "citra tanda tangan harus tertanam");
    assert.ok(page4Images >= 9, "sembilan foto appendix pertama harus tertanam");
    for (const anchor of golden.anchors) {
      const content = await (await parsed.getPage(anchor.page)).getTextContent();
      const item = content.items.find((candidate) => "str" in candidate && candidate.str.includes(anchor.text));
      assert.ok(item && "transform" in item, `anchor visual tidak ditemukan: ${anchor.text}`);
      assert.ok(Math.abs(item.transform[4] - anchor.x) <= anchor.tolerance, `x ${anchor.text}: ${item.transform[4]}`);
      assert.ok(Math.abs(item.transform[5] - anchor.y) <= anchor.tolerance, `y ${anchor.text}: ${item.transform[5]}`);
    }

    const viewerGenerate = await fetch(`${api}/reports/${report.id}/pdf`, { method: "POST", headers: authorizationHeaders(viewer.accessToken) });
    assert.equal(viewerGenerate.status, 403);
    const draft = await prisma.sealingReport.create({ data: { reportNo: `DRAFT-PDF-${suffix}`, vesselId: vessel.id, createdById: admin.user.id, reportDateTime: new Date(), status: "DRAFT" } });
    const draftGenerate = await fetch(`${api}/reports/${draft.id}/pdf`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    assert.equal(draftGenerate.status, 409);
    await prisma.sealingReport.delete({ where: { id: draft.id } });
  } finally {
    if (reportId) await prisma.sealingReport.delete({ where: { id: reportId } }).catch(() => undefined);
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => undefined);
    if (pdfPath) await unlink(pdfPath).catch(() => undefined);
    await Promise.all(fileKeys.map((key) => removeFile(key).catch(() => undefined)));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
