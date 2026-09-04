import type { NextFunction, Request, Response } from "express";

import { AppError } from "../utils/app-error.js";

export function notFound(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(
    new AppError(
      404,
      `Route ${request.method} ${request.originalUrl} tidak ditemukan`,
    ),
  );
}
