import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { test } from "node:test";

import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { removeFile, saveFileWithRollback } from "../src/storage/local-storage.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
type AttachmentResponse = {
  id: string;
  ownerType: string;
  type: string;
  sectionCode: string | null;
  compartmentId: string | null;
  vesselSealingPointId: string | null;
  caption: string | null;
  sequence: number | null;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: string;
  checksumSha256: string;
};
type SignatureResponse = {
  id: string;
  role: string;
  name: string;
  signedAt: string | null;
  signatureUrl: string | null;
  signatureFileName: string | null;
  signatureMimeType: string | null;
  signatureFileSize: string | null;
  signatureChecksumSha256: string | null;
};

const files = {
  jpeg: { mime: "image/jpeg", extension: "jpg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
  png: { mime: "image/png", extension: "png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) },
  webp: { mime: "image/webp", extension: "webp", bytes: Buffer.from("RIFF\0\0\0\0WEBP") },
  pdf: { mime: "application/pdf", extension: "pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") },
} as const;

test("Dokumentasi empat owner/format, authorization, file safety, signature, dan final lock", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const loadingMaster = await createTestIdentity("LOADING_MASTER");
  const otherLoadingMaster = await createTestIdentity("LOADING_MASTER");
  const unloadingMaster = await createTestIdentity("UNLOADING_MASTER");
  const otherUnloadingMaster = await createTestIdentity("UNLOADING_MASTER");
  const viewer = await createTestIdentity("VIEWER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const storedFiles: string[] = [];
  let vesselId = "";
  let categoryId = "";
  let templateId = "";
  let reportId = "";

  const call = async <T>(pathName: string, init?: RequestInit, token = loadingMaster.accessToken) => {
    const response = await fetch(`${api}${pathName}`, {
      ...init,
      headers: {
        ...authorizationHeaders(token),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
    });
    return { response, body: await response.json() as Api<T> };
  };

  const upload = async (
    pathName: string,
    file: (typeof files)[keyof typeof files],
    fields: Record<string, string> = {},
    token = loadingMaster.accessToken,
    fileName = `proof.${file.extension}`,
  ) => {
    const form = new FormData();
    form.append("file", new Blob([file.bytes], { type: file.mime }), fileName);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return call<AttachmentResponse>(pathName, { method: "POST", body: form }, token);
  };

  try {
    const category = await prisma.sealingCategory.create({
      data: { code: `A${suffix}`.slice(0, 5), name: `Documentation A ${suffix}`, sequence: 1 },
    });
    categoryId = category.id;
    // Snapshot menggunakan kode TKO A meskipun master test diberi kode unik agar
    // tidak berbenturan dengan seed yang sudah ada.
    const vessel = await prisma.vessel.create({
      data: {
        name: `Documentation Vessel ${suffix}`,
        compartments: { create: { code: "1P", name: "Compartment 1P", side: "PORT", sequence: 1 } },
      },
      include: { compartments: true },
    });
    vesselId = vessel.id;
    const compartment = vessel.compartments[0]!;
    const template = await prisma.sealingPointTemplate.create({
      data: { categoryId, code: `DOC-${suffix}`, name: "Documentation Point", requiresCompartment: true, sequence: 1 },
    });
    templateId = template.id;
    const point = await prisma.vesselSealingPoint.create({
      data: {
        vesselId,
        sealingPointTemplateId: template.id,
        compartmentId: compartment.id,
        code: `DOC-POINT-${suffix}`,
        side: "PORT",
        sequence: 1,
      },
    });
    const pointSnapshot = {
      vesselSealingPointId: point.id,
      code: point.code,
      section: { id: category.id, code: "A", name: "Bagian A", sequence: 1 },
      compartment: { id: compartment.id, code: compartment.code, name: compartment.name, side: "PORT", sequence: 1 },
    };
    const report = await prisma.sealingReport.create({
      data: {
        reportNo: `DOC-${suffix}`,
        vesselId,
        createdById: loadingMaster.user.id,
        loadingMasterId: loadingMaster.user.id,
        unloadingMasterId: unloadingMaster.user.id,
        reportDateTime: new Date(),
        formConfigurationSnapshot: {
          schemaVersion: 1,
          sections: [{ id: category.id, code: "A", name: "Bagian A", sequence: 1, isAvailable: true }],
          compartments: [{ id: compartment.id, code: compartment.code, name: compartment.name, side: "PORT", sequence: 1 }],
          points: [pointSnapshot],
        },
      },
    });
    reportId = report.id;
    const record = await prisma.sealingRecord.create({
      data: { sealingReportId: reportId, vesselSealingPointId: point.id, createdById: loadingMaster.user.id, pointSnapshot },
    });
    const seal = await prisma.seal.create({ data: { sealingRecordId: record.id, sealNumber: `DOC-SEAL-${suffix}` } });
    const verification = await prisma.sealVerification.create({
      data: { sealId: seal.id, verifiedById: unloadingMaster.user.id, condition: "GOOD" },
    });

    const reportAttachment = await upload(
      `/reports/${reportId}/attachments`,
      files.png,
      { caption: "Foto laporan", sequence: "2" },
      loadingMaster.accessToken,
      "../../unsafe\r\nproof.png",
    );
    assert.equal(reportAttachment.response.status, 201, JSON.stringify(reportAttachment.body));
    assert.equal(reportAttachment.body.data.ownerType, "REPORT");
    assert.equal(reportAttachment.body.data.caption, "Foto laporan");
    assert.equal(reportAttachment.body.data.sequence, 2);
    assert.equal(reportAttachment.body.data.mimeType, files.png.mime);
    assert.equal(reportAttachment.body.data.fileSize, String(files.png.bytes.length));
    assert.equal(reportAttachment.body.data.checksumSha256.length, 64);
    assert.equal(reportAttachment.body.data.fileUrl, `/api/v1/attachments/${reportAttachment.body.data.id}/preview`);
    assert.equal(/[\\/\r\n]/.test(reportAttachment.body.data.fileName), false);
    assert.equal(reportAttachment.body.data.fileName.startsWith(".."), false);
    storedFiles.push(`${reportAttachment.body.data.id}.png`);

    const sectionAttachment = await upload(
      `/shipments/${reportId}/sections/A/attachments`,
      files.jpeg,
      {
        caption: "Bagian A 1P",
        sequence: "1",
        vesselSealingPointId: point.id,
        compartmentId: compartment.id,
      },
    );
    assert.equal(sectionAttachment.response.status, 201, JSON.stringify(sectionAttachment.body));
    assert.equal(sectionAttachment.body.data.ownerType, "SECTION");
    assert.equal(sectionAttachment.body.data.sectionCode, "A");
    assert.equal(sectionAttachment.body.data.vesselSealingPointId, point.id);
    assert.equal(sectionAttachment.body.data.compartmentId, compartment.id);
    storedFiles.push(`${sectionAttachment.body.data.id}.jpg`);

    const recordAttachment = await upload(`/records/${record.id}/attachments`, files.webp, { caption: "Titik 1P" });
    assert.equal(recordAttachment.response.status, 201, JSON.stringify(recordAttachment.body));
    assert.equal(recordAttachment.body.data.ownerType, "SEALING_RECORD");
    assert.equal(recordAttachment.body.data.sectionCode, "A");
    assert.equal(recordAttachment.body.data.vesselSealingPointId, point.id);
    storedFiles.push(`${recordAttachment.body.data.id}.webp`);

    const pdfAttachment = await upload(`/voyages/${reportId}/attachments`, files.pdf, { caption: "Dokumen pendukung" });
    assert.equal(pdfAttachment.response.status, 201, JSON.stringify(pdfAttachment.body));
    assert.equal(pdfAttachment.body.data.type, "DOCUMENT");
    storedFiles.push(`${pdfAttachment.body.data.id}.pdf`);

    const reportList = await call<AttachmentResponse[]>(`/reports/${reportId}/attachments`);
    assert.equal(reportList.response.status, 200);
    assert.equal(reportList.body.data.length, 2);
    const sectionList = await call<AttachmentResponse[]>(`/reports/${reportId}/sections/A/attachments`);
    assert.equal(sectionList.body.data.length, 1);

    const preview = await fetch(`${api}/attachments/${reportAttachment.body.data.id}/preview`, { headers: authorizationHeaders(viewer.accessToken) });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), files.png.bytes);
    const download = await fetch(`${api}/attachments/${reportAttachment.body.data.id}/download`, { headers: authorizationHeaders(loadingMaster.accessToken) });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);

    const unauthorizedRead = await call<unknown>(`/attachments/${reportAttachment.body.data.id}`, undefined, otherLoadingMaster.accessToken);
    assert.equal(unauthorizedRead.response.status, 403);
    const unauthenticated = await fetch(`${api}/attachments/${reportAttachment.body.data.id}/preview`);
    assert.equal(unauthenticated.status, 401);
    const unauthorizedDelete = await call<unknown>(`/attachments/${reportAttachment.body.data.id}`, { method: "DELETE" }, otherLoadingMaster.accessToken);
    assert.equal(unauthorizedDelete.response.status, 403);

    const updatedAttachment = await call<AttachmentResponse>(
      `/attachments/${reportAttachment.body.data.id}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption: "Caption diperbarui", sequence: 4 }) },
    );
    assert.equal(updatedAttachment.response.status, 200, JSON.stringify(updatedAttachment.body));
    assert.equal(updatedAttachment.body.data.caption, "Caption diperbarui");
    assert.equal(updatedAttachment.body.data.sequence, 4);

    const invalidContent = new FormData();
    invalidContent.append("file", new Blob([Buffer.from("not png")], { type: "image/png" }), "fake.png");
    assert.equal((await call<unknown>(`/reports/${reportId}/attachments`, { method: "POST", body: invalidContent })).response.status, 400);
    const unsupported = new FormData();
    unsupported.append("file", new Blob([Buffer.from("text")], { type: "text/plain" }), "proof.txt");
    assert.equal((await call<unknown>(`/reports/${reportId}/attachments`, { method: "POST", body: unsupported })).response.status, 415);
    const oversized = new FormData();
    oversized.append("file", new Blob([Buffer.alloc(env.MAX_UPLOAD_SIZE_BYTES + 1)], { type: "image/png" }), "large.png");
    assert.equal((await call<unknown>(`/reports/${reportId}/attachments`, { method: "POST", body: oversized })).response.status, 413);

    const uploadRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);
    const rollbackKey = `rollback-${suffix}.png`;
    await assert.rejects(saveFileWithRollback(rollbackKey, files.png.bytes, async () => {
      throw new Error("Simulasi transaksi database gagal");
    }));
    const namesAfterFailure = await readdir(uploadRoot).catch(() => [] as string[]);
    assert.equal(namesAfterFailure.includes(rollbackKey), false, "File wajib dibersihkan ketika transaksi database gagal");

    const deletedPdf = await call<unknown>(`/attachments/${pdfAttachment.body.data.id}`, { method: "DELETE" });
    assert.equal(deletedPdf.response.status, 200);
    storedFiles.splice(storedFiles.indexOf(`${pdfAttachment.body.data.id}.pdf`), 1);
    assert.equal((await call<unknown>(`/attachments/${pdfAttachment.body.data.id}`)).response.status, 404);

    const signatureIds: string[] = [];
    for (const role of ["CHIEF_OFFICER", "TERMINAL_REPRESENTATIVE", "SURVEYOR"] as const) {
      const created = await call<SignatureResponse>(
        `/reports/${reportId}/signatures`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role, name: `${role} ${suffix}`, signedAt: new Date().toISOString() }) },
      );
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
      signatureIds.push(created.body.data.id);
    }
    const duplicateRole = await call<unknown>(
      `/reports/${reportId}/signatures`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "CHIEF_OFFICER", name: "Duplicate" }) },
    );
    assert.equal(duplicateRole.response.status, 409);
    const signatureList = await call<SignatureResponse[]>(`/shipments/${reportId}/signatures`);
    assert.equal(signatureList.response.status, 200);
    assert.deepEqual(signatureList.body.data.map((item) => item.role).sort(), ["CHIEF_OFFICER", "SURVEYOR", "TERMINAL_REPRESENTATIVE"]);

    const chiefId = signatureIds[0]!;
    const signatureForm = new FormData();
    signatureForm.append("file", new Blob([files.png.bytes], { type: files.png.mime }), "chief-signature.png");
    const signatureUpload = await call<SignatureResponse>(`/signatures/${chiefId}/file`, { method: "PUT", body: signatureForm });
    assert.equal(signatureUpload.response.status, 200, JSON.stringify(signatureUpload.body));
    assert.equal(signatureUpload.body.data.signatureMimeType, "image/png");
    assert.equal(signatureUpload.body.data.signatureChecksumSha256?.length, 64);
    storedFiles.push(`signature-${chiefId}.png`);
    const signaturePreview = await fetch(`${api}/signatures/${chiefId}/preview`, { headers: authorizationHeaders(viewer.accessToken) });
    assert.equal(signaturePreview.status, 200);
    assert.match(signaturePreview.headers.get("content-disposition") ?? "", /^inline;/);
    const signatureDownload = await fetch(`${api}/signatures/${chiefId}/download`, { headers: authorizationHeaders(loadingMaster.accessToken) });
    assert.equal(signatureDownload.status, 200);
    assert.match(signatureDownload.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal((await call<unknown>(`/signatures/${chiefId}`, undefined, otherLoadingMaster.accessToken)).response.status, 403);

    const surveyorId = signatureIds[2]!;
    const surveyorFile = new FormData();
    surveyorFile.append("file", new Blob([files.webp.bytes], { type: files.webp.mime }), "surveyor.webp");
    assert.equal((await call<unknown>(`/signatures/${surveyorId}/file`, { method: "PUT", body: surveyorFile })).response.status, 200);
    storedFiles.push(`signature-${surveyorId}.webp`);
    assert.equal((await call<unknown>(`/signatures/${surveyorId}`, { method: "DELETE" })).response.status, 200);
    storedFiles.splice(storedFiles.indexOf(`signature-${surveyorId}.webp`), 1);

    await prisma.sealingReport.update({ where: { id: reportId }, data: { status: "SANDAR", sealingProcessStatus: "VERIFICATION" } });
    const verificationAttachment = await upload(
      `/verifications/${verification.id}/attachments`,
      files.pdf,
      { caption: "Bukti verification", sequence: "1" },
      unloadingMaster.accessToken,
    );
    assert.equal(verificationAttachment.response.status, 201, JSON.stringify(verificationAttachment.body));
    assert.equal(verificationAttachment.body.data.ownerType, "VERIFICATION");
    assert.equal(verificationAttachment.body.data.sectionCode, "A");
    storedFiles.push(`${verificationAttachment.body.data.id}.pdf`);
    assert.equal((await upload(`/verifications/${verification.id}/attachments`, files.pdf, {}, otherUnloadingMaster.accessToken)).response.status, 403);
    const terminalRepresentativeId = signatureIds[1]!;
    const updatedByUnloading = await call<SignatureResponse>(
      `/signatures/${terminalRepresentativeId}`,
      { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Terminal Representative Updated" }) },
      unloadingMaster.accessToken,
    );
    assert.equal(updatedByUnloading.response.status, 200);

    await prisma.sealingReport.update({ where: { id: reportId }, data: { status: "FINISH", sealingProcessStatus: "FINALIZED", finishedAt: new Date() } });
    assert.equal((await call<unknown>(`/attachments/${reportAttachment.body.data.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ caption: "Locked" }) })).response.status, 400);
    assert.equal((await call<unknown>(`/attachments/${verificationAttachment.body.data.id}`, { method: "DELETE" }, unloadingMaster.accessToken)).response.status, 400);
    assert.equal((await upload(`/reports/${reportId}/attachments`, files.png)).response.status, 400);
    assert.equal((await call<unknown>(`/signatures/${chiefId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Locked" }) })).response.status, 400);
    const lockedFile = new FormData();
    lockedFile.append("file", new Blob([files.jpeg.bytes], { type: files.jpeg.mime }), "locked.jpg");
    assert.equal((await call<unknown>(`/signatures/${chiefId}/file`, { method: "PUT", body: lockedFile })).response.status, 400);
    assert.equal((await call<unknown>(`/signatures/${chiefId}`, { method: "DELETE" })).response.status, 400);

    const attachmentAudits = await prisma.auditLog.count({ where: { userId: loadingMaster.user.id, entityType: "ATTACHMENT" } });
    const signatureAudits = await prisma.auditLog.count({ where: { entityType: { in: ["REPORT_SIGNATURE", "REPORT_SIGNATURE_FILE"] }, entityId: { in: signatureIds } } });
    assert.ok(attachmentAudits >= 6);
    assert.ok(signatureAudits >= 6);
  } finally {
    for (const key of storedFiles) await removeFile(key).catch(() => {});
    const userIds = [loadingMaster.user.id, otherLoadingMaster.user.id, unloadingMaster.user.id, otherUnloadingMaster.user.id, viewer.user.id];
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    if (reportId) await prisma.sealingReport.delete({ where: { id: reportId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    if (templateId) await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (categoryId) await prisma.sealingCategory.delete({ where: { id: categoryId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
