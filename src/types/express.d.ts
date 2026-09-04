import type { UserRole } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        username: string;
        role: UserRole;
      };
    }
  }
}

export {};
