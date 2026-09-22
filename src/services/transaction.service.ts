import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { AuditAction, Prisma, ReportStatus, SealCondition, SealingProcessStatus, UserRole } from "../generated/prisma/client.js";
import type { CreatePlantJettyAssignmentInput, CreateRecordInput, CreateReportInput, CreateSealInput, CreateShipmentInput, FormPointPatchInput, FormPointWriteInput, FormSectionBatchInput, ListAuditsInput, ListPlantJettyAssignmentsInput, ListReportsInput, UpdateRecordInput, UpdateReportInput, UpdateSealInput, UpdateShipmentInput, VerifySealInput } from "../schemas/transaction.schema.js";
import { AppError } from "../utils/app-error.js";

export type Actor = { id: string; role: UserRole };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const pageMeta = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
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
    ...(actor.role === "UNLOADING_MASTER" ? { unloadingMasterId: actor.id } : {}),
    ...(query.vesselId ? { vesselId: query.vesselId } : {}),
    ...(query.activityId ? { activityId: query.activityId } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
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
    ...(query.search ? { AND: [{ OR: [
      { reportNo: { contains: query.search, mode: "insensitive" } },
      { voyageNumber: { contains: query.search, mode: "insensitive" } },
      { shipmentNumber: { contains: query.search, mode: "insensitive" } },
      { cargo: { contains: query.search, mode: "insensitive" } },
      { portName: { contains: query.search, mode: "insensitive" } },
    ] }] } : {}),
  };
  const items = await prisma.sealingReport.findMany({ where, include: reportInclude, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { reportDateTime: query.sortOrder } });
  const total = await prisma.sealingReport.count({ where });
  return { items: items.map(withSnapshotDrawing), pagination: pageMeta(query.page, query.limit, total) };
}

export async function getReport(id: string, actor?: Actor) {
  const item = await prisma.sealingReport.findUnique({ where: { id }, include: { ...reportInclude, sealingRecords: { include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: { include: { verifications: true } } }, orderBy: { createdAt: "asc" } }, signatures: { orderBy: { role: "asc" } } } });
  if (!item) throw new AppError(404, "Laporan sealing tidak ditemukan");
  if (actor?.role === "LOADING_MASTER" && (item.loadingMasterId ?? item.createdById) !== actor.id) throw new AppError(403, "Anda tidak berhak melihat perjalanan ini");
  if (actor?.role === "UNLOADING_MASTER" && item.unloadingMasterId !== actor.id) throw new AppError(403, "Anda tidak berhak menerima perjalanan ini");
  return withSnapshotDrawing(item);
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
  if (loadingMasterId && !canManage(actor) && loadingMasterId !== actor.id) {
    throw new AppError(403, "Hanya Supervisor atau Admin yang dapat menetapkan Loading Master lain");
  }
  const resolved = loadingMasterId ??
    (actor.role === "LOADING_MASTER" || actor.role === "SUPERVISOR" ? actor.id : undefined);
  if (!resolved) throw new AppError(400, "Loading Master wajib ditetapkan");
  await validateLoadingMaster(resolved);
  return resolved;
}

async function validateUnloadingMaster(unloadingMasterId: string | null | undefined) {
  if (!unloadingMasterId) return;
  const unloadingMaster = await prisma.user.findUnique({
    where: { id: unloadingMasterId },
    select: { id: true, role: true, isActive: true },
  });
  if (!unloadingMaster?.isActive || !["UNLOADING_MASTER", "SUPERVISOR"].includes(unloadingMaster.role)) {
    throw new AppError(400, "Unloading Master tidak tersedia atau role tidak sesuai");
  }
}

async function validateShipmentReferences(input: {
  vesselId: string;
  activityId: string;
  productId: string;
  loadingPlantId: string;
  loadingJettyId: string;
  dischargePlantId: string;
  dischargeJettyId: string;
}) {
  const [vessel, activity, product, loadingPlant, loadingJetty, dischargePlant, dischargeJetty, loadingAssignment, dischargeAssignment] = await Promise.all([
    prisma.vessel.findUnique({ where: { id: input.vesselId }, select: { id: true, isActive: true } }),
    prisma.activity.findUnique({ where: { id: input.activityId }, select: { id: true, code: true, isActive: true } }),
    prisma.product.findUnique({ where: { id: input.productId }, select: { id: true, isActive: true } }),
    prisma.plant.findUnique({ where: { id: input.loadingPlantId }, select: { id: true, isActive: true } }),
    prisma.jetty.findUnique({ where: { id: input.loadingJettyId }, select: { id: true, isActive: true } }),
    prisma.plant.findUnique({ where: { id: input.dischargePlantId }, select: { id: true, isActive: true } }),
    prisma.jetty.findUnique({ where: { id: input.dischargeJettyId }, select: { id: true, isActive: true } }),
    prisma.plantJettyAssignment.findUnique({
      where: { plantId_jettyId: { plantId: input.loadingPlantId, jettyId: input.loadingJettyId } },
      select: { id: true },
    }),
    prisma.plantJettyAssignment.findUnique({
      where: { plantId_jettyId: { plantId: input.dischargePlantId, jettyId: input.dischargeJettyId } },
      select: { id: true },
    }),
  ]);

  if (!vessel?.isActive) throw new AppError(400, "Vessel tidak tersedia atau tidak aktif");
  if (!activity?.isActive) throw new AppError(400, "Activity tidak tersedia atau tidak aktif");
  if (!supportedActivityCodes.includes(activity.code.toUpperCase() as typeof supportedActivityCodes[number])) {
    throw new AppError(400, "Activity shipment harus LOADING, DISCHARGE, atau ROB");
  }
  if (!product?.isActive) throw new AppError(400, "Product tidak tersedia atau tidak aktif");
  if (!loadingPlant?.isActive) throw new AppError(400, "Loading plant tidak tersedia atau tidak aktif");
  if (!loadingJetty?.isActive) throw new AppError(400, "Loading jetty tidak tersedia atau tidak aktif");
  if (!dischargePlant?.isActive) throw new AppError(400, "Discharge plant tidak tersedia atau tidak aktif");
  if (!dischargeJetty?.isActive) throw new AppError(400, "Discharge jetty tidak tersedia atau tidak aktif");
  if (!loadingAssignment) throw new AppError(400, "Loading jetty tidak terdaftar pada loading plant");
  if (!dischargeAssignment) throw new AppError(400, "Discharge jetty tidak terdaftar pada discharge plant");
}

export async function createShipment(input: CreateShipmentInput, actor: Actor) {
  const loadingMasterId = await resolveLoadingMasterId(input.loadingMasterId, actor);
  await Promise.all([
    validateShipmentReferences(input),
    validateUnloadingMaster(input.unloadingMasterId),
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
    productId: input.productId,
    loadingPlantId: input.loadingPlantId,
    loadingJettyId: input.loadingJettyId,
    dischargePlantId: input.dischargePlantId,
    dischargeJettyId: input.dischargeJettyId,
    sealingStatus: (input.sealingStatus ?? defaultSealingStatus).toUpperCase(),
    loadingMasterId,
    unloadingMasterId: input.unloadingMasterId,
    loadingMasterSurveyorName: input.loadingMasterSurveyorName,
    remarks: input.remarks,
    createdById: actor.id,
  });
  const [created] = await prisma.$transaction([
    prisma.sealingReport.create({ data, include: reportInclude }),
    audit(actor.id, "CREATE", "SHIPMENT_VOYAGE", id, undefined, data),
  ]);
  return created;
}

export async function updateShipment(id: string, input: UpdateShipmentInput, actor: Actor) {
  const old = await prisma.sealingReport.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya shipment/voyage DRAFT yang dapat diperbarui");
  if (input.loadingMasterId && input.loadingMasterId !== old.loadingMasterId && !canManage(actor)) {
    throw new AppError(403, "Hanya Supervisor atau Admin yang dapat mengganti assignment Loading Master");
  }

  const references = {
    vesselId: input.vesselId ?? old.vesselId,
    activityId: input.activityId ?? old.activityId,
    productId: input.productId ?? old.productId,
    loadingPlantId: input.loadingPlantId ?? old.loadingPlantId,
    loadingJettyId: input.loadingJettyId ?? old.loadingJettyId,
    dischargePlantId: input.dischargePlantId ?? old.dischargePlantId,
    dischargeJettyId: input.dischargeJettyId ?? old.dischargeJettyId,
  };
  const voyageNumber = input.voyageNumber ?? old.voyageNumber;
  const shipmentNumber = input.shipmentNumber ?? old.shipmentNumber;
  if (!references.activityId || !references.productId || !references.loadingPlantId || !references.loadingJettyId || !references.dischargePlantId || !references.dischargeJettyId || !voyageNumber || !shipmentNumber) {
    throw new AppError(400, "Laporan historis belum memiliki seluruh field wajib shipment");
  }
  await Promise.all([
    validateShipmentReferences(references as Required<typeof references>),
    ...(input.loadingMasterId ? [validateLoadingMaster(input.loadingMasterId)] : []),
    validateUnloadingMaster(input.unloadingMasterId),
  ]);
  if (input.vesselId && input.vesselId !== old.vesselId && await prisma.sealingRecord.count({ where: { sealingReportId: id } }) > 0) {
    throw new AppError(400, "Vessel tidak dapat diubah setelah titik segel disiapkan");
  }

  const data = withoutUndefined({
    ...input,
    ...(input.voyageNumber ? { voyageNumber: input.voyageNumber.toUpperCase() } : {}),
    ...(input.shipmentNumber ? { shipmentNumber: input.shipmentNumber.toUpperCase() } : {}),
    ...(input.sealingStatus ? { sealingStatus: input.sealingStatus.toUpperCase() } : {}),
    ...(!input.sealingStatus && !old.sealingStatus ? { sealingStatus: defaultSealingStatus } : {}),
  });
  const [updated] = await prisma.$transaction([
    prisma.sealingReport.update({ where: { id }, data, include: reportInclude }),
    audit(actor.id, "UPDATE", "SHIPMENT_VOYAGE", id, old, data),
  ]);
  return updated;
}

export async function listPlantJettyAssignments(query: ListPlantJettyAssignmentsInput) {
  const where: Prisma.PlantJettyAssignmentWhereInput = {
    ...(query.plantId ? { plantId: query.plantId } : {}),
    ...(query.jettyId ? { jettyId: query.jettyId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.plantJettyAssignment.findMany({
      where,
      include: {
        plant: { select: { id: true, code: true, name: true, isActive: true } },
        jetty: { select: { id: true, name: true, isActive: true } },
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ plant: { sequence: "asc" } }, { jetty: { sequence: "asc" } }],
    }),
    prisma.plantJettyAssignment.count({ where }),
  ]);
  return { items, pagination: pageMeta(query.page, query.limit, total) };
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
  return created;
}

export async function updateReport(id: string, input: UpdateReportInput, actor: Actor) {
  const old = await prisma.sealingReport.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diperbarui");
  if (input.vesselId && input.vesselId !== old.vesselId && await prisma.sealingRecord.count({ where: { sealingReportId: id } }) > 0) throw new AppError(400, "Vessel tidak dapat diubah setelah titik segel compartment disiapkan");
  if (input.vesselId && !(await prisma.vessel.findFirst({ where: { id: input.vesselId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Vessel tidak tersedia atau tidak aktif");
  if (input.originTerminalId && !(await prisma.terminal.findFirst({ where: { id: input.originTerminalId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Terminal asal tidak tersedia atau tidak aktif");
  if (input.destinationTerminalId && !(await prisma.terminal.findFirst({ where: { id: input.destinationTerminalId, isActive: true }, select: { id: true } }))) throw new AppError(400, "Terminal tujuan tidak tersedia atau tidak aktif");
  const originId = input.originTerminalId ?? old.originTerminalId;
  const destinationId = input.destinationTerminalId ?? old.destinationTerminalId;
  if (destinationId && originId === destinationId) throw new AppError(400, "Terminal asal dan tujuan harus berbeda");
  if (input.unloadingMasterId) {
    const user = await prisma.user.findFirst({ where: { id: input.unloadingMasterId, isActive: true, role: { in: ["UNLOADING_MASTER", "SUPERVISOR"] } }, select: { id: true } });
    if (!user) throw new AppError(400, "Unloading Master tidak tersedia atau role tidak sesuai");
  }
  const data = withoutUndefined({ ...input, ...(input.reportNo ? { reportNo: input.reportNo.toUpperCase() } : {}) });
  const [updated] = await prisma.$transaction([prisma.sealingReport.update({ where: { id }, data, include: reportInclude }), audit(actor.id, "UPDATE", "SEALING_REPORT", id, old, data)]);
  return updated;
}

export async function deleteReport(id: string, actor: Actor) {
  const old = await prisma.sealingReport.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat dihapus");
  const [deleted] = await prisma.$transaction([prisma.sealingReport.delete({ where: { id } }), audit(actor.id, "DELETE", "SEALING_REPORT", id, old)]);
  return deleted;
}

export async function deleteShipment(id: string, actor: Actor) {
  const old = await prisma.sealingReport.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  assertLoadingOwner(old.createdById, actor, old.loadingMasterId);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya shipment/voyage DRAFT yang dapat dihapus");
  const [deleted] = await prisma.$transaction([
    prisma.sealingReport.delete({ where: { id } }),
    audit(actor.id, "DELETE", "SHIPMENT_VOYAGE", id, old),
  ]);
  return deleted;
}

async function editableReport(reportId: string, actor: Actor) {
  const report = await prisma.sealingReport.findUnique({ where: { id: reportId }, select: { id: true, vesselId: true, createdById: true, loadingMasterId: true, status: true, formConfigurationSnapshot: true } });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
  if (report.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diedit");
  return report;
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
  "sealingRecord" | "seal" | "auditLog" | "sealingReport" | "vesselFormProfile" |
  "compartment" | "vesselSealingPoint" | "plantJettyAssignment" | "$queryRawUnsafe"
>;
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
    const mandatoryFields: Array<[unknown, string]> = [
      [report.activityId, "activityId"],
      [report.voyageNumber, "voyageNumber"],
      [report.productId, "productId"],
      [report.loadingPlantId, "loadingPlantId"],
      [report.loadingJettyId, "loadingJettyId"],
      [report.dischargePlantId, "dischargePlantId"],
      [report.dischargeJettyId, "dischargeJettyId"],
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
    if (!report.product?.isActive) commonDepartureErrors.push({ code: "PRODUCT_INACTIVE", message: "Product shipment tidak aktif" });
    if (!report.loadingPlant?.isActive || !report.loadingJetty?.isActive) commonDepartureErrors.push({ code: "LOADING_LOCATION_INACTIVE", message: "Loading Plant dan Jetty harus aktif" });
    if (!report.dischargePlant?.isActive || !report.dischargeJetty?.isActive) commonDepartureErrors.push({ code: "DISCHARGE_LOCATION_INACTIVE", message: "Discharge Plant dan Jetty harus aktif" });
    if (report.loadingPlantId && report.loadingJettyId && !(await tx.plantJettyAssignment.findUnique({ where: { plantId_jettyId: { plantId: report.loadingPlantId, jettyId: report.loadingJettyId } }, select: { id: true } }))) {
      commonDepartureErrors.push({ code: "LOADING_JETTY_MISMATCH", message: "Loading Jetty tidak terdaftar pada Loading Plant" });
    }
    if (report.dischargePlantId && report.dischargeJettyId && !(await tx.plantJettyAssignment.findUnique({ where: { plantId_jettyId: { plantId: report.dischargePlantId, jettyId: report.dischargeJettyId } }, select: { id: true } }))) {
      commonDepartureErrors.push({ code: "DISCHARGE_JETTY_MISMATCH", message: "Discharge Jetty tidak terdaftar pada Discharge Plant" });
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

export async function transitionReport(
  id: string,
  transition: keyof typeof transitions,
  occurredAt: Date | undefined,
  remarks: string | null | undefined,
  actor: Actor,
) {
  return prisma.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as SnapshotTransactionClient;
    await tx.$queryRawUnsafe('SELECT "id" FROM "sealing_report" WHERE "id" = $1 FOR UPDATE', id);
    const report = await loadLifecycleReport(tx, id);
    if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
    const rule = transitions[transition];
    if (report.status !== rule.from) throw new AppError(400, `Transisi ${report.status} ke ${rule.to} tidak valid`);

    if (transition === "depart") assertLoadingOwner(report.createdById, actor, report.loadingMasterId);
    if (transition === "arrive" || transition === "finish") assertUnloadingAssignment(report.unloadingMasterId, actor);

    const validation = await evaluateLifecycleReport(tx, report);
    const transitionValidation = validation.transitions[transition === "finish" ? "finalize" : transition];
    if (!transitionValidation.allowed) {
      throw new AppError(400, `Validasi ${transition === "finish" ? "finalisasi" : transition} gagal`, transitionValidation.errors);
    }

    const transitionAt = occurredAt ?? new Date();
    const finalSnapshot = transition === "finish" ? asJson({
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
        product: report.product,
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
    const data = {
      status: rule.to,
      sealingProcessStatus: rule.processStatus,
      [rule.timestamp]: transitionAt,
      ...(transition === "finish" ? { finalizedById: actor.id, finalSnapshot } : {}),
      ...(remarks === undefined ? {} : { remarks }),
    };
    const updated = await tx.sealingReport.update({ where: { id }, data, include: reportInclude });
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
    report.unloadingMasterId !== actor.id
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
      isEditable: report.status === "DRAFT" && canLoad(actor) && (canManage(actor) || (report.loadingMasterId ?? report.createdById) === actor.id),
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
          ? (options.replace ? [] : (existing?.seals ?? []).map((seal) => ({
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
        where: { sealNumber: { in: allDesiredSealNumbers, mode: "insensitive" } },
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
      await tx.seal.deleteMany({
        where: {
          sealingRecordId: recordId,
          ...(desiredNumbers.length > 0 ? { sealNumber: { notIn: desiredNumbers } } : {}),
        },
      });
    }

    for (const input of resolvedInputs) {
      const recordId = recordIdByPoint.get(input.vesselSealingPointId)!;
      const oldValue = oldValues.get(input.vesselSealingPointId);
      for (const sealInput of input.seals) {
        const sealNumber = normalizeSealNumber(sealInput.sealNumber);
        const existingSeal = await tx.seal.findUnique({ where: { sealNumber } });
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
          await tx.seal.update({ where: { id: existingSeal.id }, data: sealData });
        } else {
          await tx.seal.create({
            data: {
              id: randomUUID(),
              sealingRecordId: recordId,
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

async function refreshDraftSealingProcessStatus(reportId: string) {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: { status: true, formConfigurationSnapshot: true },
  });
  if (!report || report.status !== "DRAFT") return;
  const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
  const sealingProcessStatus = snapshot
    ? await calculateDraftSealingProcessStatus(prisma as unknown as SnapshotTransactionClient, reportId, snapshot)
    : "NOT_STARTED";
  await prisma.sealingReport.update({ where: { id: reportId }, data: { sealingProcessStatus } });
}

export async function listRecords(reportId: string, page: number, limit: number, actor?: Actor) {
  await getReport(reportId, actor);
  const items = await prisma.sealingRecord.findMany({ where: { sealingReportId: reportId }, include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: true }, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "asc" } });
  const total = await prisma.sealingRecord.count({ where: { sealingReportId: reportId } });
  return { items, pagination: pageMeta(page, limit, total) };
}

export async function createRecord(reportId: string, input: CreateRecordInput, actor: Actor) {
  const report = await editableReport(reportId, actor);
  const point = await prisma.vesselSealingPoint.findUnique({ where: { id: input.vesselSealingPointId }, select: { vesselId: true, compartmentId: true, isActive: true, availability: true } });
  if (!point || !point.isActive || point.availability === "INACTIVE") throw new AppError(400, "Titik sealing tidak tersedia");
  if (point.vesselId !== report.vesselId) throw new AppError(400, "Titik sealing harus berasal dari vessel laporan");
  const snapshot = readFormSnapshot(report.formConfigurationSnapshot);
  const snapshotPoint = snapshot?.points.find((item) => item.vesselSealingPointId === input.vesselSealingPointId);
  if (report.formConfigurationSnapshot && !snapshotPoint) throw new AppError(400, "Titik sealing tidak termasuk snapshot form laporan");
  const id = randomUUID(); const data = withoutUndefined({ id, sealingReportId: reportId, vesselSealingPointId: input.vesselSealingPointId, createdById: actor.id, status: input.status, notes: input.notes, pointSnapshot: snapshotPoint ? asJson(snapshotPoint) : undefined });
  const [created] = await prisma.$transaction([prisma.sealingRecord.create({ data }), audit(actor.id, "CREATE", "SEALING_RECORD", id, undefined, data)]);
  await refreshDraftSealingProcessStatus(reportId);
  return created;
}

async function editableRecord(id: string, actor: Actor) {
  const record = await prisma.sealingRecord.findUnique({ where: { id }, include: { sealingReport: { select: { id: true, createdById: true, loadingMasterId: true, status: true } } } });
  if (!record) throw new AppError(404, "Sealing record tidak ditemukan");
  assertLoadingOwner(record.sealingReport.createdById, actor, record.sealingReport.loadingMasterId);
  if (record.sealingReport.status !== "DRAFT") throw new AppError(400, "Record hanya dapat diubah saat laporan DRAFT");
  return record;
}

export async function updateRecord(id: string, input: UpdateRecordInput, actor: Actor) {
  const old = await editableRecord(id, actor); const data = withoutUndefined(input);
  const [updated] = await prisma.$transaction([prisma.sealingRecord.update({ where: { id }, data }), audit(actor.id, "UPDATE", "SEALING_RECORD", id, old, data)]);
  await refreshDraftSealingProcessStatus(old.sealingReport.id);
  return updated;
}
export async function deleteRecord(id: string, actor: Actor) {
  const old = await editableRecord(id, actor);
  const [deleted] = await prisma.$transaction([prisma.sealingRecord.delete({ where: { id } }), audit(actor.id, "DELETE", "SEALING_RECORD", id, old)]);
  await refreshDraftSealingProcessStatus(old.sealingReport.id);
  return deleted;
}

async function editableSeal(id: string, actor: Actor) {
  const seal = await prisma.seal.findUnique({ where: { id }, include: { sealingRecord: { include: { sealingReport: { select: { id: true, createdById: true, loadingMasterId: true, status: true } } } } } });
  if (!seal) throw new AppError(404, "Seal tidak ditemukan");
  assertLoadingOwner(seal.sealingRecord.sealingReport.createdById, actor, seal.sealingRecord.sealingReport.loadingMasterId);
  if (seal.sealingRecord.sealingReport.status !== "DRAFT") throw new AppError(400, "Seal hanya dapat diubah saat laporan DRAFT");
  return seal;
}

export async function createSeal(recordId: string, input: CreateSealInput, actor: Actor) {
  const record = await editableRecord(recordId, actor); const id = randomUUID();
  const data = withoutUndefined({ id, sealingRecordId: recordId, sealNumber: input.sealNumber.toUpperCase(), installedAt: input.installedAt, notes: input.notes });
  const [created] = await prisma.$transaction([prisma.seal.create({ data }), audit(actor.id, "INSTALL_SEAL", "SEAL", id, undefined, data)]);
  await refreshDraftSealingProcessStatus(record.sealingReport.id);
  return created;
}
export async function updateSeal(id: string, input: UpdateSealInput, actor: Actor) {
  const old = await editableSeal(id, actor); const data = withoutUndefined({ ...input, ...(input.sealNumber ? { sealNumber: input.sealNumber.toUpperCase() } : {}) });
  const [updated] = await prisma.$transaction([prisma.seal.update({ where: { id }, data }), audit(actor.id, "UPDATE", "SEAL", id, old, data)]);
  await refreshDraftSealingProcessStatus(old.sealingRecord.sealingReport.id);
  return updated;
}
export async function removeSeal(id: string, notes: string | null | undefined, actor: Actor) {
  const old = await editableSeal(id, actor); if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif");
  const data = { status: "REMOVED" as const, removedAt: new Date(), ...(notes === undefined ? {} : { notes }) };
  const [updated] = await prisma.$transaction([prisma.seal.update({ where: { id }, data }), audit(actor.id, "REMOVE_SEAL", "SEAL", id, old, data)]);
  await refreshDraftSealingProcessStatus(old.sealingRecord.sealingReport.id);
  return updated;
}
export async function replaceSeal(id: string, input: CreateSealInput, actor: Actor) {
  const old = await editableSeal(id, actor); if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif");
  const newId = randomUUID(); const oldData = { status: "REPLACED" as const, removedAt: new Date() };
  const newData = withoutUndefined({ id: newId, sealingRecordId: old.sealingRecordId, sealNumber: input.sealNumber.toUpperCase(), installedAt: input.installedAt, notes: input.notes });
  const [, created] = await prisma.$transaction([prisma.seal.update({ where: { id }, data: oldData }), prisma.seal.create({ data: newData }), audit(actor.id, "REPLACE_SEAL", "SEAL", id, old, { replacementSealId: newId }), audit(actor.id, "INSTALL_SEAL", "SEAL", newId, undefined, newData)]);
  await refreshDraftSealingProcessStatus(old.sealingRecord.sealingReport.id);
  return created;
}

export async function verifySeal(id: string, input: VerifySealInput, actor: Actor) {
  const seal = await prisma.seal.findUnique({ where: { id }, include: { sealingRecord: { include: { sealingReport: { select: { status: true, unloadingMasterId: true } } } } } });
  if (!seal) throw new AppError(404, "Seal tidak ditemukan");
  if (seal.sealingRecord.sealingReport.status !== "SANDAR") throw new AppError(400, "Seal hanya dapat diperiksa ketika kapal berstatus SANDAR");
  assertUnloadingAssignment(seal.sealingRecord.sealingReport.unloadingMasterId, actor);
  if (["REMOVED", "REPLACED"].includes(seal.status)) throw new AppError(400, "Seal yang sudah dilepas/diganti tidak dapat diverifikasi");
  const verificationId = randomUUID(); const sealStatus = input.condition === "BROKEN" || input.condition === "MISSING" ? "BROKEN" as const : "VERIFIED" as const;
  const data = withoutUndefined({ id: verificationId, sealId: id, verifiedById: actor.id, condition: input.condition, verifiedAt: input.verifiedAt, remarks: input.remarks });
  const [verification] = await prisma.$transaction([prisma.sealVerification.create({ data }), prisma.seal.update({ where: { id }, data: { status: sealStatus } }), audit(actor.id, "VERIFY", "SEAL", id, { status: seal.status }, { status: sealStatus, verificationId })]); return verification;
}

export async function listAudits(query: ListAuditsInput) { const where: Prisma.AuditLogWhereInput = { ...(query.entityType ? { entityType: query.entityType.toUpperCase() } : {}), ...(query.entityId ? { entityId: query.entityId } : {}), ...(query.action ? { action: query.action } : {}) }; const items = await prisma.auditLog.findMany({ where, include: { user: { select: { id: true, username: true, fullName: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" } }); const total = await prisma.auditLog.count({ where }); return { items, pagination: pageMeta(query.page, query.limit, total) }; }
