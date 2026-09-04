import type { NextFunction, Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type { AttachmentInput } from "../schemas/attachment.schema.js";
import * as service from "../services/attachment.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actor(request: Request): service.AttachmentActor {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  return { id: request.authUser.id, role: request.authUser.role };
}

export const upload = (kind: service.AttachmentOwner["kind"], paramName: string) => async (request: Request, response: Response) => {
  const { params, body } = getValidatedInput<{ params: Record<string, string>; body: AttachmentInput }>(response);
  const attachment = await service.uploadAttachment({ kind, id: params[paramName]! }, body, request.file, actor(request));
  sendSuccess(response, 201, "Lampiran berhasil diunggah", attachment);
};

export async function getAttachment(_request: Request, response: Response) {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  sendSuccess(response, 200, "Lampiran berhasil diambil", await service.getAttachment(params.id));
}

export async function downloadAttachment(_request: Request, response: Response, next: NextFunction) {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  const { attachment, absolutePath } = await service.getAttachmentFile(params.id);
  response.sendFile(absolutePath, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `inline; filename="${attachment.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  }, (error) => { if (error) next(error); });
}

export async function deleteAttachment(request: Request, response: Response) {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  sendSuccess(response, 200, "Lampiran berhasil dihapus", await service.deleteAttachment(params.id, actor(request)));
}
