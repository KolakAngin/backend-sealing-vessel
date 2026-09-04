import { Router } from "express";

import {
  createTerminalController,
  deactivateTerminalController,
  getTerminalController,
  listTerminalsController,
  updateTerminalController,
} from "../controllers/terminal.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  createTerminalRequestSchema,
  listTerminalsRequestSchema,
  terminalDetailRequestSchema,
  updateTerminalRequestSchema,
} from "../schemas/terminal.schema.js";

export const terminalRouter = Router();

terminalRouter.use(authenticate);

terminalRouter.get(
  "/",
  validateRequest(listTerminalsRequestSchema),
  listTerminalsController,
);
terminalRouter.get(
  "/:id",
  validateRequest(terminalDetailRequestSchema),
  getTerminalController,
);
terminalRouter.post(
  "/",
  authorize("ADMIN", "SUPERVISOR"),
  validateRequest(createTerminalRequestSchema),
  createTerminalController,
);
terminalRouter.patch(
  "/:id",
  authorize("ADMIN", "SUPERVISOR"),
  validateRequest(updateTerminalRequestSchema),
  updateTerminalController,
);
terminalRouter.delete(
  "/:id",
  authorize("ADMIN"),
  validateRequest(terminalDetailRequestSchema),
  deactivateTerminalController,
);
