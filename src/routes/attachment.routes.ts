import { Router } from "express";

import * as controller from "../controllers/attachment.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { uploadSingleFile } from "../middleware/upload.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/attachment.schema.js";

export const attachmentRouter = Router();
const writers = authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER");
attachmentRouter.use(authenticate);

for (const resource of ["reports", "voyages", "shipments"] as const) {
  attachmentRouter.get(`/${resource}/:reportId/attachments`, validateRequest(schema.listAttachmentsRequest), controller.list("report", "reportId"));
  attachmentRouter.post(`/${resource}/:reportId/attachments`, writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("report", "reportId"));
  attachmentRouter.get(`/${resource}/:reportId/sections/:sectionCode/attachments`, validateRequest(schema.listSectionAttachmentsRequest), controller.list("section", "reportId"));
  attachmentRouter.post(`/${resource}/:reportId/sections/:sectionCode/attachments`, writers, uploadSingleFile, validateRequest(schema.uploadSectionAttachmentRequest), controller.upload("section", "reportId"));
}
attachmentRouter.get("/records/:recordId/attachments", validateRequest(schema.listAttachmentsRequest), controller.list("record", "recordId"));
attachmentRouter.post("/records/:recordId/attachments", writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("record", "recordId"));
attachmentRouter.get("/verifications/:verificationId/attachments", validateRequest(schema.listAttachmentsRequest), controller.list("verification", "verificationId"));
attachmentRouter.post("/verifications/:verificationId/attachments", writers, uploadSingleFile, validateRequest(schema.uploadAttachmentRequest), controller.upload("verification", "verificationId"));
attachmentRouter.get("/attachments/:id", validateRequest(schema.attachmentDetailRequest), controller.getAttachment);
attachmentRouter.patch("/attachments/:id", writers, validateRequest(schema.updateAttachmentRequest), controller.updateAttachment);
attachmentRouter.get("/attachments/:id/preview", validateRequest(schema.attachmentDetailRequest), controller.previewAttachment);
attachmentRouter.get("/attachments/:id/download", validateRequest(schema.attachmentDetailRequest), controller.downloadAttachment);
attachmentRouter.get("/attachments/:id/file", validateRequest(schema.attachmentDetailRequest), controller.previewAttachment);
attachmentRouter.delete("/attachments/:id", writers, validateRequest(schema.attachmentDetailRequest), controller.deleteAttachment);
