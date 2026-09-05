import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { env } from "../config/env.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const tokenPayloadSchema = z.object({
  sub: z.uuid(),
  username: z.string(),
  role: z.enum(["ADMIN", "SUPERVISOR", "LOADING_MASTER", "UNLOADING_MASTER", "VIEWER"]),
});

export type AccessTokenUser = z.infer<typeof tokenPayloadSchema>;

export async function createAccessToken(user: AccessTokenUser): Promise<string> {
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_EXPIRES_IN_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenUser> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
  });
  return tokenPayloadSchema.parse(payload);
}
