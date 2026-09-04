import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  CreateUserInput,
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

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
  if (!user) throw new AppError(404, "User tidak ditemukan");
  return user;
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      username: input.username.toLowerCase(),
      passwordHash,
      fullName: input.fullName,
      ...(input.email === undefined ? {} : { email: input.email?.toLowerCase() ?? null }),
      role: input.role,
      isActive: input.isActive,
    },
    select: publicUserSelect,
  });
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  return prisma.user.update({
    where: { id },
    data: {
      ...(input.username === undefined ? {} : { username: input.username.toLowerCase() }),
      ...(passwordHash === undefined ? {} : { passwordHash }),
      ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
      ...(input.email === undefined ? {} : { email: input.email?.toLowerCase() ?? null }),
      ...(input.role === undefined ? {} : { role: input.role }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
    select: publicUserSelect,
  });
}

export async function deactivateUser(id: string, actorId: string) {
  if (id === actorId) throw new AppError(400, "Anda tidak dapat menonaktifkan akun sendiri");
  return prisma.user.update({ where: { id }, data: { isActive: false }, select: publicUserSelect });
}
