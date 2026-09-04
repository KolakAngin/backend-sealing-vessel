import { Router } from "express";

import * as controller from "../controllers/auth.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/auth.schema.js";

export const userRouter = Router();

userRouter.use(authenticate, authorize("ADMIN"));
userRouter.get("/", validateRequest(schema.listUsersRequest), controller.listUsersController);
userRouter.post("/", validateRequest(schema.createUserRequest), controller.createUserController);
userRouter.get("/:id", validateRequest(schema.userDetailRequest), controller.getUserController);
userRouter.patch("/:id", validateRequest(schema.updateUserRequest), controller.updateUserController);
userRouter.delete("/:id", validateRequest(schema.userDetailRequest), controller.deactivateUserController);
