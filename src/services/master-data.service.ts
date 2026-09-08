import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { AuditAction, Prisma } from "../generated/prisma/client.js";
import type {
  CreateActivityInput,
  CreateCategoryInput,
  CreateCompartmentInput,
  CreateJettyInput,
  CreatePlantInput,
  CreateProductInput,
  CreateTemplateInput,
  CreateUnitOfMeasureInput,
  CreateVesselInput,
  CreateVesselPointInput,
  ListActivitiesInput,
  ListCategoriesInput,
  ListCompartmentsInput,
  ListJettiesInput,
  ListPlantsInput,
  ListProductsInput,
  ListTemplatesInput,
  ListUnitsOfMeasureInput,
  ListVesselPointsInput,
  ListVesselsInput,
  UpdateActivityInput,
  UpdateCategoryInput,
  UpdateCompartmentInput,
  UpdateJettyInput,
  UpdatePlantInput,
  UpdateProductInput,
  UpdateTemplateInput,
  UpdateUnitOfMeasureInput,
  UpdateVesselInput,
  UpdateVesselPointInput,
} from "../schemas/master-data.schema.js";
import { AppError } from "../utils/app-error.js";

const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

function dynamicOrderBy<T>(field: string, direction: "asc" | "desc"): T {
  return { [field]: direction } as T;
}

function withoutUndefined<T extends object>(input: T): {
  [Key in keyof T]-?: Exclude<T[Key], undefined>;
} {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as { [Key in keyof T]-?: Exclude<T[Key], undefined> };
}

const currentFormVersionCode = "FORM-SEGEL-TKO-EDIT1";
const tkoSectionCodes = ["A", "B", "C", "D", "E", "F", "G", "H"];
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const masterAudit = (actorId: string, action: AuditAction, entityType: string, entityId: string, oldData?: unknown, newData?: unknown) => prisma.auditLog.create({
  data: {
    userId: actorId,
    action,
    entityType,
    entityId,
    ...(oldData === undefined ? {} : { oldData: asJson(oldData) }),
    ...(newData === undefined ? {} : { newData: asJson(newData) }),
  },
});

/**
 * Menjaga VesselFormProfile sebagai proyeksi eksplisit dari konfigurasi point
 * aktual yang dipakai wizard vessel. Tidak pernah membuat sealing point.
 */
async function synchronizeVesselFormProfile(vesselId: string) {
  const [formVersion, categories] = await Promise.all([
    prisma.formTkoVersion.findFirst({
      where: { code: currentFormVersionCode, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sealingCategory.findMany({
      where: { code: { in: tkoSectionCodes } },
      select: { id: true, code: true, sequence: true, isActive: true },
      orderBy: { sequence: "asc" },
    }),
  ]);
  if (!formVersion) throw new AppError(500, "Versi form TKO aktif tidak tersedia");

  const profile = await prisma.vesselFormProfile.upsert({
    where: { vesselId_formVersionId: { vesselId, formVersionId: formVersion.id } },
    update: { isActive: true, activatedAt: new Date() },
    create: {
      vesselId,
      formVersionId: formVersion.id,
      name: "Profil konfigurasi aktual",
      isActive: true,
      activatedAt: new Date(),
    },
  });

  for (const category of categories) {
    const availablePointCount = await prisma.vesselSealingPoint.count({
      where: {
        vesselId,
        isActive: true,
        availability: "AVAILABLE",
        sealingPointTemplate: {
          categoryId: category.id,
          isActive: true,
        },
        OR: [
          { compartmentId: null },
          { compartment: { isActive: true } },
        ],
      },
    });
    await prisma.vesselFormSection.upsert({
      where: {
        vesselFormProfileId_categoryId: {
          vesselFormProfileId: profile.id,
          categoryId: category.id,
        },
      },
      update: {
        isAvailable: category.isActive && availablePointCount > 0,
        sequence: category.sequence,
      },
      create: {
        vesselFormProfileId: profile.id,
        categoryId: category.id,
        isAvailable: category.isActive && availablePointCount > 0,
        sequence: category.sequence,
      },
    });
  }

  return profile;
}

async function synchronizeVesselsForCategory(categoryId: string) {
  const vesselRows = await prisma.vesselSealingPoint.findMany({
    where: { sealingPointTemplate: { categoryId } },
    distinct: ["vesselId"],
    select: { vesselId: true },
  });
  for (const { vesselId } of vesselRows) await synchronizeVesselFormProfile(vesselId);
}

async function synchronizeVesselsForTemplate(templateId: string) {
  const vesselRows = await prisma.vesselSealingPoint.findMany({
    where: { sealingPointTemplateId: templateId },
    distinct: ["vesselId"],
    select: { vesselId: true },
  });
  for (const { vesselId } of vesselRows) await synchronizeVesselFormProfile(vesselId);
}

export async function listPlants(query: ListPlantsInput) {
  const where: Prisma.PlantWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.plant.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.PlantOrderByWithRelationInput>(query.sortBy, query.sortOrder) });
  const total = await prisma.plant.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getPlant(id: string) {
  const item = await prisma.plant.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Plant tidak ditemukan");
  return item;
}

export async function createPlant(input: CreatePlantInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() }; const [item] = await prisma.$transaction([prisma.plant.create({ data }), masterAudit(actorId, "CREATE", "PLANT", id, undefined, data)]); return item; }
export async function updatePlant(id: string, input: UpdatePlantInput, actorId: string) { const old = await getPlant(id); const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) }; const [item] = await prisma.$transaction([prisma.plant.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "PLANT", id, old, data)]); return item; }
export async function deactivatePlant(id: string, actorId: string) { const old = await getPlant(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.plant.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "PLANT", id, old, data)]); return item; }

export async function listJetties(query: ListJettiesInput) {
  const where: Prisma.JettyWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
  };
  const items = await prisma.jetty.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.JettyOrderByWithRelationInput>(query.sortBy, query.sortOrder) });
  const total = await prisma.jetty.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getJetty(id: string) {
  const item = await prisma.jetty.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Jetty tidak ditemukan");
  return item;
}

export async function createJetty(input: CreateJettyInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input) }; const [item] = await prisma.$transaction([prisma.jetty.create({ data }), masterAudit(actorId, "CREATE", "JETTY", id, undefined, data)]); return item; }
export async function updateJetty(id: string, input: UpdateJettyInput, actorId: string) { const old = await getJetty(id); const data = withoutUndefined(input); const [item] = await prisma.$transaction([prisma.jetty.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "JETTY", id, old, data)]); return item; }
export async function deactivateJetty(id: string, actorId: string) { const old = await getJetty(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.jetty.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "JETTY", id, old, data)]); return item; }

export async function listActivities(query: ListActivitiesInput) {
  const where: Prisma.ActivityWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.activity.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.ActivityOrderByWithRelationInput>(query.sortBy, query.sortOrder) });
  const total = await prisma.activity.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getActivity(id: string) {
  const item = await prisma.activity.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Activity tidak ditemukan");
  return item;
}

export async function createActivity(input: CreateActivityInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() }; const [item] = await prisma.$transaction([prisma.activity.create({ data }), masterAudit(actorId, "CREATE", "ACTIVITY", id, undefined, data)]); return item; }
export async function updateActivity(id: string, input: UpdateActivityInput, actorId: string) { const old = await getActivity(id); const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) }; const [item] = await prisma.$transaction([prisma.activity.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "ACTIVITY", id, old, data)]); return item; }
export async function deactivateActivity(id: string, actorId: string) { const old = await getActivity(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.activity.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "ACTIVITY", id, old, data)]); return item; }

export async function listProducts(query: ListProductsInput) {
  const where: Prisma.ProductWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
  };
  const items = await prisma.product.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.ProductOrderByWithRelationInput>(query.sortBy, query.sortOrder) });
  const total = await prisma.product.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getProduct(id: string) {
  const item = await prisma.product.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Product tidak ditemukan");
  return item;
}

export async function createProduct(input: CreateProductInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input) }; const [item] = await prisma.$transaction([prisma.product.create({ data }), masterAudit(actorId, "CREATE", "PRODUCT", id, undefined, data)]); return item; }
export async function updateProduct(id: string, input: UpdateProductInput, actorId: string) { const old = await getProduct(id); const data = withoutUndefined(input); const [item] = await prisma.$transaction([prisma.product.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "PRODUCT", id, old, data)]); return item; }
export async function deactivateProduct(id: string, actorId: string) { const old = await getProduct(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.product.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "PRODUCT", id, old, data)]); return item; }

export async function listUnitsOfMeasure(query: ListUnitsOfMeasureInput) {
  const where: Prisma.UnitOfMeasureWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { code: { contains: query.search, mode: "insensitive" } } : {}),
  };
  const items = await prisma.unitOfMeasure.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.UnitOfMeasureOrderByWithRelationInput>(query.sortBy, query.sortOrder) });
  const total = await prisma.unitOfMeasure.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getUnitOfMeasure(id: string) {
  const item = await prisma.unitOfMeasure.findUnique({ where: { id } });
  if (!item) throw new AppError(404, "Unit of measure tidak ditemukan");
  return item;
}

export async function createUnitOfMeasure(input: CreateUnitOfMeasureInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() }; const [item] = await prisma.$transaction([prisma.unitOfMeasure.create({ data }), masterAudit(actorId, "CREATE", "UNIT_OF_MEASURE", id, undefined, data)]); return item; }
export async function updateUnitOfMeasure(id: string, input: UpdateUnitOfMeasureInput, actorId: string) { const old = await getUnitOfMeasure(id); const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) }; const [item] = await prisma.$transaction([prisma.unitOfMeasure.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "UNIT_OF_MEASURE", id, old, data)]); return item; }
export async function deactivateUnitOfMeasure(id: string, actorId: string) { const old = await getUnitOfMeasure(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.unitOfMeasure.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "UNIT_OF_MEASURE", id, old, data)]); return item; }

export async function listVessels(query: ListVesselsInput) {
  const where: Prisma.VesselWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.vesselType ? { vesselType: query.vesselType } : {}),
    ...(query.search ? { OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { imoNumber: { contains: query.search, mode: "insensitive" } },
      { productGroup: { contains: query.search, mode: "insensitive" } },
      { owner: { contains: query.search, mode: "insensitive" } },
      { flag: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.vessel.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.VesselOrderByWithRelationInput>(query.sortBy, query.sortOrder), include: { _count: { select: { compartments: true, sealingPoints: true, sealingReports: true } } } });
  const total = await prisma.vessel.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getVessel(id: string) {
  const item = await prisma.vessel.findUnique({ where: { id }, include: { _count: { select: { compartments: true, sealingPoints: true, sealingReports: true } } } });
  if (!item) throw new AppError(404, "Vessel tidak ditemukan");
  return item;
}

export async function createVessel(input: CreateVesselInput, actorId: string) {
  const id = randomUUID();
  const createData = {
    id,
    name: input.name,
    ...(input.imoNumber === undefined ? {} : { imoNumber: input.imoNumber }),
    ...(input.vesselType === undefined ? {} : { vesselType: input.vesselType }),
    ...(input.productGroup === undefined ? {} : { productGroup: input.productGroup }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.flag === undefined ? {} : { flag: input.flag }),
    ...(input.deadweightTonnage === undefined ? {} : { deadweightTonnage: input.deadweightTonnage }),
    ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
    ...(input.tankCount === undefined ? {} : { tankCount: input.tankCount }),
    ...(input.drawingStatus === undefined ? {} : { drawingStatus: input.drawingStatus }),
    ...(input.drawingFileUrl === undefined ? {} : { drawingFileUrl: input.drawingFileUrl }),
    ...(input.drawingLink === undefined ? {} : { drawingLink: input.drawingLink }),
    isActive: input.isActive,
    compartments: {
      create: input.compartments.map((compartment) => ({
        ...withoutUndefined(compartment),
        code: compartment.code.toUpperCase(),
      })),
    },
  } satisfies Prisma.VesselCreateInput;
  const [vessel] = await prisma.$transaction([
    prisma.vessel.create({
    data: {
      ...createData,
    },
    include: { compartments: { orderBy: { sequence: "asc" } } },
    }),
    masterAudit(actorId, "CREATE", "VESSEL", id, undefined, createData),
  ]);
  await synchronizeVesselFormProfile(vessel.id);
  return vessel;
}

export async function updateVessel(id: string, input: UpdateVesselInput, actorId: string) {
  const old = await getVessel(id);
  const data = withoutUndefined(input);
  const [item] = await prisma.$transaction([
    prisma.vessel.update({ where: { id }, data }),
    masterAudit(actorId, "UPDATE", "VESSEL", id, old, data),
  ]);
  return item;
}

export async function deactivateVessel(id: string, actorId: string) {
  const old = await getVessel(id);
  const data = { isActive: false };
  const [item] = await prisma.$transaction([
    prisma.vessel.update({ where: { id }, data }),
    masterAudit(actorId, "DELETE", "VESSEL", id, old, data),
  ]);
  return item;
}

export async function listCompartments(query: ListCompartmentsInput) {
  const where: Prisma.CompartmentWhereInput = {
    ...(query.vesselId ? { vesselId: query.vesselId } : {}),
    ...(query.side ? { side: query.side } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.compartment.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.CompartmentOrderByWithRelationInput>(query.sortBy, query.sortOrder), include: { vessel: { select: { id: true, name: true } } } });
  const total = await prisma.compartment.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getCompartment(id: string) {
  const item = await prisma.compartment.findUnique({ where: { id }, include: { vessel: { select: { id: true, name: true } }, _count: { select: { sealingPoints: true } } } });
  if (!item) throw new AppError(404, "Compartment tidak ditemukan");
  return item;
}

export async function createCompartment(input: CreateCompartmentInput, actorId: string) {
  if (!(await prisma.vessel.findUnique({ where: { id: input.vesselId }, select: { id: true } }))) throw new AppError(404, "Vessel tidak ditemukan");
  const id = randomUUID();
  const data = {
    id,
    vesselId: input.vesselId, code: input.code.toUpperCase(), name: input.name,
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
    ...(input.description === undefined ? {} : { description: input.description }),
    isActive: input.isActive,
  };
  const [item] = await prisma.$transaction([
    prisma.compartment.create({ data }),
    masterAudit(actorId, "CREATE", "COMPARTMENT", id, undefined, data),
  ]);
  return item;
}

export async function updateCompartment(id: string, input: UpdateCompartmentInput, actorId: string) {
  const old = await getCompartment(id);
  const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) };
  const [item] = await prisma.$transaction([
    prisma.compartment.update({ where: { id }, data }),
    masterAudit(actorId, "UPDATE", "COMPARTMENT", id, old, data),
  ]);
  await synchronizeVesselFormProfile(item.vesselId);
  return item;
}

export async function deactivateCompartment(id: string, actorId: string) {
  const old = await getCompartment(id);
  const data = { isActive: false };
  const [item] = await prisma.$transaction([
    prisma.compartment.update({ where: { id }, data }),
    masterAudit(actorId, "DELETE", "COMPARTMENT", id, old, data),
  ]);
  await synchronizeVesselFormProfile(item.vesselId);
  return item;
}

export async function listCategories(query: ListCategoriesInput) {
  const where: Prisma.SealingCategoryWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.sealingCategory.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.SealingCategoryOrderByWithRelationInput>(query.sortBy, query.sortOrder), include: { _count: { select: { sealingPointTemplates: true } } } });
  const total = await prisma.sealingCategory.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getCategory(id: string) {
  const item = await prisma.sealingCategory.findUnique({ where: { id }, include: { _count: { select: { sealingPointTemplates: true } } } });
  if (!item) throw new AppError(404, "Kategori sealing tidak ditemukan");
  return item;
}

export async function createCategory(input: CreateCategoryInput, actorId: string) { const id = randomUUID(); const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() }; const [item] = await prisma.$transaction([prisma.sealingCategory.create({ data }), masterAudit(actorId, "CREATE", "SEALING_CATEGORY", id, undefined, data)]); return item; }
export async function updateCategory(id: string, input: UpdateCategoryInput, actorId: string) { const old = await getCategory(id); const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) }; const [item] = await prisma.$transaction([prisma.sealingCategory.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "SEALING_CATEGORY", id, old, data)]); if (!item.isActive || !tkoSectionCodes.includes(item.code)) await prisma.vesselFormSection.updateMany({ where: { categoryId: id }, data: { isAvailable: false } }); await synchronizeVesselsForCategory(id); return item; }
export async function deactivateCategory(id: string, actorId: string) { const old = await getCategory(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.sealingCategory.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "SEALING_CATEGORY", id, old, data)]); await prisma.vesselFormSection.updateMany({ where: { categoryId: id }, data: { isAvailable: false } }); await synchronizeVesselsForCategory(id); return item; }

export async function listTemplates(query: ListTemplatesInput) {
  const where: Prisma.SealingPointTemplateWhereInput = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.requiresCompartment === undefined ? {} : { requiresCompartment: query.requiresCompartment }),
    ...(query.supportsSide === undefined ? {} : { supportsSide: query.supportsSide }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.sealingPointTemplate.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.SealingPointTemplateOrderByWithRelationInput>(query.sortBy, query.sortOrder), include: { category: { select: { id: true, code: true, name: true } } } });
  const total = await prisma.sealingPointTemplate.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getTemplate(id: string) {
  const item = await prisma.sealingPointTemplate.findUnique({ where: { id }, include: { category: { select: { id: true, code: true, name: true } }, _count: { select: { vesselSealingPoints: true } } } });
  if (!item) throw new AppError(404, "Template titik sealing tidak ditemukan");
  return item;
}

export async function createTemplate(input: CreateTemplateInput, actorId: string) {
  if (!(await prisma.sealingCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw new AppError(404, "Kategori sealing tidak ditemukan");
  const id = randomUUID();
  const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() };
  const [item] = await prisma.$transaction([prisma.sealingPointTemplate.create({ data }), masterAudit(actorId, "CREATE", "SEALING_POINT_TEMPLATE", id, undefined, data)]);
  return item;
}

export async function updateTemplate(id: string, input: UpdateTemplateInput, actorId: string) {
  if (input.categoryId && !(await prisma.sealingCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw new AppError(404, "Kategori sealing tidak ditemukan");
  const old = await getTemplate(id);
  const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) };
  const [item] = await prisma.$transaction([prisma.sealingPointTemplate.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "SEALING_POINT_TEMPLATE", id, old, data)]);
  await synchronizeVesselsForTemplate(id);
  return item;
}
export async function deactivateTemplate(id: string, actorId: string) { const old = await getTemplate(id); const data = { isActive: false }; const [item] = await prisma.$transaction([prisma.sealingPointTemplate.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "SEALING_POINT_TEMPLATE", id, old, data)]); await synchronizeVesselsForTemplate(id); return item; }

async function validateVesselPointConfiguration(vesselId: string, templateId: string, compartmentId: string | null | undefined, side: string | null | undefined) {
  const vessel = await prisma.vessel.findUnique({ where: { id: vesselId }, select: { id: true } });
  if (!vessel) throw new AppError(404, "Vessel tidak ditemukan");

  const template = await prisma.sealingPointTemplate.findUnique({ where: { id: templateId }, select: { id: true, requiresCompartment: true, supportsSide: true } });
  if (!template) throw new AppError(404, "Template titik sealing tidak ditemukan");
  if (template.requiresCompartment && !compartmentId) throw new AppError(400, "Template ini mewajibkan compartment");

  const compartment = compartmentId
    ? await prisma.compartment.findUnique({ where: { id: compartmentId }, select: { vesselId: true } })
    : null;
  if (compartmentId && !compartment) throw new AppError(404, "Compartment tidak ditemukan");
  if (compartment && compartment.vesselId !== vesselId) throw new AppError(400, "Compartment harus berasal dari vessel yang sama");
  if (side && !template.supportsSide) throw new AppError(400, "Template ini tidak mendukung side");
}

export async function listVesselPoints(query: ListVesselPointsInput) {
  const where: Prisma.VesselSealingPointWhereInput = {
    ...(query.vesselId ? { vesselId: query.vesselId } : {}),
    ...(query.sealingPointTemplateId ? { sealingPointTemplateId: query.sealingPointTemplateId } : {}),
    ...(query.compartmentId ? { compartmentId: query.compartmentId } : {}),
    ...(query.side ? { side: query.side } : {}),
    ...(query.availability ? { availability: query.availability } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { code: { contains: query.search, mode: "insensitive" } },
      { displayName: { contains: query.search, mode: "insensitive" } },
      { locationName: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.vesselSealingPoint.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: dynamicOrderBy<Prisma.VesselSealingPointOrderByWithRelationInput>(query.sortBy, query.sortOrder), include: { vessel: { select: { id: true, name: true } }, sealingPointTemplate: { select: { id: true, code: true, name: true } }, compartment: { select: { id: true, code: true, name: true } } } });
  const total = await prisma.vesselSealingPoint.count({ where });
  return { items, pagination: pagination(query.page, query.limit, total) };
}

export async function getVesselPoint(id: string) {
  const item = await prisma.vesselSealingPoint.findUnique({ where: { id }, include: { vessel: true, sealingPointTemplate: { include: { category: true } }, compartment: true, _count: { select: { sealingRecords: true } } } });
  if (!item) throw new AppError(404, "Titik sealing vessel tidak ditemukan");
  return item;
}

export async function createVesselPoint(input: CreateVesselPointInput, actorId: string) {
  await validateVesselPointConfiguration(input.vesselId, input.sealingPointTemplateId, input.compartmentId, input.side);
  const id = randomUUID();
  const data = { id, ...withoutUndefined(input), code: input.code.toUpperCase() };
  const [point] = await prisma.$transaction([prisma.vesselSealingPoint.create({ data }), masterAudit(actorId, "CREATE", "VESSEL_SEALING_POINT", id, undefined, data)]);
  await synchronizeVesselFormProfile(point.vesselId);
  return point;
}

export async function updateVesselPoint(id: string, input: UpdateVesselPointInput, actorId: string) {
  const existing = await prisma.vesselSealingPoint.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Titik sealing vessel tidak ditemukan");
  const vesselId = input.vesselId ?? existing.vesselId;
  const templateId = input.sealingPointTemplateId ?? existing.sealingPointTemplateId;
  const compartmentId = input.compartmentId === undefined ? existing.compartmentId : input.compartmentId;
  const side = input.side === undefined ? existing.side : input.side;
  await validateVesselPointConfiguration(vesselId, templateId, compartmentId, side);
  const data = { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) };
  const [point] = await prisma.$transaction([prisma.vesselSealingPoint.update({ where: { id }, data }), masterAudit(actorId, "UPDATE", "VESSEL_SEALING_POINT", id, existing, data)]);
  await synchronizeVesselFormProfile(point.vesselId);
  if (existing.vesselId !== point.vesselId) await synchronizeVesselFormProfile(existing.vesselId);
  return point;
}

export async function deactivateVesselPoint(id: string, actorId: string) {
  const old = await getVesselPoint(id);
  const data = { isActive: false, availability: "INACTIVE" as const };
  const [point] = await prisma.$transaction([prisma.vesselSealingPoint.update({ where: { id }, data }), masterAudit(actorId, "DELETE", "VESSEL_SEALING_POINT", id, old, data)]);
  await synchronizeVesselFormProfile(point.vesselId);
  return point;
}
