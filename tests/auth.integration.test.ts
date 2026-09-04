import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity, TEST_PASSWORD } from "./helpers/auth.js";

type ApiResponse<T> = { success: boolean; message: string; data: T };

async function requestJson<T>(url: string, init?: RequestInit, token?: string) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(token ? authorizationHeaders(token) : {}),
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  return { response, body };
}

const jsonRequest = (method: string, body: object): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("Autentikasi, authorization, dan CRUD User", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const admin = await createTestIdentity("ADMIN");
  let viewerId: string | undefined;

  try {
    const unauthenticated = await requestJson<unknown>(`${api}/vessels`);
    assert.equal(unauthenticated.response.status, 401);

    const login = await requestJson<{ accessToken: string; user: Record<string, unknown> }>(
      `${api}/auth/login`,
      jsonRequest("POST", { username: admin.user.username, password: TEST_PASSWORD }),
    );
    assert.equal(login.response.status, 200);
    assert.equal(typeof login.body.data.accessToken, "string");
    assert.equal("passwordHash" in login.body.data.user, false);

    const adminToken = login.body.data.accessToken;
    const me = await requestJson<Record<string, unknown>>(`${api}/auth/me`, undefined, adminToken);
    assert.equal(me.response.status, 200);
    assert.equal(me.body.data.id, admin.user.id);
    assert.equal("passwordHash" in me.body.data, false);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const viewerUsername = `viewer_${suffix}`;
    const created = await requestJson<Record<string, unknown>>(
      `${api}/users`,
      jsonRequest("POST", {
        username: viewerUsername,
        password: TEST_PASSWORD,
        fullName: "Viewer Integration Test",
        role: "VIEWER",
      }),
      adminToken,
    );
    assert.equal(created.response.status, 201);
    assert.equal("passwordHash" in created.body.data, false);
    viewerId = created.body.data.id as string;

    const users = await requestJson<Array<Record<string, unknown>>>(`${api}/users?search=${viewerUsername}`, undefined, adminToken);
    assert.equal(users.response.status, 200);
    assert.equal(users.body.data.some((user) => user.id === viewerId), true);

    const viewerLogin = await requestJson<{ accessToken: string }>(
      `${api}/auth/login`,
      jsonRequest("POST", { username: viewerUsername, password: TEST_PASSWORD }),
    );
    assert.equal(viewerLogin.response.status, 200);
    const viewerToken = viewerLogin.body.data.accessToken;

    const viewerCanRead = await requestJson<unknown>(`${api}/vessels`, undefined, viewerToken);
    assert.equal(viewerCanRead.response.status, 200);

    const viewerCannotWrite = await requestJson<unknown>(
      `${api}/vessels`,
      jsonRequest("POST", { name: "Tidak Boleh Dibuat" }),
      viewerToken,
    );
    assert.equal(viewerCannotWrite.response.status, 403);

    const updated = await requestJson<Record<string, unknown>>(
      `${api}/users/${viewerId}`,
      jsonRequest("PATCH", { fullName: "Viewer Updated" }),
      adminToken,
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.fullName, "Viewer Updated");

    const deactivated = await requestJson<Record<string, unknown>>(
      `${api}/users/${viewerId}`,
      { method: "DELETE" },
      adminToken,
    );
    assert.equal(deactivated.response.status, 200);
    assert.equal(deactivated.body.data.isActive, false);

    const deactivatedToken = await requestJson<unknown>(`${api}/auth/me`, undefined, viewerToken);
    assert.equal(deactivatedToken.response.status, 401);

    const cannotDeactivateSelf = await requestJson<unknown>(
      `${api}/users/${admin.user.id}`,
      { method: "DELETE" },
      adminToken,
    );
    assert.equal(cannotDeactivateSelf.response.status, 400);
  } finally {
    if (viewerId) await prisma.user.delete({ where: { id: viewerId } }).catch(() => {});
    await prisma.user.delete({ where: { id: admin.user.id } }).catch(() => {});
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
