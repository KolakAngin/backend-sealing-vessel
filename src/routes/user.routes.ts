import { Router } from "express";

import * as controller from "../controllers/auth.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/auth.schema.js";

export const userRouter = Router();

userRouter.use(authenticate);
userRouter.get("/assignable", authorize("ADMIN", "SUPERVISOR", "LOADING_MASTER"), validateRequest(schema.assignableUsersRequest), controller.listAssignableUsersController);

// Flutter saat ini membaca /users dengan filter ini. Berikan hanya data
// penugasan untuk LM/Supervisor; semua pola lain tetap melewati aturan ADMIN.
userRouter.get("/", (request, _response, next) => {
  const role = request.authUser?.role;
  if ((role === "LOADING_MASTER" || role === "SUPERVISOR") &&
      request.query.role === "UNLOADING_MASTER" && request.query.isActive === "true") {
    next();
    return;
  }
  next("route");
}, validateRequest(schema.flutterAssignableUsersRequest), controller.listAssignableUsersController);

userRouter.use(authorize("ADMIN"));
userRouter.get("/", validateRequest(schema.listUsersRequest), controller.listUsersController);
userRouter.post("/", validateRequest(schema.createUserRequest), controller.createUserController);
userRouter.get("/:id", validateRequest(schema.userDetailRequest), controller.getUserController);
userRouter.patch("/:id", validateRequest(schema.updateUserRequest), controller.updateUserController);
userRouter.delete("/:id", validateRequest(schema.userDetailRequest), controller.deactivateUserController);
