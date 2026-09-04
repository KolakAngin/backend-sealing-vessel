import { compare, hash } from "bcryptjs";

const PASSWORD_SALT_ROUNDS = 12;

export const hashPassword = (password: string) =>
  hash(password, PASSWORD_SALT_ROUNDS);

export const verifyPassword = (password: string, passwordHash: string) =>
  compare(password, passwordHash);
