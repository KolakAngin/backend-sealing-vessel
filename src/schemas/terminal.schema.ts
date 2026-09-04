import { z } from "zod";

const nullableTrimmedString = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

export const terminalIdParamsSchema = z.object({
  id: z.uuid("ID terminal harus berupa UUID yang valid"),
});

export const createTerminalBodySchema = z
  .object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(1).max(150),
    address: nullableTrimmedString(2_000),
    city: nullableTrimmedString(100),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const updateTerminalBodySchema = z
  .object({
    code: z.string().trim().min(1).max(20).optional(),
    name: z.string().trim().min(1).max(150).optional(),
    address: nullableTrimmedString(2_000),
    city: nullableTrimmedString(100),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Minimal satu field harus dikirim",
  });

const booleanQuerySchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const listTerminalsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().min(1).max(150).optional(),
  isActive: booleanQuerySchema,
  sortBy: z
    .enum(["code", "name", "city", "createdAt", "updatedAt"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const createTerminalRequestSchema = z.object({
  body: createTerminalBodySchema,
  params: z.object({}),
  query: z.object({}),
});

export const listTerminalsRequestSchema = z.object({
  body: z.unknown(),
  params: z.object({}),
  query: listTerminalsQuerySchema,
});

export const terminalDetailRequestSchema = z.object({
  body: z.unknown(),
  params: terminalIdParamsSchema,
  query: z.object({}),
});

export const updateTerminalRequestSchema = z.object({
  body: updateTerminalBodySchema,
  params: terminalIdParamsSchema,
  query: z.object({}),
});

export type CreateTerminalInput = z.infer<typeof createTerminalBodySchema>;
export type UpdateTerminalInput = z.infer<typeof updateTerminalBodySchema>;
export type ListTerminalsQuery = z.infer<typeof listTerminalsQuerySchema>;
export type TerminalIdParams = z.infer<typeof terminalIdParamsSchema>;
