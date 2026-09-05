import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type ApiResponse<T> = { success: boolean; message: string; data: T };

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
  } finally {
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
