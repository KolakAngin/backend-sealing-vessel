import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Shipment/voyage wajib, relasi Plant-Jetty, status terpisah, dan audit", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = await createTestIdentity("ADMIN");
  const operator = await createTestIdentity("LOADING_MASTER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const call = async <T>(path: string, init?: RequestInit, token = operator.accessToken) => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        ...authorizationHeaders(token),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
    });
    return { response, body: (await response.json()) as Api<T> };
  };

  const reportIds: string[] = [];
  const assignmentIds: string[] = [];
  const createdActivityIds: string[] = [];
  let vesselId = "";
  let productId = "";
  let inactiveProductId = "";
  let unsupportedActivityId = "";
  let loadingPlantId = "";
  let dischargePlantId = "";
  let loadingJettyId = "";
  let dischargeJettyId = "";
  let terminalId = "";
  let destinationTerminalId = "";

  try {
    const ensureActivity = async (code: "LOADING" | "DISCHARGE" | "ROB") => {
      const existing = await prisma.activity.findUnique({ where: { code } });
      if (existing) {
        assert.equal(existing.isActive, true, `Master activity ${code} harus aktif`);
        return existing;
      }
      const created = await prisma.activity.create({ data: { code, name: code, isActive: true } });
      createdActivityIds.push(created.id);
      return created;
    };
    const activities = {
      LOADING: await ensureActivity("LOADING"),
      DISCHARGE: await ensureActivity("DISCHARGE"),
      ROB: await ensureActivity("ROB"),
    };

    const vessel = await prisma.vessel.create({
      data: { name: `Shipment Vessel ${suffix}`, imoNumber: `SH-${suffix}`, isActive: true },
    });
    vesselId = vessel.id;
    const product = await prisma.product.create({ data: { name: `Shipment Product ${suffix}`, isActive: true } });
    productId = product.id;
    const inactiveProduct = await prisma.product.create({ data: { name: `Inactive Product ${suffix}`, isActive: false } });
    inactiveProductId = inactiveProduct.id;
    const unsupportedActivity = await prisma.activity.create({ data: { code: `OTHER-${suffix}`, name: "Unsupported", isActive: true } });
    unsupportedActivityId = unsupportedActivity.id;
    const loadingPlant = await prisma.plant.create({ data: { code: `L${suffix}`.slice(0, 20), name: `Loading Plant ${suffix}` } });
    loadingPlantId = loadingPlant.id;
    const dischargePlant = await prisma.plant.create({ data: { code: `D${suffix}`.slice(0, 20), name: `Discharge Plant ${suffix}` } });
    dischargePlantId = dischargePlant.id;
    const loadingJetty = await prisma.jetty.create({ data: { name: `Loading Jetty ${suffix}` } });
    loadingJettyId = loadingJetty.id;
    const dischargeJetty = await prisma.jetty.create({ data: { name: `Discharge Jetty ${suffix}` } });
    dischargeJettyId = dischargeJetty.id;

    for (const body of [
      { plantId: loadingPlantId, jettyId: loadingJettyId },
      { plantId: dischargePlantId, jettyId: dischargeJettyId },
    ]) {
      const assignment = await call<{ id: string }>(
        "/plant-jetty-assignments",
        json("POST", body),
        admin.accessToken,
      );
      assert.equal(assignment.response.status, 201, JSON.stringify(assignment.body));
      assignmentIds.push(assignment.body.data.id);
    }

    const missing = await call<unknown>("/shipments", json("POST", { vesselId }));
    assert.equal(missing.response.status, 400);

    const payload = {
      vesselId,
      activityId: activities.LOADING.id,
      reportDateTime: new Date().toISOString(),
      voyageNumber: `VOY-${suffix}`,
      shipmentNumber: `SHP-${suffix}-1`,
      productId,
      loadingPlantId,
      loadingJettyId,
      dischargePlantId,
      dischargeJettyId,
      sealingStatus: "READY",
    };

    const wrongJettyPlant = await call<unknown>(
      "/shipments",
      json("POST", { ...payload, shipmentNumber: `SHP-${suffix}-BAD-PAIR`, loadingJettyId: dischargeJettyId }),
    );
    assert.equal(wrongJettyPlant.response.status, 400);
    assert.match(wrongJettyPlant.body.message, /tidak terdaftar pada loading plant/i);

    const inactiveReference = await call<unknown>(
      "/shipments",
      json("POST", { ...payload, shipmentNumber: `SHP-${suffix}-INACTIVE`, productId: inactiveProductId }),
    );
    assert.equal(inactiveReference.response.status, 400);
    assert.match(inactiveReference.body.message, /product.*tidak aktif/i);

    const unsupportedActivityResponse = await call<unknown>(
      "/shipments",
      json("POST", { ...payload, shipmentNumber: `SHP-${suffix}-OTHER`, activityId: unsupportedActivityId }),
    );
    assert.equal(unsupportedActivityResponse.response.status, 400);
    assert.match(unsupportedActivityResponse.body.message, /LOADING, DISCHARGE, atau ROB/);

    const created = await call<{
      id: string;
      reportNo: string;
      shipmentNumber: string;
      voyageNumber: string;
      sealingStatus: string;
      status: string;
      activity: { code: string };
      loadingPlant: { id: string };
      loadingJetty: { id: string };
    }>("/shipments", json("POST", payload));
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    reportIds.push(created.body.data.id);
    assert.match(created.body.data.reportNo, /^RPT-/);
    assert.equal(created.body.data.shipmentNumber, payload.shipmentNumber);
    assert.equal(created.body.data.voyageNumber, payload.voyageNumber);
    assert.equal(created.body.data.activity.code, "LOADING");
    assert.equal(created.body.data.status, "DRAFT");
    assert.equal(created.body.data.sealingStatus, "READY");
    assert.equal(created.body.data.loadingPlant.id, loadingPlantId);
    assert.equal(created.body.data.loadingJetty.id, loadingJettyId);

    const usedAssignmentDelete = await call<unknown>(
      `/plant-jetty-assignments/${assignmentIds[0]}`,
      { method: "DELETE" },
      admin.accessToken,
    );
    assert.equal(usedAssignmentDelete.response.status, 409);

    const duplicate = await call<unknown>(
      "/voyages",
      json("POST", { ...payload, shipmentNumber: payload.shipmentNumber.toLowerCase() }),
    );
    assert.equal(duplicate.response.status, 409);

    const patched = await call<{ status: string; sealingStatus: string }>(
      `/voyages/${created.body.data.id}`,
      json("PATCH", { sealingStatus: "SEALED" }),
    );
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.data.status, "DRAFT");
    assert.equal(patched.body.data.sealingStatus, "SEALED");

    const listed = await call<Array<{ id: string }>>(
      `/shipments?shipmentNumber=${payload.shipmentNumber.toLowerCase()}`,
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.some((item) => item.id === created.body.data.id), true);

    for (const [index, code] of (["DISCHARGE", "ROB"] as const).entries()) {
      const activityCreated = await call<{ id: string; activity: { code: string } }>(
        "/voyages",
        json("POST", {
          ...payload,
          activityId: activities[code].id,
          voyageNumber: `VOY-${suffix}-${index + 2}`,
          shipmentNumber: `SHP-${suffix}-${index + 2}`,
        }),
      );
      assert.equal(activityCreated.response.status, 201, JSON.stringify(activityCreated.body));
      assert.equal(activityCreated.body.data.activity.code, code);
      reportIds.push(activityCreated.body.data.id);
    }

    const deletedId = reportIds.pop();
    assert.ok(deletedId);
    const deleted = await call<unknown>(`/shipments/${deletedId}`, { method: "DELETE" });
    assert.equal(deleted.response.status, 200);
    const deletedAudits = await call<Array<{ action: string; entityType: string }>>(
      `/audit-logs?entityId=${deletedId}&limit=100`,
      undefined,
      admin.accessToken,
    );
    assert.deepEqual(
      new Set(deletedAudits.body.data.map((item) => item.action)),
      new Set(["CREATE", "DELETE"]),
    );
    assert.equal(deletedAudits.body.data.every((item) => item.entityType === "SHIPMENT_VOYAGE"), true);

    const audits = await call<Array<{ action: string; entityType: string }>>(
      `/audit-logs?entityId=${created.body.data.id}&limit=100`,
      undefined,
      admin.accessToken,
    );
    assert.equal(audits.response.status, 200);
    assert.deepEqual(
      new Set(audits.body.data.map((item) => item.action)),
      new Set(["CREATE", "UPDATE"]),
    );
    assert.equal(audits.body.data.every((item) => item.entityType === "SHIPMENT_VOYAGE"), true);

    const temporaryAssignment = await call<{ id: string }>(
      "/plant-jetty-assignments",
      json("POST", { plantId: loadingPlantId, jettyId: dischargeJettyId }),
      admin.accessToken,
    );
    assert.equal(temporaryAssignment.response.status, 201);
    const temporaryAssignmentId = temporaryAssignment.body.data.id;
    const removedAssignment = await call<unknown>(
      `/plant-jetty-assignments/${temporaryAssignmentId}`,
      { method: "DELETE" },
      admin.accessToken,
    );
    assert.equal(removedAssignment.response.status, 200);
    const assignmentAudits = await call<Array<{ action: string }>>(
      `/audit-logs?entityId=${temporaryAssignmentId}&limit=100`,
      undefined,
      admin.accessToken,
    );
    assert.deepEqual(
      new Set(assignmentAudits.body.data.map((item) => item.action)),
      new Set(["CREATE", "DELETE"]),
    );

    const origin = await prisma.terminal.create({ data: { code: `OL${suffix}`, name: `Origin Legacy ${suffix}` } });
    terminalId = origin.id;
    const destination = await prisma.terminal.create({ data: { code: `DL${suffix}`, name: `Destination Legacy ${suffix}` } });
    destinationTerminalId = destination.id;
    const legacy = await call<{ id: string; shipmentNumber: null }>(
      "/reports",
      json("POST", {
        reportNo: `LEGACY-${suffix}`,
        vesselId,
        originTerminalId: terminalId,
        destinationTerminalId,
        reportDateTime: new Date().toISOString(),
      }),
    );
    assert.equal(legacy.response.status, 201, JSON.stringify(legacy.body));
    assert.equal(legacy.body.data.shipmentNumber, null);
    reportIds.push(legacy.body.data.id);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.user.id, operator.user.id] } } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.plantJettyAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    if (terminalId) await prisma.terminal.delete({ where: { id: terminalId } }).catch(() => {});
    if (destinationTerminalId) await prisma.terminal.delete({ where: { id: destinationTerminalId } }).catch(() => {});
    if (loadingJettyId) await prisma.jetty.delete({ where: { id: loadingJettyId } }).catch(() => {});
    if (dischargeJettyId) await prisma.jetty.delete({ where: { id: dischargeJettyId } }).catch(() => {});
    if (loadingPlantId) await prisma.plant.delete({ where: { id: loadingPlantId } }).catch(() => {});
    if (dischargePlantId) await prisma.plant.delete({ where: { id: dischargePlantId } }).catch(() => {});
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    if (inactiveProductId) await prisma.product.delete({ where: { id: inactiveProductId } }).catch(() => {});
    if (unsupportedActivityId) await prisma.activity.delete({ where: { id: unsupportedActivityId } }).catch(() => {});
    await prisma.activity.deleteMany({ where: { id: { in: createdActivityIds } } });
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [admin.user.id, operator.user.id] } } });
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.$disconnect();
  }
});
