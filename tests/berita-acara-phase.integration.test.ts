import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { removeFile } from "../src/storage/local-storage.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
type SignatureResponse = {
  id: string;
  phase: "LOADING" | "UNLOADING" | null;
  role: "CHIEF_OFFICER" | "SURVEYOR" | "TERMINAL_REPRESENTATIVE";
  name: string;
  signatureChecksumSha256: string | null;
};
type BaDocumentResponse = {
  id: string;
  phase: "LOADING" | "UNLOADING";
  status: "DRAFT" | "FINALIZED";
  snapshot: unknown;
  finalizedById: string | null;
  finalizedAt: string | null;
};

const roles = ["CHIEF_OFFICER", "SURVEYOR", "TERMINAL_REPRESENTATIVE"] as const;
const png = (marker: number) => sharp({
  create: { width: 2, height: 2, channels: 4, background: { r: marker, g: 0, b: 0, alpha: 1 } },
}).png().toBuffer();
const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const standardFontDataUrl = `${path.resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}${path.sep}`;
const pdfText = async (bytes: Buffer) => {
  const parsed = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, standardFontDataUrl }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= parsed.numPages; pageNumber += 1) {
    const content = await (await parsed.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n");
};

test("Berita Acara LOADING/UNLOADING mempunyai enam slot, otorisasi, file, final lock, dan legacy compatibility", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = await createTestIdentity("ADMIN");
  const loadingMaster = await createTestIdentity("LOADING_MASTER");
  const otherLoadingMaster = await createTestIdentity("LOADING_MASTER");
  const unloadingMaster = await createTestIdentity("UNLOADING_MASTER");
  const otherUnloadingMaster = await createTestIdentity("UNLOADING_MASTER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const call = async <T>(path: string, init?: RequestInit, token = loadingMaster.accessToken) => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        ...authorizationHeaders(token),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
    });
    return { response, body: await response.json() as Api<T> };
  };
  const uploadSignature = async (id: string, bytes: Buffer, token: string) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${id}.png`);
    return call<SignatureResponse>(`/signatures/${id}/file`, { method: "PUT", body: form }, token);
  };

  let vesselId = "";
  let reportId = "";
  let reportWithoutLoadingBaId = "";
  let destinationPlantId = "";
  let destinationJettyId = "";
  let baPdfStorageKey = "";
  let unloadingBaPdfStorageKey = "";
  const storedFiles: string[] = [];
  try {
    const vessel = await prisma.vessel.create({ data: { name: `BA Phase Vessel ${suffix}` } });
    vesselId = vessel.id;
    const destinationPlant = await prisma.plant.create({ data: { code: `BAP${suffix}`.slice(0, 20), name: `BA Phase Plant ${suffix}` } });
    destinationPlantId = destinationPlant.id;
    const destinationJetty = await prisma.jetty.create({ data: { name: `BA Phase Jetty ${suffix}` } });
    destinationJettyId = destinationJetty.id;
    await prisma.plantJettyAssignment.create({ data: { plantId: destinationPlantId, jettyId: destinationJettyId } });
    const report = await prisma.sealingReport.create({
      data: {
        reportNo: `BA-${suffix}`,
        shipmentNumber: `BA-SHP-${suffix}`,
        voyageNumber: `BA-VOY-${suffix}`,
        vesselId,
        createdById: loadingMaster.user.id,
        loadingMasterId: loadingMaster.user.id,
        unloadingMasterId: unloadingMaster.user.id,
        dischargePlantId: destinationPlantId,
        dischargeJettyId: destinationJettyId,
        reportDateTime: new Date(),
        status: "DRAFT",
        sealingProcessStatus: "READY",
        formConfigurationSnapshot: {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          formVersion: { id: randomUUID(), code: "BA-TEST", name: "BA Test", revision: null },
          vesselFormProfile: { id: randomUUID(), name: "BA Test" },
          vessel: { id: vesselId, name: vessel.name, imoNumber: null },
          sections: [], compartments: [], points: [],
        },
        finalSnapshot: { schemaVersion: 1, legacy: true },
      },
    });
    reportId = report.id;
    const reportWithoutLoadingBa = await prisma.sealingReport.create({
      data: {
        reportNo: `BA-NO-LOAD-${suffix}`,
        shipmentNumber: `BA-NO-LOAD-SHP-${suffix}`,
        voyageNumber: `BA-NO-LOAD-VOY-${suffix}`,
        vesselId,
        createdById: loadingMaster.user.id,
        loadingMasterId: loadingMaster.user.id,
        unloadingMasterId: unloadingMaster.user.id,
        dischargePlantId: destinationPlantId,
        dischargeJettyId: destinationJettyId,
        reportDateTime: new Date(),
        status: "SANDAR",
        sealingProcessStatus: "VERIFICATION",
      },
    });
    reportWithoutLoadingBaId = reportWithoutLoadingBa.id;
    for (const role of roles) {
      const result = await call<SignatureResponse>(
        `/shipments/${reportWithoutLoadingBaId}/ba/unloading/signatures/${role}`,
        json("PUT", { name: `No Loading BA ${role}` }),
        unloadingMaster.accessToken,
      );
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
    }
    const withoutLoadingBa = await call<unknown>(
      `/shipments/${reportWithoutLoadingBaId}/ba/unloading/finalize`,
      json("POST", {}),
      unloadingMaster.accessToken,
    );
    assert.equal(withoutLoadingBa.response.status, 400);
    assert.match(withoutLoadingBa.body.message, /BA LOADING/);
    await prisma.pdfArtifact.create({
      data: {
        sealingReportId: reportId,
        generatedById: loadingMaster.user.id,
        fileName: `legacy-${suffix}.pdf`,
        storageKey: `legacy-${suffix}.pdf`,
        fileSize: 10n,
        checksumSha256: "a".repeat(64),
        templateChecksumSha256: "b".repeat(64),
        snapshotChecksumSha256: "c".repeat(64),
        rendererVersion: "legacy-test",
        formPageCount: 1,
        appendixPageCount: 0,
        pageCount: 1,
      },
    });

    const legacy = await call<SignatureResponse>(
      `/shipments/${reportId}/signatures`,
      json("POST", { role: "CHIEF_OFFICER", name: "Historical Chief" }),
    );
    assert.equal(legacy.response.status, 201, JSON.stringify(legacy.body));
    assert.equal(legacy.body.data.phase, null);

    const unauthorizedLoading = await call<unknown>(
      `/shipments/${reportId}/ba/loading/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Wrong Loading Master" }),
      otherLoadingMaster.accessToken,
    );
    assert.equal(unauthorizedLoading.response.status, 403);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/loading/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Unloading Cannot Sign Loading" }),
      unloadingMaster.accessToken,
    )).response.status, 403);

    const loadingSignatures: SignatureResponse[] = [];
    for (const role of roles) {
      const result = await call<SignatureResponse>(
        `/shipments/${reportId}/ba/loading/signatures/${role}`,
        json("PUT", { name: `Loading ${role}`, signedAt: new Date().toISOString() }),
      );
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.phase, "LOADING");
      loadingSignatures.push(result.body.data);
    }
    const unloadingFinalizeBeforeSandar = await call<unknown>(
      `/shipments/${reportId}/ba/unloading/finalize`, json("POST", {}), unloadingMaster.accessToken,
    );
    assert.equal(unloadingFinalizeBeforeSandar.response.status, 400);
    assert.match(unloadingFinalizeBeforeSandar.body.message, /SANDAR/);
    const loadingChiefAgain = await call<SignatureResponse>(
      `/voyages/${reportId}/ba/LOADING/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Loading Chief Updated" }),
    );
    assert.equal(loadingChiefAgain.response.status, 200);
    assert.equal(loadingChiefAgain.body.data.id, loadingSignatures[0]!.id);
    assert.equal(await prisma.reportSignature.count({ where: { sealingReportId: reportId, phase: "LOADING", role: "CHIEF_OFFICER" } }), 1);

    const loadingBytes = await png(0x11);
    const loadingUpload = await uploadSignature(loadingSignatures[0]!.id, loadingBytes, loadingMaster.accessToken);
    assert.equal(loadingUpload.response.status, 200, JSON.stringify(loadingUpload.body));
    storedFiles.push(`signature-loading-${loadingSignatures[0]!.id}.png`);

    const concurrentLoadingFinalizations = await Promise.all([
      call<BaDocumentResponse>(`/reports/${reportId}/ba/loading/finalize`, json("POST", {})),
      call<BaDocumentResponse>(`/voyages/${reportId}/ba/loading/finalize`, json("POST", {})),
    ]);
    assert.deepEqual(concurrentLoadingFinalizations.map((result) => result.response.status).sort(), [200, 400]);
    const finalizedLoading = concurrentLoadingFinalizations.find((result) => result.response.status === 200)!;
    assert.equal(finalizedLoading.response.status, 200, JSON.stringify(finalizedLoading.body));
    assert.equal(finalizedLoading.body.data.status, "FINALIZED");
    assert.ok(finalizedLoading.body.data.snapshot);
    assert.equal(finalizedLoading.body.data.finalizedById, loadingMaster.user.id);
    const loadingSnapshot = finalizedLoading.body.data.snapshot as {
      phase: string;
      report: { destinationAssignment: { dischargePlantId: string; dischargeJettyId: string } };
      formConfigurationSnapshot: unknown;
      records: unknown[];
      attachments: unknown[];
      signatures: Array<{ phase: string }>;
    };
    assert.equal(loadingSnapshot.phase, "LOADING");
    assert.equal(loadingSnapshot.report.destinationAssignment.dischargePlantId, destinationPlantId);
    assert.equal(loadingSnapshot.report.destinationAssignment.dischargeJettyId, destinationJettyId);
    assert.ok(loadingSnapshot.formConfigurationSnapshot);
    assert.equal(loadingSnapshot.signatures.length, 3);
    assert.equal(loadingSnapshot.signatures.every((signature) => signature.phase === "LOADING"), true);
    assert.equal((await call<unknown>(`/shipments/${reportId}/ba/loading/finalize`, json("POST", {}))).response.status, 400);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/destination-assignment`,
      json("PUT", { dischargePlantId: destinationPlantId, dischargeJettyId: destinationJettyId }),
    )).response.status, 400);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/form/points/${randomUUID()}`,
      json("PUT", { status: "NOT_APPLICABLE", seals: [] }),
    )).response.status, 400);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/loading/signatures/SURVEYOR`,
      json("PUT", { name: "Locked" }),
    )).response.status, 400);
    const lockedShipmentHeader = await call<unknown>(
      `/shipments/${reportId}`,
      json("PATCH", { remarks: "Tidak boleh mengubah header setelah BA LOADING final" }),
    );
    assert.equal(lockedShipmentHeader.response.status, 400);
    assert.match(lockedShipmentHeader.body.message, /dikunci setelah BA LOADING/i);
    const lockedShipmentDelete = await call<unknown>(`/shipments/${reportId}`, { method: "DELETE" });
    assert.equal(lockedShipmentDelete.response.status, 409);
    assert.match(lockedShipmentDelete.body.message, /proses BA/i);

    const concurrentLoadingPdfs = await Promise.all([
      call<{ checksumSha256: string; reused: boolean }>(`/shipments/${reportId}/ba/loading/pdf`, json("POST", {})),
      call<{ checksumSha256: string; reused: boolean }>(`/reports/${reportId}/ba/loading/pdf`, json("POST", {})),
    ]);
    assert.deepEqual(concurrentLoadingPdfs.map((result) => result.response.status).sort(), [200, 201]);
    assert.deepEqual(concurrentLoadingPdfs.map((result) => result.body.data.reused).sort(), [false, true]);
    assert.equal(concurrentLoadingPdfs[0]!.body.data.checksumSha256, concurrentLoadingPdfs[1]!.body.data.checksumSha256);
    const generatedPdf = concurrentLoadingPdfs.find((result) => result.body.data.reused === false)!;
    assert.equal(generatedPdf.response.status, 201, JSON.stringify(generatedPdf.body));
    assert.equal(generatedPdf.body.data.reused, false);
    await prisma.plant.update({ where: { id: destinationPlantId }, data: { name: `BA Phase Plant Changed ${suffix}` } });
    await prisma.jetty.update({ where: { id: destinationJettyId }, data: { name: `BA Phase Jetty Changed ${suffix}` } });
    const regeneratedPdf = await call<{ checksumSha256: string; reused: boolean }>(
      `/voyages/${reportId}/ba/loading/pdf`, json("POST", {}),
    );
    assert.equal(regeneratedPdf.response.status, 200, JSON.stringify(regeneratedPdf.body));
    assert.equal(regeneratedPdf.body.data.reused, true);
    assert.equal(regeneratedPdf.body.data.checksumSha256, generatedPdf.body.data.checksumSha256);
    const previewPdf = await fetch(`${api}/shipments/${reportId}/ba/loading/pdf/preview`, { headers: authorizationHeaders(loadingMaster.accessToken) });
    const downloadPdf = await fetch(`${api}/reports/${reportId}/ba/loading/pdf/download`, { headers: authorizationHeaders(loadingMaster.accessToken) });
    assert.equal(previewPdf.status, 200);
    assert.equal(downloadPdf.status, 200);
    assert.equal(previewPdf.headers.get("content-type"), "application/pdf");
    const previewBytes = Buffer.from(await previewPdf.arrayBuffer());
    const downloadBytes = Buffer.from(await downloadPdf.arrayBuffer());
    assert.deepEqual(downloadBytes, previewBytes);
    assert.equal(previewPdf.headers.get("x-checksum-sha256"), generatedPdf.body.data.checksumSha256);
    const baPdfArtifact = await prisma.beritaAcaraPdfArtifact.findFirst({ where: { baDocument: { sealingReportId: reportId, phase: "LOADING" } } });
    assert.ok(baPdfArtifact);
    baPdfStorageKey = baPdfArtifact.storageKey;
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/unloading/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Too Early" }),
      unloadingMaster.accessToken,
    )).response.status, 400);

    await prisma.sealingReport.update({
      where: { id: reportId },
      data: { status: "SANDAR", sealingProcessStatus: "VERIFICATION", arrivedAt: new Date() },
    });
    const beforeUnloadingFinal = await call<unknown>(
      `/shipments/${reportId}/ba/unloading/pdf`, json("POST", {}), unloadingMaster.accessToken,
    );
    assert.equal(beforeUnloadingFinal.response.status, 409);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/unloading/pdf`, json("POST", {}), otherUnloadingMaster.accessToken,
    )).response.status, 403);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/unloading/pdf`, json("POST", {}), loadingMaster.accessToken,
    )).response.status, 403);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/unloading/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Loading Cannot Sign Unloading" }),
    )).response.status, 403);
    assert.equal((await call<unknown>(
      `/shipments/${reportId}/ba/unloading/signatures/CHIEF_OFFICER`,
      json("PUT", { name: "Wrong Unloading Master" }),
      otherUnloadingMaster.accessToken,
    )).response.status, 403);

    const unloadingSignatures: SignatureResponse[] = [];
    for (const role of roles) {
      const result = await call<SignatureResponse>(
        `/shipments/${reportId}/ba/unloading/signatures/${role}`,
        json("PUT", { name: `Unloading ${role}`, signedAt: new Date().toISOString() }),
        unloadingMaster.accessToken,
      );
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.data.phase, "UNLOADING");
      unloadingSignatures.push(result.body.data);
    }
    assert.notEqual(unloadingSignatures[0]!.id, loadingSignatures[0]!.id);
    assert.equal(await prisma.reportSignature.count({ where: { sealingReportId: reportId, phase: { not: null } } }), 6);
    const loadingPdfAfterUnloadingSignatures = await call<{ checksumSha256: string; reused: boolean }>(
      `/shipments/${reportId}/ba/loading/pdf`, json("POST", {}), loadingMaster.accessToken,
    );
    assert.equal(loadingPdfAfterUnloadingSignatures.response.status, 200, JSON.stringify(loadingPdfAfterUnloadingSignatures.body));
    assert.equal(loadingPdfAfterUnloadingSignatures.body.data.reused, true);
    assert.equal(loadingPdfAfterUnloadingSignatures.body.data.checksumSha256, generatedPdf.body.data.checksumSha256);

    const legacyFinalBeforeUnloadingFinal = await call<unknown>(
      `/shipments/${reportId}/pdf`, json("POST", {}), unloadingMaster.accessToken,
    );
    assert.equal(legacyFinalBeforeUnloadingFinal.response.status, 409);
    assert.match(legacyFinalBeforeUnloadingFinal.body.message, /BA UNLOADING/);

    const unloadingBytes = await png(0x22);
    const unloadingUpload = await uploadSignature(unloadingSignatures[0]!.id, unloadingBytes, unloadingMaster.accessToken);
    assert.equal(unloadingUpload.response.status, 200, JSON.stringify(unloadingUpload.body));
    storedFiles.push(`signature-unloading-${unloadingSignatures[0]!.id}.png`);
    const loadingPreview = await fetch(`${api}/signatures/${loadingSignatures[0]!.id}/preview`, { headers: authorizationHeaders(loadingMaster.accessToken) });
    const unloadingPreview = await fetch(`${api}/signatures/${unloadingSignatures[0]!.id}/preview`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    assert.equal(loadingPreview.status, 200);
    assert.equal(unloadingPreview.status, 200);
    assert.deepEqual(Buffer.from(await loadingPreview.arrayBuffer()), loadingBytes);
    assert.deepEqual(Buffer.from(await unloadingPreview.arrayBuffer()), unloadingBytes);

    const concurrentUnloadingFinalizations = await Promise.all([
      call<BaDocumentResponse>(`/shipments/${reportId}/ba/unloading/finalize`, json("POST", {}), unloadingMaster.accessToken),
      call<BaDocumentResponse>(`/reports/${reportId}/ba/unloading/finalize`, json("POST", {}), unloadingMaster.accessToken),
    ]);
    assert.deepEqual(concurrentUnloadingFinalizations.map((result) => result.response.status).sort(), [200, 400]);
    const finalizedUnloading = concurrentUnloadingFinalizations.find((result) => result.response.status === 200)!;
    assert.equal(finalizedUnloading.response.status, 200, JSON.stringify(finalizedUnloading.body));
    assert.equal(finalizedUnloading.body.data.status, "FINALIZED");
    assert.ok(finalizedUnloading.body.data.snapshot);
    assert.equal((await uploadSignature(unloadingSignatures[0]!.id, await png(0x33), unloadingMaster.accessToken)).response.status, 400);

    const concurrentUnloadingPdfs = await Promise.all([
      call<{
        checksumSha256: string;
        snapshotChecksumSha256: string;
        reused: boolean;
        phase: string;
      }>(`/shipments/${reportId}/ba/unloading/pdf`, json("POST", {}), unloadingMaster.accessToken),
      call<{
        checksumSha256: string;
        snapshotChecksumSha256: string;
        reused: boolean;
        phase: string;
      }>(`/reports/${reportId}/ba/unloading/pdf`, json("POST", {}), unloadingMaster.accessToken),
    ]);
    assert.deepEqual(concurrentUnloadingPdfs.map((result) => result.response.status).sort(), [200, 201]);
    assert.deepEqual(concurrentUnloadingPdfs.map((result) => result.body.data.reused).sort(), [false, true]);
    assert.equal(concurrentUnloadingPdfs[0]!.body.data.checksumSha256, concurrentUnloadingPdfs[1]!.body.data.checksumSha256);
    const generatedUnloadingPdf = concurrentUnloadingPdfs.find((result) => result.body.data.reused === false)!;
    assert.equal(generatedUnloadingPdf.response.status, 201, JSON.stringify(generatedUnloadingPdf.body));
    assert.equal(generatedUnloadingPdf.body.data.phase, "UNLOADING");
    assert.equal(generatedUnloadingPdf.body.data.reused, false);
    const reusedUnloadingPdf = await call<{ checksumSha256: string; reused: boolean }>(
      `/voyages/${reportId}/ba/unloading/pdf`, json("POST", {}), unloadingMaster.accessToken,
    );
    assert.equal(reusedUnloadingPdf.response.status, 200, JSON.stringify(reusedUnloadingPdf.body));
    assert.equal(reusedUnloadingPdf.body.data.reused, true);
    assert.equal(reusedUnloadingPdf.body.data.checksumSha256, generatedUnloadingPdf.body.data.checksumSha256);
    const unloadingPdfPreview = await fetch(`${api}/shipments/${reportId}/ba/unloading/pdf/preview`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    const unloadingPdfDownload = await fetch(`${api}/reports/${reportId}/ba/unloading/pdf/download`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    assert.equal(unloadingPdfPreview.status, 200);
    assert.equal(unloadingPdfDownload.status, 200);
    const unloadingPreviewBytes = Buffer.from(await unloadingPdfPreview.arrayBuffer());
    const unloadingDownloadBytes = Buffer.from(await unloadingPdfDownload.arrayBuffer());
    assert.deepEqual(unloadingPreviewBytes, unloadingDownloadBytes);
    assert.equal(unloadingPdfPreview.headers.get("x-checksum-sha256"), generatedUnloadingPdf.body.data.checksumSha256);
    const unloadingText = await pdfText(unloadingPreviewBytes);
    for (const role of roles) {
      assert.match(unloadingText, new RegExp(role === "CHIEF_OFFICER" ? "Loading Chief Updated" : `Loading ${role}`));
      assert.match(unloadingText, new RegExp(`Unloading ${role}`));
    }
    const compatibilityGenerate = await call<{
      checksumSha256: string;
      phase: string;
      reused: boolean;
      previewUrl: string;
    }>(`/reports/${reportId}/pdf`, json("POST", {}), unloadingMaster.accessToken);
    assert.equal(compatibilityGenerate.response.status, 200, JSON.stringify(compatibilityGenerate.body));
    assert.equal(compatibilityGenerate.body.data.phase, "UNLOADING");
    assert.equal(compatibilityGenerate.body.data.reused, true);
    assert.equal(compatibilityGenerate.body.data.checksumSha256, generatedUnloadingPdf.body.data.checksumSha256);
    assert.equal(compatibilityGenerate.body.data.previewUrl, `/api/v1/shipments/${reportId}/ba/unloading/pdf/preview`);
    assert.equal((await call<unknown>(`/voyages/${reportId}/pdf`, json("POST", {}), loadingMaster.accessToken)).response.status, 403);
    assert.equal((await call<unknown>(`/shipments/${reportId}/pdf`, json("POST", {}), otherUnloadingMaster.accessToken)).response.status, 403);
    const compatibilityPreview = await fetch(`${api}/voyages/${reportId}/pdf/preview`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    const compatibilityDownload = await fetch(`${api}/shipments/${reportId}/pdf/download`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    assert.equal(compatibilityPreview.status, 200);
    assert.equal(compatibilityDownload.status, 200);
    assert.equal(compatibilityPreview.headers.get("x-checksum-sha256"), generatedUnloadingPdf.body.data.checksumSha256);
    assert.deepEqual(Buffer.from(await compatibilityPreview.arrayBuffer()), unloadingPreviewBytes);
    assert.deepEqual(Buffer.from(await compatibilityDownload.arrayBuffer()), unloadingPreviewBytes);

    const documents = await prisma.beritaAcaraDocument.findMany({
      where: { sealingReportId: reportId },
      orderBy: { phase: "asc" },
    }) as Array<{ id: string; phase: "LOADING" | "UNLOADING"; status: "DRAFT" | "FINALIZED" }>;
    assert.equal(documents.length, 2);
    assert.equal(documents.every((document) => document.status === "FINALIZED"), true);
    assert.equal(await prisma.beritaAcaraPdfArtifact.count({ where: { baDocument: { sealingReportId: reportId } } }), 2);
    const unloadingArtifact = await prisma.beritaAcaraPdfArtifact.findFirst({
      where: { baDocument: { sealingReportId: reportId, phase: "UNLOADING" } },
    });
    assert.ok(unloadingArtifact);
    unloadingBaPdfStorageKey = unloadingArtifact.storageKey;
    assert.notEqual(unloadingArtifact.storageKey, baPdfStorageKey);
    const legacyArtifact = await prisma.pdfArtifact.findUnique({ where: { sealingReportId: reportId } });
    assert.ok(legacyArtifact);
    assert.equal(legacyArtifact.rendererVersion, "legacy-test");
    assert.notEqual(legacyArtifact.storageKey, baPdfStorageKey);
    assert.notEqual(legacyArtifact.storageKey, unloadingArtifact.storageKey);
    assert.equal(await prisma.pdfArtifact.count({ where: { sealingReportId: reportId } }), 1);
    const savedChecksum = unloadingArtifact.checksumSha256;
    await prisma.beritaAcaraPdfArtifact.update({ where: { id: unloadingArtifact.id }, data: { checksumSha256: "0".repeat(64) } });
    const integrityFailure = await fetch(`${api}/shipments/${reportId}/ba/unloading/pdf/preview`, { headers: authorizationHeaders(unloadingMaster.accessToken) });
    assert.equal(integrityFailure.status, 409);
    await prisma.beritaAcaraPdfArtifact.update({ where: { id: unloadingArtifact.id }, data: { checksumSha256: savedChecksum } });

    const legacyList = await call<SignatureResponse[]>(`/shipments/${reportId}/signatures`);
    assert.equal(legacyList.response.status, 200);
    assert.equal(legacyList.body.data.length, 1);
    assert.equal(legacyList.body.data[0]!.id, legacy.body.data.id);
    assert.equal((await call<SignatureResponse>(`/signatures/${legacy.body.data.id}`)).response.status, 200);
    const loadingList = await call<SignatureResponse[]>(`/shipments/${reportId}/ba/loading/signatures`);
    assert.equal(loadingList.body.data.length, 3);
    const preserved = await prisma.sealingReport.findUnique({
      where: { id: reportId },
      select: { finalSnapshot: true, pdfArtifact: true },
    });
    assert.deepEqual(preserved?.finalSnapshot, { schemaVersion: 1, legacy: true });
    assert.equal(preserved?.pdfArtifact?.rendererVersion, "legacy-test");
  } finally {
    for (const key of storedFiles) await removeFile(key).catch(() => {});
    if (baPdfStorageKey) await unlink(path.resolve(process.cwd(), env.PDF_EXPORT_DIR, baPdfStorageKey)).catch(() => {});
    if (unloadingBaPdfStorageKey) await unlink(path.resolve(process.cwd(), env.PDF_EXPORT_DIR, unloadingBaPdfStorageKey)).catch(() => {});
    const userIds = [admin.user.id, loadingMaster.user.id, otherLoadingMaster.user.id, unloadingMaster.user.id, otherUnloadingMaster.user.id];
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    if (reportWithoutLoadingBaId) await prisma.sealingReport.delete({ where: { id: reportWithoutLoadingBaId } }).catch(() => {});
    if (reportId) await prisma.sealingReport.delete({ where: { id: reportId } }).catch(() => {});
    if (destinationPlantId && destinationJettyId) await prisma.plantJettyAssignment.deleteMany({ where: { plantId: destinationPlantId, jettyId: destinationJettyId } });
    if (destinationJettyId) await prisma.jetty.delete({ where: { id: destinationJettyId } }).catch(() => {});
    if (destinationPlantId) await prisma.plant.delete({ where: { id: destinationPlantId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
