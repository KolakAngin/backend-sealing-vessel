import multer from "multer";

import { env } from "../config/env.js";
import { AppError } from "../utils/app-error.js";

const acceptedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const uploadSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_SIZE_BYTES, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!acceptedMimeTypes.has(file.mimetype)) {
      callback(new AppError(415, "Format file harus JPEG, PNG, WebP, atau PDF"));
      return;
    }
    callback(null, true);
  },
}).single("file");
