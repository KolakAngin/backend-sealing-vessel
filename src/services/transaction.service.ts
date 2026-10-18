import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { AuditAction, Prisma, ReportStatus, SealCondition, SealingProcessStatus, UserRole } from "../generated/prisma/client.js";
import type { CreatePlantJettyAssignmentInput, CreateRecordInput, CreateReportInput, CreateSealInput, CreateShipmentInput, DestinationAssignmentInput, FormPointPatchInput, FormPointWriteInput, FormSectionBatchInput, ListAuditsInput, ListPlantJettyAssignmentsInput, ListReportsInput, UpdateRecordInput, UpdateReportInput, UpdateSealInput, UpdateShipmentInput, VerifySealInput } from "../schemas/transaction.schema.js";
import { AppError } from "../utils/app-error.js";
import { resolvePagination } from "../utils/pagination.js";

export type Actor = { id: string; role: UserRole };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const canManage = (actor: Actor) => actor.role === "ADMIN" || actor.role === "SUPERVISOR";
const canLoad = (actor: Actor) => canManage(actor) || actor.role === "LOADING_MASTER";
const canUnload = (actor: Actor) => canManage(actor) || actor.role === "UNLOADING_MASTER";
const defaultSealingStatus = "READY";
function withoutUndefined<T extends object>(input: T): { [K in keyof T]-?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]-?: Exclude<T[K], undefined> };
}

function assertOwnerOrManager(createdById: string, actor: Actor) {
  if (createdById !== actor.id && !canManage(actor)) throw new AppError(403, "Anda tidak berhak mengubah transaksi ini");
}

function assertLoadingOwner(createdById: string, actor: Actor, loadingMasterId?: string | null) {
  if (!canLoad(actor)) throw new AppError(403, "Hanya Loading Master atau Supervisor yang dapat melakukan proses loading");
  if (!canManage(actor) && (loadingMasterId ?? createdById) !== actor.id) {
    throw new AppError(403, "Shipment/voyage ditugaskan kepada Loading Master lain");
  }
}

function assertShipmentModifiable(old: { createdById: string; loadingMasterId: string | null; status: ReportStatus }, actor: Actor) {
  if (canManage(actor)) return;
  if (old.status === "DRAFT" && old.createdById === actor.id) return;
  if (canLoad(actor) && (old.loadingMasterId ?? old.createdById) === actor.id) return;
  throw new AppError(403, "Anda tidak berhak mengubah transaksi ini");
}

function assertUnloadingAssignment(unloadingMasterId: string | null, actor: Actor) {
  if (!canUnload(actor)) throw new AppError(403, "Hanya Unloading Master atau Supervisor yang dapat melakukan proses unloading");
  if (!canManage(actor) && unloadingMasterId !== actor.id) {
    throw new AppError(403, "Perjalanan ini ditugaskan kepada Unloading Master lain");
  }
}

const reportInclude = {
  vessel: { select: { id: true, name: true, imoNumber: true, drawingFileUrl: true, drawingLink: true } },
  activity: { select: { id: true, code: true, name: true } },
  product: { select: { id: true, name: true } },
  shipmentProducts: {
    select: { product: { select: { id: true, name: true } }, sequence: true },
    orderBy: { sequence: "asc" as const },
  },
  loadingPlant: { select: { id: true, code: true, name: true } },
  loadingJetty: { select: { id: true, name: true } },
  dischargePlant: { select: { id: true, code: true, name: true } },
  dischargeJetty: { select: { id: true, name: true } },
  originTerminal: { select: { id: true, code: true, name: true } },
  destinationTerminal: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, username: true, fullName: true, role: true } },
  loadingMaster: { select: { id: true, username: true, fullName: true, role: true } },
  unloadingMaster: { select: { id: true, username: true, fullName: true, role: true } },
  finalizedBy: { select: { id: true, username: true, fullName: true, role: true } },
  _count: { select: { sealingRecords: true, signatures: true, attachments: true } },
} satisfies Prisma.SealingReportInclude;

function audit(userId: string, action: AuditAction, entityType: string, entityId: string, oldData?: unknown, newData?: unknown) {
  return prisma.auditLog.create({ data: { userId, action, entityType, entityId, ...(oldData === undefined ? {} : { oldData: asJson(oldData) }), ...(newData === undefined ? {} : { newData: asJson(newData) }) } });
}

export async function listReports(query: ListReportsInput, actor: Actor) {
  const where: Prisma.SealingReportWhereInput = {
    ...(actor.role === "LOADING_MASTER" ? { OR: [
      { loadingMasterId: actor.id },
      { loadingMasterId: null, createdById: actor.id },
    ] } : {}),
    ...(actor.role === "UNLOADING_MASTER" ? { OR: [
      { unloadingMasterId: actor.id },
      { createdById: actor.id },
    ] } : {}),
    ...(query.vesselId ? { vesselId: query.vesselId } : {}),
    ...(query.activityId ? { activityId: query.activityId } : {}),
    ...(query.loadingPlantId ? { loadingPlantId: query.loadingPlantId } : {}),
    ...(query.loadingJettyId ? { loadingJettyId: query.loadingJettyId } : {}),
    ...(query.dischargePlantId ? { dischargePlantId: query.dischargePlantId } : {}),
    ...(query.dischargeJettyId ? { dischargeJettyId: query.dischargeJettyId } : {}),
    ...(query.originTerminalId ? { originTerminalId: query.originTerminalId } : {}),
    ...(query.destinationTerminalId ? { destinationTerminalId: query.destinationTerminalId } : {}),
    ...(query.voyageNumber ? { voyageNumber: query.voyageNumber.toUpperCase() } : {}),
    ...(query.shipmentNumber ? { shipmentNumber: query.shipmentNumber.toUpperCase() } : {}),
    ...(query.sealingStatus ? { sealingStatus: query.sealingStatus } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...((query.productId || query.search) ? { AND: [
      ...(query.productId ? [{ OR: [
        { shipmentProducts: { some: { productId: query.productId } } },
        { productId: query.productId },
      ] }] : []),
      ...(query.search ? [{ OR: [
        { reportNo: { contains: query.search, mode: "insensitive" as const } },
        { voyageNumber: { contains: query.search, mode: "insensitive" as const } },
        { shipmentNumber: { contains: query.search, mode: "insensitive" as const } },
        { cargo: { contains: query.search, mode: "insensitive" as const } },
        { portName: { contains: query.search, mode: "insensitive" as const } },
        { shipmentProducts: { some: { product: { name: { contains: query.search, mode: "insensitive" as const } } } } },
      ] }] : []),
    ] } : {}),
  };
  const total = await prisma.sealingReport.count({ where });
  const pagination = resolvePagination(query.page, query.limit, total);
  const items = await prisma.sealingReport.findMany({ where, include: reportInclude, skip: pagination.skip, take: pagination.take, orderBy: [{ reportDateTime: query.sortOrder }, { id: "asc" }] });
  return { items: items.map(withReportCompatibility), pagination: pagination.meta };
}

export async function getReport(id: string, actor?: Actor) {
  const item = await prisma.sealingReport.findUnique({ where: { id }, include: { ...reportInclude, sealingRecords: { include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: { include: { verifications: true } } }, orderBy: { createdAt: "asc" } }, signatures: { where: { phase: null }, orderBy: { role: "asc" } } } });
  if (!item) throw new AppError(404, "Laporan sealing tidak ditemukan");
  if (actor?.role === "LOADING_MASTER" && (item.loadingMasterId ?? item.createdById) !== actor.id) throw new AppError(403, "Anda tidak berhak melihat perjalanan ini");
  if (actor?.role === "UNLOADING_MASTER" && item.unloadingMasterId !== actor.id && item.createdById !== actor.id) throw new AppError(403, "Anda tidak berhak menerima perjalanan ini");
  return withReportCompatibility(item);
}

const supportedActivityCodes = ["LOADING", "DISCHARGE", "ROB"] as const;

async function validateLoadingMaster(loadingMasterId: string) {
  const loadingMaster = await prisma.user.findUnique({
    where: { id: loadingMasterId },
    select: { id: true, role: true, isActive: true },
  });
  if (!loadingMaster?.isActive || !["LOADING_MASTER", "SUPERVISOR"].includes(loadingMaster.role)) {
    throw new AppError(400, "Loading Master tidak tersedia atau role tidak sesuai");
  }
}

async function resolveLoadingMasterId(loadingMasterId: string | undefined, actor: Actor) {
  if (loadingMasterId && !canManage(actor) && actor.role !== "UNLOADING_MASTER" && loadingMasterId !== actor.id) {
    throw new AppError(403, "Hanya Supervisor atau Admin yang dapat menetapkan Loading Master lain");
  }
  const resolved = loadingMasterId ??
    (actor.role === "LOADING_MASTER" || actor.role === "SUPERVISOR" ? actor.id : undefined);
  if (!resolved && actor.role !== "UNLOADING_MASTER") throw new AppError(400, "Loading Master wajib ditetapkan");
  if (resolved) {
    await validateLoadingMaster(resolved);
  }
  return resolved ?? null;
}

type ShipmentReferenceClient = Pick<
  typeof prisma,
  "vessel" | "activity" | "product" | "plant" | "jetty" | "plantJettyAssignment" | "user"
>;
type DestinationAssignmentTransactionClient = ShipmentReferenceClient & Pick<
  typeof prisma,
  "sealingReport" | "sealingReportProduct" | "beritaAcaraDocument" | "auditLog" | "$queryRawUnsafe"
>;

async function validateUnloadingMaster(
  unloadingMasterId: string | null | undefined,
  database: Pick<ShipmentReferenceClient, "user"> = prisma,
) {
  if (!unloadingMasterId) return;
  const unloadingMaster = await database.user.findUnique({
    where: { id: unloadingMasterId },
    select: { id: true, role: true, isActive: true },
  });
  if (!unloadingMaster?.isActive || !["UNLOADING_MASTER", "SUPERVISOR"].includes(unloadingMaster.role)) {
    throw new AppError(400, "Unloading Master tidak tersedia atau role tidak sesuai");
  }
}

async function validateCoreShipmentReferences(input: {
  vesselId: string;
  activityId: string;
  productIds: string[];
  loadingPlantId: string;
  loadingJettyId: string;
}, database: ShipmentReferenceClient = prisma) {
  const [vessel, activity, products, loadingPlant, loadingJetty, loadingAssignment] = await Promise.all([
    database.vessel.findUnique({ where: { id: input.vesselId }, select: { id: true, isActive: true } }),
    database.activity.findUnique({ where: { id: input.activityId }, select: { id: true, code: true, isActive: true } }),
    database.product.findMany({ where: { id: { in: input.productIds } }, select: { id: true, isActive: true } }),
    database.plant.findUnique({ where: { id: input.loadingPlantId }, select: { id: true, isActive: true } }),
    database.jetty.findUnique({ where: { id: input.loadingJettyId }, select: { id: true, isActive: true } }),
    database.plantJettyAssignment.findUnique({
      where: { plantId_jettyId: { plantId: input.loadingPlantId, jettyId: input.loadingJettyId } },
      select: { id: true },
    }),
  ]);

  if (!vessel?.isActive) throw new AppError(400, "Vessel tidak tersedia atau tidak aktif");
  if (!activity?.isActive) throw new AppError(400, "Activity tidak tersedia atau tidak aktif");
  if (!supportedActivityCodes.includes(activity.code.toUpperCase() as typeof supportedActivityCodes[number])) {
    throw new AppError(400, "Activity shipment harus LOADING, DISCHARGE, atau ROB");
  }
  const activeProductIds = new Set(products.filter((product: { isActive: boolean }) => product.isActive).map((product: { id: string }) => product.id));
  const invalidProductIds = input.productIds.filter((id) => !activeProductIds.has(id));
  if (invalidProductIds.length > 0) throw new AppError(400, "Satu atau lebih Product tidak tersedia atau tidak aktif");
  if (!loadingPlant?.isActive) throw new AppError(400, "Loading plant tidak tersedia atau tidak aktif");
  if (!loadingJetty?.isActive) throw new AppError(400, "Loading jetty tidak tersedia atau tidak aktif");
  if (!loadingAssignment) throw new AppError(400, "Loading jetty tidak terdaftar pada loading plant");
}

async function validateDestinationReferences(input: {
  dischargePlantId: string;
  dischargeJettyId: string;
}, database: Pick<ShipmentReferenceClient, "plant" | "jetty" | "plantJettyAssignment"> = prisma) {
  const [dischargePlant, dischargeJetty, dischargeAssignment] = await Promise.all([
    database.plant.findUnique({ where: { id: input.dischargePlantId }, select: { id: true, isActive: true } }),
    database.jetty.findUnique({ where: { id: input.dischargeJettyId }, select: { id: true, isActive: true } }),
    database.plantJettyAssignment.findUnique({
      where: { plantId_jettyId: { plantId: input.dischargePlantId, jettyId: input.dischargeJettyId } },
      select: { id: true },
    }),
  ]);

  if (!dischargePlant?.isActive) throw new AppError(400, "Discharge plant tidak tersedia atau tidak aktif");
  if (!dischargeJetty?.isActive) throw new AppError(400, "Discharge jetty tidak tersedia atau tidak aktif");
  if (!dischargeAssignment) throw new AppError(400, "Discharge jetty tidak terdaftar pada discharge plant");
}

export async function createShipment(input: CreateShipmentInput, actor: Actor) {
  const loadingMasterId = await resolveLoadingMasterId(input.loadingMasterId, actor);
  const unloadingMasterId = input.unloadingMasterId !== undefined
    ? input.unloadingMasterId
    : (actor.role === "UNLOADING_MASTER" ? actor.id : null);
  const productIds = input.productIds ?? (input.productId ? [input.productId] : []);
  await Promise.all([
    validateCoreShipmentReferences({ ...input, productIds }),
    ...(input.dischargePlantId && input.dischargeJettyId ? [validateDestinationReferences({
      dischargePlantId: input.dischargePlantId,
      dischargeJettyId: input.dischargeJettyId,
    })] : []),
    validateUnloadingMaster(unloadingMasterId),
  ]);

  const id = randomUUID();
  const data = withoutUndefined({
    id,
    reportNo: `RPT-${randomUUID()}`,
    vesselId: input.vesselId,
    activityId: input.activityId,
    reportDateTime: input.reportDateTime,
    voyageNumber: input.voyageNumber.toUpperCase(),
    shipmentNumber: input.shipmentNumber.toUpperCase(),
    // Alias produk pertama dipertahankan untuk client/data historis lama.
    productId: productIds[0],
    shipmentProducts: {
      create: productIds.map((productId, index) => ({ productId, sequence: index + 1 })),
    },
    loadingPlantId: input.loadingPlantId,
    loadingJettyId: input.loadingJettyId,
    dischargePlantId: input.dischargePlantId,
    dischargeJettyId: input.dischargeJettyId,
    sealingStatus: (input.sealingStatus ?? defaultSealingStatus).toUpperCase(),
    loadingMasterId: loadingMasterId ?? undefined,
    unloadingMasterId: unloadingMasterId ?? undefined,
    loadingMasterSurveyorName: input.loadingMasterSurveyorName,
    remarks: input.remarks,
    createdById: actor.id,
  });
  const [created] = await prisma.$transaction([
    prisma.sealingReport.create({ data, include: reportInclude }),
    audit(actor.id, "CREATE", "SHIPMENT_VOYAGE", id, undefined, data),
  ]);
  return withReportCompatibility(created);
}

export async function updateShipment(id: string, input: UpdateShipmentInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as DestinationAssignmentTransactionClient & Pick<typeof prisma, "sealingRecord">;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const old = await tx.sealingReport.findUnique({
      where: { id },
      include: { shipmentProducts: { select: { productId: true }, orderBy: { sequence: "asc" } } },
    });
    if (!old) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    assertShipmentModifiable(old, actor);
    if (old.status !== "DRAFT") throw new AppError(400, "Hanya shipment/voyage DRAFT yang dapat diperbarui");
    if (input.dischargePlantId !== undefined || input.dischargeJettyId !== undefined) {
      throw new AppError(400, "Gunakan endpoint destination-assignment untuk memilih atau mengubah discharge Plant dan Jetty");
    }
    const loadingBa = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: id, phase: "LOADING" } },
      select: { status: true },
    });
    if (loadingBa?.status === "FINALIZED") {
      throw new AppError(400, "Shipment/voyage telah dikunci setelah BA LOADING difinalisasi");
    }
    if (input.loadingMasterId && input.loadingMasterId !== old.loadingMasterId && !canManage(actor) && actor.role !== "UNLOADING_MASTER") {
      throw new AppError(403, "Hanya Supervisor atau Admin yang dapat mengganti assignment Loading Master");
    }

    const productsChanged = input.productIds !== undefined || input.productId !== undefined;
    const selectedProductIds: string[] = productsChanged
      ? (input.productIds ?? (input.productId ? [input.productId] : []))
      : (old.shipmentProducts.length > 0
        ? old.shipmentProducts.map((item: { productId: string }) => item.productId)
        : (old.productId ? [old.productId] : []));
    const references = {
      vesselId: input.vesselId ?? old.vesselId,
      activityId: input.activityId ?? old.activityId,
      productIds: selectedProductIds,
      loadingPlantId: input.loadingPlantId ?? old.loadingPlantId,
      loadingJettyId: input.loadingJettyId ?? old.loadingJettyId,
    };
    const voyageNumber = input.voyageNumber ?? old.voyageNumber;
    const shipmentNumber = input.shipmentNumber ?? old.shipmentNumber;
    if (!references.activityId || references.productIds.length === 0 || !references.loadingPlantId || !references.loadingJettyId || !voyageNumber || !shipmentNumber) {
      throw new AppError(400, "Laporan historis belum memiliki seluruh field inti shipment");
    }
    await Promise.all([
      validateCoreShipmentReferences(references as { vesselId: string; activityId: string; productIds: string[]; loadingPlantId: string; loadingJettyId: string }, tx),
      ...(input.loadingMasterId ? [validateLoadingMaster(input.loadingMasterId)] : []),
      validateUnloadingMaster(input.unloadingMasterId, tx),
    ]);
    if (input.vesselId && input.vesselId !== old.vesselId && await tx.sealingRecord.count({ where: { sealingReportId: id } }) > 0) {
      throw new AppError(400, "Vessel tidak dapat diubah setelah titik segel disiapkan");
    }

    const { productIds: _productIds, productId: _productId, ...scalarInput } = input;
    if (productsChanged) {
      await tx.sealingReportProduct.deleteMany({ where: { sealingReportId: id } });
      await tx.sealingReportProduct.createMany({
        data: selectedProductIds.map((productId: string, index: number) => ({ sealingReportId: id, productId, sequence: index + 1 })),
      });
    }
    const data = withoutUndefined({
      ...scalarInput,
      ...(productsChanged ? { productId: selectedProductIds[0] } : {}),
      ...(input.voyageNumber ? { voyageNumber: input.voyageNumber.toUpperCase() } : {}),
      ...(input.shipmentNumber ? { shipmentNumber: input.shipmentNumber.toUpperCase() } : {}),
      ...(input.sealingStatus ? { sealingStatus: input.sealingStatus.toUpperCase() } : {}),
      ...(!input.sealingStatus && !old.sealingStatus ? { sealingStatus: defaultSealingStatus } : {}),
    });
    const updated = await tx.sealingReport.update({ where: { id }, data, include: reportInclude });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "UPDATE",
        entityType: "SHIPMENT_VOYAGE",
        entityId: id,
        oldData: asJson(old),
        newData: asJson({
          ...data,
          ...(productsChanged ? { productIds: selectedProductIds } : {}),
        }),
      },
    });
    return withReportCompatibility(updated);
  });
}

export async function assignShipmentDestination(id: string, input: DestinationAssignmentInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as DestinationAssignmentTransactionClient;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const old = await tx.sealingReport.findUnique({
      where: { id },
      select: {
        id: true,
        shipmentNumber: true,
        createdById: true,
        loadingMasterId: true,
        unloadingMasterId: true,
        dischargePlantId: true,
        dischargeJettyId: true,
        status: true,
        sealingProcessStatus: true,
      },
    });
    if (!old) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    if (!old.shipmentNumber) throw new AppError(400, "Destination assignment hanya tersedia untuk shipment/voyage canonical");
    assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
    if (old.status !== "DRAFT") throw new AppError(400, "Destination hanya dapat dipilih ketika shipment/voyage masih DRAFT");
    if (old.sealingProcessStatus !== "READY") {
      throw new AppError(400, "Destination hanya dapat dipilih setelah penyegelan loading lengkap (READY)");
    }
    const loadingBa = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: id, phase: "LOADING" } },
      select: { status: true },
    });
    if (loadingBa?.status === "FINALIZED") {
      throw new AppError(400, "Destination telah dikunci setelah BA LOADING difinalisasi");
    }

    await Promise.all([
      validateDestinationReferences(input, tx),
      validateUnloadingMaster(input.unloadingMasterId, tx),
    ]);

    const assignedAt = new Date();
    const data = {
      dischargePlantId: input.dischargePlantId,
      dischargeJettyId: input.dischargeJettyId,
      ...(input.unloadingMasterId === undefined ? {} : { unloadingMasterId: input.unloadingMasterId }),
    };
    const updated = await tx.sealingReport.update({ where: { id }, data, include: reportInclude });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "UPDATE",
        entityType: "SHIPMENT_DESTINATION_ASSIGNMENT",
        entityId: id,
        oldData: asJson({
          dischargePlantId: old.dischargePlantId,
          dischargeJettyId: old.dischargeJettyId,
          unloadingMasterId: old.unloadingMasterId,
        }),
        newData: asJson({
          ...data,
          unloadingMasterId: input.unloadingMasterId ?? old.unloadingMasterId,
          assignedById: actor.id,
          assignedAt: assignedAt.toISOString(),
        }),
      },
    });
    return withReportCompatibility(updated);
  });
}

export async function listPlantJettyAssignments(query: ListPlantJettyAssignmentsInput) {
  const where: Prisma.PlantJettyAssignmentWhereInput = {
    ...(query.plantId ? { plantId: query.plantId } : {}),
    ...(query.jettyId ? { jettyId: query.jettyId } : {}),
  };
  const total = await prisma.plantJettyAssignment.count({ where });
  const pagination = resolvePagination(query.page, query.limit, total);
  const items = await prisma.plantJettyAssignment.findMany({
    where,
    include: {
      plant: { select: { id: true, code: true, name: true, isActive: true } },
      jetty: { select: { id: true, name: true, isActive: true } },
    },
    skip: pagination.skip,
    take: pagination.take,
    orderBy: [{ plant: { sequence: "asc" } }, { jetty: { sequence: "asc" } }, { id: "asc" }],
  });
  return { items, pagination: pagination.meta };
}

export async function createPlantJettyAssignment(input: CreatePlantJettyAssignmentInput, actor: Actor) {
  const [plant, jetty] = await Promise.all([
    prisma.plant.findUnique({ where: { id: input.plantId }, select: { id: true, isActive: true } }),
    prisma.jetty.findUnique({ where: { id: input.jettyId }, select: { id: true, isActive: true } }),
  ]);
  if (!plant?.isActive) throw new AppError(400, "Plant tidak tersedia atau tidak aktif");
  if (!jetty?.isActive) throw new AppError(400, "Jetty tidak tersedia atau tidak aktif");

  const id = randomUUID();
  const data = { id, plantId: input.plantId, jettyId: input.jettyId };
  const [created] = await prisma.$transaction([
    prisma.plantJettyAssignment.create({ data, include: { plant: true, jetty: true } }),
    audit(actor.id, "CREATE", "PLANT_JETTY_ASSIGNMENT", id, undefined, data),
  ]);
  return created;
}

export async function deletePlantJettyAssignment(id: string, actor: Actor) {
  const old = await prisma.plantJettyAssignment.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Assignment Plant-Jetty tidak ditemukan");
  const usedByShipment = await prisma.sealingReport.count({
    where: {
      OR: [
        { loadingPlantId: old.plantId, loadingJettyId: old.jettyId },
        { dischargePlantId: old.plantId, dischargeJettyId: old.jettyId },
      ],
    },
  });
  if (usedByShipment > 0) throw new AppError(409, "Assignment Plant-Jetty masih digunakan shipment/voyage");
  const [deleted] = await prisma.$transaction([
    prisma.plantJettyAssignment.delete({ where: { id } }),
    audit(actor.id, "DELETE", "PLANT_JETTY_ASSIGNMENT", id, old),
  ]);
  return deleted;
}

export async function createReport(input: CreateReportInput, actor: Actor) {
  const [vessel, originTerminal, destinationTerminal, unloadingMaster] = await Promise.all([
    prisma.vessel.findUnique({ where: { id: input.vesselId }, select: { id: true, isActive: true } }),
    prisma.terminal.findUnique({ where: { id: input.originTerminalId }, select: { id: true, isActive: true } }),
    prisma.terminal.findUnique({ where: { id: input.destinationTerminalId }, select: { id: true, isActive: true } }),
    input.unloadingMasterId ? prisma.user.findUnique({ where: { id: input.unloadingMasterId }, select: { id: true, role: true, isActive: true } }) : null,
  ]);
  if (!vessel?.isActive) throw new AppError(400, "Vessel tidak tersedia atau tidak aktif");
  if (!originTerminal?.isActive || !destinationTerminal?.isActive) throw new AppError(400, "Terminal asal/tujuan tidak tersedia atau tidak aktif");
  if (input.originTerminalId === input.destinationTerminalId) throw new AppError(400, "Terminal asal dan tujuan harus berbeda");
  if (unloadingMaster && (!unloadingMaster.isActive || !["UNLOADING_MASTER", "SUPERVISOR"].includes(unloadingMaster.role))) throw new AppError(400, "Unloading Master tidak tersedia atau role tidak sesuai");
  const id = randomUUID();
  const data = withoutUndefined({ id, reportNo: input.reportNo.toUpperCase(), vesselId: input.vesselId, originTerminalId: input.originTerminalId, destinationTerminalId: input.destinationTerminalId, loadingMasterId: actor.role === "LOADING_MASTER" || actor.role === "SUPERVISOR" ? actor.id : undefined, unloadingMasterId: input.unloadingMasterId, createdById: actor.id, cargo: input.cargo, operationType: input.operationType, reportDateTime: input.reportDateTime, loadingMasterSurveyorName: input.loadingMasterSurveyorName, portName: input.portName, remarks: input.remarks });
  const [created] = await prisma.$transaction([prisma.sealingReport.create({ data, include: reportInclude }), audit(actor.id, "CREATE", "SEALING_REPORT", id, undefined, data)]);
  return withReportCompatibility(created);
}

export async function updateReport(id: string, input: UpdateReportInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as typeof prisma;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const old = await tx.sealingReport.findUnique({ where: { id } });
    if (!old) throw new AppError(404, "Laporan sealing tidak ditemukan");
    if (old.shipmentNumber) throw new AppError(400, "Shipment canonical harus diperbarui melalui endpoint /shipments atau /voyages");
    assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
    if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diperbarui");
    if (input.vesselId && input.vesselId !== old.vesselId && await tx.sealingRecord.count({ where: { sealingReportId: id } }) > 0) throw new AppError(400, "Vessel tidak dapat diubah setelah titik segel compartment disiapkan");
    if (input.vesselId && !(await tx.vessel.findFirst({ where: { id: input.vesselId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Vessel tidak tersedia atau tidak aktif");
    if (input.originTerminalId && !(await tx.terminal.findFirst({ where: { id: input.originTerminalId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Terminal asal tidak tersedia atau tidak aktif");
    if (input.destinationTerminalId && !(await tx.terminal.findFirst({ where: { id: input.destinationTerminalId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Terminal tujuan tidak tersedia atau tidak aktif");
    const originId = input.originTerminalId ?? old.originTerminalId;
    const destinationId = input.destinationTerminalId ?? old.destinationTerminalId;
    if (destinationId && originId === destinationId) throw new AppError(400, "Terminal asal dan tujuan harus berbeda");
    if (input.unloadingMasterId) {
      const user = await tx.user.findFirst({ where: { id: input.unloadingMasterId, isActive: true, role: { in: ["UNLOADING_MASTER", "SUPERVISOR"] } }, select: { id: true } });
      if (!user) throw new AppError(400, "Unloading Master tidak tersedia atau role tidak sesuai");
    }
    const data = withoutUndefined({ ...input, ...(input.reportNo ? { reportNo: input.reportNo.toUpperCase() } : {}) });
    const updated = await tx.sealingReport.update({ where: { id }, data, include: reportInclude });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", entityType: "SEALING_REPORT", entityId: id, oldData: asJson(old), newData: asJson(data) } });
    return withReportCompatibility(updated);
  });
}

export async function deleteReport(id: string, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as typeof prisma;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const old = await tx.sealingReport.findUnique({ where: { id } });
    if (!old) throw new AppError(404, "Laporan sealing tidak ditemukan");
    if (old.shipmentNumber) throw new AppError(400, "Shipment canonical harus dihapus melalui endpoint /shipments atau /voyages");
    assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
    if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat dihapus");
    const deleted = await tx.sealingReport.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "SEALING_REPORT", entityId: id, oldData: asJson(old) } });
    return deleted;
  });
}

export async function deleteShipment(id: string, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as typeof prisma;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const old = await tx.sealingReport.findUnique({
      where: { id },
      include: { baDocuments: { select: { id: true, phase: true, status: true } } },
    });
    if (!old) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    assertShipmentModifiable(old, actor);
    if (old.status !== "DRAFT") throw new AppError(400, "Hanya shipment/voyage DRAFT yang dapat dihapus");
    if (old.baDocuments.length > 0) throw new AppError(409, "Shipment/voyage yang sudah memulai proses BA tidak dapat dihapus");
    const deleted = await tx.sealingReport.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "SHIPMENT_VOYAGE", entityId: id, oldData: asJson(old) } });
    return deleted;
  });
}

type FormSnapshotPoint = {
  vesselSealingPointId: string;
  code: string;
  displayName: string | null;
  side: string | null;
  locationName: string | null;
  canvasX?: string | null;
  canvasY?: string | null;
  instanceNo: number;
  isRequired?: boolean;
  sequence: number | null;
  section: { id: string; code: string; name: string; sequence: number };
  template: {
    id: string;
    code: string;
    name: string;
    requiresCompartment: boolean;
    supportsSide: boolean;
    sequence: number;
  };
  compartment: {
    id: string;
    code: string;
    name: string;
    side: string | null;
    sequence: number | null;
  } | null;
};

type FormConfigurationSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  formVersion: { id: string; code: string; name: string; revision: string | null };
  vesselFormProfile: { id: string; name: string | null };
  vessel: { id: string; name: string; imoNumber: string | null; drawingFileUrl?: string | null; drawingLink?: string | null };
  sections: Array<{ id: string; code: string; name: string; sequence: number; isAvailable: boolean }>;
  compartments: Array<{ id: string; code: string; name: string; side: string | null; sequence: number | null; description: string | null }>;
  points: FormSnapshotPoint[];
};

type SnapshotTransactionClient = Pick<
  typeof prisma,
  "sealingRecord" | "seal" | "sealVerification" | "auditLog" | "sealingReport" | "vesselFormProfile" |
  "compartment" | "vesselSealingPoint" | "plantJettyAssignment" | "plant" | "jetty" | "beritaAcaraDocument" | "$queryRawUnsafe"
>;

async function assertLoadingBaOpen(tx: SnapshotTransactionClient, reportId: string) {
  const document = await tx.beritaAcaraDocument.findUnique({
    where: { sealingReportId_phase: { sealingReportId: reportId, phase: "LOADING" } },
    select: { status: true },
  });
  if (document?.status === "FINALIZED") {
    throw new AppError(400, "Form dan nomor segel loading telah dikunci setelah BA LOADING difinalisasi");
  }
}
type SnapshotProfile = Prisma.VesselFormProfileGetPayload<{
  include: { formVersion: true; sections: { include: { category: true } } };
}>;
type SnapshotCompartment = Prisma.CompartmentGetPayload<Record<string, never>>;
type SnapshotVesselPoint = Prisma.VesselSealingPointGetPayload<{
  include: { compartment: true; sealingPointTemplate: { include: { category: true } } };
}>;

function readFormSnapshot(value: unknown): FormConfigurationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<FormConfigurationSnapshot>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.points) || !Array.isArray(candidate.sections) || !Array.isArray(candidate.compartments)) return null;
  if (!candidate.formVersion || !candidate.vesselFormProfile || !candidate.vessel) return null;
  return candidate as FormConfigurationSnapshot;
}

function withSnapshotDrawing<T extends {
  formConfigurationSnapshot: unknown;
  vessel: { drawingFileUrl: string | null; drawingLink: string | null };
}>(report: T): T {
  const vessel = readFormSnapshot(report.formConfigurationSnapshot)?.vessel;
  if (!vessel || (vessel.drawingFileUrl === undefined && vessel.drawingLink === undefined)) return report;
  return {
    ...report,
    vessel: {
      ...report.vessel,
      drawingFileUrl: vessel.drawingFileUrl === undefined ? report.vessel.drawingFileUrl : vessel.drawingFileUrl,
      drawingLink: vessel.drawingLink === undefined ? report.vessel.drawingLink : vessel.drawingLink,
    },
  };
}

function withReportCompatibility<T extends {
  formConfigurationSnapshot: unknown;
  vessel: { drawingFileUrl: string | null; drawingLink: string | null };
  productId: string | null;
  product: { id: string; name: string } | null;
  shipmentProducts: Array<{ product: { id: string; name: string }; sequence: number }>;
}>(report: T) {
  const withDrawing = withSnapshotDrawing(report);
  const products = withDrawing.shipmentProducts.length > 0
    ? withDrawing.shipmentProducts.map((item) => item.product)
    : (withDrawing.product ? [withDrawing.product] : []);
  const { shipmentProducts: _shipmentProducts, ...rest } = withDrawing;
  return {
    ...rest,
    productId: products[0]?.id ?? withDrawing.productId,
    product: products[0] ?? withDrawing.product,
    productIds: products.map((product) => product.id),
    products,
  };
}

function snapshotPointPositionKey(point: FormSnapshotPoint) {
  const effectiveSide = point.side ?? point.compartment?.side ?? "NONE";
  return [
    point.section.code,
    point.template.id,
    point.compartment?.id ?? "NO-COMPARTMENT",
    effectiveSide,
    point.instanceNo,
  ].join(":");
}

function assertSnapshotIntegrity(reportVesselId: string, snapshot: FormConfigurationSnapshot) {
  if (snapshot.vessel.id !== reportVesselId) {
    throw new AppError(409, "Vessel pada snapshot form tidak sesuai dengan vessel shipment");
  }

  const sections = new Map(snapshot.sections.map((section) => [section.code, section]));
  const compartmentIds = new Set(snapshot.compartments.map((compartment) => compartment.id));
  const pointIds = new Set<string>();
  const positions = new Map<string, string>();

  for (const point of snapshot.points) {
    if (pointIds.has(point.vesselSealingPointId)) {
      throw new AppError(409, `Titik ${point.code} tersimpan lebih dari sekali pada snapshot laporan`);
    }
    pointIds.add(point.vesselSealingPointId);

    const section = sections.get(point.section.code);
    if (!section || section.id !== point.section.id || !section.isAvailable) {
      throw new AppError(409, `Section ${point.section.code} untuk titik ${point.code} tidak tersedia pada snapshot laporan`);
    }
    if (point.compartment && !compartmentIds.has(point.compartment.id)) {
      throw new AppError(409, `Compartment titik ${point.code} tidak tersedia pada snapshot laporan`);
    }
    if (point.template.requiresCompartment && !point.compartment) {
      throw new AppError(409, `Titik ${point.code} wajib mempunyai compartment pada snapshot laporan`);
    }
    if (!Number.isInteger(point.instanceNo) || point.instanceNo < 1) {
      throw new AppError(409, `Instance titik ${point.code} tidak valid pada snapshot laporan`);
    }
    const coordinateValues = [point.canvasX, point.canvasY];
    if (coordinateValues.some((value) => value != null) &&
        (coordinateValues.some((value) => value == null) ||
          coordinateValues.some((value) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1))) {
      throw new AppError(409, `Koordinat titik ${point.code} tidak valid pada snapshot laporan`);
    }

    const positionKey = snapshotPointPositionKey(point);
    const duplicateCode = positions.get(positionKey);
    if (duplicateCode) {
      throw new AppError(409, `Posisi titik ${point.code} duplikat dengan ${duplicateCode} pada snapshot laporan`);
    }
    positions.set(positionKey, point.code);
  }
}

async function calculateDraftSealingProcessStatus(
  tx: SnapshotTransactionClient,
  reportId: string,
  snapshot: FormConfigurationSnapshot,
): Promise<SealingProcessStatus> {
  const requiredPointIds = snapshot.points
    .filter((point) => point.isRequired !== false)
    .map((point) => point.vesselSealingPointId);
  if (requiredPointIds.length === 0) return "READY";

  const records = await tx.sealingRecord.findMany({
    where: {
      sealingReportId: reportId,
      vesselSealingPointId: { in: requiredPointIds },
    },
    include: { seals: true },
  }) as unknown as FormRecordWithSeals[];
  const recordsByPoint = new Map(records.map((record) => [record.vesselSealingPointId, record]));
  const ready = requiredPointIds.every((pointId) => {
    const record = recordsByPoint.get(pointId);
    if (!record) return false;
    if (record.status === "NOT_APPLICABLE") return true;
    return record.status === "SEALED" && record.seals.some((seal) => seal.status === "INSTALLED");
  });
  return ready ? "READY" : "IN_PROGRESS";
}

async function materializeSnapshotRecords(
  tx: SnapshotTransactionClient,
  reportId: string,
  snapshot: FormConfigurationSnapshot,
  actor: Actor,
) {
  let createdCount = 0;
  for (const point of snapshot.points) {
    const recordId = randomUUID();
    const record = await tx.sealingRecord.upsert({
      where: {
        sealingReportId_vesselSealingPointId: {
          sealingReportId: reportId,
          vesselSealingPointId: point.vesselSealingPointId,
        },
      },
      update: {},
      create: {
        id: recordId,
        sealingReportId: reportId,
        vesselSealingPointId: point.vesselSealingPointId,
        createdById: actor.id,
        status: "NOT_SEALED",
        pointSnapshot: asJson(point),
      },
    });
    if (record.id === recordId) {
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "CREATE",
          entityType: "SEALING_RECORD",
          entityId: recordId,
          newData: asJson({
            sealingReportId: reportId,
            vesselSealingPointId: point.vesselSealingPointId,
            status: "NOT_SEALED",
            source: "VESSEL_FORM_SNAPSHOT",
          }),
        },
      });
      createdCount += 1;
    }
  }
  return createdCount;
}

/**
 * Membekukan konfigurasi aktual form A-H untuk shipment/voyage. Snapshot pertama
 * menjadi sumber idempotensi; perubahan master berikutnya tidak menambah,
 * menghapus, atau mengubah titik pada laporan yang sudah diinisialisasi.
 */
export async function prepareReportSeals(reportId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const database = tx as unknown as SnapshotTransactionClient;
    await database.$queryRawUnsafe(
      'SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE',
      reportId,
    );
    const report = await database.sealingReport.findUnique({
      where: { id: reportId },
      include: { vessel: { select: { id: true, name: true, imoNumber: true, drawingFileUrl: true, drawingLink: true } } },
    });
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (report.status !== "DRAFT") throw new AppError(400, "Form hanya dapat diinisialisasi saat shipment/voyage DRAFT");
    await assertLoadingBaOpen(database, reportId);

    const existingSnapshot = readFormSnapshot(report.formConfigurationSnapshot);
    if (report.formConfigurationSnapshot && !existingSnapshot) {
      throw new AppError(500, "Snapshot konfigurasi form laporan tidak valid");
    }
    if (existingSnapshot) {
      assertSnapshotIntegrity(report.vesselId, existingSnapshot);
      const createdCount = await materializeSnapshotRecords(database, reportId, existingSnapshot, actor);
      const sealingProcessStatus = await calculateDraftSealingProcessStatus(database, reportId, existingSnapshot);
      await database.sealingReport.update({ where: { id: reportId }, data: { sealingProcessStatus } });
      return {
        reportId,
        formVersion: existingSnapshot.formVersion,
        vesselFormProfileId: existingSnapshot.vesselFormProfile.id,
        sectionCount: existingSnapshot.sections.filter((section) => section.isAvailable).length,
        compartmentCount: existingSnapshot.compartments.length,
        pointCount: existingSnapshot.points.length,
        readyCount: await database.sealingRecord.count({ where: { sealingReportId: reportId } }),
        createdCount,
        initializedAt: report.formInitializedAt,
        sealingProcessStatus,
        reusedSnapshot: true,
      };
    }

    const profile = await database.vesselFormProfile.findFirst({
      where: {
        vesselId: report.vesselId,
        isActive: true,
        formVersion: { isActive: true },
      },
      include: {
        formVersion: true,
        sections: {
          where: { category: { code: { in: ["A", "B", "C", "D", "E", "F", "G", "H"] } } },
          include: { category: true },
          orderBy: [{ sequence: "asc" }, { category: { code: "asc" } }],
        },
      },
      orderBy: { updatedAt: "desc" },
    }) as SnapshotProfile | null;
    if (!profile) throw new AppError(400, "VesselFormProfile aktif untuk vessel ini tidak tersedia");

    const compartments = await database.compartment.findMany({
      where: { vesselId: report.vesselId, isActive: true },
      orderBy: [{ sequence: "asc" }, { code: "asc" }],
    });
    const availableSectionIds = profile.sections
      .filter((section: SnapshotProfile["sections"][number]) => section.isAvailable && section.category.isActive)
      .map((section: SnapshotProfile["sections"][number]) => section.categoryId);
    const points: SnapshotVesselPoint[] = availableSectionIds.length === 0
      ? []
      : await database.vesselSealingPoint.findMany({
        where: {
          vesselId: report.vesselId,
          isActive: true,
          availability: "AVAILABLE",
          sealingPointTemplate: {
            isActive: true,
            categoryId: { in: availableSectionIds },
            category: { isActive: true },
          },
          OR: [{ compartmentId: null }, { compartment: { isActive: true } }],
        },
        include: {
          compartment: true,
          sealingPointTemplate: { include: { category: true } },
        },
        orderBy: [
          { sealingPointTemplate: { category: { sequence: "asc" } } },
          { compartment: { sequence: "asc" } },
          { sequence: "asc" },
          { instanceNo: "asc" },
          { code: "asc" },
        ],
      });

    const capturedAt = new Date();
    const snapshot: FormConfigurationSnapshot = {
      schemaVersion: 1,
      capturedAt: capturedAt.toISOString(),
      formVersion: {
        id: profile.formVersion.id,
        code: profile.formVersion.code,
        name: profile.formVersion.name,
        revision: profile.formVersion.revision,
      },
      vesselFormProfile: { id: profile.id, name: profile.name },
      vessel: report.vessel,
      sections: profile.sections.map((section: SnapshotProfile["sections"][number]) => ({
        id: section.category.id,
        code: section.category.code,
        name: section.category.name,
        sequence: section.sequence,
        isAvailable: section.isAvailable && section.category.isActive,
      })),
      compartments: (compartments as SnapshotCompartment[]).map((compartment) => ({
        id: compartment.id,
        code: compartment.code,
        name: compartment.name,
        side: compartment.side,
        sequence: compartment.sequence,
        description: compartment.description,
      })),
      points: points.map((point: SnapshotVesselPoint) => ({
        vesselSealingPointId: point.id,
        code: point.code,
        displayName: point.displayName,
        side: point.side,
        locationName: point.locationName,
        canvasX: point.canvasX?.toString() ?? null,
        canvasY: point.canvasY?.toString() ?? null,
        instanceNo: point.instanceNo,
        isRequired: point.isRequired,
        sequence: point.sequence,
        section: {
          id: point.sealingPointTemplate.category.id,
          code: point.sealingPointTemplate.category.code,
          name: point.sealingPointTemplate.category.name,
          sequence: point.sealingPointTemplate.category.sequence,
        },
        template: {
          id: point.sealingPointTemplate.id,
          code: point.sealingPointTemplate.code,
          name: point.sealingPointTemplate.name,
          requiresCompartment: point.sealingPointTemplate.requiresCompartment,
          supportsSide: point.sealingPointTemplate.supportsSide,
          sequence: point.sealingPointTemplate.sequence,
        },
        compartment: point.compartment ? {
          id: point.compartment.id,
          code: point.compartment.code,
          name: point.compartment.name,
          side: point.compartment.side,
          sequence: point.compartment.sequence,
        } : null,
      })),
    };

    assertSnapshotIntegrity(report.vesselId, snapshot);

    await database.sealingReport.update({
      where: { id: reportId },
      data: {
        formVersionId: profile.formVersion.id,
        vesselFormProfileId: profile.id,
        formConfigurationSnapshot: asJson(snapshot),
        formInitializedAt: capturedAt,
      },
    });
    await database.auditLog.create({
      data: {
        userId: actor.id,
        action: "UPDATE",
        entityType: "SHIPMENT_VOYAGE",
        entityId: reportId,
        newData: asJson({
          formVersionId: profile.formVersion.id,
          vesselFormProfileId: profile.id,
          formInitializedAt: capturedAt,
          sectionCount: availableSectionIds.length,
          compartmentCount: compartments.length,
          pointCount: snapshot.points.length,
        }),
      },
    });
    const createdCount = await materializeSnapshotRecords(database, reportId, snapshot, actor);
    const sealingProcessStatus = await calculateDraftSealingProcessStatus(database, reportId, snapshot);
    await database.sealingReport.update({ where: { id: reportId }, data: { sealingProcessStatus } });
    return {
      reportId,
      formVersion: snapshot.formVersion,
      vesselFormProfileId: profile.id,
      sectionCount: availableSectionIds.length,
      compartmentCount: compartments.length,
      pointCount: snapshot.points.length,
      readyCount: await database.sealingRecord.count({ where: { sealingReportId: reportId } }),
      createdCount,
      initializedAt: capturedAt,
      sealingProcessStatus,
      reusedSnapshot: false,
    };
  });
}

type FormEntrySeal = {
  sealNumber: string;
  installedAt?: Date | undefined;
  notes?: string | null | undefined;
};

type ResolvedFormPointInput = {
  vesselSealingPointId: string;
  status: FormPointWriteInput["status"];
  notes: string | null;
  seals: FormEntrySeal[];
};

type FormStoredSeal = {
  id: string;
  sealingRecordId: string;
  sealNumber: string;
  status: string;
  installedAt: Date;
  removedAt: Date | null;
  notes: string | null;
};

type FormSealVerification = {
  id: string;
  sealId: string;
  verifiedById: string;
  condition: SealCondition;
  verifiedAt: Date;
  remarks: string | null;
};

type FormStoredSealWithVerifications = FormStoredSeal & {
  verifications: FormSealVerification[];
};

type FormRecordWithSeals = {
  id: string;
  sealingReportId: string;
  vesselSealingPointId: string;
  createdById: string;
  status: FormPointWriteInput["status"];
  notes: string | null;
  pointSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
  seals: FormStoredSeal[];
};

type FormRecordWithVerifications = Omit<FormRecordWithSeals, "seals"> & {
  seals: FormStoredSealWithVerifications[];
};

type LifecycleUser = {
  id: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
};

type LifecycleAttachment = {
  id: string;
  ownerType: string;
  type: string;
  sectionCode: string | null;
  compartmentId: string | null;
  vesselSealingPointId: string | null;
  caption: string | null;
  sequence: number | null;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: bigint | null;
  checksumSha256: string | null;
  uploadedById: string;
  createdAt: Date;
};

type LifecycleSeal = FormStoredSeal & {
  verifications: Array<{
    id: string;
    condition: string;
    verifiedAt: Date;
    remarks: string | null;
    verifiedById: string;
    attachments: LifecycleAttachment[];
  }>;
};

type LifecycleRecord = Omit<FormRecordWithSeals, "seals"> & {
  seals: LifecycleSeal[];
  attachments: LifecycleAttachment[];
};

const snapshotAttachment = (attachment: LifecycleAttachment) => ({
  ...attachment,
  fileSize: attachment.fileSize?.toString() ?? null,
});

type LifecycleReport = {
  id: string;
  reportNo: string;
  vesselId: string;
  createdById: string;
  loadingMasterId: string | null;
  unloadingMasterId: string | null;
  finalizedById: string | null;
  activityId: string | null;
  productId: string | null;
  loadingPlantId: string | null;
  loadingJettyId: string | null;
  dischargePlantId: string | null;
  dischargeJettyId: string | null;
  shipmentNumber: string | null;
  voyageNumber: string | null;
  sealingStatus: string | null;
  sealingProcessStatus: SealingProcessStatus;
  status: ReportStatus;
  reportDateTime: Date;
  departedAt: Date | null;
  arrivedAt: Date | null;
  finishedAt: Date | null;
  remarks: string | null;
  formConfigurationSnapshot: unknown;
  formInitializedAt: Date | null;
  finalSnapshot: unknown;
  vessel: { id: string; name: string; imoNumber: string | null; isActive: boolean };
  activity: { id: string; code: string; name: string; isActive: boolean } | null;
  product: { id: string; name: string; isActive: boolean } | null;
  shipmentProducts: Array<{
    sequence: number;
    product: { id: string; name: string; isActive: boolean };
  }>;
  loadingPlant: { id: string; code: string; name: string; isActive: boolean } | null;
  loadingJetty: { id: string; name: string; isActive: boolean } | null;
  dischargePlant: { id: string; code: string; name: string; isActive: boolean } | null;
  dischargeJetty: { id: string; name: string; isActive: boolean } | null;
  createdBy: LifecycleUser;
  loadingMaster: LifecycleUser | null;
  unloadingMaster: LifecycleUser | null;
  sealingRecords: LifecycleRecord[];
  attachments: LifecycleAttachment[];
  signatures: Array<{
    id: string;
    userId: string | null;
    role: string;
    name: string;
    signedAt: Date | null;
    signatureUrl: string | null;
    signatureFileName: string | null;
    signatureMimeType: string | null;
    signatureFileSize: bigint | null;
    signatureChecksumSha256: string | null;
  }>;
};

type LifecycleValidationIssue = {
  code: string;
  message: string;
  pointIds?: string[];
};

async function loadLifecycleReport(tx: SnapshotTransactionClient, reportId: string) {
  return await tx.sealingReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      reportNo: true,
      vesselId: true,
      createdById: true,
      loadingMasterId: true,
      unloadingMasterId: true,
      finalizedById: true,
      activityId: true,
      productId: true,
      loadingPlantId: true,
      loadingJettyId: true,
      dischargePlantId: true,
      dischargeJettyId: true,
      shipmentNumber: true,
      voyageNumber: true,
      sealingStatus: true,
      sealingProcessStatus: true,
      status: true,
      reportDateTime: true,
      departedAt: true,
      arrivedAt: true,
      finishedAt: true,
      remarks: true,
      formConfigurationSnapshot: true,
      formInitializedAt: true,
      finalSnapshot: true,
      vessel: { select: { id: true, name: true, imoNumber: true, isActive: true } },
      activity: { select: { id: true, code: true, name: true, isActive: true } },
      product: { select: { id: true, name: true, isActive: true } },
      shipmentProducts: {
        select: { sequence: true, product: { select: { id: true, name: true, isActive: true } } },
        orderBy: { sequence: "asc" },
      },
      loadingPlant: { select: { id: true, code: true, name: true, isActive: true } },
      loadingJetty: { select: { id: true, name: true, isActive: true } },
      dischargePlant: { select: { id: true, code: true, name: true, isActive: true } },
      dischargeJetty: { select: { id: true, name: true, isActive: true } },
      createdBy: { select: { id: true, fullName: true, role: true, isActive: true } },
      loadingMaster: { select: { id: true, fullName: true, role: true, isActive: true } },
      unloadingMaster: { select: { id: true, fullName: true, role: true, isActive: true } },
      attachments: {
        select: {
          id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
          vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
          fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
          uploadedById: true, createdAt: true,
        },
        orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
      },
      signatures: {
        where: { phase: null },
        select: {
          id: true, userId: true, role: true, name: true, signedAt: true,
          signatureUrl: true, signatureFileName: true, signatureMimeType: true,
          signatureFileSize: true, signatureChecksumSha256: true,
        },
        orderBy: { role: "asc" },
      },
      sealingRecords: {
        include: {
          attachments: {
            select: {
              id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
              vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
              fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
              uploadedById: true, createdAt: true,
            },
            orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
          },
          seals: {
            include: {
              verifications: {
                select: {
                  id: true, condition: true, verifiedAt: true, remarks: true, verifiedById: true,
                  attachments: {
                    select: {
                      id: true, ownerType: true, type: true, sectionCode: true, compartmentId: true,
                      vesselSealingPointId: true, caption: true, sequence: true, fileName: true,
                      fileUrl: true, mimeType: true, fileSize: true, checksumSha256: true,
                      uploadedById: true, createdAt: true,
                    },
                    orderBy: [{ sequence: "asc" }, { createdAt: "asc" }],
                  },
                },
              },
            },
          },
        },
      },
    },
  }) as unknown as LifecycleReport | null;
}

function activeAssignment(user: LifecycleUser | null, roles: UserRole[]) {
  return Boolean(user?.isActive && roles.includes(user.role));
}

async function evaluateLifecycleReport(tx: SnapshotTransactionClient, report: LifecycleReport) {
  const isCanonicalShipment = report.shipmentNumber !== null;
  const commonDepartureErrors: LifecycleValidationIssue[] = [];
  const finalizationErrors: LifecycleValidationIssue[] = [];
  let snapshot: FormConfigurationSnapshot | null = null;

  if (!activeAssignment(report.loadingMaster, ["LOADING_MASTER", "SUPERVISOR"])) {
    commonDepartureErrors.push({ code: "LOADING_MASTER_REQUIRED", message: "Loading Master aktif dengan role yang sesuai wajib ditetapkan" });
  }
  if (!activeAssignment(report.unloadingMaster, ["UNLOADING_MASTER", "SUPERVISOR"])) {
    commonDepartureErrors.push({ code: "UNLOADING_MASTER_REQUIRED", message: "Unloading Master aktif dengan role yang sesuai wajib ditetapkan sebelum berangkat" });
  }

  if (isCanonicalShipment) {
    const products = report.shipmentProducts.length > 0
      ? report.shipmentProducts.map((item) => item.product)
      : (report.product ? [report.product] : []);
    const loadingBa = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: report.id, phase: "LOADING" } },
      select: { status: true },
    });
    if (loadingBa?.status !== "FINALIZED") {
      commonDepartureErrors.push({
        code: "LOADING_BA_NOT_FINALIZED",
        message: "BA LOADING wajib difinalisasi sebelum kapal berangkat",
      });
    }
    const unloadingBa = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: report.id, phase: "UNLOADING" } },
      select: { status: true },
    });
    if ((loadingBa || unloadingBa) && unloadingBa?.status !== "FINALIZED") {
      finalizationErrors.push({
        code: "UNLOADING_BA_NOT_FINALIZED",
        message: "BA UNLOADING wajib difinalisasi sebelum shipment FINISH",
      });
    }
    const mandatoryFields: Array<[unknown, string]> = [
      [report.activityId, "activityId"],
      [report.voyageNumber, "voyageNumber"],
      [products.length > 0 ? products : null, "productIds"],
      [report.loadingPlantId, "loadingPlantId"],
      [report.loadingJettyId, "loadingJettyId"],
      [report.sealingStatus, "sealingStatus"],
    ];
    const missingFields = mandatoryFields.filter(([value]) => value === null || value === "").map(([, name]) => name);
    if (missingFields.length > 0) {
      commonDepartureErrors.push({ code: "SHIPMENT_FIELDS_INCOMPLETE", message: `Field shipment wajib belum lengkap: ${missingFields.join(", ")}` });
    }
    if (!report.vessel.isActive) commonDepartureErrors.push({ code: "VESSEL_INACTIVE", message: "Vessel shipment tidak aktif" });
    if (!report.activity?.isActive || !supportedActivityCodes.includes(report.activity.code.toUpperCase() as typeof supportedActivityCodes[number])) {
      commonDepartureErrors.push({ code: "ACTIVITY_INVALID", message: "Activity harus aktif dan berkode LOADING, DISCHARGE, atau ROB" });
    }
    if (products.some((product) => !product.isActive)) {
      commonDepartureErrors.push({ code: "PRODUCT_INACTIVE", message: "Satu atau lebih Product shipment tidak aktif" });
    }
    if (!report.loadingPlant?.isActive || !report.loadingJetty?.isActive) commonDepartureErrors.push({ code: "LOADING_LOCATION_INACTIVE", message: "Loading Plant dan Jetty harus aktif" });
    if (report.loadingPlantId && report.loadingJettyId && !(await tx.plantJettyAssignment.findUnique({ where: { plantId_jettyId: { plantId: report.loadingPlantId, jettyId: report.loadingJettyId } }, select: { id: true } }))) {
      commonDepartureErrors.push({ code: "LOADING_JETTY_MISMATCH", message: "Loading Jetty tidak terdaftar pada Loading Plant" });
    }
    if (report.dischargePlantId && report.dischargeJettyId) {
      if (!report.dischargePlant?.isActive || !report.dischargeJetty?.isActive) {
        commonDepartureErrors.push({ code: "DISCHARGE_LOCATION_INACTIVE", message: "Discharge Plant dan Jetty harus aktif" });
      }
      if (!(await tx.plantJettyAssignment.findUnique({ where: { plantId_jettyId: { plantId: report.dischargePlantId, jettyId: report.dischargeJettyId } }, select: { id: true } }))) {
        commonDepartureErrors.push({ code: "DISCHARGE_JETTY_MISMATCH", message: "Discharge Jetty tidak terdaftar pada Discharge Plant" });
      }
    }

    if (!report.dischargePlantId || !report.dischargeJettyId) {
      finalizationErrors.push({ code: "DESTINATION_REQUIRED", message: "Discharge Plant dan Jetty wajib ditetapkan sebelum shipment selesai" });
    } else {
      if (!report.dischargePlant?.isActive || !report.dischargeJetty?.isActive) {
        finalizationErrors.push({ code: "DISCHARGE_LOCATION_INACTIVE", message: "Discharge Plant dan Jetty harus aktif" });
      }
      if (!(await tx.plantJettyAssignment.findUnique({ where: { plantId_jettyId: { plantId: report.dischargePlantId, jettyId: report.dischargeJettyId } }, select: { id: true } }))) {
        finalizationErrors.push({ code: "DISCHARGE_JETTY_MISMATCH", message: "Discharge Jetty tidak terdaftar pada Discharge Plant" });
      }
    }

    snapshot = readFormSnapshot(report.formConfigurationSnapshot);
    if (!snapshot) {
      const issue = { code: "FORM_NOT_INITIALIZED", message: "Snapshot form A-H belum diinisialisasi" };
      commonDepartureErrors.push(issue);
      finalizationErrors.push(issue);
    } else {
      try {
        assertSnapshotIntegrity(report.vesselId, snapshot);
      } catch (error) {
        const issue = {
          code: "FORM_SNAPSHOT_INVALID",
          message: error instanceof Error ? error.message : "Snapshot form A-H tidak valid",
        };
        commonDepartureErrors.push(issue);
        finalizationErrors.push(issue);
        snapshot = null;
      }
    }
  }

  const recordsByPoint = new Map(report.sealingRecords.map((record) => [record.vesselSealingPointId, record]));
  const requiredPoints = snapshot?.points.filter((point) => point.isRequired !== false) ?? [];
  const incompleteRequiredPointIds: string[] = [];
  const requiredWithoutSealPointIds: string[] = [];
  let notApplicableRequiredCount = 0;

  if (snapshot) {
    for (const point of requiredPoints) {
      const record = recordsByPoint.get(point.vesselSealingPointId);
      if (record?.status === "NOT_APPLICABLE") {
        notApplicableRequiredCount += 1;
        continue;
      }
      if (!record || record.status !== "SEALED") {
        incompleteRequiredPointIds.push(point.vesselSealingPointId);
        continue;
      }
      if (!record.seals.some((seal) => seal.status === "INSTALLED" || seal.status === "VERIFIED" || seal.status === "BROKEN")) {
        requiredWithoutSealPointIds.push(point.vesselSealingPointId);
      }
    }
    if (incompleteRequiredPointIds.length > 0) {
      commonDepartureErrors.push({ code: "REQUIRED_POINTS_INCOMPLETE", message: "Titik required masih berstatus NOT_SEALED atau belum mempunyai record", pointIds: incompleteRequiredPointIds });
      finalizationErrors.push({ code: "REQUIRED_POINTS_INCOMPLETE", message: "Titik required belum selesai", pointIds: incompleteRequiredPointIds });
    }
    if (requiredWithoutSealPointIds.length > 0) {
      commonDepartureErrors.push({ code: "REQUIRED_SEAL_NUMBER_MISSING", message: "Titik required berstatus SEALED wajib mempunyai nomor segel", pointIds: requiredWithoutSealPointIds });
      finalizationErrors.push({ code: "REQUIRED_SEAL_NUMBER_MISSING", message: "Titik required tidak mempunyai nomor segel", pointIds: requiredWithoutSealPointIds });
    }

    const snapshotPointIds = new Set(snapshot.points.map((point) => point.vesselSealingPointId));
    const unverifiedPointIds = report.sealingRecords
      .filter((record) => snapshotPointIds.has(record.vesselSealingPointId) && record.status !== "NOT_APPLICABLE")
      .filter((record) => record.seals.some((seal) =>
        !["REMOVED", "REPLACED"].includes(seal.status) && seal.verifications.length === 0))
      .map((record) => record.vesselSealingPointId);
    if (unverifiedPointIds.length > 0) {
      finalizationErrors.push({ code: "SEALS_NOT_VERIFIED", message: "Seluruh nomor segel aktif harus diperiksa sebelum finalisasi", pointIds: unverifiedPointIds });
    }
  } else if (!isCanonicalShipment) {
    if (report.sealingRecords.length === 0) {
      commonDepartureErrors.push({ code: "LEGACY_RECORD_REQUIRED", message: "Perjalanan legacy harus memiliki minimal satu sealing record" });
    }
    const invalidLegacy = report.sealingRecords.filter((record) =>
      record.status === "SEALED" && !record.seals.some((seal) => seal.status === "INSTALLED"));
    if (invalidLegacy.length > 0) {
      commonDepartureErrors.push({ code: "LEGACY_SEAL_MISSING", message: "Record SEALED legacy harus memiliki minimal satu nomor segel" });
    }
    const legacyUnverified = report.sealingRecords.filter((record) =>
      record.status !== "NOT_APPLICABLE" && record.seals.some((seal) => seal.status === "INSTALLED" && seal.verifications.length === 0));
    if (legacyUnverified.length > 0) {
      finalizationErrors.push({ code: "SEALS_NOT_VERIFIED", message: "Seluruh nomor segel aktif harus diperiksa sebelum finalisasi" });
    }
  }

  const sealingReady = !commonDepartureErrors.some((issue) =>
    ["FORM_NOT_INITIALIZED", "FORM_SNAPSHOT_INVALID", "REQUIRED_POINTS_INCOMPLETE", "REQUIRED_SEAL_NUMBER_MISSING", "LEGACY_RECORD_REQUIRED", "LEGACY_SEAL_MISSING"].includes(issue.code));
  const calculatedProcessStatus: SealingProcessStatus = report.status === "FINISH"
    ? "FINALIZED"
    : report.status === "SANDAR"
      ? "VERIFICATION"
      : report.status === "BERLAYAR"
        ? "IN_TRANSIT"
        : !report.formConfigurationSnapshot
          ? "NOT_STARTED"
          : sealingReady ? "READY" : "IN_PROGRESS";

  const departureErrors = [
    ...(report.status === "DRAFT" ? [] : [{ code: "INVALID_JOURNEY_STATUS", message: "Keberangkatan hanya dapat dilakukan dari DRAFT" }]),
    ...commonDepartureErrors,
  ];
  const arrivalErrors: LifecycleValidationIssue[] = [
    ...(report.status === "BERLAYAR" ? [] : [{ code: "INVALID_JOURNEY_STATUS", message: "Kedatangan hanya dapat dilakukan dari BERLAYAR" }]),
    ...(activeAssignment(report.unloadingMaster, ["UNLOADING_MASTER", "SUPERVISOR"])
      ? []
      : [{ code: "UNLOADING_MASTER_REQUIRED", message: "Unloading Master aktif dengan role yang sesuai wajib ditetapkan" }]),
  ];
  const finishErrors: LifecycleValidationIssue[] = [
    ...(report.status === "SANDAR" ? [] : [{ code: "INVALID_JOURNEY_STATUS", message: "Finalisasi hanya dapat dilakukan dari SANDAR" }]),
    ...(activeAssignment(report.unloadingMaster, ["UNLOADING_MASTER", "SUPERVISOR"])
      ? []
      : [{ code: "UNLOADING_MASTER_REQUIRED", message: "Unloading Master aktif dengan role yang sesuai wajib ditetapkan" }]),
    ...finalizationErrors,
  ];

  return {
    reportId: report.id,
    activity: report.activity ? { id: report.activity.id, code: report.activity.code, name: report.activity.name } : null,
    journeyStatus: report.status,
    sealingStatus: report.sealingStatus,
    sealingProcessStatus: calculatedProcessStatus,
    storedSealingProcessStatus: report.sealingProcessStatus,
    assignments: {
      loadingMaster: report.loadingMaster,
      unloadingMaster: report.unloadingMaster,
    },
    summary: {
      snapshotPointCount: snapshot?.points.length ?? 0,
      requiredCount: requiredPoints.length,
      notApplicableRequiredCount,
      recordCount: report.sealingRecords.length,
    },
    transitions: {
      depart: { allowed: departureErrors.length === 0, errors: departureErrors },
      arrive: { allowed: arrivalErrors.length === 0, errors: arrivalErrors },
      finalize: { allowed: finishErrors.length === 0, errors: finishErrors },
    },
    rules: {
      supportedActivities: [...supportedActivityCodes],
      requiredSealPolicy: "AVAILABLE_AND_REQUIRED_ONLY",
      documentationRequired: false,
      notApplicableBlocksFinalization: false,
      revisionSupported: false,
    },
  };
}

export async function validateReportLifecycle(reportId: string, actor: Actor) {
  const report = await loadLifecycleReport(prisma as unknown as SnapshotTransactionClient, reportId);
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertFormReadable(report, actor);
  return evaluateLifecycleReport(prisma as unknown as SnapshotTransactionClient, report);
}

const transitions: Record<"depart" | "arrive" | "finish", {
  from: ReportStatus;
  to: ReportStatus;
  action: AuditAction;
  timestamp: "departedAt" | "arrivedAt" | "finishedAt";
  processStatus: SealingProcessStatus;
}> = {
  depart: { from: "DRAFT", to: "BERLAYAR", action: "DEPART", timestamp: "departedAt", processStatus: "IN_TRANSIT" },
  arrive: { from: "BERLAYAR", to: "SANDAR", action: "ARRIVE", timestamp: "arrivedAt", processStatus: "VERIFICATION" },
  finish: { from: "SANDAR", to: "FINISH", action: "FINALIZE", timestamp: "finishedAt", processStatus: "FINALIZED" },
};

export type JourneyTransitionOptions = {
  occurredAt?: Date | undefined;
  remarks?: string | null | undefined;
  dischargePlantId?: string | undefined;
  dischargeJettyId?: string | undefined;
};


export async function transitionReport(
  id: string,
  transition: keyof typeof transitions,
  optionsOrOccurredAt: JourneyTransitionOptions | Date | undefined,
  remarksOrActor?: string | null | Actor,
  maybeActor?: Actor,
) {
  let occurredAt: Date | undefined;
  let remarks: string | null | undefined;
  let dischargePlantId: string | undefined;
  let dischargeJettyId: string | undefined;
  let actor: Actor;

  if (optionsOrOccurredAt instanceof Date || optionsOrOccurredAt === undefined) {
    occurredAt = optionsOrOccurredAt;
    if (maybeActor) {
      remarks = remarksOrActor as string | null | undefined;
      actor = maybeActor;
    } else {
      actor = remarksOrActor as Actor;
    }
  } else {
    occurredAt = optionsOrOccurredAt.occurredAt;
    remarks = optionsOrOccurredAt.remarks;
    dischargePlantId = optionsOrOccurredAt.dischargePlantId;
    dischargeJettyId = optionsOrOccurredAt.dischargeJettyId;
    actor = (remarksOrActor as Actor) ?? maybeActor!;
  }

  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const report = await loadLifecycleReport(tx, id);
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    const rule = transitions[transition];
    if (report.status !== rule.from) throw new AppError(400, `Transisi ${report.status} ke ${rule.to} tidak valid`);

    if (transition === "depart") assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (transition === "arrive" || transition === "finish") assertUnloadingAssignment(report.unloadingMasterId, actor);

    if (transition === "arrive" && dischargePlantId && dischargeJettyId) {
      await validateDestinationReferences({ dischargePlantId, dischargeJettyId }, tx);
    }

    const validation = await evaluateLifecycleReport(tx, report);
    const transitionValidation = validation.transitions[transition === "finish" ? "finalize" : transition];
    if (!transitionValidation.allowed) {
      throw new AppError(400, `Validasi ${transition === "finish" ? "finalisasi" : transition} gagal`, transitionValidation.errors);
    }

    const transitionAt = occurredAt ?? new Date();
    const existingPhaseDocument = transition === "finish" && report.shipmentNumber
      ? await tx.beritaAcaraDocument.findFirst({ where: { sealingReportId: id }, select: { id: true } })
      : null;
    const unloadingDocument = transition === "finish" && report.shipmentNumber && existingPhaseDocument
      ? await tx.beritaAcaraDocument.findUnique({
        where: { sealingReportId_phase: { sealingReportId: id, phase: "UNLOADING" } },
        select: { status: true, snapshot: true },
      })
      : null;
    const useLegacyFinalSnapshot = transition === "finish" && (!report.shipmentNumber || !existingPhaseDocument);
    const legacyFinalSnapshot = useLegacyFinalSnapshot ? asJson({
      schemaVersion: 1,
      capturedAt: transitionAt.toISOString(),
      finalizedById: actor.id,
      report: {
        id: report.id,
        reportNo: report.reportNo,
        shipmentNumber: report.shipmentNumber,
        voyageNumber: report.voyageNumber,
        activity: report.activity,
        vessel: report.vessel,
        product: report.shipmentProducts[0]?.product ?? report.product,
        products: report.shipmentProducts.length > 0
          ? report.shipmentProducts.map((item) => item.product)
          : (report.product ? [report.product] : []),
        loadingPlant: report.loadingPlant,
        loadingJetty: report.loadingJetty,
        dischargePlant: report.dischargePlant,
        dischargeJetty: report.dischargeJetty,
        sealingStatus: report.sealingStatus,
        journeyStatus: "FINISH",
        sealingProcessStatus: "FINALIZED",
        reportDateTime: report.reportDateTime,
        departedAt: report.departedAt,
        arrivedAt: report.arrivedAt,
        finishedAt: transitionAt,
        loadingMaster: report.loadingMaster,
        unloadingMaster: report.unloadingMaster,
        remarks: remarks === undefined ? report.remarks : remarks,
      },
      formConfigurationSnapshot: report.formConfigurationSnapshot,
      attachments: report.attachments.map(snapshotAttachment),
      signatures: report.signatures.map((signature) => ({
        ...signature,
        signatureFileSize: signature.signatureFileSize?.toString() ?? null,
      })),
      records: report.sealingRecords.map((record) => ({
        id: record.id,
        vesselSealingPointId: record.vesselSealingPointId,
        pointSnapshot: record.pointSnapshot,
        status: record.status,
        notes: record.notes,
        attachments: record.attachments.map(snapshotAttachment),
        seals: record.seals.map((seal) => ({
          id: seal.id,
          sealNumber: seal.sealNumber,
          status: seal.status,
          installedAt: seal.installedAt,
          removedAt: seal.removedAt,
          notes: seal.notes,
          verifications: seal.verifications.map((verification) => ({
            ...verification,
            attachments: verification.attachments.map(snapshotAttachment),
          })),
        })),
      })),
    }) : undefined;
    let finalSnapshot = legacyFinalSnapshot;
    if (transition === "finish" && report.shipmentNumber && existingPhaseDocument) {
      if (!unloadingDocument || unloadingDocument.status !== "FINALIZED" || !unloadingDocument.snapshot) {
        throw new AppError(409, "Snapshot BA UNLOADING final tidak tersedia");
      }
      finalSnapshot = asJson(unloadingDocument.snapshot);
    }
    const data = {
      status: rule.to,
      sealingProcessStatus: rule.processStatus,
      [rule.timestamp]: transitionAt,
      ...(transition === "arrive" && dischargePlantId && dischargeJettyId ? {
        dischargePlantId,
        dischargeJettyId,
      } : {}),
      ...(transition === "finish" && finalSnapshot !== undefined ? { finalizedById: actor.id, finalSnapshot } : transition === "finish" ? { finalizedById: actor.id } : {}),
      ...(remarks === undefined ? {} : { remarks }),
    };
    const updated = await tx.sealingReport.update({ where: { id }, data, include: reportInclude });
    if (transition === "arrive" && dischargePlantId && dischargeJettyId) {
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "UPDATE",
          entityType: "SHIPMENT_DESTINATION_ASSIGNMENT",
          entityId: id,
          oldData: asJson({
            dischargePlantId: report.dischargePlantId,
            dischargeJettyId: report.dischargeJettyId,
            unloadingMasterId: report.unloadingMasterId,
          }),
          newData: asJson({
            dischargePlantId,
            dischargeJettyId,
            unloadingMasterId: report.unloadingMasterId,
            assignedById: actor.id,
            assignedAt: transitionAt.toISOString(),
          }),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: rule.action,
        entityType: "SHIPMENT_VOYAGE",
        entityId: id,
        oldData: asJson({ status: report.status, sealingProcessStatus: report.sealingProcessStatus }),
        newData: asJson(data),
      },
    });
    return updated;
  });
}

const normalizeSealNumber = (sealNumber: string) => sealNumber.trim().toUpperCase();
const sideOrder = (side: string | null) => side === "PORT" ? 1 : side === "STBD" ? 2 : side === "CENTER" ? 3 : 4;

function assertFormReadable(
  report: { createdById: string; loadingMasterId: string | null; unloadingMasterId: string | null; status: ReportStatus },
  actor: Actor,
) {
  if (actor.role === "LOADING_MASTER" && (report.loadingMasterId ?? report.createdById) !== actor.id) {
    throw new AppError(403, "Anda tidak berhak melihat perjalanan ini");
  }
  if (
    actor.role === "UNLOADING_MASTER" &&
    report.unloadingMasterId !== actor.id &&
    report.createdById !== actor.id
  ) {
    throw new AppError(403, "Anda tidak berhak menerima perjalanan ini");
  }
}

function buildGroupedForm(
  report: {
    id: string;
    vesselId: string;
    createdById: string;
    loadingMasterId: string | null;
    unloadingMasterId: string | null;
    status: ReportStatus;
    shipmentNumber: string | null;
    voyageNumber: string | null;
    formInitializedAt: Date | null;
    formConfigurationSnapshot: unknown;
    baDocuments: Array<{ status: "DRAFT" | "FINALIZED" }>;
    sealingRecords: FormRecordWithVerifications[];
  },
  snapshot: FormConfigurationSnapshot,
  actor: Actor,
) {
  const records = new Map(report.sealingRecords.map((record) => [record.vesselSealingPointId, record]));
  const sections = [...snapshot.sections]
    .sort((left, right) => left.sequence - right.sequence || left.code.localeCompare(right.code))
    .map((section) => {
      const rows = new Map<string, {
        rowKey: string;
        rowSequence: number;
        label: string;
        compartment: FormSnapshotPoint["compartment"];
        columns: Array<{
          columnKey: string;
          columnSequence: number;
          label: string;
          positionKey: string;
          vesselSealingPointId: string;
          recordId: string | null;
          sectionSequence: number;
          rowSequence: number;
          compartment: FormSnapshotPoint["compartment"];
          side: string | null;
          instance: number;
          required: boolean;
          template: FormSnapshotPoint["template"];
          point: Pick<FormSnapshotPoint, "code" | "displayName" | "locationName" | "sequence" | "canvasX" | "canvasY">;
          status: FormPointWriteInput["status"];
          notes: string | null;
          seals: Array<{
            id: string;
            sealNumber: string;
            status: string;
            installedAt: Date;
            removedAt: Date | null;
            notes: string | null;
            verifications: FormSealVerification[];
          }>;
        }>;
      }>();

      for (const point of snapshot.points.filter((candidate) => candidate.section.id === section.id)) {
        const rowKey = point.compartment
          ? `COMPARTMENT:${point.compartment.id}`
          : `EQUIPMENT:${point.template.id}`;
        const rowSequence = point.compartment?.sequence ?? point.template.sequence;
        const row = rows.get(rowKey) ?? {
          rowKey,
          rowSequence,
          label: point.compartment?.name ?? point.displayName ?? point.template.name,
          compartment: point.compartment,
          columns: [],
        };
        const record = records.get(point.vesselSealingPointId);
        const effectiveSide = point.side ?? point.compartment?.side ?? null;
        row.columns.push({
          columnKey: snapshotPointPositionKey(point),
          columnSequence: point.sequence ?? point.template.sequence,
          label: point.displayName ?? point.template.name,
          positionKey: snapshotPointPositionKey(point),
          vesselSealingPointId: point.vesselSealingPointId,
          recordId: record?.id ?? null,
          sectionSequence: section.sequence,
          rowSequence,
          compartment: point.compartment,
          side: effectiveSide,
          instance: point.instanceNo,
          required: point.isRequired !== false,
          template: point.template,
          point: {
            code: point.code,
            displayName: point.displayName,
            locationName: point.locationName,
            sequence: point.sequence,
            canvasX: point.canvasX ?? null,
            canvasY: point.canvasY ?? null,
          },
          status: record?.status ?? "NOT_SEALED",
          notes: record?.notes ?? null,
          seals: (record?.seals ?? [])
            .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
            .sort((left, right) => left.installedAt.getTime() - right.installedAt.getTime() || left.sealNumber.localeCompare(right.sealNumber))
            .map((seal) => ({
              id: seal.id,
              sealNumber: seal.sealNumber,
              status: seal.status,
              installedAt: seal.installedAt,
              removedAt: seal.removedAt,
              notes: seal.notes,
              verifications: seal.verifications,
            })),
        });
        rows.set(rowKey, row);
      }

      return {
        id: section.id,
        code: section.code,
        name: section.name,
        sequence: section.sequence,
        isAvailable: section.isAvailable,
        rows: [...rows.values()]
          .sort((left, right) => left.rowSequence - right.rowSequence || left.rowKey.localeCompare(right.rowKey))
          .map((row) => ({
            ...row,
            columns: row.columns.sort((left, right) =>
              left.columnSequence - right.columnSequence ||
              sideOrder(left.side) - sideOrder(right.side) ||
              left.instance - right.instance ||
              left.positionKey.localeCompare(right.positionKey)),
          })),
      };
    });

  return {
    report: {
      id: report.id,
      shipmentNumber: report.shipmentNumber,
      voyageNumber: report.voyageNumber,
      status: report.status,
      isEditable: report.status === "DRAFT" && !report.baDocuments.some((document) => document.status === "FINALIZED") && canLoad(actor) && (canManage(actor) || (report.loadingMasterId ?? report.createdById) === actor.id),
      vessel: snapshot.vessel,
      formVersion: snapshot.formVersion,
      vesselFormProfile: snapshot.vesselFormProfile,
      initializedAt: report.formInitializedAt,
      capturedAt: snapshot.capturedAt,
    },
    sections,
  };
}

export async function getReportFormStructure(reportId: string, actor: Actor) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      vesselId: true,
      createdById: true,
      loadingMasterId: true,
      unloadingMasterId: true,
      status: true,
      shipmentNumber: true,
      voyageNumber: true,
      formInitializedAt: true,
      formConfigurationSnapshot: true,
      baDocuments: { where: { phase: "LOADING" }, select: { status: true } },
      sealingRecords: { include: { seals: { include: { verifications: {
        select: { id: true, sealId: true, verifiedById: true, condition: true, verifiedAt: true, remarks: true },
        orderBy: [{ verifiedAt: "asc" }, { id: "asc" }],
      } } } } },
    },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertFormReadable(report, actor);
  const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
  if (!snapshot) throw new AppError(400, "Form A-H belum diinisialisasi untuk shipment/voyage ini");
  assertSnapshotIntegrity(report.vesselId, snapshot);
  return buildGroupedForm(report, snapshot, actor);
}

function validateResolvedFormPoint(input: ResolvedFormPointInput) {
  const sealNumbers = input.seals.map((seal) => normalizeSealNumber(seal.sealNumber));
  if (new Set(sealNumbers).size !== sealNumbers.length) {
    throw new AppError(400, `Nomor segel duplikat pada titik ${input.vesselSealingPointId}`);
  }
  if (input.status === "SEALED" && sealNumbers.length === 0) {
    throw new AppError(400, "Status SEALED wajib mempunyai minimal satu nomor segel");
  }
  if (input.status !== "SEALED" && sealNumbers.length > 0) {
    throw new AppError(400, "Status NOT_SEALED/NOT_APPLICABLE tidak boleh mempunyai nomor segel");
  }
}

async function mutateFormPoints(
  reportId: string,
  requestedSectionCode: string | null,
  inputs: Array<{
    vesselSealingPointId: string;
    status?: FormPointWriteInput["status"] | undefined;
    notes?: string | null | undefined;
    seals?: FormEntrySeal[] | undefined;
  }>,
  actor: Actor,
  options: { replace: boolean; auditAction: "UPDATE" | "DELETE"; batch: boolean },
) {
  await prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE',
      reportId,
    );
    const report = await tx.sealingReport.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        vesselId: true,
        createdById: true,
        loadingMasterId: true,
        status: true,
        formConfigurationSnapshot: true,
        sealingRecords: { include: { seals: true } },
      },
    }) as unknown as {
      id: string;
      vesselId: string;
      createdById: string;
      loadingMasterId: string | null;
      status: ReportStatus;
      formConfigurationSnapshot: unknown;
      sealingRecords: FormRecordWithSeals[];
    } | null;
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (report.status !== "DRAFT") throw new AppError(400, "Input form A-H hanya dapat diubah saat shipment/voyage DRAFT");
    await assertLoadingBaOpen(tx, reportId);

    const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
    if (!snapshot) throw new AppError(400, "Form A-H belum diinisialisasi untuk shipment/voyage ini");
    assertSnapshotIntegrity(report.vesselId, snapshot);

    const section = requestedSectionCode
      ? snapshot.sections.find((candidate) => candidate.code === requestedSectionCode)
      : null;
    if (requestedSectionCode && (!section || !section.isAvailable)) {
      throw new AppError(400, `Section ${requestedSectionCode} tidak tersedia pada snapshot laporan`);
    }

    const requestedPointIds = inputs.map((input) => input.vesselSealingPointId);
    if (new Set(requestedPointIds).size !== requestedPointIds.length) {
      throw new AppError(400, "Titik tidak boleh duplikat dalam satu request");
    }

    const snapshotPoints = new Map(snapshot.points.map((point) => [point.vesselSealingPointId, point]));
    for (const input of inputs) {
      const point = snapshotPoints.get(input.vesselSealingPointId);
      if (!point) throw new AppError(400, `Titik ${input.vesselSealingPointId} tidak berasal dari snapshot laporan`);
      if (requestedSectionCode && point.section.code !== requestedSectionCode) {
        throw new AppError(400, `Titik ${point.code} bukan bagian dari section ${requestedSectionCode}`);
      }
      const pointSection = snapshot.sections.find((candidate) => candidate.id === point.section.id);
      if (!pointSection?.isAvailable) throw new AppError(400, `Section ${point.section.code} tidak tersedia pada snapshot laporan`);
      if (point.compartment && !snapshot.compartments.some((compartment) => compartment.id === point.compartment?.id)) {
        throw new AppError(400, `Compartment titik ${point.code} tidak sesuai dengan snapshot laporan`);
      }
    }

    const existingRecords = new Map(report.sealingRecords.map((record) => [record.vesselSealingPointId, record]));
    const resolvedInputs: ResolvedFormPointInput[] = inputs.map((input) => {
      const existing = existingRecords.get(input.vesselSealingPointId);
      const resolved: ResolvedFormPointInput = {
        vesselSealingPointId: input.vesselSealingPointId,
        status: input.status ?? existing?.status ?? "NOT_SEALED",
        notes: input.notes === undefined
          ? (options.replace ? null : existing?.notes ?? null)
          : input.notes,
        seals: input.seals === undefined
          ? (options.replace ? [] : (existing?.seals ?? [])
            .filter((seal) => !["REMOVED", "REPLACED"].includes(seal.status))
            .map((seal) => ({
              sealNumber: seal.sealNumber,
              installedAt: seal.installedAt,
              notes: seal.notes,
            })))
          : input.seals,
      };
      validateResolvedFormPoint(resolved);
      return resolved;
    });

    const sealOwnerByNumber = new Map<string, string>();
    for (const input of resolvedInputs) {
      for (const seal of input.seals) {
        const sealNumber = normalizeSealNumber(seal.sealNumber);
        const owner = sealOwnerByNumber.get(sealNumber);
        if (owner && owner !== input.vesselSealingPointId) {
          throw new AppError(409, `Nomor segel ${sealNumber} digunakan lebih dari satu titik dalam request`);
        }
        sealOwnerByNumber.set(sealNumber, input.vesselSealingPointId);
      }
    }

    const recordIdByPoint = new Map<string, string>();
    for (const input of resolvedInputs) {
      recordIdByPoint.set(
        input.vesselSealingPointId,
        existingRecords.get(input.vesselSealingPointId)?.id ?? randomUUID(),
      );
    }
    const pointByRecordId = new Map([...recordIdByPoint.entries()].map(([pointId, recordId]) => [recordId, pointId]));
    const desiredNumbersByPoint = new Map(resolvedInputs.map((input) => [
      input.vesselSealingPointId,
      new Set(input.seals.map((seal) => normalizeSealNumber(seal.sealNumber))),
    ]));
    const allDesiredSealNumbers = [...sealOwnerByNumber.keys()];
    const occupiedSeals = allDesiredSealNumbers.length === 0
      ? []
      : await tx.seal.findMany({
        where: { sealingReportId: reportId, sealNumber: { in: allDesiredSealNumbers } },
        select: { sealNumber: true, sealingRecordId: true },
      });
    for (const occupied of occupiedSeals) {
      const normalizedOccupiedNumber = normalizeSealNumber(occupied.sealNumber);
      const desiredPointId = sealOwnerByNumber.get(normalizedOccupiedNumber);
      const desiredRecordId = desiredPointId ? recordIdByPoint.get(desiredPointId) : undefined;
      if (occupied.sealingRecordId === desiredRecordId) continue;

      const currentPointId = pointByRecordId.get(occupied.sealingRecordId);
      const currentPointWillRelease = currentPointId
        ? !desiredNumbersByPoint.get(currentPointId)?.has(normalizedOccupiedNumber)
        : false;
      if (!currentPointWillRelease) {
        throw new AppError(409, `Nomor segel ${normalizedOccupiedNumber} sudah digunakan pada titik lain`);
      }
    }

    const oldValues = new Map(resolvedInputs.map((input) => {
      const record = existingRecords.get(input.vesselSealingPointId);
      return [input.vesselSealingPointId, record ? {
        status: record.status,
        notes: record.notes,
        seals: record.seals.map((seal) => ({ sealNumber: seal.sealNumber, installedAt: seal.installedAt, notes: seal.notes })),
      } : null];
    }));

    for (const input of resolvedInputs) {
      const recordId = recordIdByPoint.get(input.vesselSealingPointId)!;
      const point = snapshotPoints.get(input.vesselSealingPointId)!;
      if (!existingRecords.has(input.vesselSealingPointId)) {
        await tx.sealingRecord.create({
          data: {
            id: recordId,
            sealingReportId: reportId,
            vesselSealingPointId: input.vesselSealingPointId,
            createdById: actor.id,
            status: "NOT_SEALED",
            pointSnapshot: asJson(point),
          },
        });
      }
      const desiredNumbers = [...desiredNumbersByPoint.get(input.vesselSealingPointId)!];
      await tx.seal.updateMany({
        where: {
          sealingRecordId: recordId,
          status: { notIn: ["REMOVED", "REPLACED"] },
          ...(desiredNumbers.length > 0 ? { sealNumber: { notIn: desiredNumbers } } : {}),
        },
        data: { status: "REPLACED", removedAt: new Date() },
      });
    }

    for (const input of resolvedInputs) {
      const recordId = recordIdByPoint.get(input.vesselSealingPointId)!;
      const oldValue = oldValues.get(input.vesselSealingPointId);
      for (const sealInput of input.seals) {
        const sealNumber = normalizeSealNumber(sealInput.sealNumber);
        const existingSeal = await tx.seal.findUnique({
          where: { sealingReportId_sealNumber: { sealingReportId: reportId, sealNumber } },
        });
        const sealData = {
          status: "INSTALLED" as const,
          removedAt: null,
          ...(sealInput.installedAt === undefined ? {} : { installedAt: sealInput.installedAt }),
          notes: sealInput.notes ?? null,
        };
        if (existingSeal) {
          if (existingSeal.sealingRecordId !== recordId) {
            throw new AppError(409, `Nomor segel ${sealNumber} sudah digunakan pada titik lain`);
          }
          if (["REMOVED", "REPLACED"].includes(existingSeal.status)) {
            throw new AppError(409, `Nomor segel ${sealNumber} sudah menjadi riwayat dalam shipment ini`);
          }
          await tx.seal.update({ where: { id: existingSeal.id }, data: sealData });
        } else {
          await tx.seal.create({
            data: {
              id: randomUUID(),
              sealingRecordId: recordId,
              sealingReportId: reportId,
              sealNumber,
              ...sealData,
            },
          });
        }
      }
      await tx.sealingRecord.update({
        where: { id: recordId },
        data: {
          status: input.status,
          notes: input.notes,
          pointSnapshot: asJson(snapshotPoints.get(input.vesselSealingPointId)!),
        },
      });
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: options.auditAction,
          entityType: "A_H_POINT_INPUT",
          entityId: recordId,
          ...(oldValue === null || oldValue === undefined ? {} : { oldData: asJson(oldValue) }),
          newData: asJson({
            reportId,
            vesselSealingPointId: input.vesselSealingPointId,
            sectionCode: snapshotPoints.get(input.vesselSealingPointId)!.section.code,
            status: input.status,
            notes: input.notes,
            seals: input.seals.map((seal) => ({
              sealNumber: normalizeSealNumber(seal.sealNumber),
              installedAt: seal.installedAt,
              notes: seal.notes ?? null,
            })),
          }),
        },
      });
    }

    const sealingProcessStatus = await calculateDraftSealingProcessStatus(tx, reportId, snapshot);
    await tx.sealingReport.update({ where: { id: reportId }, data: { sealingProcessStatus } });

    if (options.batch) {
      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "UPDATE",
          entityType: "A_H_SECTION_INPUT",
          entityId: reportId,
          newData: asJson({
            sectionCode: requestedSectionCode,
            pointCount: resolvedInputs.length,
            vesselSealingPointIds: resolvedInputs.map((input) => input.vesselSealingPointId),
          }),
        },
      });
    }
  });
}

async function findFormPointResult(reportId: string, pointId: string, actor: Actor) {
  const form = await getReportFormStructure(reportId, actor);
  for (const section of form.sections) {
    for (const row of section.rows) {
      const point = row.columns.find((column) => column.vesselSealingPointId === pointId);
      if (point) return { reportId, sectionCode: section.code, point };
    }
  }
  throw new AppError(404, "Titik tidak ditemukan pada struktur form laporan");
}

export async function writeReportFormPoint(
  reportId: string,
  pointId: string,
  input: FormPointWriteInput,
  actor: Actor,
) {
  await mutateFormPoints(reportId, null, [{ vesselSealingPointId: pointId, ...input }], actor, {
    replace: true,
    auditAction: "UPDATE",
    batch: false,
  });
  return findFormPointResult(reportId, pointId, actor);
}

export async function patchReportFormPoint(
  reportId: string,
  pointId: string,
  input: FormPointPatchInput,
  actor: Actor,
) {
  await mutateFormPoints(reportId, null, [{ vesselSealingPointId: pointId, ...input }], actor, {
    replace: false,
    auditAction: "UPDATE",
    batch: false,
  });
  return findFormPointResult(reportId, pointId, actor);
}

export async function clearReportFormPoint(reportId: string, pointId: string, actor: Actor) {
  await mutateFormPoints(reportId, null, [{
    vesselSealingPointId: pointId,
    status: "NOT_SEALED",
    notes: null,
    seals: [],
  }], actor, {
    replace: true,
    auditAction: "DELETE",
    batch: false,
  });
  return findFormPointResult(reportId, pointId, actor);
}

export async function batchWriteReportFormSection(
  reportId: string,
  sectionCode: string,
  input: FormSectionBatchInput,
  actor: Actor,
) {
  await mutateFormPoints(reportId, sectionCode, input.points, actor, {
    replace: true,
    auditAction: "UPDATE",
    batch: true,
  });
  const form = await getReportFormStructure(reportId, actor);
  const section = form.sections.find((candidate) => candidate.code === sectionCode);
  if (!section) throw new AppError(404, `Section ${sectionCode} tidak ditemukan pada snapshot laporan`);
  return { reportId, section };
}

export async function listRecords(reportId: string, page: number, limit: number, actor?: Actor) {
  await getReport(reportId, actor);
  const total = await prisma.sealingRecord.count({ where: { sealingReportId: reportId } });
  const pagination = resolvePagination(page, limit, total);
  const items = await prisma.sealingRecord.findMany({ where: { sealingReportId: reportId }, include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: true }, skip: pagination.skip, take: pagination.take, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { items, pagination: pagination.meta };
}

export async function createRecord(reportId: string, input: CreateRecordInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', reportId);
    const report = await tx.sealingReport.findUnique({ where: { id: reportId }, select: { id: true, vesselId: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true } });
    if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
    assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (report.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diedit");
    await assertLoadingBaOpen(tx, reportId);
    const point = await tx.vesselSealingPoint.findUnique({ where: { id: input.vesselSealingPointId }, select: { vesselId: true, isActive: true, availability: true } });
    if (!point || !point.isActive || point.availability === "INACTIVE") throw new AppError(400, "Titik sealing tidak tersedia");
    if (point.vesselId !== report.vesselId) throw new AppError(400, "Titik sealing harus berasal dari vessel laporan");
    const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
    const snapshotPoint = snapshot?.points.find((item) => item.vesselSealingPointId === input.vesselSealingPointId);
    if (report.formConfigurationSnapshot && !snapshotPoint) throw new AppError(400, "Titik sealing tidak termasuk snapshot form laporan");
    const id = randomUUID();
    const data = withoutUndefined({ id, sealingReportId: reportId, vesselSealingPointId: input.vesselSealingPointId, createdById: actor.id, status: input.status, notes: input.notes, pointSnapshot: snapshotPoint ? asJson(snapshotPoint) : undefined });
    const created = await tx.sealingRecord.create({ data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "CREATE", entityType: "SEALING_RECORD", entityId: id, newData: asJson(data) } });
    if (snapshot) await tx.sealingReport.update({ where: { id: reportId }, data: { sealingProcessStatus: await calculateDraftSealingProcessStatus(tx, reportId, snapshot) } });
    return created;
  });
}

export async function updateRecord(id: string, input: UpdateRecordInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    const located = await tx.sealingRecord.findUnique({ where: { id }, select: { sealingReportId: true } });
    if (!located) throw new AppError(404, "Sealing record tidak ditemukan");
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', located.sealingReportId);
    const old = await tx.sealingRecord.findUnique({ where: { id }, include: { sealingReport: { select: { id: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true } } } });
    if (!old) throw new AppError(404, "Sealing record tidak ditemukan");
    assertLoadingOwner(old.sealingReport.createdById, actor, old.sealingReport.loadingMasterId);
    if (old.sealingReport.status !== "DRAFT") throw new AppError(400, "Record hanya dapat diubah saat laporan DRAFT");
    await assertLoadingBaOpen(tx, old.sealingReport.id);
    const data = withoutUndefined(input);
    const updated = await tx.sealingRecord.update({ where: { id }, data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", entityType: "SEALING_RECORD", entityId: id, oldData: asJson(old), newData: asJson(data) } });
    const snapshot = readFormSnapshot(old.sealingReport.formConfigurationSnapshot);
    if (snapshot) await tx.sealingReport.update({ where: { id: old.sealingReport.id }, data: { sealingProcessStatus: await calculateDraftSealingProcessStatus(tx, old.sealingReport.id, snapshot) } });
    return updated;
  });
}
export async function deleteRecord(id: string, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    const located = await tx.sealingRecord.findUnique({ where: { id }, select: { sealingReportId: true } });
    if (!located) throw new AppError(404, "Sealing record tidak ditemukan");
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', located.sealingReportId);
    const old = await tx.sealingRecord.findUnique({ where: { id }, include: { sealingReport: { select: { id: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true } } } });
    if (!old) throw new AppError(404, "Sealing record tidak ditemukan");
    assertLoadingOwner(old.sealingReport.createdById, actor, old.sealingReport.loadingMasterId);
    if (old.sealingReport.status !== "DRAFT") throw new AppError(400, "Record hanya dapat diubah saat laporan DRAFT");
    await assertLoadingBaOpen(tx, old.sealingReport.id);
    const deleted = await tx.sealingRecord.delete({ where: { id } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "DELETE", entityType: "SEALING_RECORD", entityId: id, oldData: asJson(old) } });
    const snapshot = readFormSnapshot(old.sealingReport.formConfigurationSnapshot);
    if (snapshot) await tx.sealingReport.update({ where: { id: old.sealingReport.id }, data: { sealingProcessStatus: await calculateDraftSealingProcessStatus(tx, old.sealingReport.id, snapshot) } });
    return deleted;
  });
}

export async function createSeal(recordId: string, input: CreateSealInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    const located = await tx.sealingRecord.findUnique({ where: { id: recordId }, select: { sealingReportId: true } });
    if (!located) throw new AppError(404, "Sealing record tidak ditemukan");
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', located.sealingReportId);
    const record = await tx.sealingRecord.findUnique({ where: { id: recordId }, include: { sealingReport: { select: { id: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true } } } });
    if (!record) throw new AppError(404, "Sealing record tidak ditemukan");
    assertLoadingOwner(record.sealingReport.createdById, actor, record.sealingReport.loadingMasterId);
    if (record.sealingReport.status !== "DRAFT") throw new AppError(400, "Seal hanya dapat diubah saat laporan DRAFT");
    await assertLoadingBaOpen(tx, record.sealingReport.id);
    const id = randomUUID();
    const data = withoutUndefined({ id, sealingRecordId: recordId, sealingReportId: record.sealingReport.id, sealNumber: normalizeSealNumber(input.sealNumber), installedAt: input.installedAt, notes: input.notes });
    const created = await tx.seal.create({ data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "INSTALL_SEAL", entityType: "SEAL", entityId: id, newData: asJson(data) } });
    const snapshot = readFormSnapshot(record.sealingReport.formConfigurationSnapshot);
    if (snapshot) await tx.sealingReport.update({ where: { id: record.sealingReport.id }, data: { sealingProcessStatus: await calculateDraftSealingProcessStatus(tx, record.sealingReport.id, snapshot) } });
    return created;
  });
}

type LockedEditableSeal = Prisma.SealGetPayload<Record<string, never>> & {
  sealingRecord: {
    sealingReport: {
      id: string;
      createdById: string;
      loadingMasterId: string | null;
      status: ReportStatus;
      formConfigurationSnapshot: unknown;
    };
  };
};

async function mutateLegacySeal<T>(
  id: string,
  actor: Actor,
  mutation: (tx: SnapshotTransactionClient, old: LockedEditableSeal) => Promise<T>,
) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    const located = await tx.seal.findUnique({ where: { id }, select: { sealingReportId: true } });
    if (!located) throw new AppError(404, "Seal tidak ditemukan");
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', located.sealingReportId);
    const old = await tx.seal.findUnique({
      where: { id },
      include: {
        sealingRecord: {
          include: {
            sealingReport: {
              select: { id: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true },
            },
          },
        },
      },
    }) as LockedEditableSeal | null;
    if (!old) throw new AppError(404, "Seal tidak ditemukan");
    const report = old.sealingRecord.sealingReport;
    assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (report.status !== "DRAFT") throw new AppError(400, "Seal hanya dapat diubah saat laporan DRAFT");
    await assertLoadingBaOpen(tx, report.id);
    const result = await mutation(tx, old);
    const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
    if (snapshot) await tx.sealingReport.update({ where: { id: report.id }, data: { sealingProcessStatus: await calculateDraftSealingProcessStatus(tx, report.id, snapshot) } });
    return result;
  });
}

export async function updateSeal(id: string, input: UpdateSealInput, actor: Actor) {
  return mutateLegacySeal(id, actor, async (tx, old) => {
    if (input.sealNumber !== undefined && ["REMOVED", "REPLACED"].includes(old.status) && normalizeSealNumber(input.sealNumber) !== old.sealNumber) {
      throw new AppError(400, "Nomor segel yang sudah menjadi riwayat tidak dapat diubah");
    }
    const data = withoutUndefined({ ...input, ...(input.sealNumber ? { sealNumber: normalizeSealNumber(input.sealNumber) } : {}) });
    const updated = await tx.seal.update({ where: { id }, data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "UPDATE", entityType: "SEAL", entityId: id, oldData: asJson(old), newData: asJson(data) } });
    return updated;
  });
}
export async function removeSeal(id: string, notes: string | null | undefined, actor: Actor) {
  return mutateLegacySeal(id, actor, async (tx, old) => {
    if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif");
    const data = { status: "REMOVED" as const, removedAt: new Date(), ...(notes === undefined ? {} : { notes }) };
    const updated = await tx.seal.update({ where: { id }, data });
    await tx.auditLog.create({ data: { userId: actor.id, action: "REMOVE_SEAL", entityType: "SEAL", entityId: id, oldData: asJson(old), newData: asJson(data) } });
    return updated;
  });
}
export async function replaceSeal(id: string, input: CreateSealInput, actor: Actor) {
  return mutateLegacySeal(id, actor, async (tx, old) => {
    if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif");
    const newId = randomUUID();
    const oldData = { status: "REPLACED" as const, removedAt: new Date() };
    const newData = withoutUndefined({ id: newId, sealingRecordId: old.sealingRecordId, sealingReportId: old.sealingReportId, sealNumber: normalizeSealNumber(input.sealNumber), installedAt: input.installedAt, notes: input.notes });
    await tx.seal.update({ where: { id }, data: oldData });
    const created = await tx.seal.create({ data: newData });
    await tx.auditLog.create({ data: { userId: actor.id, action: "REPLACE_SEAL", entityType: "SEAL", entityId: id, oldData: asJson(old), newData: asJson({ replacementSealId: newId }) } });
    await tx.auditLog.create({ data: { userId: actor.id, action: "INSTALL_SEAL", entityType: "SEAL", entityId: newId, newData: asJson(newData) } });
    return created;
  });
}

export async function verifySeal(id: string, input: VerifySealInput, actor: Actor) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    const located = await tx.seal.findUnique({ where: { id }, select: { sealingReportId: true } });
    if (!located) throw new AppError(404, "Seal tidak ditemukan");
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', located.sealingReportId);
    const seal = await tx.seal.findUnique({
      where: { id },
      include: {
        sealingRecord: {
          include: {
            sealingReport: { select: { id: true, status: true, unloadingMasterId: true } },
          },
        },
      },
    });
    if (!seal) throw new AppError(404, "Seal tidak ditemukan");
    const report = seal.sealingRecord.sealingReport;
    if (report.status !== "SANDAR") throw new AppError(400, "Seal hanya dapat diperiksa ketika kapal berstatus SANDAR");
    assertUnloadingAssignment(report.unloadingMasterId, actor);
    const unloadingBa = await tx.beritaAcaraDocument.findUnique({
      where: { sealingReportId_phase: { sealingReportId: report.id, phase: "UNLOADING" } },
      select: { status: true },
    });
    if (unloadingBa?.status === "FINALIZED") {
      throw new AppError(400, "Pemeriksaan segel telah dikunci setelah BA UNLOADING difinalisasi");
    }
    if (["REMOVED", "REPLACED"].includes(seal.status)) throw new AppError(400, "Seal yang sudah dilepas/diganti tidak dapat diverifikasi");
    const verificationId = randomUUID();
    const sealStatus = input.condition === "BROKEN" || input.condition === "MISSING" ? "BROKEN" as const : "VERIFIED" as const;
    const data = withoutUndefined({ id: verificationId, sealId: id, verifiedById: actor.id, condition: input.condition, verifiedAt: input.verifiedAt, remarks: input.remarks });
    const verification = await tx.sealVerification.create({ data });
    await tx.seal.update({ where: { id }, data: { status: sealStatus } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "VERIFY",
        entityType: "SEAL",
        entityId: id,
        oldData: asJson({ status: seal.status }),
        newData: asJson({ status: sealStatus, verificationId }),
      },
    });
    return verification;
  });
}

export async function listAudits(query: ListAuditsInput) {
  const where: Prisma.AuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType.toUpperCase() } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: query.action } : {}),
  };
  const total = await prisma.auditLog.count({ where });
  const pagination = resolvePagination(query.page, query.limit, total);
  const items = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { id: true, username: true, fullName: true } } },
    skip: pagination.skip,
    take: pagination.take,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return { items, pagination: pagination.meta };
}
