import assert from "node:assert/strict";
import { test } from "node:test";

import { prisma } from "../src/config/prisma.js";

test("release gate sumber: seluruh master workbook dan taxonomy A-H canonical tersedia", async () => {
  await prisma.$connect();
  try {
    const [plants, activities, products, units, jetties, vessels, templates] = await Promise.all([
      prisma.plant.findMany({ where: { code: { in: ["1401", "1402", "1403", "1404", "2503", "1S45"] } }, orderBy: { sequence: "asc" } }),
      prisma.activity.findMany({ where: { code: { in: ["LOADING", "DISCHARGE", "ROB"] } }, orderBy: { sequence: "asc" } }),
      prisma.product.findMany({ where: { name: { in: ["PERTALITE", "PERTAMAX", "PERTAMAX TURBO", "BIOSOLAR B40", "PERTADEX", "DEXLITE", "LPG", "MFO"] } }, orderBy: { sequence: "asc" } }),
      prisma.unitOfMeasure.findMany({ where: { code: { in: ["KL", "MT", "BBRL"] } }, orderBy: { sequence: "asc" } }),
      prisma.jetty.findMany({ where: { name: { in: ["JETTY 1", "JETTY 2", "JETTY 3", "MT GLOBAL", "MT XXXX"] } }, orderBy: { sequence: "asc" } }),
      prisma.vessel.findMany({ where: { name: { in: ["MT IHSAN 2", "MT IHSAN 3", "MT IHSAN 5", "OB Ratu Maryam", "OB XXXXX"] } } }),
      prisma.sealingPointTemplate.findMany({ where: { code: { in: ["A-01", "A-02", "A-04", "A-05", "A-06", "C-02", "C-03", "C-04", "C-05", "D-02", "D-03", "D-04", "D-05", "D-06", "H-03"] } }, include: { category: true } }),
    ]);

    assert.deepEqual(plants.map(({ code, name }: { code: string; name: string }) => [code, name]), [
      ["1401", "IT Balikpapan"], ["1402", "FT Samarinda"], ["1403", "FT Tarakan"],
      ["1404", "IT Banjarmasin"], ["2503", "DM LPG Banjarmasin"], ["1S45", "STS Taboneo"],
    ]);
    assert.deepEqual(activities.map(({ code }: { code: string }) => code), ["LOADING", "DISCHARGE", "ROB"]);
    assert.deepEqual(products.map(({ name }: { name: string }) => name), ["PERTALITE", "PERTAMAX", "PERTAMAX TURBO", "BIOSOLAR B40", "PERTADEX", "DEXLITE", "LPG", "MFO"]);
    assert.deepEqual(units.map(({ code }: { code: string }) => code), ["KL", "MT", "BBRL"]);
    assert.deepEqual(jetties.map(({ name }: { name: string }) => name), ["JETTY 1", "JETTY 2", "JETTY 3", "MT GLOBAL", "MT XXXX"]);
    assert.equal(vessels.length, 5);
    assert.ok(vessels.every((vessel: { deadweightTonnage: unknown; capacity: unknown; drawingLink: string | null }) => vessel.deadweightTonnage === null && vessel.capacity === null && vessel.drawingLink === null));

    type TemplateRow = { code: string; name: string; sequence: number; isActive: boolean; category: { code: string } };
    const byCode = new Map<string, TemplateRow>(templates.map((template: TemplateRow) => [template.code, template]));
    assert.equal(byCode.get("A-02")?.name, "Tank Cleaning Access DOT/Deck Seal");
    assert.deepEqual(["C-02", "C-03", "C-04", "C-05"].map((code) => byCode.get(code)?.category.code), ["C", "C", "C", "C"]);
    assert.deepEqual(["D-03", "D-04", "D-05", "D-02", "D-06"].map((code) => byCode.get(code)?.sequence), [1, 2, 3, 4, 5]);
    assert.equal(byCode.get("H-03")?.name, "Pintu Pumproom");
    assert.ok(templates.every((template: TemplateRow) => template.isActive));

    type VesselRow = { name: string; vesselType: string };
    const sourceVessels = new Map<string, VesselRow>(vessels.map((vessel: VesselRow) => [vessel.name, vessel]));
    assert.deepEqual(
      ["MT IHSAN 2", "MT IHSAN 3", "MT IHSAN 5"].map((name) => sourceVessels.get(name)?.vesselType),
      ["MT", "MT", "MT"],
    );
    assert.deepEqual(
      ["OB Ratu Maryam", "OB XXXXX"].map((name) => sourceVessels.get(name)?.vesselType),
      ["OB", "OB"],
    );
  } finally {
    await prisma.$disconnect();
  }
});
