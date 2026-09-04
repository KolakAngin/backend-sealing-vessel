import type { Response } from "express";

type ResponseMeta = Record<string, unknown>;

export function sendSuccess<T>(
  response: Response,
  statusCode: number,
  message: string,
  data: T,
  meta?: ResponseMeta,
): Response {
  return response.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
    timestamp: new Date().toISOString(),
  });
}

export function sendError(
  response: Response,
  statusCode: number,
  message: string,
  details?: unknown,
): Response {
  return response.status(statusCode).json({
    success: false,
    message,
    ...(details === undefined ? {} : { details }),
    timestamp: new Date().toISOString(),
  });
}
