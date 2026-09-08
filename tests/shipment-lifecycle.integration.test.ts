import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { removeFile } from "../src/storage/local-storage.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T; details?: unknown };
type Validation = {
  activity: { code: string } | null;
  journeyStatus: string;
  sealingStatus: string | null;
  sealingProcessStatus: string;
  summary: { requiredCount: number; notApplicableRequiredCount: number };
  transitions: {
    depart: { allowed: boolean; errors: Array<{ code: string }> };
    arrive: { allowed: boolean; errors: Array<{ code: string }> };
    finalize: { allowed: boolean; errors: Array<{ code: string }> };
  };
  rules: { documentationRequired: boolean; revisionSupported: boolean };
};

const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Lifecycle shipment LOADING, DISCHARGE, ROB, validasi gagal, dan final snapshot", async () => {
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

  const reportIds: string[] = [];
  const templateIds: string[] = [];
  const assignmentIds: string[] = [];
  const createdActivityIds: string[] = [];
  const createdCategoryIds: string[] = [];
  let createdFormVersionId: string | undefined;
  let vesselId = "";
  let productId = "";
  let loadingPlantId = "";
  let dischargePlantId = "";
  let loadingJettyId = "";
  let dischargeJettyId = "";
  let lifecycleAttachmentKey = "";

  try {
    const activities = new Map<string, { id: string; code: string }>();
    for (const code of ["LOADING", "DISCHARGE", "ROB"] as const) {
      let activity = await prisma.activity.findUnique({ where: { code } });
      if (!activity) {
        activity = await prisma.activity.create({ data: { code, name: code, isActive: true } });
        createdActivityIds.push(activity.id);
      }
      assert.equal(activity.isActive, true);
      activities.set(code, activity);
    }

    const categories = new Map<string, { id: string; code: string; sequence: number }>();
    for (const [index, code] of ["A", "B", "C", "D", "E", "F", "G", "H"].entries()) {
      let category = await prisma.sealingCategory.findUnique({ where: { code } });
      if (!category) {
        category = await prisma.sealingCategory.create({
          data: { code, name: `Bagian ${code}`, sequence: index + 1, isActive: true },
        });
        createdCategoryIds.push(category.id);
      }
      categories.set(code, category);
    }
    const categoryA = categories.get("A");
    assert.ok(categoryA);

    let formVersion = await prisma.formTkoVersion.findUnique({ where: { code: "FORM-SEGEL-TKO-EDIT1" } });
    if (!formVersion) {
      formVersion = await prisma.formTkoVersion.create({
        data: { code: "FORM-SEGEL-TKO-EDIT1", name: "Form Segel Baru sesuai TKO (edit1)", revision: "edit1" },
      });
      createdFormVersionId = formVersion.id;
    }

    const vessel = await prisma.vessel.create({
      data: {
        name: `Lifecycle Vessel ${suffix}`,
        compartments: { create: { code: "1P", name: "Compartment 1P", side: "PORT", sequence: 1 } },
      },
      include: { compartments: true },
    });
    vesselId = vessel.id;
    const compartment = vessel.compartments[0]!;
    const profile = await prisma.vesselFormProfile.create({
      data: { vesselId, formVersionId: formVersion.id, name: `Lifecycle ${suffix}`, isActive: true, activatedAt: new Date() },
    });
    await prisma.vesselFormSection.createMany({
      data: [...categories.values()].map((category) => ({
        vesselFormProfileId: profile.id,
        categoryId: category.id,
        isAvailable: category.code === "A",
        sequence: category.sequence,
      })),
    });

    const createPoint = async (serial: number, isRequired: boolean) => {
      const template = await prisma.sealingPointTemplate.create({
        data: {
          categoryId: categoryA.id,
          code: `LIFE-A-${serial}-${suffix}`,
          name: `Lifecycle A ${serial}`,
          requiresCompartment: true,
          supportsSide: true,
          sequence: serial,
        },
      });
      templateIds.push(template.id);
      return prisma.vesselSealingPoint.create({
        data: {
          vesselId,
          sealingPointTemplateId: template.id,
          compartmentId: compartment.id,
          code: `LIFE-POINT-${serial}-${suffix}`,
          side: "PORT",
          instanceNo: 1,
          sequence: serial,
          isRequired,
        },
      });
    };
    const requiredPoint = await createPoint(1, true);
    const notApplicablePoint = await createPoint(2, true);
    const optionalPoint = await createPoint(3, false);

    const product = await prisma.product.create({ data: { name: `Lifecycle Product ${suffix}` } });
    productId = product.id;
    const loadingPlant = await prisma.plant.create({ data: { code: `LL${suffix}`.slice(0, 20), name: `Lifecycle Loading ${suffix}` } });
    loadingPlantId = loadingPlant.id;
    const dischargePlant = await prisma.plant.create({ data: { code: `LD${suffix}`.slice(0, 20), name: `Lifecycle Discharge ${suffix}` } });
    dischargePlantId = dischargePlant.id;
    const loadingJetty = await prisma.jetty.create({ data: { name: `Lifecycle Loading Jetty ${suffix}` } });
    loadingJettyId = loadingJetty.id;
    const dischargeJetty = await prisma.jetty.create({ data: { name: `Lifecycle Discharge Jetty ${suffix}` } });
    dischargeJettyId = dischargeJetty.id;
    for (const pair of [
      { plantId: loadingPlantId, jettyId: loadingJettyId },
      { plantId: dischargePlantId, jettyId: dischargeJettyId },
    ]) {
      const assignment = await prisma.plantJettyAssignment.create({ data: pair });
      assignmentIds.push(assignment.id);
    }

    let shipmentSerial = 0;
    const createShipment = async (activityCode: "LOADING" | "DISCHARGE" | "ROB", includeUnloadingMaster = true) => {
      shipmentSerial += 1;
      const activity = activities.get(activityCode)!;
      const created = await call<{
        id: string;
        status: string;
        sealingProcessStatus: string;
        loadingMaster: { id: string };
      }>("/shipments", json("POST", {
        vesselId,
        activityId: activity.id,
        reportDateTime: new Date().toISOString(),
        voyageNumber: `LIFE-VOY-${suffix}-${shipmentSerial}`,
        shipmentNumber: `LIFE-SHP-${suffix}-${shipmentSerial}`,
        productId,
        loadingPlantId,
        loadingJettyId,
        dischargePlantId,
        dischargeJettyId,
        sealingStatus: "PENDING",
        ...(includeUnloadingMaster ? { unloadingMasterId: unloadingMaster.user.id } : {}),
      }));
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.data.status, "DRAFT");
      assert.equal(created.body.data.sealingProcessStatus, "NOT_STARTED");
      assert.equal(created.body.data.loadingMaster.id, loadingMaster.user.id);
      reportIds.push(created.body.data.id);
      return created.body.data.id;
    };

    const adminWithoutAssignment = await call<unknown>("/shipments", json("POST", {
      vesselId,
      activityId: activities.get("LOADING")!.id,
      reportDateTime: new Date().toISOString(),
      voyageNumber: `LIFE-ADMIN-${suffix}`,
      shipmentNumber: `LIFE-ADMIN-${suffix}`,
      productId,
      loadingPlantId,
      loadingJettyId,
      dischargePlantId,
      dischargeJettyId,
      sealingStatus: "PENDING",
    }), admin.accessToken);
    assert.equal(adminWithoutAssignment.response.status, 400);

    const loadingMasterAssignsAnother = await call<unknown>("/shipments", json("POST", {
      vesselId,
      activityId: activities.get("LOADING")!.id,
      reportDateTime: new Date().toISOString(),
      voyageNumber: `LIFE-FORBIDDEN-${suffix}`,
      shipmentNumber: `LIFE-FORBIDDEN-${suffix}`,
      productId,
      loadingPlantId,
      loadingJettyId,
      dischargePlantId,
      dischargeJettyId,
      sealingStatus: "PENDING",
      loadingMasterId: otherLoadingMaster.user.id,
      unloadingMasterId: unloadingMaster.user.id,
    }));
    assert.equal(loadingMasterAssignsAnother.response.status, 403);

    const reportId = await createShipment("LOADING");
    const otherLoadingList = await call<Array<{ id: string }>>("/shipments?limit=100", undefined, otherLoadingMaster.accessToken);
    assert.equal(otherLoadingList.response.status, 200);
    assert.equal(otherLoadingList.body.data.some((report) => report.id === reportId), false);
    assert.equal((await call<unknown>(`/shipments/${reportId}`, undefined, otherLoadingMaster.accessToken)).response.status, 403);
    const assignedUnloadingList = await call<Array<{ id: string }>>("/shipments?limit=100", undefined, unloadingMaster.accessToken);
    assert.equal(assignedUnloadingList.response.status, 200);
    assert.equal(assignedUnloadingList.body.data.some((report) => report.id === reportId), true);
    const otherUnloadingList = await call<Array<{ id: string }>>("/shipments?limit=100", undefined, otherUnloadingMaster.accessToken);
    assert.equal(otherUnloadingList.response.status, 200);
    assert.equal(otherUnloadingList.body.data.some((report) => report.id === reportId), false);
    assert.equal((await call<unknown>(`/shipments/${reportId}`, undefined, otherUnloadingMaster.accessToken)).response.status, 403);
    const prepare = await call<{ sealingProcessStatus: string }>(`/shipments/${reportId}/prepare-seals`, json("POST", {}));
    assert.equal(prepare.response.status, 200, JSON.stringify(prepare.body));
    assert.equal(prepare.body.data.sealingProcessStatus, "IN_PROGRESS");

    const initialValidation = await call<Validation>(`/shipments/${reportId}/validation`);
    assert.equal(initialValidation.response.status, 200);
    assert.equal(initialValidation.body.data.activity?.code, "LOADING");
    assert.equal(initialValidation.body.data.transitions.depart.allowed, false);
    assert.equal(initialValidation.body.data.transitions.depart.errors.some((issue) => issue.code === "REQUIRED_POINTS_INCOMPLETE"), true);
    assert.equal(initialValidation.body.data.rules.documentationRequired, false);
    assert.equal(initialValidation.body.data.rules.revisionSupported, false);

    const invalidArrival = await call<unknown>(`/shipments/${reportId}/arrive`, json("POST", {}), unloadingMaster.accessToken);
    assert.equal(invalidArrival.response.status, 400);
    const invalidFinalization = await call<unknown>(`/shipments/${reportId}/finalize`, json("POST", {}), unloadingMaster.accessToken);
    assert.equal(invalidFinalization.response.status, 400);
    const wrongLoadingMaster = await call<unknown>(`/shipments/${reportId}/depart`, json("POST", {}), otherLoadingMaster.accessToken);
    assert.equal(wrongLoadingMaster.response.status, 403);
    const incompleteDeparture = await call<unknown>(`/shipments/${reportId}/depart`, json("POST", {}));
    assert.equal(incompleteDeparture.response.status, 400);

    const requiredWritten = await call<{ point: { recordId: string; seals: Array<{ id: string }> } }>(
      `/shipments/${reportId}/form/points/${requiredPoint.id}`,
      json("PUT", { status: "SEALED", notes: "Required", seals: [{ sealNumber: `LIFE-${suffix}-001` }] }),
    );
    assert.equal(requiredWritten.response.status, 200, JSON.stringify(requiredWritten.body));
    const requiredRecordId = requiredWritten.body.data.point.recordId;
    const requiredSealId = requiredWritten.body.data.point.seals[0]!.id;
    assert.ok(requiredRecordId);

    const markedNotApplicable = await call<unknown>(
      `/shipments/${reportId}/form/points/${notApplicablePoint.id}`,
      json("PUT", { status: "NOT_APPLICABLE", notes: "Tidak digunakan", seals: [] }),
    );
    assert.equal(markedNotApplicable.response.status, 200);
    const readyValidation = await call<Validation>(`/voyages/${reportId}/validation`);
    assert.equal(readyValidation.body.data.sealingProcessStatus, "READY");
    assert.equal(readyValidation.body.data.summary.requiredCount, 2);
    assert.equal(readyValidation.body.data.summary.notApplicableRequiredCount, 1);
    assert.equal(readyValidation.body.data.transitions.depart.allowed, true);

    const documentation = new FormData();
    documentation.append("file", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "lifecycle.png");
    documentation.append("caption", "Snapshot lifecycle");
    const documentationResponse = await call<{ id: string }>(`/shipments/${reportId}/attachments`, { method: "POST", body: documentation });
    assert.equal(documentationResponse.response.status, 201, JSON.stringify(documentationResponse.body));
    lifecycleAttachmentKey = `${documentationResponse.body.data.id}.png`;
    const signatureResponse = await call<unknown>(
      `/shipments/${reportId}/signatures`,
      json("POST", { role: "CHIEF_OFFICER", name: "Chief Lifecycle", signedAt: new Date().toISOString() }),
    );
    assert.equal(signatureResponse.response.status, 201, JSON.stringify(signatureResponse.body));

    const departed = await call<{ status: string; sealingProcessStatus: string }>(`/shipments/${reportId}/depart`, json("POST", {}));
    assert.equal(departed.response.status, 200, JSON.stringify(departed.body));
    assert.equal(departed.body.data.status, "BERLAYAR");
    assert.equal(departed.body.data.sealingProcessStatus, "IN_TRANSIT");

    const editAfterDeparture = await call<unknown>(
      `/shipments/${reportId}/form/points/${optionalPoint.id}`,
      json("PUT", { status: "NOT_SEALED", seals: [] }),
    );
    assert.equal(editAfterDeparture.response.status, 400);
    const wrongUnloadingMaster = await call<unknown>(`/shipments/${reportId}/arrive`, json("POST", {}), otherUnloadingMaster.accessToken);
    assert.equal(wrongUnloadingMaster.response.status, 403);

    const arrived = await call<{ status: string; sealingProcessStatus: string }>(
      `/shipments/${reportId}/arrive`, json("POST", {}), unloadingMaster.accessToken,
    );
    assert.equal(arrived.response.status, 200, JSON.stringify(arrived.body));
    assert.equal(arrived.body.data.status, "SANDAR");
    assert.equal(arrived.body.data.sealingProcessStatus, "VERIFICATION");

    const beforeVerification = await call<Validation>(`/shipments/${reportId}/validation`, undefined, unloadingMaster.accessToken);
    assert.equal(beforeVerification.body.data.transitions.finalize.allowed, false);
    assert.equal(beforeVerification.body.data.transitions.finalize.errors.some((issue) => issue.code === "SEALS_NOT_VERIFIED"), true);
    const finalizeUnverified = await call<unknown>(`/shipments/${reportId}/finalize`, json("POST", {}), unloadingMaster.accessToken);
    assert.equal(finalizeUnverified.response.status, 400);

    const verified = await call<unknown>(
      `/seals/${requiredSealId}/verify`,
      json("POST", { condition: "GOOD", remarks: "Utuh" }),
      unloadingMaster.accessToken,
    );
    assert.equal(verified.response.status, 201, JSON.stringify(verified.body));
    const readyToFinalize = await call<Validation>(`/reports/${reportId}/validation`, undefined, unloadingMaster.accessToken);
    assert.equal(readyToFinalize.body.data.transitions.finalize.allowed, true);

    const finalized = await call<{
      status: string;
      sealingProcessStatus: string;
      finalSnapshot: unknown;
      finalizedById: string;
    }>(`/shipments/${reportId}/finalize`, json("POST", { remarks: "Final" }), unloadingMaster.accessToken);
    assert.equal(finalized.response.status, 200, JSON.stringify(finalized.body));
    assert.equal(finalized.body.data.status, "FINISH");
    assert.equal(finalized.body.data.sealingProcessStatus, "FINALIZED");
    assert.ok(finalized.body.data.finalSnapshot);
    assert.equal(finalized.body.data.finalizedById, unloadingMaster.user.id);
    const snapshotData = finalized.body.data.finalSnapshot as { attachments: unknown[]; signatures: unknown[] };
    assert.equal(snapshotData.attachments.length, 1);
    assert.equal(snapshotData.signatures.length, 1);

    const persistedFinal = await prisma.sealingReport.findUnique({ where: { id: reportId } });
    assert.ok(persistedFinal?.finalSnapshot);
    const finalSnapshotBefore = JSON.stringify(persistedFinal.finalSnapshot);
    const editShipmentAfterFinal = await call<unknown>(`/shipments/${reportId}`, json("PATCH", { sealingStatus: "CHANGED" }));
    assert.equal(editShipmentAfterFinal.response.status, 400);
    const addSealAfterFinal = await call<unknown>(
      `/records/${requiredRecordId}/seals`,
      json("POST", { sealNumber: `LIFE-${suffix}-LOCKED` }),
    );
    assert.equal(addSealAfterFinal.response.status, 400);
    const departAfterFinal = await call<unknown>(`/shipments/${reportId}/depart`, json("POST", {}));
    assert.equal(departAfterFinal.response.status, 400);
    const finalSnapshotAfter = await prisma.sealingReport.findUnique({ where: { id: reportId }, select: { finalSnapshot: true } });
    assert.equal(JSON.stringify(finalSnapshotAfter?.finalSnapshot), finalSnapshotBefore);

    const finalValidation = await call<Validation>(`/shipments/${reportId}/validation`, undefined, unloadingMaster.accessToken);
    assert.equal(finalValidation.body.data.journeyStatus, "FINISH");
    assert.equal(finalValidation.body.data.sealingProcessStatus, "FINALIZED");
    assert.equal(finalValidation.body.data.transitions.depart.allowed, false);
    assert.equal(finalValidation.body.data.transitions.arrive.allowed, false);
    assert.equal(finalValidation.body.data.transitions.finalize.allowed, false);

    for (const activityCode of ["DISCHARGE", "ROB"] as const) {
      const activityReportId = await createShipment(activityCode);
      const activityPrepared = await call<unknown>(`/shipments/${activityReportId}/prepare-seals`, json("POST", {}));
      assert.equal(activityPrepared.response.status, 200, JSON.stringify(activityPrepared.body));
      const batchNotApplicable = await call<unknown>(
        `/shipments/${activityReportId}/form/sections/A`,
        json("PUT", {
          points: [
            { vesselSealingPointId: requiredPoint.id, status: "NOT_APPLICABLE", notes: null, seals: [] },
            { vesselSealingPointId: notApplicablePoint.id, status: "NOT_APPLICABLE", notes: null, seals: [] },
          ],
        }),
      );
      assert.equal(batchNotApplicable.response.status, 200, JSON.stringify(batchNotApplicable.body));
      const activityValidation = await call<Validation>(`/shipments/${activityReportId}/validation`);
      assert.equal(activityValidation.body.data.activity?.code, activityCode);
      assert.equal(activityValidation.body.data.transitions.depart.allowed, true);
      assert.equal((await call<unknown>(`/shipments/${activityReportId}/depart`, json("POST", {}))).response.status, 200);
      assert.equal((await call<unknown>(`/shipments/${activityReportId}/arrive`, json("POST", {}), unloadingMaster.accessToken)).response.status, 200);
      const activityFinalized = await call<{ status: string }>(
        `/shipments/${activityReportId}/finalize`, json("POST", {}), unloadingMaster.accessToken,
      );
      assert.equal(activityFinalized.response.status, 200, JSON.stringify(activityFinalized.body));
      assert.equal(activityFinalized.body.data.status, "FINISH");
    }

    const unassignedReportId = await createShipment("LOADING", false);
    assert.equal((await call<unknown>(`/shipments/${unassignedReportId}/prepare-seals`, json("POST", {}))).response.status, 200);
    const unassignedInput = await call<unknown>(
      `/shipments/${unassignedReportId}/form/sections/A`,
      json("PUT", {
        points: [
          { vesselSealingPointId: requiredPoint.id, status: "NOT_APPLICABLE", seals: [] },
          { vesselSealingPointId: notApplicablePoint.id, status: "NOT_APPLICABLE", seals: [] },
        ],
      }),
    );
    assert.equal(unassignedInput.response.status, 200);
    const unassignedValidation = await call<Validation>(`/shipments/${unassignedReportId}/validation`);
    assert.equal(unassignedValidation.body.data.transitions.depart.allowed, false);
    assert.equal(unassignedValidation.body.data.transitions.depart.errors.some((issue) => issue.code === "UNLOADING_MASTER_REQUIRED"), true);
    assert.equal((await call<unknown>(`/shipments/${unassignedReportId}/depart`, json("POST", {}))).response.status, 400);

    const lifecycleAudits = await prisma.auditLog.findMany({
      where: { entityId: reportId },
      select: { action: true, entityType: true },
    });
    const lifecycleActions = new Set(lifecycleAudits
      .filter((entry: { entityType: string }) => entry.entityType === "SHIPMENT_VOYAGE")
      .map((entry: { action: string }) => entry.action));
    for (const action of ["CREATE", "DEPART", "ARRIVE", "FINALIZE"]) {
      assert.equal(lifecycleActions.has(action), true, `Audit ${action} wajib tersedia`);
    }
    const finalizationAuditApi = await call<Array<{ action: string; entityType: string }>>(
      `/audit-logs?entityId=${reportId}&action=FINALIZE`,
      undefined,
      admin.accessToken,
    );
    assert.equal(finalizationAuditApi.response.status, 200);
    assert.equal(finalizationAuditApi.body.data.length, 1);
    assert.equal(finalizationAuditApi.body.data[0]!.entityType, "SHIPMENT_VOYAGE");
  } finally {
    if (lifecycleAttachmentKey) await removeFile(lifecycleAttachmentKey).catch(() => {});
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [admin.user.id, loadingMaster.user.id, otherLoadingMaster.user.id, unloadingMaster.user.id, otherUnloadingMaster.user.id] } },
    });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    for (const templateId of templateIds) {
      await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    }
    await prisma.plantJettyAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    if (loadingJettyId) await prisma.jetty.delete({ where: { id: loadingJettyId } }).catch(() => {});
    if (dischargeJettyId) await prisma.jetty.delete({ where: { id: dischargeJettyId } }).catch(() => {});
    if (loadingPlantId) await prisma.plant.delete({ where: { id: loadingPlantId } }).catch(() => {});
    if (dischargePlantId) await prisma.plant.delete({ where: { id: dischargePlantId } }).catch(() => {});
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    await prisma.activity.deleteMany({ where: { id: { in: createdActivityIds } } });
    if (createdFormVersionId) await prisma.formTkoVersion.delete({ where: { id: createdFormVersionId } }).catch(() => {});
    await prisma.sealingCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: [admin.user.id, loadingMaster.user.id, otherLoadingMaster.user.id, unloadingMaster.user.id, otherUnloadingMaster.user.id] } },
    });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
