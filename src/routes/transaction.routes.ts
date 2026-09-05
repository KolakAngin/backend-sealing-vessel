import { Router } from "express";

import * as controller from "../controllers/transaction.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/transaction.schema.js";

export const transactionRouter = Router();
const loaders = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER");
const unloaders = authorize("ADMIN", "SUPERVISOR", "UNLOADING_MASTER");
transactionRouter.use(authenticate);

transactionRouter.get("/reports", validateRequest(schema.listReportsRequest), controller.listReports);
transactionRouter.post("/reports", loaders, validateRequest(schema.createReportRequest), controller.createReport);
transactionRouter.get("/reports/:id", validateRequest(schema.reportDetailRequest), controller.getReport);
transactionRouter.patch("/reports/:id", loaders, validateRequest(schema.updateReportRequest), controller.updateReport);
transactionRouter.delete("/reports/:id", loaders, validateRequest(schema.reportDetailRequest), controller.deleteReport);
transactionRouter.post("/reports/:id/depart", loaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("depart"));
transactionRouter.post("/reports/:id/arrive", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("arrive"));
transactionRouter.post("/reports/:id/finish", unloaders, validateRequest(schema.journeyTransitionRequest), controller.transitionReport("finish"));

transactionRouter.get("/reports/:reportId/records", validateRequest(schema.listRecordsRequest), controller.listRecords);
transactionRouter.post("/reports/:reportId/records", loaders, validateRequest(schema.createRecordRequest), controller.createRecord);
transactionRouter.patch("/records/:id", loaders, validateRequest(schema.updateRecordRequest), controller.updateRecord);
transactionRouter.delete("/records/:id", loaders, validateRequest(schema.recordDetailRequest), controller.deleteRecord);

transactionRouter.post("/records/:recordId/seals", loaders, validateRequest(schema.createSealRequest), controller.createSeal);
transactionRouter.patch("/seals/:id", loaders, validateRequest(schema.updateSealRequest), controller.updateSeal);
transactionRouter.post("/seals/:id/remove", loaders, validateRequest(schema.removeSealRequest), controller.removeSeal);
transactionRouter.post("/seals/:id/replace", loaders, validateRequest(schema.replaceSealRequest), controller.replaceSeal);
transactionRouter.post("/seals/:id/verify", unloaders, validateRequest(schema.verifySealRequest), controller.verifySeal);

transactionRouter.get("/reports/:reportId/signatures", validateRequest(schema.listSignaturesRequest), controller.listSignatures);
transactionRouter.post("/reports/:reportId/signatures", loaders, validateRequest(schema.createSignatureRequest), controller.createSignature);
transactionRouter.patch("/signatures/:id", loaders, validateRequest(schema.updateSignatureRequest), controller.updateSignature);
transactionRouter.delete("/signatures/:id", loaders, validateRequest(schema.signatureDetailRequest), controller.deleteSignature);

transactionRouter.get("/audit-logs", authorize("ADMIN", "SUPERVISOR"), validateRequest(schema.listAuditsRequest), controller.listAudits);
