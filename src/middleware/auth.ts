import type { NextFunction, Request, Response } from "express";

import { prisma } from "../config/prisma.js";
import type { UserRole } from "../generated/prisma/enums.js";
import { AppError } from "../utils/app-error.js";
import { verifyAccessToken } from "../utils/jwt.js";

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new AppError(401, "Token autentikasi diperlukan");
    }

    const token = authorization.slice(7).trim();
    if (!token) throw new AppError(401, "Token autentikasi diperlukan");

    const payload = await verifyAccessToken(token).catch(() => {
      throw new AppError(401, "Token autentikasi tidak valid atau kedaluwarsa");
    });
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true },
    });

    if (!user?.isActive) {
      throw new AppError(401, "Akun tidak aktif atau tidak ditemukan");
    }

    request.authUser = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.authUser) {
      next(new AppError(401, "Autentikasi diperlukan"));
      return;
    }

    if (!roles.includes(request.authUser.role)) {
      next(new AppError(403, "Anda tidak memiliki izin untuk tindakan ini"));
      return;
    }

    next();
  };
}
