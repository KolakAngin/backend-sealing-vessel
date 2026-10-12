import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
};

let accessToken = "";

async function requestJson<T>(url: string, init?: RequestInit) {
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

test("CRUD master data dan relasinya", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const identity = await createTestIdentity();
  accessToken = identity.accessToken;

  let vesselId: string | undefined;
  let compartmentId: string | undefined;
  let categoryId: string | undefined;
  let templateId: string | undefined;
  let vesselPointId: string | undefined;

  try {
    const vessel = await requestJson<{ id: string; name: string }>(`${api}/vessels`, jsonRequest("POST", {
      name: `Vessel Test ${suffix}`,
      imoNumber: `IMO-${suffix}`,
      vesselType: "TANKER",
      compartments: [{ code: "INIT", name: "Initial Compartment", sequence: 99 }],
    }));
    assert.equal(vessel.response.status, 201);
    vesselId = vessel.body.data.id;

    const compartment = await requestJson<{ id: string; code: string }>(`${api}/compartments`, jsonRequest("POST", {
      vesselId,
      code: "1p-test",
      name: "Compartment Test",
      side: "PORT",
      sequence: 1,
    }));
    assert.equal(compartment.response.status, 201);
    assert.equal(compartment.body.data.code, "1P-TEST");
    compartmentId = compartment.body.data.id;

    const category = await requestJson<{ id: string; code: string }>(`${api}/sealing-categories`, jsonRequest("POST", {
      code: `Z${suffix.slice(0, 4)}`,
      name: `Kategori Test ${suffix}`,
      sequence: 999,
    }));
    assert.equal(category.response.status, 201);
    categoryId = category.body.data.id;

    const template = await requestJson<{ id: string }>(`${api}/sealing-point-templates`, jsonRequest("POST", {
      categoryId,
      code: `ZT-${suffix}`,
      name: `Template Test ${suffix}`,
      requiresCompartment: true,
      supportsSide: true,
      sequence: 1,
    }));
    assert.equal(template.response.status, 201);
    templateId = template.body.data.id;

    const missingCompartment = await requestJson<unknown>(`${api}/vessel-sealing-points`, jsonRequest("POST", {
      vesselId,
      sealingPointTemplateId: templateId,
      code: `INVALID-${suffix}`,
      side: "PORT",
    }));
    assert.equal(missingCompartment.response.status, 400);

    const vesselPoint = await requestJson<{ id: string }>(`${api}/vessel-sealing-points`, jsonRequest("POST", {
      vesselId,
      sealingPointTemplateId: templateId,
      compartmentId,
      code: `VP-${suffix}`,
      displayName: "Titik Test",
      side: "PORT",
      sequence: 1,
    }));
    assert.equal(vesselPoint.response.status, 201);
    vesselPointId = vesselPoint.body.data.id;

    const nestedCompartments = await requestJson<Array<{ id: string }>>(`${api}/vessels/${vesselId}/compartments`);
    assert.equal(nestedCompartments.response.status, 200);
    assert.equal(nestedCompartments.body.data.some((item) => item.id === compartmentId), true);

    const nestedTemplates = await requestJson<Array<{ id: string }>>(`${api}/sealing-categories/${categoryId}/templates`);
    assert.equal(nestedTemplates.response.status, 200);
    assert.equal(nestedTemplates.body.data.some((item) => item.id === templateId), true);

    const nestedPoints = await requestJson<Array<{ id: string }>>(`${api}/vessels/${vesselId}/sealing-points`);
    assert.equal(nestedPoints.response.status, 200);
    assert.equal(nestedPoints.body.data.some((item) => item.id === vesselPointId), true);

    for (const [path, body] of [
      [`vessels/${vesselId}`, { owner: "Owner Updated" }],
      [`compartments/${compartmentId}`, { name: "Compartment Updated" }],
      [`sealing-categories/${categoryId}`, { name: "Kategori Updated" }],
      [`sealing-point-templates/${templateId}`, { name: "Template Updated" }],
      [`vessel-sealing-points/${vesselPointId}`, { displayName: "Titik Updated" }],
    ] as const) {
      const updated = await requestJson<unknown>(`${api}/${path}`, jsonRequest("PATCH", body));
      assert.equal(
        updated.response.status,
        200,
        `${path}: ${JSON.stringify(updated.body)}`,
      );
    }

    for (const path of [
      `vessel-sealing-points/${vesselPointId}`,
      `compartments/${compartmentId}`,
      `sealing-point-templates/${templateId}`,
      `sealing-categories/${categoryId}`,
      `vessels/${vesselId}`,
    ]) {
      const removed = await requestJson<{ isActive: boolean }>(`${api}/${path}`, { method: "DELETE" });
      assert.equal(removed.response.status, 200);
      assert.equal(removed.body.data.isActive, false);
    }

    for (const entityId of [vesselId, compartmentId, categoryId, templateId, vesselPointId]) {
      assert.ok(entityId);
      const actions = await prisma.auditLog.findMany({
        where: { entityId, userId: identity.user.id },
        select: { action: true },
      });
      assert.deepEqual(new Set(actions.map((entry: { action: string }) => entry.action)), new Set(["CREATE", "UPDATE", "DELETE"]));
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: identity.user.id } });
    if (vesselPointId) await prisma.vesselSealingPoint.delete({ where: { id: vesselPointId } }).catch(() => {});
    if (compartmentId) await prisma.compartment.delete({ where: { id: compartmentId } }).catch(() => {});
    if (templateId) await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (categoryId) await prisma.sealingCategory.delete({ where: { id: categoryId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.delete({ where: { id: identity.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});

test("nested vessel master mengembalikan data di atas 10 dan count hanya menghitung titik eligible", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}/api/v1`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const identity = await createTestIdentity();
  accessToken = identity.accessToken;

  let vesselId: string | undefined;
  let templateId: string | undefined;

  try {
    const vessel = await prisma.vessel.create({
      data: {
        name: `Pagination Vessel ${suffix}`,
        compartments: {
          create: Array.from({ length: 11 }, (_, index) => ({
            code: `C${String(index + 1).padStart(2, "0")}-${suffix}`,
            name: `Compartment ${index + 1}`,
            sequence: 1,
            isActive: true,
          })),
        },
      },
      include: { compartments: { orderBy: { sequence: "asc" } } },
    });
    vesselId = vessel.id;

    const category = await prisma.sealingCategory.findFirst({
      where: { code: { in: ["A", "B", "C", "D", "E", "F", "G", "H"] }, isActive: true },
      orderBy: { sequence: "asc" },
    });
    assert.ok(category, "Kategori aktif A-H dari seed test wajib tersedia");
    const template = await prisma.sealingPointTemplate.create({
      data: {
        categoryId: category.id,
        code: `ZP-${suffix}`,
        name: `Pagination Template ${suffix}`,
        requiresCompartment: true,
        supportsSide: false,
        sequence: 1,
      },
    });
    templateId = template.id;

    await prisma.vesselSealingPoint.createMany({
      data: Array.from({ length: 11 }, (_, index) => ({
        vesselId: vessel.id,
        sealingPointTemplateId: template.id,
        compartmentId: vessel.compartments[index]!.id,
        code: `POINT-${String(index + 1).padStart(2, "0")}-${suffix}`,
        sequence: index + 1,
        isActive: index !== 9,
        availability: index === 9 ? "INACTIVE" : index === 10 ? "NOT_AVAILABLE" : "AVAILABLE",
      })),
    });

    const compartments = await requestJson<Array<{ id: string; code: string }>>(
      `${api}/vessels/${vessel.id}/compartments`,
    );
    assert.equal(compartments.response.status, 200);
    assert.equal(compartments.body.data.length, 11);
    assert.equal(compartments.body.data.some((item) => item.code === `C11-${suffix}`), true);
    assert.deepEqual(compartments.body.meta, { page: 1, limit: 100, total: 11, totalPages: 1 });

    const firstPage = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/compartments?page=1&limit=10&sortBy=sequence`,
    );
    const secondPage = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/compartments?page=2&limit=10&sortBy=sequence`,
    );
    const repeatedFirstPage = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/compartments?page=1&limit=10&sortBy=sequence`,
    );
    assert.equal(firstPage.body.data.length, 10);
    assert.equal(secondPage.body.data.length, 1);
    assert.deepEqual(firstPage.body.data.map((item) => item.id), repeatedFirstPage.body.data.map((item) => item.id));
    assert.equal(new Set([...firstPage.body.data, ...secondPage.body.data].map((item) => item.id)).size, 11);
    assert.deepEqual(secondPage.body.meta, { page: 2, limit: 10, total: 11, totalPages: 2 });

    const pagePastEnd = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/compartments?page=99&limit=10&sortBy=sequence`,
    );
    assert.deepEqual(pagePastEnd.body.data.map((item) => item.id), secondPage.body.data.map((item) => item.id));
    assert.deepEqual(pagePastEnd.body.meta, { page: 2, limit: 10, total: 11, totalPages: 2 });

    const emptyPagePastEnd = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/compartments?page=99&limit=10&search=${encodeURIComponent(`NONE-${suffix}`)}`,
    );
    assert.deepEqual(emptyPagePastEnd.body.data, []);
    assert.deepEqual(emptyPagePastEnd.body.meta, { page: 1, limit: 10, total: 0, totalPages: 1 });

    const allPoints = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/sealing-points`,
    );
    assert.equal(allPoints.response.status, 200);
    assert.equal(allPoints.body.data.length, 11);
    assert.deepEqual(allPoints.body.meta, { page: 1, limit: 100, total: 11, totalPages: 1 });

    const activePoints = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/sealing-points?isActive=true`,
    );
    assert.equal(activePoints.response.status, 200);
    assert.equal(activePoints.body.data.length, 10);
    assert.deepEqual(activePoints.body.meta, { page: 1, limit: 100, total: 10, totalPages: 1 });

    const snapshotEligiblePoints = await requestJson<Array<{ id: string }>>(
      `${api}/vessels/${vessel.id}/sealing-points?isActive=true&availability=AVAILABLE`,
    );
    assert.equal(snapshotEligiblePoints.response.status, 200);
    assert.equal(snapshotEligiblePoints.body.data.length, 9);
    assert.deepEqual(snapshotEligiblePoints.body.meta, { page: 1, limit: 100, total: 9, totalPages: 1 });

    const vessels = await requestJson<Array<{
      id: string;
      _count: { compartments: number; sealingPoints: number; sealingReports: number };
    }>>(`${api}/vessels?search=${encodeURIComponent(`Pagination Vessel ${suffix}`)}&limit=100`);
    assert.equal(vessels.response.status, 200);
    const vesselSummary = vessels.body.data.find((item) => item.id === vessel.id);
    assert.ok(vesselSummary);
    assert.equal(vesselSummary._count.compartments, 11);
    assert.equal(vesselSummary._count.sealingPoints, 9);
  } finally {
    if (vesselId) await prisma.vesselSealingPoint.deleteMany({ where: { vesselId } });
    if (vesselId) await prisma.compartment.deleteMany({ where: { vesselId } });
    if (templateId) await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.auditLog.deleteMany({ where: { userId: identity.user.id } });
    await prisma.user.delete({ where: { id: identity.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
