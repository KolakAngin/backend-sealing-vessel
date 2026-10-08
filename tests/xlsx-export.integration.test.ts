import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";

import JSZip from "jszip";

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import type { Prisma } from "../src/generated/prisma/client.js";
import { buildOfficialWorkbook, OFFICIAL_XLSX_TEMPLATE_SHA256 } from "../src/services/xlsx-export.service.js";
import { removeFile, saveFile } from "../src/storage/local-storage.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Golden = {
  templateSha256: string;
  report: {
    reportNo: string; shipmentNumber: string; voyageNumber: string; vesselName: string;
    activity: string; product: string; loadingPlant: string; loadingJetty: string;
    dischargePlant: string; dischargeJetty: string; sealingStatus: string;
    reportDateTime: string; loadingMaster: string;
  };
  compartments: Array<{ code: string; side: string }>;
  sectionATemplates: string[];
  equipment: Record<string, string[]>;
  expected: Record<string, string>;
  structure: { sheetCount: number; mergeCount: number; logoPath: string; printerSettingsPath: string };
};
type Api<T> = { success: boolean; message: string; data: T };

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const decodeXml = (value: string) => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");

function cellValue(xml: string, reference: string) {
  const match = xml.match(new RegExp(`<c\\b[^>]*\\br="${reference}"[^>]*>([\\s\\S]*?)<\\/c>`));
  if (!match) return "";
  return decodeXml([...match[1]!.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((item) => item[1]).join(""));
}

function structuralFragments(xml: string) {
  const element = (name: string) => xml.match(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}>`))?.[0] ?? xml.match(new RegExp(`<${name}\\b[^>]*/>`))?.[0] ?? "";
  return {
    columns: element("cols"),
    merges: element("mergeCells"),
    margins: element("pageMargins"),
    setup: element("pageSetup"),
    breaks: element("colBreaks"),
    rowGeometry: [...xml.matchAll(/<row\b[^>]*>/g)].map((item) => item[0].replace(/ spans="[^"]*"/, "")),
  };
}

test("XLSX resmi Queen Sofia memetakan nilai dan mempertahankan struktur template", async () => {
  await prisma.$connect();
  const golden = JSON.parse(await readFile(new URL("./fixtures/queen-sofia-xlsx.golden.json", import.meta.url), "utf8")) as Golden;
  const templatePath = path.resolve(process.cwd(), env.SEALING_XLSX_TEMPLATE_PATH);
  const templateBytes = await readFile(templatePath);
  assert.equal(sha256(templateBytes), golden.templateSha256);
  assert.equal(golden.templateSha256, OFFICIAL_XLSX_TEMPLATE_SHA256);

  const admin = await createTestIdentity("ADMIN");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const signatureId = randomUUID();
  const signatureBytes = (await JSZip.loadAsync(templateBytes)).file(golden.structure.logoPath)!;
  const storedSignature = await signatureBytes.async("nodebuffer");
  const signatureKey = `signature-${signatureId}.png`;
  let vesselId = "";
  let reportId = "";
  let exportFile = "";

  const sections = "ABCDEFGH".split("").map((code, index) => ({ id: `section-${code}`, code, name: `Bagian ${code}`, sequence: index + 1, isAvailable: true }));
  const compartments = golden.compartments.map((compartment, index) => ({ id: `comp-${index + 1}`, code: compartment.code, name: compartment.code, side: compartment.side, sequence: index + 1 }));
  const points: Array<Record<string, unknown>> = [];
  const records: Array<Record<string, unknown>> = [];
  const addPoint = (sectionCode: string, templateName: string, sealNumbers: string[], compartment: typeof compartments[number] | null = null, status = "SEALED") => {
    const section = sections.find((item) => item.code === sectionCode)!;
    const sequence = golden.sectionATemplates.indexOf(templateName) >= 0 ? golden.sectionATemplates.indexOf(templateName) + 1 : (points.filter((point) => (point.section as { code: string }).code === sectionCode).length + 1);
    const id = `point-${sectionCode}-${points.length + 1}`;
    points.push({ vesselSealingPointId: id, code: id, displayName: templateName, side: compartment?.side ?? null, instanceNo: 1, isRequired: true, sequence, section, template: { id: `template-${sectionCode}-${templateName}`, code: templateName, name: templateName, sequence }, compartment });
    records.push({ vesselSealingPointId: id, status, notes: null, pointSnapshot: points.at(-1), seals: sealNumbers.map((sealNumber) => ({ sealNumber, status: "VERIFIED" })) });
  };

  golden.compartments.forEach((compartment, compartmentIndex) => {
    golden.sectionATemplates.forEach((template, templateIndex) => addPoint("A", template, [`QS-A-${compartment.code.replaceAll(" ", "-")}-${templateIndex + 1}`], compartments[compartmentIndex]!));
  });
  for (const code of "BCDEF") golden.equipment[code]!.forEach((name, index) => addPoint(code, name, [`QS-${code}-${String(index + 1).padStart(3, "0")}`]));
  golden.equipment.G!.forEach((name, index) => addPoint("G", name, index === 0 ? ["QS-G-001", "QS-G-001-B"] : [`QS-G-${String(index + 1).padStart(3, "0")}`]));
  golden.equipment.H!.forEach((name, index) => addPoint("H", name, [`QS-H-${String(index + 1).padStart(3, "0")}`]));

  try {
    await saveFile(signatureKey, storedSignature);
    const vessel = await prisma.vessel.create({ data: { name: `${golden.report.vesselName}-${suffix}` } });
    vesselId = vessel.id;
    const finalSnapshot = {
      schemaVersion: 1,
      capturedAt: "2026-07-29T00:00:00.000Z",
      report: {
        id: "snapshot-report", reportNo: golden.report.reportNo, shipmentNumber: `${golden.report.shipmentNumber}-${suffix}`, voyageNumber: golden.report.voyageNumber,
        activity: { code: golden.report.activity, name: golden.report.activity }, vessel: { id: vessel.id, name: golden.report.vesselName, imoNumber: null },
        product: { name: golden.report.product }, loadingPlant: { code: "TAB", name: golden.report.loadingPlant }, loadingJetty: { name: golden.report.loadingJetty },
        dischargePlant: { code: "MKS", name: golden.report.dischargePlant }, dischargeJetty: { name: golden.report.dischargeJetty }, sealingStatus: golden.report.sealingStatus,
        reportDateTime: golden.report.reportDateTime, loadingMaster: { fullName: golden.report.loadingMaster }, unloadingMaster: { fullName: "Unloading Master Queen Sofia" },
      },
      formConfigurationSnapshot: { schemaVersion: 1, sections, compartments, points },
      signatures: [
        { id: signatureId, role: "CHIEF_OFFICER", name: "Chief Officer Queen Sofia", signedAt: "2026-07-29T01:00:00.000Z", signatureUrl: `/api/v1/signatures/${signatureId}/preview`, signatureFileName: "chief.png", signatureMimeType: "image/png", signatureChecksumSha256: sha256(storedSignature) },
        { id: "terminal-sign", role: "TERMINAL_REPRESENTATIVE", name: "Terminal Representative Queen Sofia", signedAt: null, signatureUrl: "https://example.invalid/terminal-signature", signatureFileName: null, signatureMimeType: null, signatureChecksumSha256: null },
      ],
      records,
      attachments: [],
    };
    const report = await prisma.sealingReport.create({ data: {
      reportNo: `${golden.report.reportNo}-${suffix}`, shipmentNumber: `${golden.report.shipmentNumber}-${suffix}`, voyageNumber: golden.report.voyageNumber,
      vesselId: vessel.id, createdById: admin.user.id, reportDateTime: new Date(golden.report.reportDateTime), status: "FINISH", finalSnapshot,
    } as Prisma.SealingReportUncheckedCreateInput });
    reportId = report.id;

    const generateResponse = await fetch(`${api}/shipments/${report.id}/xlsx`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    const generated = await generateResponse.json() as Api<{ fileName: string; checksumSha256: string; templateChecksumSha256: string; sheetCount: number }>;
    assert.equal(generateResponse.status, 201, JSON.stringify(generated));
    assert.equal(generated.data.templateChecksumSha256, golden.templateSha256);
    assert.equal(generated.data.sheetCount, golden.structure.sheetCount);
    exportFile = path.resolve(process.cwd(), env.XLSX_EXPORT_DIR, generated.data.fileName);

    const preview = await fetch(`${api}/reports/${report.id}/xlsx/preview`, { headers: authorizationHeaders(admin.accessToken) });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition") ?? "", /^inline;/);
    const output = Buffer.from(await preview.arrayBuffer());
    assert.equal(sha256(output), generated.data.checksumSha256);
    const download = await fetch(`${api}/voyages/${report.id}/xlsx/download`, { headers: authorizationHeaders(admin.accessToken) });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);

    const [templateZip, outputZip] = await Promise.all([JSZip.loadAsync(templateBytes), JSZip.loadAsync(output)]);
    const [templateSheet, outputSheet] = await Promise.all([
      templateZip.file("xl/worksheets/sheet1.xml")!.async("string"), outputZip.file("xl/worksheets/sheet1.xml")!.async("string"),
    ]);
    for (const [cell, value] of Object.entries(golden.expected)) assert.equal(cellValue(outputSheet, cell), value, cell);
    assert.match(cellValue(outputSheet, "C2"), /Voyage: VOY-QS-2026-01/);
    assert.match(cellValue(outputSheet, "U11"), /Loading: STS TABONEO \/ MT\. GLOBAL TOP/);
    assert.deepEqual(structuralFragments(outputSheet), structuralFragments(templateSheet));
    assert.equal((outputSheet.match(/<mergeCell /g) ?? []).length, golden.structure.mergeCount);
    assert.deepEqual(await outputZip.file(golden.structure.logoPath)!.async("nodebuffer"), await templateZip.file(golden.structure.logoPath)!.async("nodebuffer"));
    assert.deepEqual(await outputZip.file(golden.structure.printerSettingsPath)!.async("nodebuffer"), await templateZip.file(golden.structure.printerSettingsPath)!.async("nodebuffer"));
    assert.deepEqual(await outputZip.file("xl/styles.xml")!.async("nodebuffer"), await templateZip.file("xl/styles.xml")!.async("nodebuffer"));
    assert.deepEqual(await outputZip.file("xl/calcChain.xml")!.async("nodebuffer"), await templateZip.file("xl/calcChain.xml")!.async("nodebuffer"));
    assert.ok(outputZip.file(`xl/media/${signatureKey}`));
    assert.match(await outputZip.file("xl/drawings/drawing1.xml")!.async("string"), /Signature CHIEF_OFFICER/);
    assert.equal(await prisma.auditLog.count({ where: { entityType: "XLSX_EXPORT", entityId: report.id } }), 1);

    const overflowSnapshot = structuredClone(finalSnapshot);
    for (let index = 4; index <= 15; index += 1) {
      const section = sections.find((item) => item.code === "G")!;
      const point = { vesselSealingPointId: `point-G-overflow-${index}`, code: `G-OVERFLOW-${index}`, displayName: `Equipment G ${index}`, side: null, instanceNo: 1, isRequired: true, sequence: index, section, template: { id: `template-G-overflow-${index}`, code: `G${index}`, name: `Equipment G ${index}`, sequence: index }, compartment: null };
      overflowSnapshot.formConfigurationSnapshot.points.push(point);
      overflowSnapshot.records.push({ vesselSealingPointId: point.vesselSealingPointId, status: "SEALED", notes: null, pointSnapshot: point, seals: [{ sealNumber: `QS-G-${String(index).padStart(3, "0")}`, status: "VERIFIED" }] });
    }
    const overflow = await buildOfficialWorkbook(overflowSnapshot as never);
    assert.equal(overflow.sheetCount, 2);
    const overflowZip = await JSZip.loadAsync(overflow.buffer);
    const continuationSheet = await overflowZip.file("xl/worksheets/sheet2.xml")!.async("string");
    assert.deepEqual(structuralFragments(continuationSheet), structuralFragments(templateSheet));
    assert.equal(cellValue(continuationSheet, "DI83"), "Equipment G 15");
    assert.equal(cellValue(continuationSheet, "DZ83"), "QS-G-015");
    assert.match(await overflowZip.file("xl/workbook.xml")!.async("string"), /Segel Lanjutan 1/);
    assert.ok(overflowZip.file("xl/printerSettings/printerSettings2.bin"));
    assert.ok(overflowZip.file("xl/drawings/drawing2.xml"));

    const draft = await prisma.sealingReport.create({ data: { reportNo: `DRAFT-XLSX-${suffix}`, vesselId: vessel.id, createdById: admin.user.id, reportDateTime: new Date(), status: "DRAFT" } });
    const rejected = await fetch(`${api}/reports/${draft.id}/xlsx`, { method: "POST", headers: authorizationHeaders(admin.accessToken) });
    assert.equal(rejected.status, 409);
    await prisma.sealingReport.delete({ where: { id: draft.id } });
  } finally {
    if (reportId) await prisma.sealingReport.delete({ where: { id: reportId } }).catch(() => undefined);
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => undefined);
    if (exportFile) await unlink(exportFile).catch(() => undefined);
    await removeFile(signatureKey).catch(() => undefined);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
