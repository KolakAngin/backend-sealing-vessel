import { z } from "zod";

const uuid = z.string().uuid();

export const uploadAttachmentRequest = z.object({
  params: z.record(z.string(), uuid),
  body: z.object({
    type: z.enum(["PHOTO", "DOCUMENT", "OTHER"]).optional(),
    description: z.string().trim().max(2_000).optional(),
    sequence: z.coerce.number().int().nonnegative().optional(),
  }),
  query: z.object({}),
});

export const attachmentDetailRequest = z.object({
  params: z.object({ id: uuid }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export type AttachmentInput = z.infer<typeof uploadAttachmentRequest>["body"];
