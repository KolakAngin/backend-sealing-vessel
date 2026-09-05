import { Router } from "express";

import * as controller from "../controllers/attachment.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadSingleFile } from "../middleware/upload.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/attachment.schema.js";

export const attachmentRouter = Router();
const writers = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER");
attachmentRouter.use(authenticate);

attachmentRouter.post("/reports/:reportId/attachments", writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("report", "reportId"));
attachmentRouter.post("/records/:recordId/attachments", writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("record", "recordId"));
attachmentRouter.post("/verifications/:verificationId/attachments", writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("verification", "verificationId"));
attachmentRouter.get("/attachments/:id", validateRequest(schema.attachmentDetailRequest), controller.getAttachment);
attachmentRouter.get("/attachments/:id/file", validateRequest(schema.attachmentDetailRequest), controller.downloadAttachment);
attachmentRouter.delete("/attachments/:id", writers, validateRequest(schema.attachmentDetailRequest), controller.deleteAttachment);
