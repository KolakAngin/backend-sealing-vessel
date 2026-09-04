import { randomUUID } from "node:crypto";

import { prisma } from "../../src/config/prisma.js";
import type { UserRole } from "../../src/generated/prisma/enums.js";
import { createAccessToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/utils/password.js";

export const TEST_PASSWORD = "TestPassword123!";

export async function createTestIdentity(role: UserRole = "ADMIN") {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const username = `test_${role.toLowerCase()}_${suffix}`;
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(TEST_PASSWORD),
      fullName: `Test ${role}`,
      role,
    },
  });
  const accessToken = await createAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  return { user, accessToken };
}

export const authorizationHeaders = (accessToken: string) => ({
  authorization: `Bearer ${accessToken}`,
});
