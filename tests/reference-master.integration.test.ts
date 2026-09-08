import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type ApiResponse<T> = { success: boolean; message: string; data: T };

async function requestJson<T>(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authorizationHeaders(accessToken),
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  return { response, body };
}

const jsonRequest = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("CRUD master workbook, otorisasi admin, dan spesifikasi vessel", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const admin = await createTestIdentity("ADMIN");
  const viewer = await createTestIdentity("VIEWER");
  const supervisor = await createTestIdentity("SUPERVISOR");

  const createdIds: Record<string, string> = {};
  let vesselId: string | undefined;

  const masters = [
    { key: "plant", path: "plants", create: { code: `P${suffix}`, name: `Plant ${suffix}`, sequence: 901 }, update: { name: `Plant Updated ${suffix}` }, expectedCode: `P${suffix}` },
    { key: "jetty", path: "jetties", create: { name: `Jetty ${suffix}`, sequence: 902 }, update: { name: `Jetty Updated ${suffix}` } },
    { key: "activity", path: "activities", create: { code: `A${suffix}`, name: `Activity ${suffix}`, sequence: 903 }, update: { name: `Activity Updated ${suffix}` }, expectedCode: `A${suffix}` },
    { key: "product", path: "products", create: { name: `Product ${suffix}`, sequence: 904 }, update: { name: `Product Updated ${suffix}` } },
    { key: "unit", path: "units-of-measure", create: { code: `u${suffix}`, sequence: 905 }, update: { sequence: 906 }, expectedCode: `U${suffix}` },
  ] as const;

  try {
    const forbidden = await requestJson<unknown>(
      `${api}/plants`,
      viewer.accessToken,
      jsonRequest("POST", { code: `X${suffix}`, name: "Tidak boleh dibuat" }),
    );
    assert.equal(forbidden.response.status, 403);
    const supervisorForbidden = await requestJson<unknown>(
      `${api}/products`,
      supervisor.accessToken,
      jsonRequest("POST", { name: `Supervisor ${suffix}` }),
    );
    assert.equal(supervisorForbidden.response.status, 403);

    for (const master of masters) {
      const created = await requestJson<{ id: string; code?: string }>(
        `${api}/${master.path}`,
        admin.accessToken,
        jsonRequest("POST", master.create),
      );
      assert.equal(created.response.status, 201, `${master.path}: ${JSON.stringify(created.body)}`);
      createdIds[master.key] = created.body.data.id;
      if ("expectedCode" in master) assert.equal(created.body.data.code, master.expectedCode);

      const listed = await requestJson<Array<{ id: string }>>(
        `${api}/${master.path}?search=${suffix}&limit=100`,
        viewer.accessToken,
      );
      assert.equal(listed.response.status, 200);
      assert.equal(listed.body.data.some((item) => item.id === created.body.data.id), true);

      const detail = await requestJson<{ id: string }>(
        `${api}/${master.path}/${created.body.data.id}`,
        viewer.accessToken,
      );
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.data.id, created.body.data.id);

      const updated = await requestJson<{ id: string }>(
        `${api}/${master.path}/${created.body.data.id}`,
        admin.accessToken,
        jsonRequest("PATCH", master.update),
      );
      assert.equal(updated.response.status, 200, `${master.path}: ${JSON.stringify(updated.body)}`);
    }

    const vessel = await requestJson<{
      id: string;
      vesselType: string;
      productGroup: string;
      owner: string;
      deadweightTonnage: string | number;
      capacity: string | number;
      tankCount: number;
      drawingStatus: string;
      drawingFileUrl: string;
      drawingLink: string;
    }>(`${api}/vessels`, admin.accessToken, jsonRequest("POST", {
      name: `Vessel Master ${suffix}`,
      vesselType: "MT",
      productGroup: "LPG",
      owner: "Pemilik Test",
      deadweightTonnage: 12500.125,
      capacity: 9000.5,
      tankCount: 2,
      drawingStatus: "YES",
      drawingFileUrl: `drawings/${suffix}.pdf`,
      drawingLink: `https://example.test/drawings/${suffix}`,
      compartments: [{ code: "T1", name: "Tank 1", sequence: 1 }],
    }));
    assert.equal(vessel.response.status, 201, JSON.stringify(vessel.body));
    vesselId = vessel.body.data.id;
    assert.equal(vessel.body.data.vesselType, "MT");
    assert.equal(vessel.body.data.productGroup, "LPG");
    assert.equal(vessel.body.data.owner, "Pemilik Test");
    assert.equal(Number(vessel.body.data.deadweightTonnage), 12500.125);
    assert.equal(Number(vessel.body.data.capacity), 9000.5);
    assert.equal(vessel.body.data.tankCount, 2);
    assert.equal(vessel.body.data.drawingStatus, "YES");

    const invalidVessel = await requestJson<unknown>(
      `${api}/vessels/${vesselId}`,
      admin.accessToken,
      jsonRequest("PATCH", { deadweightTonnage: -1 }),
    );
    assert.equal(invalidVessel.response.status, 400);

    const updatedVessel = await requestJson<{ vesselType: string; drawingStatus: string; drawingFileUrl: null }>(
      `${api}/vessels/${vesselId}`,
      admin.accessToken,
      jsonRequest("PATCH", { vesselType: "OB", drawingStatus: "NO", drawingFileUrl: null }),
    );
    assert.equal(updatedVessel.response.status, 200);
    assert.equal(updatedVessel.body.data.vesselType, "OB");
    assert.equal(updatedVessel.body.data.drawingStatus, "NO");
    assert.equal(updatedVessel.body.data.drawingFileUrl, null);

    for (const master of masters) {
      const removed = await requestJson<{ isActive: boolean }>(
        `${api}/${master.path}/${createdIds[master.key]}`,
        admin.accessToken,
        { method: "DELETE" },
      );
      assert.equal(removed.response.status, 200);
      assert.equal(removed.body.data.isActive, false);
    }

    for (const entityId of Object.values(createdIds)) {
      const actions = await prisma.auditLog.findMany({ where: { entityId, userId: admin.user.id }, select: { action: true } });
      assert.deepEqual(new Set(actions.map((entry: { action: string }) => entry.action)), new Set(["CREATE", "UPDATE", "DELETE"]));
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [admin.user.id, viewer.user.id, supervisor.user.id] } } });
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    if (createdIds.plant) await prisma.plant.delete({ where: { id: createdIds.plant } }).catch(() => {});
    if (createdIds.jetty) await prisma.jetty.delete({ where: { id: createdIds.jetty } }).catch(() => {});
    if (createdIds.activity) await prisma.activity.delete({ where: { id: createdIds.activity } }).catch(() => {});
    if (createdIds.product) await prisma.product.delete({ where: { id: createdIds.product } }).catch(() => {});
    if (createdIds.unit) await prisma.unitOfMeasure.delete({ where: { id: createdIds.unit } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [admin.user.id, viewer.user.id, supervisor.user.id] } } }).catch(() => {});
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
