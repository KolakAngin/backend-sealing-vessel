import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import sharp from "sharp";


import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Revisi 1 & 2: Unloading Master shipment management and arrival destination assignment", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

  const admin = await createTestIdentity("ADMIN");
  const loadingMaster = await createTestIdentity("LOADING_MASTER");
  const unloadingMaster1 = await createTestIdentity("UNLOADING_MASTER");
  const unloadingMaster2 = await createTestIdentity("UNLOADING_MASTER");

  const call = async <T>(path: string, init?: RequestInit, token = unloadingMaster1.accessToken) => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        ...authorizationHeaders(token),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
    });
    return { response, body: (await response.json()) as Api<T> };
  };

  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const reportIds: string[] = [];
  const assignmentIds: string[] = [];
  let vesselId = "";
  let productId = "";
  let activityId = "";
  let loadingPlantId = "";
  let dischargePlantId = "";
  let loadingJettyId = "";
  let dischargeJettyId = "";
  let otherJettyId = "";

  try {
    const vessel = await prisma.vessel.create({
      data: { name: `Vessel UM ${suffix}`, imoNumber: `IMO-${suffix}`, capacity: 10000 },
    });
    vesselId = vessel.id;

    const product = await prisma.product.create({
      data: { name: `Solar ${suffix}` },
    });

    productId = product.id;

    const existingActivity = await prisma.activity.findUnique({ where: { code: "LOADING" } });
    if (existingActivity) {
      activityId = existingActivity.id;
    } else {
      const act = await prisma.activity.create({ data: { code: "LOADING", name: "LOADING", isActive: true } });
      activityId = act.id;
    }

    const loadPlant = await prisma.plant.create({ data: { code: `LP-${suffix}`, name: `Loading Plant ${suffix}` } });
    loadingPlantId = loadPlant.id;
    const dischPlant = await prisma.plant.create({ data: { code: `DP-${suffix}`, name: `Discharge Plant ${suffix}` } });
    dischargePlantId = dischPlant.id;

    const loadJetty = await prisma.jetty.create({ data: { name: `Loading Jetty ${suffix}` } });
    loadingJettyId = loadJetty.id;
    const dischJetty = await prisma.jetty.create({ data: { name: `Discharge Jetty ${suffix}` } });
    dischargeJettyId = dischJetty.id;
    const otherJetty = await prisma.jetty.create({ data: { name: `Other Jetty ${suffix}` } });
    otherJettyId = otherJetty.id;


    const assign1 = await prisma.plantJettyAssignment.create({
      data: { plantId: loadingPlantId, jettyId: loadingJettyId },
    });
    assignmentIds.push(assign1.id);
    const assign2 = await prisma.plantJettyAssignment.create({
      data: { plantId: dischargePlantId, jettyId: dischargeJettyId },
    });
    assignmentIds.push(assign2.id);


    // ==========================================
    // REVISI 1: Unloading Master CRUD Shipment
    // ==========================================

    // 1. Unloading Master membuat shipment via POST /shipments
    const createShipmentRes = await call<{
      id: string;
      createdById: string;
      unloadingMasterId: string | null;
      loadingMasterId: string | null;
      status: string;
    }>(
      "/shipments",
      json("POST", {
        vesselId,
        activityId,
        productId,
        loadingPlantId,
        loadingJettyId,
        voyageNumber: `VOY-${suffix}-UM1`,
        shipmentNumber: `SHP-${suffix}-UM1`,
        reportDateTime: new Date().toISOString(),
        remarks: "Created by Unloading Master",
      }),
      unloadingMaster1.accessToken,
    );

    assert.equal(createShipmentRes.response.status, 201, JSON.stringify(createShipmentRes.body));
    const createdReport = createShipmentRes.body.data;
    reportIds.push(createdReport.id);
    assert.equal(createdReport.createdById, unloadingMaster1.user.id);
    assert.equal(createdReport.unloadingMasterId, unloadingMaster1.user.id);
    assert.equal(createdReport.status, "DRAFT");

    // 2. Shipment langsung tampil di list milik Unloading Master (GET /shipments)
    const listRes = await call<Array<{ id: string }>>("/shipments", undefined, unloadingMaster1.accessToken);
    assert.equal(listRes.response.status, 200);
    assert.ok(listRes.body.data.some((item) => item.id === createdReport.id));


    // 3. Detail shipment bisa dibaca oleh pembuat (GET /shipments/:id)
    const detailRes = await call<{ id: string }>(`/shipments/${createdReport.id}`, undefined, unloadingMaster1.accessToken);
    assert.equal(detailRes.response.status, 200);
    assert.equal(detailRes.body.data.id, createdReport.id);

    // 4. Unloading Master pembuat dapat mengubah shipment saat DRAFT (PATCH /shipments/:id)
    const updateRes = await call<{ remarks: string }>(
      `/shipments/${createdReport.id}`,
      json("PATCH", { remarks: "Updated by UM Creator" }),
      unloadingMaster1.accessToken,
    );
    assert.equal(updateRes.response.status, 200, JSON.stringify(updateRes.body));
    assert.equal(updateRes.body.data.remarks, "Updated by UM Creator");

    // 5. Unloading Master lain tidak berhak mengubah shipment ini (403)
    const unauthorizedUpdateRes = await call<unknown>(
      `/shipments/${createdReport.id}`,
      json("PATCH", { remarks: "Intruder UM" }),
      unloadingMaster2.accessToken,
    );
    assert.equal(unauthorizedUpdateRes.response.status, 403);

    // 6. Unloading Master lain tidak berhak menghapus shipment ini (403)
    const unauthorizedDeleteRes = await call<unknown>(
      `/shipments/${createdReport.id}`,
      { method: "DELETE" },
      unloadingMaster2.accessToken,
    );
    assert.equal(unauthorizedDeleteRes.response.status, 403);

    // 7. Unloading Master pembuat dapat menghapus shipment saat DRAFT (DELETE /shipments/:id)
    const deleteRes = await call<unknown>(
      `/shipments/${createdReport.id}`,
      { method: "DELETE" },
      unloadingMaster1.accessToken,
    );
    assert.equal(deleteRes.response.status, 200);

    // 8. Unloading Master juga dapat membuat via POST /voyages
    const createVoyageRes = await call<{
      id: string;
      createdById: string;
      unloadingMasterId: string | null;
      status: string;
    }>(
      "/voyages",
      json("POST", {
        vesselId,
        activityId,
        productId,
        loadingPlantId,
        loadingJettyId,
        voyageNumber: `VOY-${suffix}-UM2`,
        shipmentNumber: `SHP-${suffix}-UM2`,
        reportDateTime: new Date().toISOString(),
      }),
      unloadingMaster1.accessToken,
    );
    assert.equal(createVoyageRes.response.status, 201, JSON.stringify(createVoyageRes.body));
    reportIds.push(createVoyageRes.body.data.id);
    assert.equal(createVoyageRes.body.data.createdById, unloadingMaster1.user.id);
    assert.equal(createVoyageRes.body.data.unloadingMasterId, unloadingMaster1.user.id);

    // ==========================================
    // REVISI 2: Penetapan Tujuan Bongkar saat Sandar
    // ==========================================

    // Buat shipment untuk lifecycle perjalanan lengkap
    const lifecycleShipment = await call<{ id: string }>(
      "/shipments",
      json("POST", {
        vesselId,
        activityId,
        productId,
        loadingPlantId,
        loadingJettyId,
        voyageNumber: `VOY-${suffix}-LIFE`,
        shipmentNumber: `SHP-${suffix}-LIFE`,
        loadingMasterId: loadingMaster.user.id,
        unloadingMasterId: unloadingMaster1.user.id,
        reportDateTime: new Date().toISOString(),
      }),
      loadingMaster.accessToken,
    );

    assert.equal(lifecycleShipment.response.status, 201, JSON.stringify(lifecycleShipment.body));
    const shipmentId = lifecycleShipment.body.data.id;
    reportIds.push(shipmentId);

    // Setup snapshot form dan status READY
    await prisma.sealingReport.update({
      where: { id: shipmentId },
      data: {
        sealingProcessStatus: "READY",
        formConfigurationSnapshot: {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          formVersion: { id: randomUUID(), code: "V1", name: "Form V1", revision: 1 },
          vesselFormProfile: { id: randomUUID(), name: "Profile" },
          vessel: { id: vesselId, name: `Vessel UM ${suffix}`, imoNumber: `IMO-${suffix}` },
          sections: [],
          compartments: [],
          points: [],
        },
      },
    });


    // Cek validasi sebelum BA final: depart tidak boleh karena BA belum final, tapi BUKAN karena DESTINATION
    const valBeforeBa = await call<{
      transitions: { depart: { allowed: boolean; errors: Array<{ code: string }> } };
    }>(`/shipments/${shipmentId}/validation`, undefined, loadingMaster.accessToken);
    assert.equal(valBeforeBa.response.status, 200);
    assert.equal(valBeforeBa.body.data.transitions.depart.allowed, false);
    assert.equal(valBeforeBa.body.data.transitions.depart.errors.some((e) => e.code === "DESTINATION_ASSIGNMENT_REQUIRED"), false);
    assert.equal(valBeforeBa.body.data.transitions.depart.errors.some((e) => e.code === "LOADING_BA_NOT_FINALIZED"), true);

    // Isi 3 tanda tangan BA LOADING
    for (const role of ["CHIEF_OFFICER", "TERMINAL_REPRESENTATIVE", "SURVEYOR"] as const) {
      const sigRes = await call<{ id: string }>(
        `/shipments/${shipmentId}/ba/loading/signatures/${role}`,
        json("PUT", { name: `Signer ${role}`, signedAt: new Date().toISOString() }),
        loadingMaster.accessToken,
      );
      const form = new FormData();
      const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 30, b: 90, alpha: 1 } } }).png().toBuffer();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), `${role}.png`);
      await call(`/signatures/${sigRes.body.data.id}/file`, { method: "PUT", body: form }, loadingMaster.accessToken);
    }


    // Finalisasi BA LOADING TANPA tujuan bongkar -> HARUS BERHASIL (200)
    const finalizeBaLoading = await call<{ status: string }>(
      `/shipments/${shipmentId}/ba/loading/finalize`,
      json("POST", {}),
      loadingMaster.accessToken,
    );
    assert.equal(finalizeBaLoading.response.status, 200, JSON.stringify(finalizeBaLoading.body));
    assert.equal(finalizeBaLoading.body.data.status, "FINALIZED");

    // Cetak draft PDF BA LOADING tanpa tujuan bongkar -> HARUS BERHASIL (201)
    const pdfLoading = await call<{ checksumSha256: string }>(
      `/shipments/${shipmentId}/ba/loading/pdf`,
      json("POST", {}),
      loadingMaster.accessToken,
    );
    assert.equal(pdfLoading.response.status, 201, JSON.stringify(pdfLoading.body));

    // Validasi depart sekarang HARUS ALLOWED meskipun belum ada dischargePlantId/dischargeJettyId
    const valAfterBa = await call<{
      transitions: { depart: { allowed: boolean; errors: Array<{ code: string }> } };
    }>(`/shipments/${shipmentId}/validation`, undefined, loadingMaster.accessToken);
    assert.equal(valAfterBa.body.data.transitions.depart.allowed, true);

    // Kapal berangkat (POST /shipments/:id/depart) TANPA tujuan bongkar -> BERHASIL
    const departRes = await call<{ status: string; sealingProcessStatus: string }>(
      `/shipments/${shipmentId}/depart`,
      json("POST", {}),
      loadingMaster.accessToken,
    );
    assert.equal(departRes.response.status, 200, JSON.stringify(departRes.body));
    assert.equal(departRes.body.data.status, "BERLAYAR");

    // Unloading Master mencoba sandar dengan pasangan Plant-Jetty yang tidak terdaftar -> 400
    const invalidPairArrive = await call<unknown>(
      `/shipments/${shipmentId}/arrive`,
      json("POST", { dischargePlantId, dischargeJettyId: otherJettyId }),
      unloadingMaster1.accessToken,
    );
    assert.equal(invalidPairArrive.response.status, 400);
    assert.match(invalidPairArrive.body.message, /tidak terdaftar/);

    // Unloading Master sandar dengan dischargePlantId dan dischargeJettyId valid -> BERHASIL (200)
    const arriveRes = await call<{
      status: string;
      sealingProcessStatus: string;
      dischargePlantId: string;
      dischargeJettyId: string;
    }>(
      `/shipments/${shipmentId}/arrive`,
      json("POST", { dischargePlantId, dischargeJettyId }),
      unloadingMaster1.accessToken,
    );
    assert.equal(arriveRes.response.status, 200, JSON.stringify(arriveRes.body));
    assert.equal(arriveRes.body.data.status, "SANDAR");
    assert.equal(arriveRes.body.data.dischargePlantId, dischargePlantId);
    assert.equal(arriveRes.body.data.dischargeJettyId, dischargeJettyId);

    // Audit log SHIPMENT_DESTINATION_ASSIGNMENT tercipta dengan userId Unloading Master
    const destinationAudit = await prisma.auditLog.findFirst({
      where: { entityId: shipmentId, entityType: "SHIPMENT_DESTINATION_ASSIGNMENT" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(destinationAudit);
    assert.equal(destinationAudit.userId, unloadingMaster1.user.id);
    assert.equal((destinationAudit.newData as { dischargePlantId: string }).dischargePlantId, dischargePlantId);
    assert.equal((destinationAudit.newData as { dischargeJettyId: string }).dischargeJettyId, dischargeJettyId);

  } finally {
    server.close();
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [admin.user.id, loadingMaster.user.id, unloadingMaster1.user.id, unloadingMaster2.user.id] } },
    });
    await prisma.beritaAcaraPdfArtifact.deleteMany({ where: { baDocument: { sealingReportId: { in: reportIds } } } });
    await prisma.beritaAcaraDocument.deleteMany({ where: { sealingReportId: { in: reportIds } } });
    await prisma.reportSignature.deleteMany({ where: { sealingReportId: { in: reportIds } } });

    await prisma.sealVerification.deleteMany({ where: { seal: { sealingReportId: { in: reportIds } } } });
    await prisma.seal.deleteMany({ where: { sealingReportId: { in: reportIds } } });
    await prisma.sealingRecord.deleteMany({ where: { sealingReportId: { in: reportIds } } });
    await prisma.sealingReportProduct.deleteMany({ where: { sealingReportId: { in: reportIds } } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.plantJettyAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    if (loadingJettyId) await prisma.jetty.delete({ where: { id: loadingJettyId } }).catch(() => {});
    if (dischargeJettyId) await prisma.jetty.delete({ where: { id: dischargeJettyId } }).catch(() => {});
    if (otherJettyId) await prisma.jetty.delete({ where: { id: otherJettyId } }).catch(() => {});
    if (loadingPlantId) await prisma.plant.delete({ where: { id: loadingPlantId } }).catch(() => {});
    if (dischargePlantId) await prisma.plant.delete({ where: { id: dischargePlantId } }).catch(() => {});
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [admin.user.id, loadingMaster.user.id, unloadingMaster1.user.id, unloadingMaster2.user.id] } },
    });
    await prisma.$disconnect();
  }
});
