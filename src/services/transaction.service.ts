import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { AuditAction, Prisma, ReportStatus, UserRole } from "../generated/prisma/client.js";
import type { CreateRecordInput, CreateReportInput, CreateSealInput, ListAuditsInput, ListReportsInput, SignatureInput, UpdateRecordInput, UpdateReportInput, UpdateSealInput, UpdateSignatureInput, VerifySealInput } from "../schemas/transaction.schema.js";
import { AppError } from "../utils/app-error.js";

export type Actor = { id: string; role: UserRole };
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const pageMeta = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
const canManage = (actor: Actor) => actor.role === "ADMIN" || actor.role === "SUPERVISOR";
const canLoad = (actor: Actor) => canManage(actor) || actor.role === "LOADING_MASTER";
const canUnload = (actor: Actor) => canManage(actor) || actor.role === "UNLOADING_MASTER";
function withoutUndefined<T extends object>(input: T): { [K in keyof T]-?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]-?: Exclude<T[K], undefined> };
}

function assertOwnerOrManager(createdById: string, actor: Actor) {
  if (createdById !== actor.id && !canManage(actor)) throw new AppError(403, "Anda tidak berhak mengubah transaksi ini");
}

function assertLoadingOwner(createdById: string, actor: Actor) {
  if (!canLoad(actor)) throw new AppError(403, "Hanya Loading Master atau Supervisor yang dapat melakukan proses loading");
  assertOwnerOrManager(createdById, actor);
}

function assertUnloadingAssignment(unloadingMasterId: string | null, actor: Actor) {
  if (!canUnload(actor)) throw new AppError(403, "Hanya Unloading Master atau Supervisor yang dapat melakukan proses unloading");
  if (unloadingMasterId && unloadingMasterId !== actor.id && !canManage(actor)) {
    throw new AppError(403, "Perjalanan ini ditugaskan kepada Unloading Master lain");
  }
}

const reportInclude = {
  vessel: { select: { id: true, name: true, imoNumber: true } },
  originTerminal: { select: { id: true, code: true, name: true } },
  destinationTerminal: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, username: true, fullName: true, role: true } },
  unloadingMaster: { select: { id: true, username: true, fullName: true, role: true } },
  _count: { select: { sealingRecords: true, signatures: true, attachments: true } },
} satisfies Prisma.SealingReportInclude;

function audit(userId: string, action: AuditAction, entityType: string, entityId: string, oldData?: unknown, newData?: unknown) {
  return prisma.auditLog.create({ data: { userId, action, entityType, entityId, ...(oldData === undefined ? {} : { oldData: asJson(oldData) }), ...(newData === undefined ? {} : { newData: asJson(newData) }) } });
}

export async function listReports(query: ListReportsInput) {
  const where: Prisma.SealingReportWhereInput = {
    ...(query.vesselId ? { vesselId: query.vesselId } : {}), ...(query.originTerminalId ? { originTerminalId: query.originTerminalId } : {}),
    ...(query.destinationTerminalId ? { destinationTerminalId: query.destinationTerminalId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { OR: [{ reportNo: { contains: query.search, mode: "insensitive" } }, { cargo: { contains: query.search, mode: "insensitive" } }, { portName: { contains: query.search, mode: "insensitive" } }] } : {}),
  };
  const items = await prisma.sealingReport.findMany({ where, include: reportInclude, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { reportDateTime: query.sortOrder } });
  const total = await prisma.sealingReport.count({ where });
  return { items, pagination: pageMeta(query.page, query.limit, total) };
}

export async function getReport(id: string) {
  const item = await prisma.sealingReport.findUnique({ where: { id }, include: { ...reportInclude, sealingRecords: { include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: { include: { verifications: true } } }, orderBy: { createdAt: "asc" } }, signatures: { orderBy: { role: "asc" } } } });
  if (!item) throw new AppError(404, "Laporan sealing tidak ditemukan");
  return item;
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
  const data = withoutUndefined({ id, reportNo: input.reportNo.toUpperCase(), vesselId: input.vesselId, originTerminalId: input.originTerminalId, destinationTerminalId: input.destinationTerminalId, unloadingMasterId: input.unloadingMasterId, createdById: actor.id, cargo: input.cargo, operationType: input.operationType, reportDateTime: input.reportDateTime, loadingMasterSurveyorName: input.loadingMasterSurveyorName, portName: input.portName, remarks: input.remarks });
  const [created] = await prisma.$transaction([prisma.sealingReport.create({ data, include: reportInclude }), audit(actor.id, "CREATE", "SEALING_REPORT", id, undefined, data)]);
  return created;
}

export async function updateReport(id: string, input: UpdateReportInput, actor: Actor) {
  const old = await prisma.sealingReport.findUnique({ where: { id } });
  if (!old) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertLoadingOwner(old.createdById, actor);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diperbarui");
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
  assertLoadingOwner(old.createdById, actor);
  if (old.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat dihapus");
  const [deleted] = await prisma.$transaction([prisma.sealingReport.delete({ where: { id } }), audit(actor.id, "DELETE", "SEALING_REPORT", id, old)]);
  return deleted;
}

const transitions: Record<"depart" | "arrive" | "finish", { from: ReportStatus; to: ReportStatus; action: AuditAction; timestamp: "departedAt" | "arrivedAt" | "finishedAt" }> = {
  depart: { from: "DRAFT", to: "BERLAYAR", action: "DEPART", timestamp: "departedAt" },
  arrive: { from: "BERLAYAR", to: "SANDAR", action: "ARRIVE", timestamp: "arrivedAt" },
  finish: { from: "SANDAR", to: "FINISH", action: "FINISH", timestamp: "finishedAt" },
};

export async function transitionReport(id: string, transition: keyof typeof transitions, occurredAt: Date | undefined, remarks: string | null | undefined, actor: Actor) {
  const report = await prisma.sealingReport.findUnique({ where: { id }, include: { _count: { select: { sealingRecords: true } } } });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  const rule = transitions[transition];
  if (report.status !== rule.from) throw new AppError(400, `Transisi ${report.status} ke ${rule.to} tidak valid`);
  if (transition === "depart") {
    assertLoadingOwner(report.createdById, actor);
    if (report._count.sealingRecords === 0) throw new AppError(400, "Perjalanan harus memiliki minimal satu sealing record");
    const invalid = await prisma.sealingRecord.count({ where: { sealingReportId: id, status: "SEALED", seals: { none: {} } } });
    if (invalid > 0) throw new AppError(400, "Setiap record SEALED harus memiliki minimal satu nomor seal");
  }
  if (transition === "arrive" || transition === "finish") assertUnloadingAssignment(report.unloadingMasterId, actor);
  if (transition === "finish") {
    const unchecked = await prisma.seal.count({ where: { sealingRecord: { sealingReportId: id }, status: "INSTALLED", verifications: { none: {} } } });
    if (unchecked > 0) throw new AppError(400, "Seluruh seal aktif harus diperiksa sebelum perjalanan diselesaikan");
  }
  const data = { status: rule.to, [rule.timestamp]: occurredAt ?? new Date(), ...(transition === "arrive" && !report.unloadingMasterId ? { unloadingMasterId: actor.id } : {}), ...(remarks === undefined ? {} : { remarks }) };
  const [updated] = await prisma.$transaction([prisma.sealingReport.update({ where: { id }, data, include: reportInclude }), audit(actor.id, rule.action, "SEALING_REPORT", id, { status: report.status }, data)]);
  return updated;
}

async function editableReport(reportId: string, actor: Actor) {
  const report = await prisma.sealingReport.findUnique({ where: { id: reportId }, select: { id: true, vesselId: true, createdById: true, status: true } });
  if (!report) throw new AppError(404, "Laporan sealing tidak ditemukan");
  assertLoadingOwner(report.createdById, actor);
  if (report.status !== "DRAFT") throw new AppError(400, "Hanya laporan DRAFT yang dapat diedit");
  return report;
}

export async function listRecords(reportId: string, page: number, limit: number) {
  if (!(await prisma.sealingReport.findUnique({ where: { id: reportId }, select: { id: true } }))) throw new AppError(404, "Laporan sealing tidak ditemukan");
  const items = await prisma.sealingRecord.findMany({ where: { sealingReportId: reportId }, include: { vesselSealingPoint: { include: { compartment: true, sealingPointTemplate: true } }, seals: true }, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "asc" } });
  const total = await prisma.sealingRecord.count({ where: { sealingReportId: reportId } });
  return { items, pagination: pageMeta(page, limit, total) };
}

export async function createRecord(reportId: string, input: CreateRecordInput, actor: Actor) {
  const report = await editableReport(reportId, actor);
  const point = await prisma.vesselSealingPoint.findUnique({ where: { id: input.vesselSealingPointId }, select: { vesselId: true, isActive: true, availability: true } });
  if (!point || !point.isActive || point.availability === "INACTIVE") throw new AppError(400, "Titik sealing tidak tersedia");
  if (point.vesselId !== report.vesselId) throw new AppError(400, "Titik sealing harus berasal dari vessel laporan");
  const id = randomUUID(); const data = withoutUndefined({ id, sealingReportId: reportId, vesselSealingPointId: input.vesselSealingPointId, createdById: actor.id, status: input.status, notes: input.notes });
  const [created] = await prisma.$transaction([prisma.sealingRecord.create({ data }), audit(actor.id, "CREATE", "SEALING_RECORD", id, undefined, data)]); return created;
}

async function editableRecord(id: string, actor: Actor) {
  const record = await prisma.sealingRecord.findUnique({ where: { id }, include: { sealingReport: { select: { createdById: true, status: true } } } });
  if (!record) throw new AppError(404, "Sealing record tidak ditemukan");
  assertOwnerOrManager(record.sealingReport.createdById, actor);
  if (record.sealingReport.status !== "DRAFT") throw new AppError(400, "Record hanya dapat diubah saat laporan DRAFT");
  return record;
}

export async function updateRecord(id: string, input: UpdateRecordInput, actor: Actor) { const old = await editableRecord(id, actor); const data = withoutUndefined(input); const [updated] = await prisma.$transaction([prisma.sealingRecord.update({ where: { id }, data }), audit(actor.id, "UPDATE", "SEALING_RECORD", id, old, data)]); return updated; }
export async function deleteRecord(id: string, actor: Actor) { const old = await editableRecord(id, actor); const [deleted] = await prisma.$transaction([prisma.sealingRecord.delete({ where: { id } }), audit(actor.id, "DELETE", "SEALING_RECORD", id, old)]); return deleted; }

async function editableSeal(id: string, actor: Actor) {
  const seal = await prisma.seal.findUnique({ where: { id }, include: { sealingRecord: { include: { sealingReport: { select: { createdById: true, status: true } } } } } });
  if (!seal) throw new AppError(404, "Seal tidak ditemukan");
  assertOwnerOrManager(seal.sealingRecord.sealingReport.createdById, actor);
  if (seal.sealingRecord.sealingReport.status !== "DRAFT") throw new AppError(400, "Seal hanya dapat diubah saat laporan DRAFT");
  return seal;
}

export async function createSeal(recordId: string, input: CreateSealInput, actor: Actor) { await editableRecord(recordId, actor); const id = randomUUID(); const data = withoutUndefined({ id, sealingRecordId: recordId, sealNumber: input.sealNumber.toUpperCase(), installedAt: input.installedAt, notes: input.notes }); const [created] = await prisma.$transaction([prisma.seal.create({ data }), audit(actor.id, "INSTALL_SEAL", "SEAL", id, undefined, data)]); return created; }
export async function updateSeal(id: string, input: UpdateSealInput, actor: Actor) { const old = await editableSeal(id, actor); const data = withoutUndefined({ ...input, ...(input.sealNumber ? { sealNumber: input.sealNumber.toUpperCase() } : {}) }); const [updated] = await prisma.$transaction([prisma.seal.update({ where: { id }, data }), audit(actor.id, "UPDATE", "SEAL", id, old, data)]); return updated; }
export async function removeSeal(id: string, notes: string | null | undefined, actor: Actor) { const old = await editableSeal(id, actor); if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif"); const data = { status: "REMOVED" as const, removedAt: new Date(), ...(notes === undefined ? {} : { notes }) }; const [updated] = await prisma.$transaction([prisma.seal.update({ where: { id }, data }), audit(actor.id, "REMOVE_SEAL", "SEAL", id, old, data)]); return updated; }
export async function replaceSeal(id: string, input: CreateSealInput, actor: Actor) { const old = await editableSeal(id, actor); if (old.status === "REMOVED" || old.status === "REPLACED") throw new AppError(400, "Seal sudah tidak aktif"); const newId = randomUUID(); const oldData = { status: "REPLACED" as const, removedAt: new Date() }; const newData = withoutUndefined({ id: newId, sealingRecordId: old.sealingRecordId, sealNumber: input.sealNumber.toUpperCase(), installedAt: input.installedAt, notes: input.notes }); const [, created] = await prisma.$transaction([prisma.seal.update({ where: { id }, data: oldData }), prisma.seal.create({ data: newData }), audit(actor.id, "REPLACE_SEAL", "SEAL", id, old, { replacementSealId: newId }), audit(actor.id, "INSTALL_SEAL", "SEAL", newId, undefined, newData)]); return created; }

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

export async function listSignatures(reportId: string) { if (!(await prisma.sealingReport.findUnique({ where: { id: reportId }, select: { id: true } }))) throw new AppError(404, "Laporan sealing tidak ditemukan"); return prisma.reportSignature.findMany({ where: { sealingReportId: reportId }, include: { user: { select: { id: true, username: true, fullName: true } } }, orderBy: { role: "asc" } }); }
export async function createSignature(reportId: string, input: SignatureInput, actor: Actor) { await editableReport(reportId, actor); if (input.userId && !(await prisma.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true } }))) throw new AppError(400, "User penanda tangan tidak tersedia"); const id = randomUUID(); const data = withoutUndefined({ id, sealingReportId: reportId, ...input }); const [created] = await prisma.$transaction([prisma.reportSignature.create({ data }), audit(actor.id, "CREATE", "REPORT_SIGNATURE", id, undefined, data)]); return created; }
export async function updateSignature(id: string, input: UpdateSignatureInput, actor: Actor) { const old = await prisma.reportSignature.findUnique({ where: { id }, include: { sealingReport: { select: { id: true } } } }); if (!old) throw new AppError(404, "Tanda tangan tidak ditemukan"); await editableReport(old.sealingReportId, actor); const data = withoutUndefined(input); const [updated] = await prisma.$transaction([prisma.reportSignature.update({ where: { id }, data }), audit(actor.id, "UPDATE", "REPORT_SIGNATURE", id, old, data)]); return updated; }
export async function deleteSignature(id: string, actor: Actor) { const old = await prisma.reportSignature.findUnique({ where: { id } }); if (!old) throw new AppError(404, "Tanda tangan tidak ditemukan"); await editableReport(old.sealingReportId, actor); const [deleted] = await prisma.$transaction([prisma.reportSignature.delete({ where: { id } }), audit(actor.id, "DELETE", "REPORT_SIGNATURE", id, old)]); return deleted; }

export async function listAudits(query: ListAuditsInput) { const where: Prisma.AuditLogWhereInput = { ...(query.entityType ? { entityType: query.entityType.toUpperCase() } : {}), ...(query.entityId ? { entityId: query.entityId } : {}), ...(query.action ? { action: query.action } : {}) }; const items = await prisma.auditLog.findMany({ where, include: { user: { select: { id: true, username: true, fullName: true } } }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: { createdAt: "desc" } }); const total = await prisma.auditLog.count({ where }); return { items, pagination: pageMeta(query.page, query.limit, total) }; }
