import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";

import { AppError } from "../utils/app-error.js";
import { sendError } from "../utils/api-response.js";

function isPrismaKnownRequestError(
  error: unknown,
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    error.name === "PrismaClientKnownRequestError" &&
    "code" in error &&
    typeof error.code === "string"
  );
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "Ukuran file melebihi batas yang diizinkan"
      : `Upload file gagal: ${error.message}`;
    sendError(response, status, message);
    return;
  }
  if (error instanceof ZodError) {
    sendError(response, 400, "Validasi request gagal", error.issues);
    return;
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === "P2002") {
      sendError(response, 409, "Data dengan nilai unik tersebut sudah tersedia");
      return;
    }

    if (error.code === "P2025") {
      sendError(response, 404, "Data tidak ditemukan");
      return;
    }

    if (error.code === "P2003") {
      sendError(response, 409, "Data masih digunakan oleh relasi lain");
      return;
    }
  }

  if (error instanceof AppError) {
    sendError(response, error.statusCode, error.message, error.details);
    return;
  }

  console.error(error);
  sendError(response, 500, "Terjadi kesalahan pada server");
};
