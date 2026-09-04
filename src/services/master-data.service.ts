import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  CreateCategoryInput,
  CreateCompartmentInput,
  CreateTemplateInput,
  CreateVesselInput,
  CreateVesselPointInput,
  ListCategoriesInput,
  ListCompartmentsInput,
  ListTemplatesInput,
  ListVesselPointsInput,
  ListVesselsInput,
  UpdateCategoryInput,
  UpdateCompartmentInput,
  UpdateTemplateInput,
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

export async function listVessels(query: ListVesselsInput) {
  const where: Prisma.VesselWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.vesselType ? { vesselType: query.vesselType } : {}),
    ...(query.search ? { OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { imoNumber: { contains: query.search, mode: "insensitive" } },
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

export const createVessel = (input: CreateVesselInput) => prisma.vessel.create({ data: {
  name: input.name,
  ...(input.imoNumber === undefined ? {} : { imoNumber: input.imoNumber }),
  ...(input.vesselType === undefined ? {} : { vesselType: input.vesselType }),
  ...(input.owner === undefined ? {} : { owner: input.owner }),
  ...(input.flag === undefined ? {} : { flag: input.flag }),
  isActive: input.isActive,
} });

export const updateVessel = (id: string, input: UpdateVesselInput) => prisma.vessel.update({ where: { id }, data: withoutUndefined(input) });
export const deactivateVessel = (id: string) => prisma.vessel.update({ where: { id }, data: { isActive: false } });

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

export async function createCompartment(input: CreateCompartmentInput) {
  if (!(await prisma.vessel.findUnique({ where: { id: input.vesselId }, select: { id: true } }))) throw new AppError(404, "Vessel tidak ditemukan");
  return prisma.compartment.create({ data: {
    vesselId: input.vesselId, code: input.code.toUpperCase(), name: input.name,
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.sequence === undefined ? {} : { sequence: input.sequence }),
    ...(input.description === undefined ? {} : { description: input.description }),
    isActive: input.isActive,
  } });
}

export const updateCompartment = (id: string, input: UpdateCompartmentInput) => prisma.compartment.update({ where: { id }, data: { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) } });
export const deactivateCompartment = (id: string) => prisma.compartment.update({ where: { id }, data: { isActive: false } });

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

export const createCategory = (input: CreateCategoryInput) => prisma.sealingCategory.create({ data: { ...withoutUndefined(input), code: input.code.toUpperCase() } });
export const updateCategory = (id: string, input: UpdateCategoryInput) => prisma.sealingCategory.update({ where: { id }, data: { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) } });
export const deactivateCategory = (id: string) => prisma.sealingCategory.update({ where: { id }, data: { isActive: false } });

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

export async function createTemplate(input: CreateTemplateInput) {
  if (!(await prisma.sealingCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw new AppError(404, "Kategori sealing tidak ditemukan");
  return prisma.sealingPointTemplate.create({ data: { ...withoutUndefined(input), code: input.code.toUpperCase() } });
}

export async function updateTemplate(id: string, input: UpdateTemplateInput) {
  if (input.categoryId && !(await prisma.sealingCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw new AppError(404, "Kategori sealing tidak ditemukan");
  return prisma.sealingPointTemplate.update({ where: { id }, data: { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) } });
}
export const deactivateTemplate = (id: string) => prisma.sealingPointTemplate.update({ where: { id }, data: { isActive: false } });

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

export async function createVesselPoint(input: CreateVesselPointInput) {
  await validateVesselPointConfiguration(input.vesselId, input.sealingPointTemplateId, input.compartmentId, input.side);
  return prisma.vesselSealingPoint.create({ data: { ...withoutUndefined(input), code: input.code.toUpperCase() } });
}

export async function updateVesselPoint(id: string, input: UpdateVesselPointInput) {
  const existing = await prisma.vesselSealingPoint.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "Titik sealing vessel tidak ditemukan");
  const vesselId = input.vesselId ?? existing.vesselId;
  const templateId = input.sealingPointTemplateId ?? existing.sealingPointTemplateId;
  const compartmentId = input.compartmentId === undefined ? existing.compartmentId : input.compartmentId;
  const side = input.side === undefined ? existing.side : input.side;
  await validateVesselPointConfiguration(vesselId, templateId, compartmentId, side);
  return prisma.vesselSealingPoint.update({ where: { id }, data: { ...withoutUndefined(input), ...(input.code ? { code: input.code.toUpperCase() } : {}) } });
}

export const deactivateVesselPoint = (id: string) => prisma.vesselSealingPoint.update({ where: { id }, data: { isActive: false, availability: "INACTIVE" } });
