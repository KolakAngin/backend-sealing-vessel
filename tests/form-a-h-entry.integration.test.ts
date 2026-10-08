import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type Api<T> = { success: boolean; message: string; data: T };
type FormColumn = {
  vesselSealingPointId: string;
  recordId: string | null;
  sectionSequence: number;
  rowSequence: number;
  columnSequence: number;
  compartment: { id: string; code: string; name: string; side: string | null } | null;
  side: string | null;
  instance: number;
  status: "SEALED" | "NOT_SEALED" | "NOT_APPLICABLE";
  notes: string | null;
  seals: Array<{ sealNumber: string }>;
};
type FormSection = {
  code: string;
  sequence: number;
  isAvailable: boolean;
  rows: Array<{ rowSequence: number; columns: FormColumn[] }>;
};
type GroupedForm = {
  report: { id: string; status: string; isEditable: boolean };
  sections: FormSection[];
};

const json = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Transaksi pengisian nomor segel A-H, grouping, validasi, dan audit", async () => {
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

  const vesselIds: string[] = [];
  const reportIds: string[] = [];
  const templateIds: string[] = [];
  const createdCategoryIds: string[] = [];
  let createdFormVersionId: string | undefined;

  try {
    const categories = new Map<string, { id: string; code: string; sequence: number }>();
    for (const [index, code] of ["A", "B", "C", "D", "E", "F", "G", "H"].entries()) {
      let category = await prisma.sealingCategory.findUnique({ where: { code } });
      if (!category) {
        category = await prisma.sealingCategory.create({
          data: { code, name: `Bagian ${code}`, sequence: index + 1, isActive: true },
        });
        createdCategoryIds.push(category.id);
      }
      assert.equal(category.isActive, true);
      categories.set(code, category);
    }

    let formVersion = await prisma.formTkoVersion.findUnique({ where: { code: "FORM-SEGEL-TKO-EDIT1" } });
    if (!formVersion) {
      formVersion = await prisma.formTkoVersion.create({
        data: { code: "FORM-SEGEL-TKO-EDIT1", name: "Form Segel Baru sesuai TKO (edit1)", revision: "edit1" },
      });
      createdFormVersionId = formVersion.id;
    }

    const createTemplate = async (sectionCode: string, serial: number, requiresCompartment: boolean) => {
      const category = categories.get(sectionCode);
      assert.ok(category);
      const template = await prisma.sealingPointTemplate.create({
        data: {
          categoryId: category.id,
          code: `STEP6-${sectionCode}-${serial}-${suffix}`,
          name: `Step 6 ${sectionCode} ${serial}`,
          requiresCompartment,
          supportsSide: true,
          sequence: serial,
          isActive: true,
        },
      });
      templateIds.push(template.id);
      return template;
    };

    const templatesBySection = new Map<string, Array<{ id: string; code: string }>>();
    templatesBySection.set("A", []);
    for (let serial = 1; serial <= 5; serial += 1) {
      templatesBySection.get("A")!.push(await createTemplate("A", serial, true));
    }
    for (const sectionCode of ["B", "C", "D", "E", "F", "G", "H"]) {
      templatesBySection.set(sectionCode, [await createTemplate(sectionCode, 1, false)]);
    }

    const createProfile = async (vesselId: string, availableCodes: string[]) => {
      const profile = await prisma.vesselFormProfile.create({
        data: {
          vesselId,
          formVersionId: formVersion.id,
          name: `STEP 6 ${suffix}`,
          isActive: true,
          activatedAt: new Date(),
        },
      });
      await prisma.vesselFormSection.createMany({
        data: [...categories.values()].map((category) => ({
          vesselFormProfileId: profile.id,
          categoryId: category.id,
          isAvailable: availableCodes.includes(category.code),
          sequence: category.sequence,
        })),
      });
      return profile;
    };

    const createLegacyReport = async (vesselId: string, serial: string) => {
      const report = await prisma.sealingReport.create({
        data: {
          reportNo: `STEP6-RPT-${suffix}-${serial}`,
          shipmentNumber: `STEP6-SHP-${suffix}-${serial}`,
          voyageNumber: `STEP6-VOY-${suffix}-${serial}`,
          vesselId,
          reportDateTime: new Date(),
          createdById: operator.user.id,
        },
      });
      reportIds.push(report.id);
      return report;
    };

    const vessel = await prisma.vessel.create({
      data: {
        name: `STEP 6 A-H ${suffix}`,
        compartments: {
          create: [
            { code: "1P", name: "Compartment 1P", side: "PORT", sequence: 1 },
            { code: "1S", name: "Compartment 1S", side: "STBD", sequence: 2 },
          ],
        },
      },
      include: { compartments: true },
    });
    vesselIds.push(vessel.id);
    await createProfile(vessel.id, ["A", "B", "C", "D", "E", "F", "G", "H"]);
    const compartment = vessel.compartments.find((item: { id: string; code: string }) => item.code === "1P");
    assert.ok(compartment);

    const pointBySection = new Map<string, string[]>();
    for (const [sectionCode, templates] of templatesBySection) {
      const sectionPoints: string[] = [];
      for (const [index, template] of templates.entries()) {
        const point = await prisma.vesselSealingPoint.create({
          data: {
            vesselId: vessel.id,
            sealingPointTemplateId: template.id,
            compartmentId: sectionCode === "A" ? compartment.id : null,
            code: `STEP6-${sectionCode}-POINT-${index + 1}-${suffix}`,
            side: sectionCode === "A" ? "PORT" : index % 2 === 0 ? "CENTER" : "STBD",
            instanceNo: 1,
            sequence: index + 1,
          },
        });
        sectionPoints.push(point.id);
      }
      pointBySection.set(sectionCode, sectionPoints);
    }

    const report = await createLegacyReport(vessel.id, "ALL");
    const prepared = await call<{ pointCount: number }>(
      `/shipments/${report.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(prepared.response.status, 200, JSON.stringify(prepared.body));
    assert.equal(prepared.body.data.pointCount, 12);

    const grouped = await call<GroupedForm>(`/shipments/${report.id}/form`);
    assert.equal(grouped.response.status, 200, JSON.stringify(grouped.body));
    assert.deepEqual(grouped.body.data.sections.map((section) => section.code), ["A", "B", "C", "D", "E", "F", "G", "H"]);
    assert.equal(grouped.body.data.sections.every((section) => section.isAvailable), true);
    const sectionA = grouped.body.data.sections.find((section) => section.code === "A");
    assert.ok(sectionA);
    assert.equal(sectionA.rows.length, 1);
    assert.equal(sectionA.rows[0]!.columns.length, 5);
    assert.deepEqual(sectionA.rows[0]!.columns.map((column) => column.columnSequence), [1, 2, 3, 4, 5]);
    for (const column of sectionA.rows[0]!.columns) {
      assert.equal(column.sectionSequence, 1);
      assert.equal(column.rowSequence, 1);
      assert.equal(column.compartment?.code, "1P");
      assert.equal(column.side, "PORT");
      assert.equal(column.instance, 1);
    }

    const aPoints = pointBySection.get("A")!;
    const batchA = await call<{ section: FormSection }>(
      `/voyages/${report.id}/form/sections/A`,
      json("PUT", {
        points: [
          { vesselSealingPointId: aPoints[0], status: "SEALED", notes: "Sounding", seals: [{ sealNumber: `a-${suffix}-01` }] },
          { vesselSealingPointId: aPoints[1], status: "SEALED", notes: "Dua segel", seals: [{ sealNumber: `a-${suffix}-02` }, { sealNumber: `a-${suffix}-03` }] },
          { vesselSealingPointId: aPoints[2], status: "NOT_APPLICABLE", notes: "Tidak digunakan", seals: [] },
          { vesselSealingPointId: aPoints[3], status: "NOT_SEALED", notes: null, seals: [] },
          { vesselSealingPointId: aPoints[4], status: "SEALED", notes: "Manhole", seals: [{ sealNumber: `a-${suffix}-04` }] },
        ],
      }),
    );
    assert.equal(batchA.response.status, 200, JSON.stringify(batchA.body));
    assert.equal(batchA.body.data.section.rows[0]!.columns.length, 5);
    assert.deepEqual(
      batchA.body.data.section.rows[0]!.columns.map((column) => column.status),
      ["SEALED", "SEALED", "NOT_APPLICABLE", "NOT_SEALED", "SEALED"],
    );

    for (const sectionCode of ["B", "C", "D", "E", "F", "H"]) {
      const sectionPoint = pointBySection.get(sectionCode)![0]!;
      const written = await call<{ point: FormColumn }>(
        `/shipments/${report.id}/form/points/${sectionPoint}`,
        json("PUT", {
          status: sectionCode === "C" ? "NOT_SEALED" : "NOT_APPLICABLE",
          notes: `Input Bagian ${sectionCode}`,
          seals: [],
        }),
      );
      assert.equal(written.response.status, 200, JSON.stringify(written.body));
      assert.equal(written.body.data.point.notes, `Input Bagian ${sectionCode}`);
    }

    const gPoint = pointBySection.get("G")![0]!;
    const multiSeal = await call<{ point: FormColumn }>(
      `/reports/${report.id}/form/points/${gPoint}`,
      json("PUT", {
        status: "SEALED",
        notes: "Tiga nomor pada satu equipment",
        seals: [
          { sealNumber: `g-${suffix}-01`, notes: "Slot 1" },
          { sealNumber: `g-${suffix}-02`, notes: "Slot 2" },
          { sealNumber: `g-${suffix}-03`, notes: "Slot 3" },
        ],
      }),
    );
    assert.equal(multiSeal.response.status, 200, JSON.stringify(multiSeal.body));
    assert.deepEqual(multiSeal.body.data.point.seals.map((seal) => seal.sealNumber), [
      `G-${suffix}-01`, `G-${suffix}-02`, `G-${suffix}-03`,
    ]);

    const patched = await call<{ point: FormColumn }>(
      `/shipments/${report.id}/form/points/${gPoint}`,
      json("PATCH", { notes: "Catatan equipment diperbarui" }),
    );
    assert.equal(patched.response.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.data.point.notes, "Catatan equipment diperbarui");
    assert.equal(patched.body.data.point.seals.length, 3);

    const duplicateInPoint = await call<unknown>(
      `/shipments/${report.id}/form/points/${gPoint}`,
      json("PUT", {
        status: "SEALED",
        seals: [{ sealNumber: `DUP-${suffix}` }, { sealNumber: `dup-${suffix}` }],
      }),
    );
    assert.equal(duplicateInPoint.response.status, 400);

    const bPoint = pointBySection.get("B")![0]!;
    const duplicateAcrossPoints = await call<unknown>(
      `/shipments/${report.id}/form/points/${bPoint}`,
      json("PUT", { status: "SEALED", seals: [{ sealNumber: `g-${suffix}-01` }] }),
    );
    assert.equal(duplicateAcrossPoints.response.status, 409);

    const foreignVessel = await prisma.vessel.create({ data: { name: `STEP 6 FOREIGN ${suffix}` } });
    vesselIds.push(foreignVessel.id);
    const foreignTemplate = templatesBySection.get("B")![0]!;
    const foreignPoint = await prisma.vesselSealingPoint.create({
      data: {
        vesselId: foreignVessel.id,
        sealingPointTemplateId: foreignTemplate.id,
        code: `STEP6-FOREIGN-${suffix}`,
      },
    });
    const foreignRejected = await call<unknown>(
      `/shipments/${report.id}/form/points/${foreignPoint.id}`,
      json("PUT", { status: "NOT_SEALED", seals: [] }),
    );
    assert.equal(foreignRejected.response.status, 400);

    const wrongSection = await call<unknown>(
      `/shipments/${report.id}/form/sections/G`,
      json("PUT", { points: [{ vesselSealingPointId: aPoints[0], status: "NOT_SEALED", seals: [] }] }),
    );
    assert.equal(wrongSection.response.status, 400);

    const cleared = await call<{ point: FormColumn }>(
      `/shipments/${report.id}/form/points/${gPoint}`,
      { method: "DELETE", headers: { "content-type": "application/json" } },
    );
    assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.data.point.status, "NOT_SEALED");
    assert.equal(cleared.body.data.point.notes, null);
    assert.equal(cleared.body.data.point.seals.length, 0);

    const noGVessel = await prisma.vessel.create({
      data: {
        name: `STEP 6 NO G ${suffix}`,
        compartments: { create: { code: "1P", name: "Only Tank", side: "PORT", sequence: 1 } },
      },
      include: { compartments: true },
    });
    vesselIds.push(noGVessel.id);
    await createProfile(noGVessel.id, ["A"]);
    const noGPoint = await prisma.vesselSealingPoint.create({
      data: {
        vesselId: noGVessel.id,
        sealingPointTemplateId: templatesBySection.get("A")![0]!.id,
        compartmentId: noGVessel.compartments[0]!.id,
        code: `STEP6-NOG-A-${suffix}`,
        side: "PORT",
      },
    });
    const noGReport = await createLegacyReport(noGVessel.id, "NO-G");
    const noGPrepared = await call<unknown>(`/shipments/${noGReport.id}/prepare-seals`, json("POST", {}));
    assert.equal(noGPrepared.response.status, 200, JSON.stringify(noGPrepared.body));
    const noGForm = await call<GroupedForm>(`/shipments/${noGReport.id}/form`);
    assert.equal(noGForm.response.status, 200);
    const unavailableG = noGForm.body.data.sections.find((section) => section.code === "G");
    assert.equal(unavailableG?.isAvailable, false);
    assert.equal(unavailableG?.rows.length, 0);
    const unavailableGWrite = await call<unknown>(
      `/shipments/${noGReport.id}/form/sections/G`,
      json("PUT", { points: [{ vesselSealingPointId: noGPoint.id, status: "NOT_SEALED", seals: [] }] }),
    );
    assert.equal(unavailableGWrite.response.status, 400);

    const duplicateVessel = await prisma.vessel.create({
      data: {
        name: `STEP 6 DUPLICATE ${suffix}`,
        compartments: { create: { code: "1P", name: "Duplicate Tank", side: "PORT", sequence: 1 } },
      },
      include: { compartments: true },
    });
    vesselIds.push(duplicateVessel.id);
    await createProfile(duplicateVessel.id, ["A"]);
    const duplicateTemplate = templatesBySection.get("A")![0]!;
    for (const serial of [1, 2]) {
      await prisma.vesselSealingPoint.create({
        data: {
          vesselId: duplicateVessel.id,
          sealingPointTemplateId: duplicateTemplate.id,
          compartmentId: duplicateVessel.compartments[0]!.id,
          code: `STEP6-DUP-${serial}-${suffix}`,
          side: "PORT",
          instanceNo: 1,
          sequence: serial,
        },
      });
    }
    const duplicateReport = await createLegacyReport(duplicateVessel.id, "DUPLICATE");
    const duplicatePosition = await call<unknown>(
      `/shipments/${duplicateReport.id}/prepare-seals`,
      json("POST", {}),
    );
    assert.equal(duplicatePosition.response.status, 409);

    const auditCount = await prisma.auditLog.count({
      where: {
        userId: operator.user.id,
        entityType: { in: ["A_H_POINT_INPUT", "A_H_SECTION_INPUT"] },
      },
    });
    assert.equal(auditCount >= 9, true);

    await prisma.sealingReport.update({ where: { id: report.id }, data: { status: "BERLAYAR" } });
    const lockedEdit = await call<unknown>(
      `/shipments/${report.id}/form/points/${bPoint}`,
      json("PUT", { status: "NOT_SEALED", seals: [] }),
    );
    assert.equal(lockedEdit.response.status, 400);
  } finally {
    await prisma.auditLog.deleteMany({ where: { userId: operator.user.id } });
    await prisma.sealingReport.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.vessel.deleteMany({ where: { id: { in: vesselIds } } });
    for (const templateId of templateIds) {
      await prisma.sealingPointTemplate.delete({ where: { id: templateId } }).catch(() => {});
    }
    if (createdFormVersionId) {
      await prisma.formTkoVersion.delete({ where: { id: createdFormVersionId } }).catch(() => {});
    }
    await prisma.sealingCategory.deleteMany({ where: { id: { in: createdCategoryIds } } });
    await prisma.user.delete({ where: { id: operator.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
    await prisma.$disconnect();
  }
});
