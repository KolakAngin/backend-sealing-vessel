import { randomUUID } from "node:crypto";

import { prisma } from "../config/prisma.js";
import type { AuditAction, Prisma } from "../generated/prisma/client.js";
import type {
  CreateUserInput,
  AssignableUsersInput,
  ListUsersInput,
  LoginInput,
  UpdateUserInput,
} from "../schemas/auth.schema.js";
import { AppError } from "../utils/app-error.js";
import { createAccessToken } from "../utils/jwt.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { env } from "../config/env.js";

const publicUserSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const userAudit = (actorId: string, action: AuditAction, entityId: string, oldData?: unknown, newData?: unknown) => prisma.auditLog.create({
  data: {
    userId: actorId,
    action,
    entityType: "USER",
    entityId,
    ...(oldData === undefined ? {} : { oldData: asJson(oldData) }),
    ...(newData === undefined ? {} : { newData: asJson(newData) }),
  },
});

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { username: input.username.toLowerCase() },
  });

  if (!user || !user.isActive || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, "Username atau password salah");
  }

  const accessToken = await createAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  const { passwordHash: _passwordHash, ...publicUser } = user;
  return {
    accessToken,
    tokenType: "Bearer" as const,
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    user: publicUser,
  };
}

export async function getCurrentUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!user) throw new AppError(404, "User tidak ditemukan");
  return user;
}

export async function listUsers(query: ListUsersInput) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search ? { OR: [
      { username: { contains: query.search, mode: "insensitive" } },
      { fullName: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const items = await prisma.user.findMany({
    where,
    select: publicUserSelect,
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    orderBy: { [query.sortBy]: query.sortOrder },
  });
  const total = await prisma.user.count({ where });
  return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function listAssignableUsers(query: AssignableUsersInput) {
  const where: Prisma.UserWhereInput = {
    role: "UNLOADING_MASTER",
    isActive: true,
    ...(query.search ? { OR: [
      { username: { contains: query.search, mode: "insensitive" } },
      { fullName: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: { id: true, username: true, fullName: true, role: true },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    }),
    prisma.user.count({ where }),
  ]);
  return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!user) throw new AppError(404, "User tidak ditemukan");
  return user;
}

export async function createUser(input: CreateUserInput, actorId: string) {
  const passwordHash = await hashPassword(input.password);
  const id = randomUUID();
  const data = {
      id,
      username: input.username.toLowerCase(),
      passwordHash,
      fullName: input.fullName,
      ...(input.email === undefined ? {} : { email: input.email?.toLowerCase() ?? null }),
      role: input.role,
      isActive: input.isActive,
  };
  const publicData = { id, username: data.username, fullName: data.fullName, email: data.email ?? null, role: data.role, isActive: data.isActive };
  const [user] = await prisma.$transaction([
    prisma.user.create({ data, select: publicUserSelect }),
    userAudit(actorId, "CREATE", id, undefined, publicData),
  ]);
  return user;
}

export async function updateUser(id: string, input: UpdateUserInput, actorId: string) {
  const old = await getUser(id);
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  const data = {
      ...(input.username === undefined ? {} : { username: input.username.toLowerCase() }),
      ...(passwordHash === undefined ? {} : { passwordHash }),
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.email === undefined ? {} : { email: input.email?.toLowerCase() ?? null }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };
  const auditData = {
    ...Object.fromEntries(Object.entries(data).filter(([key]) => key !== "passwordHash")),
    ...(passwordHash === undefined ? {} : { passwordChanged: true }),
  };
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id }, data, select: publicUserSelect }),
    userAudit(actorId, "UPDATE", id, old, auditData),
  ]);
  return user;
}

export async function deactivateUser(id: string, actorId: string) {
  if (id === actorId) throw new AppError(400, "Anda tidak dapat menonaktifkan akun sendiri");
  const old = await getUser(id);
  const data = { isActive: false };
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id }, data, select: publicUserSelect }),
    userAudit(actorId, "DELETE", id, old, data),
  ]);
  return user;
}
