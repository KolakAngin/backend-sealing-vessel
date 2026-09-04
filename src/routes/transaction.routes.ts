import { Router } from "express";

import * as controller from "../controllers/transaction.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/transaction.schema.js";

export const transactionRouter = Router();
const writers = authorize("ADMIN", "SUPERVISOR", "OPERATOR");
const reviewers = authorize("ADMIN", "SUPERVISOR");
transactionRouter.use(authenticate);

transactionRouter.get("/reports", validateRequest(schema.listReportsRequest), controller.listReports);
transactionRouter.post("/reports", writers, validateRequest(schema.createReportRequest), controller.createReport);
transactionRouter.get("/reports/:id", validateRequest(schema.reportDetailRequest), controller.getReport);
transactionRouter.patch("/reports/:id", writers, validateRequest(schema.updateReportRequest), controller.updateReport);
transactionRouter.delete("/reports/:id", writers, validateRequest(schema.reportDetailRequest), controller.deleteReport);
transactionRouter.post("/reports/:id/submit", writers, validateRequest(schema.transitionReportRequest), controller.transitionReport("submit"));
transactionRouter.post("/reports/:id/verify", reviewers, validateRequest(schema.transitionReportRequest), controller.transitionReport("verify"));
transactionRouter.post("/reports/:id/approve", reviewers, validateRequest(schema.transitionReportRequest), controller.transitionReport("approve"));
transactionRouter.post("/reports/:id/reject", reviewers, validateRequest(schema.transitionReportRequest), controller.transitionReport("reject"));

transactionRouter.get("/reports/:reportId/records", validateRequest(schema.listRecordsRequest), controller.listRecords);
transactionRouter.post("/reports/:reportId/records", writers, validateRequest(schema.createRecordRequest), controller.createRecord);
transactionRouter.patch("/records/:id", writers, validateRequest(schema.updateRecordRequest), controller.updateRecord);
transactionRouter.delete("/records/:id", writers, validateRequest(schema.recordDetailRequest), controller.deleteRecord);

transactionRouter.post("/records/:recordId/seals", writers, validateRequest(schema.createSealRequest), controller.createSeal);
transactionRouter.patch("/seals/:id", writers, validateRequest(schema.updateSealRequest), controller.updateSeal);
transactionRouter.post("/seals/:id/remove", writers, validateRequest(schema.removeSealRequest), controller.removeSeal);
transactionRouter.post("/seals/:id/replace", writers, validateRequest(schema.replaceSealRequest), controller.replaceSeal);
transactionRouter.post("/seals/:id/verify", reviewers, validateRequest(schema.verifySealRequest), controller.verifySeal);

transactionRouter.get("/reports/:reportId/signatures", validateRequest(schema.listSignaturesRequest), controller.listSignatures);
transactionRouter.post("/reports/:reportId/signatures", writers, validateRequest(schema.createSignatureRequest), controller.createSignature);
transactionRouter.patch("/signatures/:id", writers, validateRequest(schema.updateSignatureRequest), controller.updateSignature);
transactionRouter.delete("/signatures/:id", writers, validateRequest(schema.signatureDetailRequest), controller.deleteSignature);

transactionRouter.get("/audit-logs", reviewers, validateRequest(schema.listAuditsRequest), controller.listAudits);
