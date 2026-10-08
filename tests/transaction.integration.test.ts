import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
const json = (method: string, body: object): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("Transaksi sealing end-to-end dan audit log", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = await createTestIdentity("ADMIN");
  const operator = await createTestIdentity("LOADING_MASTER");
  const unloadingMaster = await createTestIdentity("UNLOADING_MASTER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const call = async <T>(path: string, init?: RequestInit, token = operator.accessToken) => {
    const response = await fetch(`${api}${path}`, { ...init, headers: { ...authorizationHeaders(token), ...Object.fromEntries(new Headers(init?.headers)) } });
    return { response, body: await response.json() as Api<T> };
  };

  let vesselId = ""; let terminalId = ""; let destinationTerminalId = ""; let categoryId = ""; let templateId = ""; let compartmentId = ""; let pointId = "";
  const reportIds: string[] = [];

  try {
    const vessel = await prisma.vessel.create({ data: { name: `TX Vessel ${suffix}`, imoNumber: `TX-${suffix}`, vesselType: "TANKER" } }); vesselId = vessel.id;
    const terminal = await prisma.terminal.create({ data: { code: `TX${suffix}`.slice(0, 20), name: `TX Terminal ${suffix}` } }); terminalId = terminal.id;
    const destination = await prisma.terminal.create({ data: { code: `TD${suffix}`.slice(0, 20), name: `TX Destination ${suffix}` } }); destinationTerminalId = destination.id;
    const category = await prisma.sealingCategory.create({ data: { code: `T${suffix.slice(0, 4)}`, name: `TX Category ${suffix}`, sequence: 999 } }); categoryId = category.id;
    const template = await prisma.sealingPointTemplate.create({ data: { categoryId, code: `TX-T-${suffix}`, name: "TX Template", requiresCompartment: true, supportsSide: true, sequence: 1 } }); templateId = template.id;
    const compartment = await prisma.compartment.create({ data: { vesselId, code: "TX-1P", name: "TX Compartment", side: "PORT" } }); compartmentId = compartment.id;
    const point = await prisma.vesselSealingPoint.create({ data: { vesselId, sealingPointTemplateId: templateId, compartmentId, code: `TX-P-${suffix}`, side: "PORT" } }); pointId = point.id;

    const loadingCannotCreateVessel = await call<unknown>("/vessels", json("POST", { name: "Forbidden Vessel", compartments: [{ code: "1", name: "One" }] }));
    assert.equal(loadingCannotCreateVessel.response.status, 403);
    const created = await call<{ id: string; status: string }>("/reports", json("POST", { reportNo: `RPT-${suffix}`, vesselId, originTerminalId: terminalId, destinationTerminalId, unloadingMasterId: unloadingMaster.user.id, cargo: "Crude Oil", reportDateTime: new Date().toISOString(), portName: "Balikpapan" }));
    assert.equal(created.response.status, 201); assert.equal(created.body.data.status, "DRAFT"); const reportId = created.body.data.id; reportIds.push(reportId);

    const record = await call<{ id: string }>(`/reports/${reportId}/records`, json("POST", { vesselSealingPointId: pointId, status: "SEALED", notes: "Initial" }));
    assert.equal(record.response.status, 201);
    const patchedRecord = await call<unknown>(`/records/${record.body.data.id}`, json("PATCH", { notes: "Updated" })); assert.equal(patchedRecord.response.status, 200);

    const seal = await call<{ id: string }>(`/records/${record.body.data.id}/seals`, json("POST", { sealNumber: `SEAL-${suffix}-1` })); assert.equal(seal.response.status, 201);
    const replacement = await call<{ id: string; status: string }>(`/seals/${seal.body.data.id}/replace`, json("POST", { sealNumber: `SEAL-${suffix}-2` })); assert.equal(replacement.response.status, 201);

    const signature = await call<{ id: string }>(`/reports/${reportId}/signatures`, json("POST", { role: "CHIEF_OFFICER", name: "Chief Test", signedAt: new Date().toISOString() })); assert.equal(signature.response.status, 201);
    const patchedSignature = await call<unknown>(`/signatures/${signature.body.data.id}`, json("PATCH", { name: "Chief Updated" })); assert.equal(patchedSignature.response.status, 200);

    const submitted = await call<{ status: string }>(`/reports/${reportId}/depart`, json("POST", {})); assert.equal(submitted.response.status, 200); assert.equal(submitted.body.data.status, "BERLAYAR");
    const editAfterSubmit = await call<unknown>(`/reports/${reportId}`, json("PATCH", { cargo: "Forbidden" })); assert.equal(editAfterSubmit.response.status, 400);
    const wrongArrival = await call<unknown>(`/reports/${reportId}/arrive`, json("POST", {}), operator.accessToken); assert.equal(wrongArrival.response.status, 403);
    const arrived = await call<{ status: string }>(`/reports/${reportId}/arrive`, json("POST", {}), unloadingMaster.accessToken); assert.equal(arrived.response.status, 200); assert.equal(arrived.body.data.status, "SANDAR");
    const verifiedSeal = await call<unknown>(`/seals/${replacement.body.data.id}/verify`, json("POST", { condition: "GOOD", remarks: "Seal intact" }), unloadingMaster.accessToken); assert.equal(verifiedSeal.response.status, 201);
    const finished = await call<{ status: string }>(`/reports/${reportId}/finish`, json("POST", { remarks: "Unloading completed" }), unloadingMaster.accessToken); assert.equal(finished.response.status, 200); assert.equal(finished.body.data.status, "FINISH");

    const detail = await call<{ sealingRecords: unknown[]; signatures: unknown[] }>(`/reports/${reportId}`); assert.equal(detail.response.status, 200); assert.equal(detail.body.data.sealingRecords.length, 1);
    const audits = await call<Array<{ entityId: string }>>(`/audit-logs?entityId=${reportId}`, undefined, admin.accessToken); assert.equal(audits.response.status, 200); assert.equal(audits.body.data.length >= 4, true);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.user.id, operator.user.id, unloadingMaster.user.id] } } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    if (pointId) await prisma.vesselSealingPoint.delete({ where: { id: pointId } }).catch(() => {});
    if (compartmentId) await prisma.compartment.delete({ where: { id: compartmentId } }).catch(() => {});
    if (templateId) await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (categoryId) await prisma.sealingCategory.delete({ where: { id: categoryId } }).catch(() => {});
    if (terminalId) await prisma.terminal.delete({ where: { id: terminalId } }).catch(() => {});
    if (destinationTerminalId) await prisma.terminal.delete({ where: { id: destinationTerminalId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [admin.user.id, operator.user.id, unloadingMaster.user.id] } } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await prisma.$disconnect();
  }
});
