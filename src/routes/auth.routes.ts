import { Router } from "express";

import { loginController, meController } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import { loginRequest } from "../schemas/auth.schema.js";

export const authRouter = Router();

authRouter.post("/login", validateRequest(loginRequest), loginController);
authRouter.get("/me", authenticate, meController);
