import type { Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type { CreateRecordInput, CreateReportInput, CreateSealInput, ListAuditsInput, ListReportsInput, SignatureInput, UpdateRecordInput, UpdateReportInput, UpdateSealInput, UpdateSignatureInput, VerifySealInput } from "../schemas/transaction.schema.js";
import * as service from "../services/transaction.service.js";
import { AppError } from "../utils/app-error.js";
import { sendSuccess } from "../utils/api-response.js";

const actor = (request: Request): service.Actor => {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  return { id: request.authUser.id, role: request.authUser.role };
};

export async function listReports(req: Request, res: Response) { const { query } = getValidatedInput<{ query: ListReportsInput }>(res); const result = await service.listReports(query); sendSuccess(res, 200, "Daftar laporan berhasil diambil", result.items, result.pagination); }
export async function getReport(_req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Laporan berhasil diambil", await service.getReport(params.id)); }
export async function createReport(req: Request, res: Response) { const { body } = getValidatedInput<{ body: CreateReportInput }>(res); sendSuccess(res, 201, "Laporan berhasil dibuat", await service.createReport(body, actor(req))); }
export async function updateReport(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateReportInput }>(res); sendSuccess(res, 200, "Laporan berhasil diperbarui", await service.updateReport(params.id, body, actor(req))); }
export async function deleteReport(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Laporan berhasil dihapus", await service.deleteReport(params.id, actor(req))); }
export const transitionReport = (transition: "submit" | "verify" | "approve" | "reject") => async (req: Request, res: Response) => { const { params, body } = getValidatedInput<{ params: { id: string }; body: { remarks?: string | null } }>(res); sendSuccess(res, 200, `Laporan berhasil di-${transition}`, await service.transitionReport(params.id, transition, body.remarks, actor(req))); };

export async function listRecords(_req: Request, res: Response) { const { params, query } = getValidatedInput<{ params: { reportId: string }; query: { page: number; limit: number } }>(res); const result = await service.listRecords(params.reportId, query.page, query.limit); sendSuccess(res, 200, "Daftar record berhasil diambil", result.items, result.pagination); }
export async function createRecord(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string }; body: CreateRecordInput }>(res); sendSuccess(res, 201, "Record berhasil dibuat", await service.createRecord(params.reportId, body, actor(req))); }
export async function updateRecord(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateRecordInput }>(res); sendSuccess(res, 200, "Record berhasil diperbarui", await service.updateRecord(params.id, body, actor(req))); }
export async function deleteRecord(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Record berhasil dihapus", await service.deleteRecord(params.id, actor(req))); }

export async function createSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { recordId: string }; body: CreateSealInput }>(res); sendSuccess(res, 201, "Seal berhasil dipasang", await service.createSeal(params.recordId, body, actor(req))); }
export async function updateSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateSealInput }>(res); sendSuccess(res, 200, "Seal berhasil diperbarui", await service.updateSeal(params.id, body, actor(req))); }
export async function removeSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: { notes?: string | null } }>(res); sendSuccess(res, 200, "Seal berhasil dilepas", await service.removeSeal(params.id, body.notes, actor(req))); }
export async function replaceSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: CreateSealInput }>(res); sendSuccess(res, 201, "Seal berhasil diganti", await service.replaceSeal(params.id, body, actor(req))); }
export async function verifySeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: VerifySealInput }>(res); sendSuccess(res, 201, "Seal berhasil diverifikasi", await service.verifySeal(params.id, body, actor(req))); }

export async function listSignatures(_req: Request, res: Response) { const { params } = getValidatedInput<{ params: { reportId: string } }>(res); sendSuccess(res, 200, "Daftar tanda tangan berhasil diambil", await service.listSignatures(params.reportId)); }
export async function createSignature(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string }; body: SignatureInput }>(res); sendSuccess(res, 201, "Tanda tangan berhasil dibuat", await service.createSignature(params.reportId, body, actor(req))); }
export async function updateSignature(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateSignatureInput }>(res); sendSuccess(res, 200, "Tanda tangan berhasil diperbarui", await service.updateSignature(params.id, body, actor(req))); }
export async function deleteSignature(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Tanda tangan berhasil dihapus", await service.deleteSignature(params.id, actor(req))); }

export async function listAudits(_req: Request, res: Response) { const { query } = getValidatedInput<{ query: ListAuditsInput }>(res); const result = await service.listAudits(query); sendSuccess(res, 200, "Audit log berhasil diambil", result.items, result.pagination); }
