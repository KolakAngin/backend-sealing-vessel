import type { Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type { AssignableUsersInput, CreateUserInput, ListUsersInput, LoginInput, UpdateUserInput, UserIdParams } from "../schemas/auth.schema.js";
import * as authService from "../services/auth.service.js";
import { AppError } from "../utils/app-error.js";
import { sendSuccess } from "../utils/api-response.js";

export async function loginController(_request: Request, response: Response): Promise<void> {
  const { body } = getValidatedInput<{ body: LoginInput }>(response);
  sendSuccess(response, 200, "Login berhasil", await authService.login(body));
}

export async function meController(request: Request, response: Response): Promise<void> {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  sendSuccess(response, 200, "Profil user berhasil diambil", await authService.getCurrentUser(request.authUser.id));
}

export async function listUsersController(_request: Request, response: Response): Promise<void> {
  const { query } = getValidatedInput<{ query: ListUsersInput }>(response);
  const result = await authService.listUsers(query);
  sendSuccess(response, 200, "Daftar user berhasil diambil", result.items, result.pagination);
}

export async function listAssignableUsersController(_request: Request, response: Response): Promise<void> {
  const { query } = getValidatedInput<{ query: AssignableUsersInput }>(response);
  const result = await authService.listAssignableUsers(query);
  sendSuccess(response, 200, "Daftar Unloading Master aktif berhasil diambil", result.items, result.pagination);
}

export async function getUserController(_request: Request, response: Response): Promise<void> {
  const { params } = getValidatedInput<{ params: UserIdParams }>(response);
  sendSuccess(response, 200, "User berhasil diambil", await authService.getUser(params.id));
}

export async function createUserController(request: Request, response: Response): Promise<void> {
  const { body } = getValidatedInput<{ body: CreateUserInput }>(response);
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  sendSuccess(response, 201, "User berhasil dibuat", await authService.createUser(body, request.authUser.id));
}

export async function updateUserController(request: Request, response: Response): Promise<void> {
  const { params, body } = getValidatedInput<{ params: UserIdParams; body: UpdateUserInput }>(response);
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  sendSuccess(response, 200, "User berhasil diperbarui", await authService.updateUser(params.id, body, request.authUser.id));
}

export async function deactivateUserController(request: Request, response: Response): Promise<void> {
  const { params } = getValidatedInput<{ params: UserIdParams }>(response);
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  sendSuccess(response, 200, "User berhasil dinonaktifkan", await authService.deactivateUser(params.id, request.authUser.id));
}
