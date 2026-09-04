import express from "express";

import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import { authRouter } from "./routes/auth.routes.js";
import { attachmentRouter } from "./routes/attachment.routes.js";
import { masterDataRouter } from "./routes/master-data.routes.js";
import { terminalRouter } from "./routes/terminal.routes.js";
import { transactionRouter } from "./routes/transaction.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { sendSuccess } from "./utils/api-response.js";

export const app = express();

app.disable("x-powered-by");
app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value,
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.get("/", (_request, response) => {
  return sendSuccess(response, 200, "Server berjalan", {
    service: "backend-kapal",
  });
});

app.get("/api/v1/health", (_request, response) => {
  return sendSuccess(response, 200, "Service sehat", {
    status: "ok",
    uptime: process.uptime(),
  });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", attachmentRouter);
app.use("/api/v1/users", userRouter);
app.use("/api/v1/terminals", terminalRouter);
app.use("/api/v1", masterDataRouter);
app.use("/api/v1", transactionRouter);

app.use(notFound);
app.use(errorHandler);
