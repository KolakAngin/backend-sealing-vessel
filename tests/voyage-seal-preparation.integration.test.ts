import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
type Prepared = {
  reportId: string;
  formVersion: { id: string; code: string };
  vesselFormProfileId: string;
  sectionCount: number;
  compartmentCount: number;
  pointCount: number;
  readyCount: number;
  createdCount: number;
  reusedSnapshot: boolean;
};

const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Snapshot form aktual A-H bersifat lengkap, immutable, dan idempotent", async () => {
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
    return { response, body: (await response.json()) as Api<T> };
  };

  const reportIds: string[] = [];
  const vesselIds: string[] = [];
  const templateIds: string[] = [];
  const createdCategoryIds: string[] = [];
  let createdFormVersionId: string | undefined;
  let createdActivityId: string | undefined;
  let productId = "";
  let loadingPlantId = "";
  let dischargePlantId = "";
  let loadingJettyId = "";
  let dischargeJettyId = "";
  let assignmentId = "";
  let dischargeAssignmentId = "";

  try {
    const categoryByCode = new Map<string, { id: string; code: string; sequence: number }>();
    for (const [index, code] of ["A", "B", "C", "D", "E", "F", "G", "H"].entries()) {
      let category = await prisma.sealingCategory.findUnique({ where: { code } });
      if (!category) {
        category = await prisma.sealingCategory.create({
          data: { code, name: `Section ${code}`, sequence: index + 1, isActive: true },
        });
        createdCategoryIds.push(category.id);
      }
      categoryByCode.set(code, category);
    }
    const categoryA = categoryByCode.get("A");
    const categoryG = categoryByCode.get("G");
    assert.ok(categoryA);
    assert.ok(categoryG);

    let formVersion = await prisma.formTkoVersion.findUnique({
      where: { code: "FORM-SEGEL-TKO-EDIT1" },
    });
    if (!formVersion) {
      formVersion = await prisma.formTkoVersion.create({
        data: {
          code: "FORM-SEGEL-TKO-EDIT1",
          name: "Form Segel Baru sesuai TKO (edit1)",
          revision: "edit1",
          isActive: true,
        },
      });
      createdFormVersionId = formVersion.id;
    }
    assert.equal(formVersion.isActive, true);

    const createTemplate = async (categoryId: string, code: string, requiresCompartment: boolean) => {
      const template = await prisma.sealingPointTemplate.create({
        data: {
          categoryId,
          code,
          name: code,
          requiresCompartment,
          supportsSide: false,
          sequence: templateIds.length + 100,
          isActive: true,
        },
      });
      templateIds.push(template.id);
      return template;
    };
    const templateA1 = await createTemplate(categoryA.id, `A-T1-${suffix}`, true);
    const templateA2 = await createTemplate(categoryA.id, `A-T2-${suffix}`, true);
    const templateG = await createTemplate(categoryG.id, `G-T1-${suffix}`, false);

    let systemCategory = await prisma.sealingCategory.findUnique({ where: { code: "SYSC" } });
    if (!systemCategory) {
      systemCategory = await prisma.sealingCategory.create({
        data: { code: "SYSC", name: "Legacy System Compartment", sequence: 999 },
      });
    }
    let systemTemplate = await prisma.sealingPointTemplate.findUnique({
      where: { code: "SYS-COMPARTMENT" },
    });
    if (!systemTemplate) {
      systemTemplate = await prisma.sealingPointTemplate.create({
        data: {
          categoryId: systemCategory.id,
          code: "SYS-COMPARTMENT",
          name: "Legacy Compartment Point",
          requiresCompartment: true,
          supportsSide: true,
          sequence: 999,
        },
      });
    }

    const activityExisting = await prisma.activity.findUnique({ where: { code: "LOADING" } });
    const activity = activityExisting ?? await prisma.activity.create({
      data: { code: "LOADING", name: "LOADING", isActive: true },
    });
    if (!activityExisting) createdActivityId = activity.id;
    assert.equal(activity.isActive, true);
    const product = await prisma.product.create({ data: { name: `Snapshot Product ${suffix}` } });
    productId = product.id;
    const loadingPlant = await prisma.plant.create({ data: { code: `SL${suffix}`, name: `Snapshot Loading ${suffix}` } });
    loadingPlantId = loadingPlant.id;
    const dischargePlant = await prisma.plant.create({ data: { code: `SD${suffix}`, name: `Snapshot Discharge ${suffix}` } });
    dischargePlantId = dischargePlant.id;
    const loadingJetty = await prisma.jetty.create({ data: { name: `Snapshot Loading Jetty ${suffix}` } });
    loadingJettyId = loadingJetty.id;
    const dischargeJetty = await prisma.jetty.create({ data: { name: `Snapshot Discharge Jetty ${suffix}` } });
    dischargeJettyId = dischargeJetty.id;
    const loadingAssignment = await prisma.plantJettyAssignment.create({ data: { plantId: loadingPlantId, jettyId: loadingJettyId } });
    assignmentId = loadingAssignment.id;
    const dischargeAssignment = await prisma.plantJettyAssignment.create({ data: { plantId: dischargePlantId, jettyId: dischargeJettyId } });
    dischargeAssignmentId = dischargeAssignment.id;

    const createProfile = async (vesselId: string, availableCodes: string[]) => {
      const profile = await prisma.vesselFormProfile.create({
        data: {
          vesselId,
          formVersionId: formVersion.id,
          name: `Profile ${suffix}`,
          isActive: true,
          activatedAt: new Date(),
        },
      });
      await prisma.vesselFormSection.createMany({
        data: [...categoryByCode.values()].map((category) => ({
          vesselFormProfileId: profile.id,
          categoryId: category.id,
          sequence: category.sequence,
          isAvailable: availableCodes.includes(category.code),
        })),
      });
      return profile;
    };

    const createReport = async (vesselId: string, serial: string) => {
      const report = await prisma.sealingReport.create({
        data: {
          reportNo: `SNAP-RPT-${suffix}-${serial}`,
          shipmentNumber: `SNAP-SHP-${suffix}-${serial}`,
          voyageNumber: `SNAP-VOY-${suffix}-${serial}`,
          vesselId,
          activityId: activity.id,
          productId,
          loadingPlantId,
          loadingJettyId,
          dischargePlantId,
          dischargeJettyId,
          sealingStatus: "READY",
          reportDateTime: new Date(),
          createdById: operator.user.id,
        },
      });
      reportIds.push(report.id);
      return report;
    };

    const queenCompartments = Array.from({ length: 7 }, (_, index) => [
      { code: `${index + 1}P`, name: `Compartment ${index + 1}P`, side: "PORT" as const, sequence: index * 2 + 1 },
      { code: `${index + 1}S`, name: `Compartment ${index + 1}S`, side: "STBD" as const, sequence: index * 2 + 2 },
    ]).flat();
    queenCompartments.push(
      { code: "SLOP-P", name: "Slop Port", side: "PORT", sequence: 15 },
      { code: "SLOP-S", name: "Slop Starboard", side: "STBD", sequence: 16 },
    );
    const queen = await prisma.vessel.create({
      data: {
        name: `OB. QUEEN SOFIA SNAPSHOT ${suffix}`,
        compartments: { create: queenCompartments },
      },
      include: { compartments: true },
    });
    vesselIds.push(queen.id);
    await createProfile(queen.id, ["A", "G"]);
    for (const compartment of queen.compartments) {
      for (const [index, template] of [templateA1, templateA2].entries()) {
        await prisma.vesselSealingPoint.create({
          data: {
            vesselId: queen.id,
            sealingPointTemplateId: template.id,
            compartmentId: compartment.id,
            code: `Q-${compartment.code}-${index + 1}-${suffix}`,
            sequence: index + 1,
          },
        });
      }
    }
    await prisma.vesselSealingPoint.create({
      data: {
        vesselId: queen.id,
        sealingPointTemplateId: templateG.id,
        code: `Q-G-${suffix}`,
      },
    });
    const queenReport = await createReport(queen.id, "QUEEN");
    const queenPrepared = await call<Prepared>(
      `/shipments/${queenReport.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(queenPrepared.response.status, 200, JSON.stringify(queenPrepared.body));
    assert.equal(queenPrepared.body.data.compartmentCount, 16);
    assert.equal(queenPrepared.body.data.sectionCount, 2);
    assert.equal(queenPrepared.body.data.pointCount, 33);
    assert.equal(queenPrepared.body.data.createdCount, 33);

    const three = await prisma.vessel.create({
      data: {
        name: `Three Compartment ${suffix}`,
        compartments: {
          create: [1, 2, 3].map((number) => ({
            code: `T${number}`,
            name: `Tank ${number}`,
            sequence: number,
          })),
        },
      },
      include: { compartments: true },
    });
    vesselIds.push(three.id);
    const threeProfile = await createProfile(three.id, ["A"]);
    const threePoints = [];
    for (const compartment of three.compartments) {
      for (const [index, template] of [templateA1, templateA2].entries()) {
        threePoints.push(await prisma.vesselSealingPoint.create({
          data: {
            vesselId: three.id,
            sealingPointTemplateId: template.id,
            compartmentId: compartment.id,
            code: `T-${compartment.code}-${index + 1}-${suffix}`,
            sequence: index + 1,
          },
        }));
      }
    }
    const unavailableGPoint = await prisma.vesselSealingPoint.create({
      data: {
        vesselId: three.id,
        sealingPointTemplateId: templateG.id,
        code: `T-G-${suffix}`,
        availability: "NOT_AVAILABLE",
      },
    });
    const legacyPoint = await prisma.vesselSealingPoint.create({
      data: {
        vesselId: three.id,
        sealingPointTemplateId: systemTemplate.id,
        compartmentId: three.compartments[0]!.id,
        code: `LEGACY-SYS-${suffix}`,
      },
    });
    const threeReport = await createReport(three.id, "THREE");
    const legacyRecord = await prisma.sealingRecord.create({
      data: {
        sealingReportId: threeReport.id,
        vesselSealingPointId: legacyPoint.id,
        createdById: operator.user.id,
        status: "SEALED",
      },
    });

    const threePrepared = await call<Prepared>(
      `/voyages/${threeReport.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(threePrepared.response.status, 200, JSON.stringify(threePrepared.body));
    assert.equal(threePrepared.body.data.compartmentCount, 3);
    assert.equal(threePrepared.body.data.sectionCount, 1);
    assert.equal(threePrepared.body.data.pointCount, 6);
    assert.equal(threePrepared.body.data.createdCount, 6);
    assert.equal(threePrepared.body.data.readyCount, 7);

    const generatedRecords = await prisma.sealingRecord.findMany({
      where: { sealingReportId: threeReport.id, id: { not: legacyRecord.id } },
    });
    assert.equal(generatedRecords.length, 6);
    assert.equal(generatedRecords.every((record: { status: string }) => record.status === "NOT_SEALED"), true);
    assert.equal(generatedRecords.every((record: { pointSnapshot: unknown }) => record.pointSnapshot !== null), true);
    assert.equal(generatedRecords.some((record: { vesselSealingPointId: string }) => record.vesselSealingPointId === unavailableGPoint.id), false);
    const persistedLegacy = await prisma.sealingRecord.findUnique({ where: { id: legacyRecord.id } });
    assert.equal(persistedLegacy?.status, "SEALED");
    assert.equal(persistedLegacy?.pointSnapshot, null);

    const snapshotBefore = await prisma.sealingReport.findUnique({
      where: { id: threeReport.id },
      select: { formConfigurationSnapshot: true },
    });
    assert.ok(snapshotBefore?.formConfigurationSnapshot);
    const firstPoint = threePoints[0]!;
    const firstCompartment = three.compartments[0]!;
    await prisma.vesselSealingPoint.update({
      where: { id: firstPoint.id },
      data: { code: `CHANGED-${suffix}`, displayName: "Changed after snapshot" },
    });
    await prisma.compartment.update({
      where: { id: firstCompartment.id },
      data: { name: "Changed compartment after snapshot" },
    });
    await prisma.vesselFormSection.update({
      where: {
        vesselFormProfileId_categoryId: {
          vesselFormProfileId: threeProfile.id,
          categoryId: categoryG.id,
        },
      },
      data: { isAvailable: true },
    });
    await prisma.vesselSealingPoint.update({
      where: { id: unavailableGPoint.id },
      data: { availability: "AVAILABLE" },
    });
    await prisma.vesselSealingPoint.create({
      data: {
        vesselId: three.id,
        sealingPointTemplateId: templateA1.id,
        compartmentId: firstCompartment.id,
        code: `NEW-AFTER-SNAPSHOT-${suffix}`,
        instanceNo: 2,
      },
    });

    const preparedAgain = await call<Prepared>(
      `/voyages/${threeReport.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(preparedAgain.response.status, 200);
    assert.equal(preparedAgain.body.data.reusedSnapshot, true);
    assert.equal(preparedAgain.body.data.createdCount, 0);
    assert.equal(preparedAgain.body.data.pointCount, 6);
    assert.equal(preparedAgain.body.data.readyCount, 7);
    const snapshotAfter = await prisma.sealingReport.findUnique({
      where: { id: threeReport.id },
      select: { formConfigurationSnapshot: true },
    });
    assert.deepEqual(snapshotAfter?.formConfigurationSnapshot, snapshotBefore.formConfigurationSnapshot);
    const firstRecord = await prisma.sealingRecord.findFirst({
      where: { sealingReportId: threeReport.id, vesselSealingPointId: firstPoint.id },
    });
    assert.equal((firstRecord?.pointSnapshot as { code?: string } | null)?.code, `T-${firstCompartment.code}-1-${suffix}`);

    const futureReport = await createReport(three.id, "FUTURE");
    const futurePrepared = await call<Prepared>(
      `/shipments/${futureReport.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(futurePrepared.response.status, 200);
    assert.equal(futurePrepared.body.data.sectionCount, 2);
    assert.equal(futurePrepared.body.data.pointCount, 8);

    const manualReport = await createReport(three.id, "MANUAL");
    const firstManual = await call<unknown>(
      `/reports/${manualReport.id}/records`,
      json("POST", { vesselSealingPointId: threePoints[0]!.id, status: "NOT_SEALED" }),
    );
    const secondManual = await call<unknown>(
      `/reports/${manualReport.id}/records`,
      json("POST", { vesselSealingPointId: threePoints[1]!.id, status: "NOT_SEALED" }),
    );
    assert.equal(firstManual.response.status, 201);
    assert.equal(secondManual.response.status, 201);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: operator.user.id } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.vessel.deleteMany({ where: { id: { in: vesselIds } } });
    for (const templateId of templateIds) {
      await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    }
    if (assignmentId) await prisma.plantJettyAssignment.delete({ where: { id: assignmentId } }).catch(() => {});
    if (dischargeAssignmentId) await prisma.plantJettyAssignment.delete({ where: { id: dischargeAssignmentId } }).catch(() => {});
    if (loadingJettyId) await prisma.jetty.delete({ where: { id: loadingJettyId } }).catch(() => {});
    if (dischargeJettyId) await prisma.jetty.delete({ where: { id: dischargeJettyId } }).catch(() => {});
    if (loadingPlantId) await prisma.plant.delete({ where: { id: loadingPlantId } }).catch(() => {});
    if (dischargePlantId) await prisma.plant.delete({ where: { id: dischargePlantId } }).catch(() => {});
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
    if (createdActivityId) await prisma.activity.delete({ where: { id: createdActivityId } }).catch(() => {});
    if (createdFormVersionId) await prisma.formTkoVersion.delete({ where: { id: createdFormVersionId } }).catch(() => {});
    await prisma.sealingCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.user.delete({ where: { id: operator.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.$disconnect();
  }
});
