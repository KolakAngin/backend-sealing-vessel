import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
type SealResponse = { id: string; sealNumber: string; status: string };

const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("nomor segel unik per shipment pada create, update, replace, dan request concurrent", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const operator = await createTestIdentity("LOADING_MASTER");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const call = async <T>(path: string, init?: RequestInit) => {
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        ...authorizationHeaders(operator.accessToken),
        ...Object.fromEntries(new Headers(init?.headers)),
      },
    });
    return { response, body: await response.json() as Api<T> };
  };

  let vesselId = "";
  let originTerminalId = "";
  let destinationTerminalId = "";
  let categoryId = "";
  let templateId = "";
  const pointIds: string[] = [];
  const reportIds: string[] = [];

  try {
    const vessel = await prisma.vessel.create({ data: { name: `Seal Scope Vessel ${suffix}` } });
    vesselId = vessel.id;
    const origin = await prisma.terminal.create({ data: { code: `SO${suffix}`.slice(0, 20), name: `Seal Origin ${suffix}` } });
    originTerminalId = origin.id;
    const destination = await prisma.terminal.create({ data: { code: `SD${suffix}`.slice(0, 20), name: `Seal Destination ${suffix}` } });
    destinationTerminalId = destination.id;
    const category = await prisma.sealingCategory.create({
      data: { code: `U${suffix.slice(0, 4)}`, name: `Seal Uniqueness ${suffix}`, sequence: 998 },
    });
    categoryId = category.id;
    const template = await prisma.sealingPointTemplate.create({
      data: { categoryId, code: `UNIQ-${suffix}`, name: `Uniqueness ${suffix}`, sequence: 1 },
    });
    templateId = template.id;
    for (const serial of [1, 2]) {
      const point = await prisma.vesselSealingPoint.create({
        data: {
          vesselId,
          sealingPointTemplateId: templateId,
          code: `UNIQ-${serial}-${suffix}`,
          instanceNo: serial,
          sequence: serial,
        },
      });
      pointIds.push(point.id);
    }

    const createReport = async (serial: number) => {
      const created = await call<{ id: string }>("/reports", json("POST", {
        reportNo: `UNIQ-RPT-${serial}-${suffix}`,
        vesselId,
        originTerminalId,
        destinationTerminalId,
        reportDateTime: new Date().toISOString(),
      }));
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
      reportIds.push(created.body.data.id);
      return created.body.data.id;
    };
    const createRecord = async (reportId: string, pointId: string) => {
      const created = await call<{ id: string }>(`/reports/${reportId}/records`, json("POST", {
        vesselSealingPointId: pointId,
        status: "NOT_SEALED",
      }));
      assert.equal(created.response.status, 201, JSON.stringify(created.body));
      return created.body.data.id;
    };

    const firstReportId = await createReport(1);
    const secondReportId = await createReport(2);
    const firstRecordId = await createRecord(firstReportId, pointIds[0]!);
    const secondRecordId = await createRecord(firstReportId, pointIds[1]!);
    const otherShipmentRecordId = await createRecord(secondReportId, pointIds[0]!);

    const sharedNumber = `SCOPE-${suffix}-001`;
    const firstSeal = await call<SealResponse>(
      `/records/${firstRecordId}/seals`,
      json("POST", { sealNumber: `  ${sharedNumber.toLowerCase()}  ` }),
    );
    assert.equal(firstSeal.response.status, 201, JSON.stringify(firstSeal.body));
    assert.equal(firstSeal.body.data.sealNumber, sharedNumber);

    const duplicateSameShipment = await call<unknown>(
      `/records/${secondRecordId}/seals`,
      json("POST", { sealNumber: sharedNumber.toLowerCase() }),
    );
    assert.equal(duplicateSameShipment.response.status, 409, JSON.stringify(duplicateSameShipment.body));

    const reusedOtherShipment = await call<SealResponse>(
      `/records/${otherShipmentRecordId}/seals`,
      json("POST", { sealNumber: sharedNumber.toLowerCase() }),
    );
    assert.equal(reusedOtherShipment.response.status, 201, JSON.stringify(reusedOtherShipment.body));
    assert.equal(reusedOtherShipment.body.data.sealNumber, sharedNumber);

    const updateCandidate = await call<SealResponse>(
      `/records/${secondRecordId}/seals`,
      json("POST", { sealNumber: `SCOPE-${suffix}-UPDATE` }),
    );
    assert.equal(updateCandidate.response.status, 201, JSON.stringify(updateCandidate.body));
    const duplicateUpdate = await call<unknown>(
      `/seals/${updateCandidate.body.data.id}`,
      json("PATCH", { sealNumber: sharedNumber.toLowerCase() }),
    );
    assert.equal(duplicateUpdate.response.status, 409, JSON.stringify(duplicateUpdate.body));

    const replacementNumber = `SCOPE-${suffix}-REPLACEMENT`;
    const replacement = await call<SealResponse>(
      `/seals/${firstSeal.body.data.id}/replace`,
      json("POST", { sealNumber: replacementNumber }),
    );
    assert.equal(replacement.response.status, 201, JSON.stringify(replacement.body));
    const reuseReplacedNumber = await call<unknown>(
      `/records/${secondRecordId}/seals`,
      json("POST", { sealNumber: sharedNumber }),
    );
    assert.equal(reuseReplacedNumber.response.status, 409, JSON.stringify(reuseReplacedNumber.body));

    const removable = await call<SealResponse>(
      `/records/${firstRecordId}/seals`,
      json("POST", { sealNumber: `SCOPE-${suffix}-REMOVED` }),
    );
    assert.equal(removable.response.status, 201, JSON.stringify(removable.body));
    const removed = await call<SealResponse>(`/seals/${removable.body.data.id}/remove`, json("POST", {}));
    assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
    const reuseRemovedNumber = await call<unknown>(
      `/records/${secondRecordId}/seals`,
      json("POST", { sealNumber: removable.body.data.sealNumber.toLowerCase() }),
    );
    assert.equal(reuseRemovedNumber.response.status, 409, JSON.stringify(reuseRemovedNumber.body));
    const renameRemovedNumber = await call<unknown>(
      `/seals/${removable.body.data.id}`,
      json("PATCH", { sealNumber: `SCOPE-${suffix}-RENAMED-HISTORY` }),
    );
    assert.equal(renameRemovedNumber.response.status, 400, JSON.stringify(renameRemovedNumber.body));
    assert.equal((await prisma.seal.findUnique({ where: { id: removable.body.data.id } }))?.sealNumber, removable.body.data.sealNumber);

    const replaceCollisionSource = await call<SealResponse>(
      `/records/${secondRecordId}/seals`,
      json("POST", { sealNumber: `SCOPE-${suffix}-REPLACE-SOURCE` }),
    );
    assert.equal(replaceCollisionSource.response.status, 201, JSON.stringify(replaceCollisionSource.body));
    const duplicateReplace = await call<unknown>(
      `/seals/${replaceCollisionSource.body.data.id}/replace`,
      json("POST", { sealNumber: replacementNumber.toLowerCase() }),
    );
    assert.equal(duplicateReplace.response.status, 409, JSON.stringify(duplicateReplace.body));
    const sourceAfterRollback = await prisma.seal.findUnique({ where: { id: replaceCollisionSource.body.data.id } });
    assert.equal(sourceAfterRollback?.status, "INSTALLED");

    const concurrentNumber = `SCOPE-${suffix}-CONCURRENT`;
    const concurrentResponses = await Promise.all([
      call<SealResponse>(`/records/${firstRecordId}/seals`, json("POST", { sealNumber: concurrentNumber })),
      call<SealResponse>(`/records/${secondRecordId}/seals`, json("POST", { sealNumber: concurrentNumber.toLowerCase() })),
    ]);
    assert.deepEqual(concurrentResponses.map((result) => result.response.status).sort(), [201, 409]);
    assert.equal(await prisma.seal.count({ where: { sealingReportId: firstReportId, sealNumber: concurrentNumber } }), 1);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: operator.user.id } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.vesselSealingPoint.deleteMany({ where: { id: { in: pointIds } } });
    if (templateId) await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    if (categoryId) await prisma.sealingCategory.delete({ where: { id: categoryId } }).catch(() => {});
    if (originTerminalId) await prisma.terminal.delete({ where: { id: originTerminalId } }).catch(() => {});
    if (destinationTerminalId) await prisma.terminal.delete({ where: { id: destinationTerminalId } }).catch(() => {});
    if (vesselId) await prisma.vessel.delete({ where: { id: vesselId } }).catch(() => {});
    await prisma.user.delete({ where: { id: operator.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await prisma.$disconnect();
  }
});
