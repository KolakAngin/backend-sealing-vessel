import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };

test("Upload, validasi isi, unduh, dan hapus lampiran", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const operator = await createTestIdentity("LOADING_MASTER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  let vesselId = "";
  let terminalId = "";
  let destinationTerminalId = "";
  let reportId = "";
  let attachmentId = "";

  try {
    const vessel = await prisma.vessel.create({ data: { name: `ATT Vessel ${suffix}`, imoNumber: `ATT-${suffix}`, vesselType: "TANKER" } });
    vesselId = vessel.id;
    const terminal = await prisma.terminal.create({ data: { code: `AT${suffix}`.slice(0, 20), name: `ATT Terminal ${suffix}` } });
    terminalId = terminal.id;
    const destination = await prisma.terminal.create({ data: { code: `AD${suffix}`.slice(0, 20), name: `ATT Destination ${suffix}` } });
    destinationTerminalId = destination.id;
    const report = await prisma.sealingReport.create({ data: { reportNo: `ATT-${suffix}`, vesselId, originTerminalId: terminalId, destinationTerminalId, createdById: operator.user.id, operationType: "LOADING", reportDateTime: new Date() } });
    reportId = report.id;

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const form = new FormData();
    form.append("file", new Blob([png], { type: "image/png" }), "proof.png");
    form.append("description", "Foto bukti sealing");
    form.append("sequence", "1");
    const uploadedResponse = await fetch(`${api}/reports/${reportId}/attachments`, { method: "POST", headers: authorizationHeaders(operator.accessToken), body: form });
    const uploaded = await uploadedResponse.json() as Api<{ id: string; type: string; mimeType: string; fileSize: string; sealingReportId: string }>;
    assert.equal(uploadedResponse.status, 201);
    assert.equal(uploaded.data.type, "PHOTO");
    assert.equal(uploaded.data.mimeType, "image/png");
    assert.equal(uploaded.data.fileSize, String(png.length));
    assert.equal(uploaded.data.sealingReportId, reportId);
    attachmentId = uploaded.data.id;

    const metadataResponse = await fetch(`${api}/attachments/${attachmentId}`, { headers: authorizationHeaders(operator.accessToken) });
    assert.equal(metadataResponse.status, 200);
    const fileResponse = await fetch(`${api}/attachments/${attachmentId}/file`, { headers: authorizationHeaders(operator.accessToken) });
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await fileResponse.arrayBuffer()), png);

    const fake = new FormData();
    fake.append("file", new Blob([Buffer.from("not a png")], { type: "image/png" }), "fake.png");
    const fakeResponse = await fetch(`${api}/reports/${reportId}/attachments`, { method: "POST", headers: authorizationHeaders(operator.accessToken), body: fake });
    assert.equal(fakeResponse.status, 400);

    const deletedResponse = await fetch(`${api}/attachments/${attachmentId}`, { method: "DELETE", headers: authorizationHeaders(operator.accessToken) });
    assert.equal(deletedResponse.status, 200);
    assert.equal((await fetch(`${api}/attachments/${attachmentId}`, { headers: authorizationHeaders(operator.accessToken) })).status, 404);
    attachmentId = "";
    assert.equal(await prisma.auditLog.count({ where: { userId: operator.user.id, entityType: "ATTACHMENT" } }), 2);
  } finally {
    if (attachmentId) await prisma.attachment.delete({ where: { id: attachmentId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId: operator.user.id } });
    if (reportId) await prisma.sealingReport.delete({ where: { id: reportId } }).catch(() => {});
    if (terminalId) await prisma.terminal.delete({ where: { id: terminalId } }).catch(() => {});
    if (destinationTerminalId) await prisma.terminal.delete({ where: { id: destinationTerminalId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.delete({ where: { id: operator.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
