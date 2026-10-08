import type { NextFunction, Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type { CreatePlantJettyAssignmentInput, CreateRecordInput, CreateReportInput, CreateSealInput, CreateShipmentInput, FormPointPatchInput, FormPointWriteInput, FormSectionBatchInput, ListAuditsInput, ListPlantJettyAssignmentsInput, ListReportsInput, SignatureInput, UpsertSignatureInput, UpdateRecordInput, UpdateReportInput, UpdateSealInput, UpdateShipmentInput, UpdateSignatureInput, VerifySealInput } from "../schemas/transaction.schema.js";
import * as service from "../services/transaction.service.js";
import * as signatureService from "../services/signature.service.js";
import * as xlsxExportService from "../services/xlsx-export.service.js";
import * as pdfExportService from "../services/pdf-export.service.js";
import { AppError } from "../utils/app-error.js";
import { sendSuccess } from "../utils/api-response.js";

const actor = (request: Request): service.Actor => {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  return { id: request.authUser.id, role: request.authUser.role };
};

export async function listReports(req: Request, res: Response) { const { query } = getValidatedInput<{ query: ListReportsInput }>(res); const result = await service.listReports(query, actor(req)); sendSuccess(res, 200, "Daftar perjalanan berhasil diambil", result.items, result.pagination); }
export async function getReport(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Perjalanan berhasil diambil", await service.getReport(params.id, actor(req))); }
export async function createReport(req: Request, res: Response) { const { body } = getValidatedInput<{ body: CreateReportInput }>(res); sendSuccess(res, 201, "Laporan berhasil dibuat", await service.createReport(body, actor(req))); }
export async function updateReport(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateReportInput }>(res); sendSuccess(res, 200, "Laporan berhasil diperbarui", await service.updateReport(params.id, body, actor(req))); }
export async function deleteReport(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Laporan berhasil dihapus", await service.deleteReport(params.id, actor(req))); }
export async function createShipment(req: Request, res: Response) { const { body } = getValidatedInput<{ body: CreateShipmentInput }>(res); sendSuccess(res, 201, "Shipment/voyage berhasil dibuat", await service.createShipment(body, actor(req))); }
export async function updateShipment(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateShipmentInput }>(res); sendSuccess(res, 200, "Shipment/voyage berhasil diperbarui", await service.updateShipment(params.id, body, actor(req))); }
export async function deleteShipment(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Shipment/voyage berhasil dihapus", await service.deleteShipment(params.id, actor(req))); }
export const transitionReport = (transition: "depart" | "arrive" | "finish") => async (req: Request, res: Response) => { const { params, body } = getValidatedInput<{ params: { id: string }; body: { occurredAt?: Date; remarks?: string | null } }>(res); sendSuccess(res, 200, `Status perjalanan berhasil diubah menjadi ${transition === "depart" ? "BERLAYAR" : transition === "arrive" ? "SANDAR" : "FINISH"}`, await service.transitionReport(params.id, transition, body.occurredAt, body.remarks, actor(req))); };
export async function validateReportLifecycle(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Validasi lifecycle shipment/voyage berhasil", await service.validateReportLifecycle(params.id, actor(req))); }
export async function prepareReportSeals(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Snapshot form A-H berhasil diinisialisasi", await service.prepareReportSeals(params.id, actor(req))); }
export async function getReportForm(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { reportId: string } }>(res); sendSuccess(res, 200, "Struktur form A-H berhasil diambil", await service.getReportFormStructure(params.reportId, actor(req))); }
export async function writeReportFormPoint(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string; pointId: string }; body: FormPointWriteInput }>(res); sendSuccess(res, 200, "Input titik form berhasil disimpan", await service.writeReportFormPoint(params.reportId, params.pointId, body, actor(req))); }
export async function patchReportFormPoint(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string; pointId: string }; body: FormPointPatchInput }>(res); sendSuccess(res, 200, "Input titik form berhasil diperbarui", await service.patchReportFormPoint(params.reportId, params.pointId, body, actor(req))); }
export async function clearReportFormPoint(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { reportId: string; pointId: string } }>(res); sendSuccess(res, 200, "Input titik form berhasil dihapus", await service.clearReportFormPoint(params.reportId, params.pointId, actor(req))); }
export async function batchWriteReportFormSection(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string; sectionCode: string }; body: FormSectionBatchInput }>(res); sendSuccess(res, 200, "Input section form berhasil disimpan", await service.batchWriteReportFormSection(params.reportId, params.sectionCode, body, actor(req))); }

export async function generateReportXlsx(req: Request, res: Response) {
  const { params } = getValidatedInput<{ params: { reportId: string } }>(res);
  sendSuccess(res, 201, "XLSX resmi berhasil dibuat", await xlsxExportService.generateOfficialXlsx(params.reportId, actor(req)));
}
const sendReportXlsx = (disposition: "inline" | "attachment") => async (req: Request, res: Response, next: NextFunction) => {
  const { params } = getValidatedInput<{ params: { reportId: string } }>(res);
  const file = await xlsxExportService.getOfficialXlsxFile(params.reportId, actor(req));
  res.sendFile(file.absolutePath, { headers: {
    "Content-Type": xlsxExportService.XLSX_CONTENT_TYPE,
    "Content-Disposition": `${disposition}; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } }, (error) => { if (error) next(error); });
};
export const previewReportXlsx = sendReportXlsx("inline");
export const downloadReportXlsx = sendReportXlsx("attachment");

export async function generateReportPdf(req: Request, res: Response) {
  const { params } = getValidatedInput<{ params: { reportId: string } }>(res);
  const result = await pdfExportService.generateOfficialPdf(params.reportId, actor(req));
  sendSuccess(res, result.reused ? 200 : 201, result.reused ? "PDF final sudah tersedia" : "PDF final berhasil dibuat", result);
}
const sendReportPdf = (disposition: "inline" | "attachment") => async (req: Request, res: Response, next: NextFunction) => {
  const { params } = getValidatedInput<{ params: { reportId: string } }>(res);
  const file = await pdfExportService.getOfficialPdfFile(params.reportId, actor(req));
  res.sendFile(file.absolutePath, { headers: {
    "Content-Type": pdfExportService.PDF_CONTENT_TYPE,
    "Content-Disposition": `${disposition}; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Checksum-SHA256": file.metadata.checksumSha256,
  } }, (error) => { if (error) next(error); });
};
export const previewReportPdf = sendReportPdf("inline");
export const downloadReportPdf = sendReportPdf("attachment");

export async function listPlantJettyAssignments(_req: Request, res: Response) { const { query } = getValidatedInput<{ query: ListPlantJettyAssignmentsInput }>(res); const result = await service.listPlantJettyAssignments(query); sendSuccess(res, 200, "Daftar assignment Plant-Jetty berhasil diambil", result.items, result.pagination); }
export async function createPlantJettyAssignment(req: Request, res: Response) { const { body } = getValidatedInput<{ body: CreatePlantJettyAssignmentInput }>(res); sendSuccess(res, 201, "Assignment Plant-Jetty berhasil dibuat", await service.createPlantJettyAssignment(body, actor(req))); }
export async function deletePlantJettyAssignment(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Assignment Plant-Jetty berhasil dihapus", await service.deletePlantJettyAssignment(params.id, actor(req))); }

export async function listRecords(req: Request, res: Response) { const { params, query } = getValidatedInput<{ params: { reportId: string }; query: { page: number; limit: number } }>(res); const result = await service.listRecords(params.reportId, query.page, query.limit, actor(req)); sendSuccess(res, 200, "Daftar record berhasil diambil", result.items, result.pagination); }
export async function createRecord(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string }; body: CreateRecordInput }>(res); sendSuccess(res, 201, "Record berhasil dibuat", await service.createRecord(params.reportId, body, actor(req))); }
export async function updateRecord(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateRecordInput }>(res); sendSuccess(res, 200, "Record berhasil diperbarui", await service.updateRecord(params.id, body, actor(req))); }
export async function deleteRecord(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Record berhasil dihapus", await service.deleteRecord(params.id, actor(req))); }

export async function createSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { recordId: string }; body: CreateSealInput }>(res); sendSuccess(res, 201, "Seal berhasil dipasang", await service.createSeal(params.recordId, body, actor(req))); }
export async function updateSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateSealInput }>(res); sendSuccess(res, 200, "Seal berhasil diperbarui", await service.updateSeal(params.id, body, actor(req))); }
export async function removeSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: { notes?: string | null } }>(res); sendSuccess(res, 200, "Seal berhasil dilepas", await service.removeSeal(params.id, body.notes, actor(req))); }
export async function replaceSeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: CreateSealInput }>(res); sendSuccess(res, 201, "Seal berhasil diganti", await service.replaceSeal(params.id, body, actor(req))); }
export async function verifySeal(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: VerifySealInput }>(res); sendSuccess(res, 201, "Seal berhasil diverifikasi", await service.verifySeal(params.id, body, actor(req))); }

export async function listSignatures(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { reportId: string } }>(res); sendSuccess(res, 200, "Daftar tanda tangan berhasil diambil", await signatureService.listSignatures(params.reportId, actor(req))); }
export async function getSignature(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Tanda tangan berhasil diambil", await signatureService.getSignature(params.id, actor(req))); }
export async function createSignature(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string }; body: SignatureInput }>(res); sendSuccess(res, 201, "Tanda tangan berhasil dibuat", await signatureService.createSignature(params.reportId, body, actor(req))); }
export async function upsertSignature(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { reportId: string; role: SignatureInput["role"] }; body: UpsertSignatureInput }>(res); sendSuccess(res, 200, "Tanda tangan berhasil disimpan", await signatureService.upsertSignature(params.reportId, params.role, body, actor(req))); }
export async function updateSignature(req: Request, res: Response) { const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateSignatureInput }>(res); sendSuccess(res, 200, "Tanda tangan berhasil diperbarui", await signatureService.updateSignature(params.id, body, actor(req))); }
export async function uploadSignatureFile(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "File tanda tangan berhasil disimpan", await signatureService.uploadSignatureFile(params.id, req.file, actor(req))); }
const sendSignatureFile = (disposition: "inline" | "attachment") => async (req: Request, res: Response, next: NextFunction) => {
  const { params } = getValidatedInput<{ params: { id: string } }>(res);
  const { signature, absolutePath } = await signatureService.getSignatureFile(params.id, actor(req));
  res.sendFile(absolutePath, { headers: {
    "Content-Type": signature.signatureMimeType!,
    "Content-Disposition": `${disposition}; filename="${signature.signatureFileName!.replace(/["\\\r\n]/g, "_")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } }, (error) => { if (error) next(error); });
};
export const previewSignatureFile = sendSignatureFile("inline");
export const downloadSignatureFile = sendSignatureFile("attachment");
export async function deleteSignature(req: Request, res: Response) { const { params } = getValidatedInput<{ params: { id: string } }>(res); sendSuccess(res, 200, "Tanda tangan berhasil dihapus", await signatureService.deleteSignature(params.id, actor(req))); }

export async function listAudits(_req: Request, res: Response) { const { query } = getValidatedInput<{ query: ListAuditsInput }>(res); const result = await service.listAudits(query); sendSuccess(res, 200, "Audit log berhasil diambil", result.items, result.pagination); }
