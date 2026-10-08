import { z } from "zod";

const uuid = z.string().uuid();
const sectionCode = z.string().trim().toUpperCase().pipe(z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]));
const optionalText = (max: number) => z.string().trim().max(max).optional();

export const uploadAttachmentRequest = z.object({
  params: z.record(z.string(), uuid),
  body: z.object({
    type: z.enum(["PHOTO", "DOCUMENT", "OTHER"]).optional(),
    caption: optionalText(2_000),
    description: optionalText(2_000),
    sequence: z.coerce.number().int().nonnegative().max(2_147_483_647).optional(),
    sectionCode: sectionCode.optional(),
    compartmentId: uuid.optional(),
    vesselSealingPointId: uuid.optional(),
  }).strict(),
  query: z.object({}),
});

export const uploadSectionAttachmentRequest = z.object({
  params: z.object({ reportId: uuid, sectionCode }),
  body: uploadAttachmentRequest.shape.body,
  query: z.object({}),
});

export const updateAttachmentRequest = z.object({
  params: z.object({ id: uuid }),
  body: z.object({
    type: z.enum(["PHOTO", "DOCUMENT", "OTHER"]).optional(),
    caption: z.string().trim().max(2_000).nullable().optional(),
    sequence: z.coerce.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "Minimal satu field harus dikirim"),
  query: z.object({}),
});

export const listAttachmentsRequest = z.object({
  params: z.record(z.string(), uuid),
  body: z.unknown(),
  query: z.object({}),
});

export const listSectionAttachmentsRequest = z.object({
  params: z.object({ reportId: uuid, sectionCode }),
  body: z.unknown(),
  query: z.object({}),
});

export const attachmentDetailRequest = z.object({
  params: z.object({ id: uuid }),
  body: z.object({}).optional(),
  query: z.object({}),
});

export type AttachmentInput = z.infer<typeof uploadAttachmentRequest>["body"];
export type UpdateAttachmentInput = z.infer<typeof updateAttachmentRequest>["body"];
