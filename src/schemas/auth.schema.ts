import { z } from "zod";

const userRole = z.enum(["ADMIN", "SUPERVISOR", "OPERATOR", "VIEWER"]);
const idParams = z.object({ id: z.uuid("ID user harus berupa UUID yang valid") });

export const loginBody = z.object({
  username: z.string().trim().min(1).max(50),
  password: z.string().min(1).max(200),
}).strict();

export const createUserBody = z.object({
  username: z.string().trim().min(3).max(50),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(100).nullable().optional(),
  role: userRole.default("OPERATOR"),
  isActive: z.boolean().default(true),
}).strict();

export const updateUserBody = z.object({
  username: z.string().trim().min(3).max(50).optional(),
  password: z.string().min(8).max(72).optional(),
  fullName: z.string().trim().min(1).max(100).optional(),
  email: z.string().trim().email().max(100).nullable().optional(),
  role: userRole.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");

const booleanQuery = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());

export const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().min(1).max(100).optional(),
  role: userRole.optional(),
  isActive: booleanQuery,
  sortBy: z.enum(["username", "fullName", "role", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const loginRequest = z.object({ body: loginBody, params: z.object({}), query: z.object({}) });
export const createUserRequest = z.object({ body: createUserBody, params: z.object({}), query: z.object({}) });
export const updateUserRequest = z.object({ body: updateUserBody, params: idParams, query: z.object({}) });
export const userDetailRequest = z.object({ body: z.unknown(), params: idParams, query: z.object({}) });
export const listUsersRequest = z.object({ body: z.unknown(), params: z.object({}), query: listUsersQuery });

export type LoginInput = z.infer<typeof loginBody>;
export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type ListUsersInput = z.infer<typeof listUsersQuery>;
export type UserIdParams = z.infer<typeof idParams>;
