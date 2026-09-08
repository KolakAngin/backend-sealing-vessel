import { Router } from "express";

import * as controller from "../controllers/transaction.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadSingleFile } from "../middleware/upload.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/transaction.schema.js";

export const transactionRouter = Router();
const loaders = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER");
const unloaders = authorize("ADMIN", "SUPERVISOR", "UNLOADING_MASTER");
const signatureWriters = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER");
const xlsxGenerators = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER");
const pdfGenerators = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER");
transactionRouter.use(authenticate);

transactionRouter.get("/reports", validateRequest(schema.listReportsRequest), controller.listReports);
transactionRouter.post("/reports", loaders, validateRequest(schema.createReportRequest), controller.createReport);
transactionRouter.get("/reports/:id", validateRequest(schema.reportDetailRequest), controller.getReport);
transactionRouter.patch("/reports/:id", loaders, validateRequest(schema.updateReportRequest), controller.updateReport);
transactionRouter.delete("/reports/:id", loaders, validateRequest(schema.reportDetailRequest), controller.deleteReport);
transactionRouter.post("/reports/:id/depart", loaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("depart"));
transactionRouter.post("/reports/:id/arrive", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("arrive"));
transactionRouter.post("/reports/:id/finish", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.post("/reports/:id/finalize", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.get("/reports/:id/validation", validateRequest(schema.lifecycleValidationRequest), controller.validateReportLifecycle);
transactionRouter.post("/reports/:id/prepare-seals", loaders, validateRequest(schema.prepareReportSealsRequest), controller.prepareReportSeals);

// Endpoint canonical shipment/voyage. /reports tetap menjadi endpoint legacy
// agar integrasi laporan lama tidak terputus.
transactionRouter.get("/voyages", validateRequest(schema.listReportsRequest), controller.listReports);
transactionRouter.post("/voyages", loaders, validateRequest(schema.createShipmentRequest), controller.createShipment);
transactionRouter.get("/voyages/:id", validateRequest(schema.reportDetailRequest), controller.getReport);
transactionRouter.patch("/voyages/:id", loaders, validateRequest(schema.updateShipmentRequest), controller.updateShipment);
transactionRouter.delete("/voyages/:id", loaders, validateRequest(schema.reportDetailRequest), controller.deleteShipment);
transactionRouter.post("/voyages/:id/depart", loaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("depart"));
transactionRouter.post("/voyages/:id/arrive", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("arrive"));
transactionRouter.post("/voyages/:id/finish", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.post("/voyages/:id/finalize", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.get("/voyages/:id/validation", validateRequest(schema.lifecycleValidationRequest), controller.validateReportLifecycle);
transactionRouter.post("/voyages/:id/prepare-seals", loaders, validateRequest(schema.prepareReportSealsRequest), controller.prepareReportSeals);

transactionRouter.get("/shipments", validateRequest(schema.listReportsRequest), controller.listReports);
transactionRouter.post("/shipments", loaders, validateRequest(schema.createShipmentRequest), controller.createShipment);
transactionRouter.get("/shipments/:id", validateRequest(schema.reportDetailRequest), controller.getReport);
transactionRouter.patch("/shipments/:id", loaders, validateRequest(schema.updateShipmentRequest), controller.updateShipment);
transactionRouter.delete("/shipments/:id", loaders, validateRequest(schema.reportDetailRequest), controller.deleteShipment);
transactionRouter.post("/shipments/:id/depart", loaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("depart"));
transactionRouter.post("/shipments/:id/arrive", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("arrive"));
transactionRouter.post("/shipments/:id/finish", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.post("/shipments/:id/finalize", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));
transactionRouter.get("/shipments/:id/validation", validateRequest(schema.lifecycleValidationRequest), controller.validateReportLifecycle);
transactionRouter.post("/shipments/:id/prepare-seals", loaders, validateRequest(schema.prepareReportSealsRequest), controller.prepareReportSeals);

// Pengisian form A-H memakai snapshot laporan. Ketiga prefix dipertahankan
// karena Shipment/Voyage menggunakan aggregate SealingReport yang sama.
for (const resource of ["reports", "voyages", "shipments"] as const) {
  transactionRouter.get(`/${resource}/:reportId/form`, validateRequest(schema.reportFormRequest), controller.getReportForm);
  transactionRouter.put(`/${resource}/:reportId/form/points/:pointId`, loaders, validateRequest(schema.writeFormPointRequest), controller.writeReportFormPoint);
  transactionRouter.patch(`/${resource}/:reportId/form/points/:pointId`, loaders, validateRequest(schema.patchFormPointRequest), controller.patchReportFormPoint);
  transactionRouter.delete(`/${resource}/:reportId/form/points/:pointId`, loaders, validateRequest(schema.deleteFormPointRequest), controller.clearReportFormPoint);
  transactionRouter.put(`/${resource}/:reportId/form/sections/:sectionCode`, loaders, validateRequest(schema.batchFormSectionRequest), controller.batchWriteReportFormSection);
}

// PDF final disimpan sebagai satu artefak immutable. Preview dan download
// selalu membaca byte-stream yang sama, bukan menjalankan renderer ulang.
for (const resource of ["reports", "voyages", "shipments"] as const) {
  transactionRouter.post(`/${resource}/:reportId/pdf`, pdfGenerators, validateRequest(schema.reportPdfRequest), controller.generateReportPdf);
  transactionRouter.get(`/${resource}/:reportId/pdf/preview`, validateRequest(schema.reportPdfRequest), controller.previewReportPdf);
  transactionRouter.get(`/${resource}/:reportId/pdf/download`, validateRequest(schema.reportPdfRequest), controller.downloadReportPdf);
}

// Generator resmi hanya membaca finalSnapshot. Ketiga alias memakai artefak
// yang sama karena Shipment/Voyage dan SealingReport adalah aggregate yang sama.
for (const resource of ["reports", "voyages", "shipments"] as const) {
  transactionRouter.post(`/${resource}/:reportId/xlsx`, xlsxGenerators, validateRequest(schema.reportXlsxRequest), controller.generateReportXlsx);
  transactionRouter.get(`/${resource}/:reportId/xlsx/preview`, validateRequest(schema.reportXlsxRequest), controller.previewReportXlsx);
  transactionRouter.get(`/${resource}/:reportId/xlsx/download`, validateRequest(schema.reportXlsxRequest), controller.downloadReportXlsx);
}

transactionRouter.get("/plant-jetty-assignments", validateRequest(schema.listPlantJettyAssignmentsRequest), controller.listPlantJettyAssignments);
transactionRouter.post("/plant-jetty-assignments", authorize("ADMIN"), validateRequest(schema.createPlantJettyAssignmentRequest), controller.createPlantJettyAssignment);
transactionRouter.delete("/plant-jetty-assignments/:id", authorize("ADMIN"), validateRequest(schema.plantJettyAssignmentDetailRequest), controller.deletePlantJettyAssignment);

transactionRouter.get("/reports/:reportId/records", validateRequest(schema.listRecordsRequest), controller.listRecords);
transactionRouter.post("/reports/:reportId/records", loaders, validateRequest(schema.createRecordRequest), controller.createRecord);
transactionRouter.get("/voyages/:reportId/records", validateRequest(schema.listRecordsRequest), controller.listRecords);
transactionRouter.post("/voyages/:reportId/records", loaders, validateRequest(schema.createRecordRequest), controller.createRecord);
transactionRouter.get("/shipments/:reportId/records", validateRequest(schema.listRecordsRequest), controller.listRecords);
transactionRouter.post("/shipments/:reportId/records", loaders, validateRequest(schema.createRecordRequest), controller.createRecord);
transactionRouter.patch("/records/:id", loaders, validateRequest(schema.updateRecordRequest), controller.updateRecord);
transactionRouter.delete("/records/:id", loaders, validateRequest(schema.recordDetailRequest), controller.deleteRecord);

transactionRouter.post("/records/:recordId/seals", loaders, validateRequest(schema.createSealRequest), controller.createSeal);
transactionRouter.patch("/seals/:id", loaders, validateRequest(schema.updateSealRequest), controller.updateSeal);
transactionRouter.post("/seals/:id/remove", loaders, validateRequest(schema.removeSealRequest), controller.removeSeal);
transactionRouter.post("/seals/:id/replace", loaders, validateRequest(schema.replaceSealRequest), controller.replaceSeal);
transactionRouter.post("/seals/:id/verify", unloaders, validateRequest(schema.verifySealRequest), controller.verifySeal);

for (const resource of ["reports", "voyages", "shipments"] as const) {
  transactionRouter.get(`/${resource}/:reportId/signatures`, validateRequest(schema.listSignaturesRequest), controller.listSignatures);
  transactionRouter.post(`/${resource}/:reportId/signatures`, signatureWriters, validateRequest(schema.createSignatureRequest), controller.createSignature);
}
transactionRouter.get("/signatures/:id", validateRequest(schema.signatureDetailRequest), controller.getSignature);
transactionRouter.patch("/signatures/:id", signatureWriters, validateRequest(schema.updateSignatureRequest), controller.updateSignature);
transactionRouter.put("/signatures/:id/file", signatureWriters, uploadSingleFile, validateRequest(schema.signatureDetailRequest), controller.uploadSignatureFile);
transactionRouter.get("/signatures/:id/preview", validateRequest(schema.signatureDetailRequest), controller.previewSignatureFile);
transactionRouter.get("/signatures/:id/download", validateRequest(schema.signatureDetailRequest), controller.downloadSignatureFile);
transactionRouter.delete("/signatures/:id", signatureWriters, validateRequest(schema.signatureDetailRequest), controller.deleteSignature);

transactionRouter.get("/audit-logs", authorize("ADMIN", "SUPERVISOR"), validateRequest(schema.listAuditsRequest), controller.listAudits);
