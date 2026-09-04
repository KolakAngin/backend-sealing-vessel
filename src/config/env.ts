import "dotenv/config";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(5000),
  JWT_SECRET: z.string().min(32, "JWT_SECRET minimal 32 karakter"),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(28_800),
  UPLOAD_DIR: z.string().min(1).default("uploads"),
  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const messages = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Konfigurasi environment tidak valid: ${messages}`);
}

export const env = parsedEnv.data;
