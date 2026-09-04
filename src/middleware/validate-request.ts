import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";

export function validateRequest(schema: z.ZodType) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: request.body,
      params: request.params,
      query: request.query,
    });

    if (!result.success) {
      next(result.error);
      return;
    }

    response.locals.validatedInput = result.data;
    next();
  };
}

export function getValidatedInput<T>(response: Response): T {
  return response.locals.validatedInput as T;
}
