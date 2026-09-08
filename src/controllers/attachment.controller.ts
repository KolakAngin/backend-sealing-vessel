import type { NextFunction, Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type { AttachmentInput, UpdateAttachmentInput } from "../schemas/attachment.schema.js";
import * as service from "../services/attachment.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

function actor(request: Request): service.AttachmentActor {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  return { id: request.authUser.id, role: request.authUser.role };
}

function owner(kind: service.AttachmentOwner["kind"], params: Record<string, string>, paramName: string): service.AttachmentOwner {
  if (kind === "section") return { kind, id: params[paramName]!, sectionCode: params.sectionCode! };
  return { kind, id: params[paramName]! };
}

export const upload = (kind: service.AttachmentOwner["kind"], paramName: string) => async (request: Request, response: Response) => {
  const { params, body } = getValidatedInput<{ params: Record<string, string>; body: AttachmentInput }>(response);
  const attachment = await service.uploadAttachment(owner(kind, params, paramName), body, request.file, actor(request));
  sendSuccess(response, 201, "Lampiran berhasil diunggah", attachment);
};

export const list = (kind: service.AttachmentOwner["kind"], paramName: string) => async (request: Request, response: Response) => {
  const { params } = getValidatedInput<{ params: Record<string, string> }>(response);
  sendSuccess(response, 200, "Daftar lampiran berhasil diambil", await service.listAttachments(owner(kind, params, paramName), actor(request)));
};

export async function getAttachment(request: Request, response: Response) {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  sendSuccess(response, 200, "Lampiran berhasil diambil", await service.getAttachment(params.id, actor(request)));
}

export async function updateAttachment(request: Request, response: Response) {
  const { params, body } = getValidatedInput<{ params: { id: string }; body: UpdateAttachmentInput }>(response);
  sendSuccess(response, 200, "Metadata lampiran berhasil diperbarui", await service.updateAttachment(params.id, body, actor(request)));
}

const sendAttachmentFile = (disposition: "inline" | "attachment") => async (request: Request, response: Response, next: NextFunction) => {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  const { attachment, absolutePath } = await service.getAttachmentFile(params.id, actor(request));
  response.sendFile(absolutePath, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `${disposition}; filename="${attachment.fileName.replace(/["\\\r\n]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  }, (error) => { if (error) next(error); });
};

export const previewAttachment = sendAttachmentFile("inline");
export const downloadAttachment = sendAttachmentFile("attachment");

export async function deleteAttachment(request: Request, response: Response) {
  const { params } = getValidatedInput<{ params: { id: string } }>(response);
  sendSuccess(response, 200, "Lampiran berhasil dihapus", await service.deleteAttachment(params.id, actor(request)));
}
