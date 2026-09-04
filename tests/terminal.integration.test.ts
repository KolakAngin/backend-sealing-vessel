import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

let accessToken = "";

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...authorizationHeaders(accessToken),
      ...Object.fromEntries(new Headers(init?.headers)),
    },
  });
  const body = (await response.json()) as ApiResponse<T>;
  return { response, body };
}

test("CRUD Terminal", async () => {
  await prisma.$connect();

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1/terminals`;
  const code = `TEST-${Date.now()}`.slice(0, 20);
  let terminalId: string | undefined;
  const identity = await createTestIdentity();
  accessToken = identity.accessToken;

  try {
    const created = await requestJson<{ id: string; code: string }>(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.toLowerCase(),
        name: "Terminal Integration Test",
        city: "Balikpapan",
      }),
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.success, true);
    assert.equal(created.body.data.code, code.toUpperCase());
    terminalId = created.body.data.id;

    const duplicate = await requestJson<unknown>(baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Terminal Duplikat" }),
    });
    assert.equal(duplicate.response.status, 409);

    const listed = await requestJson<Array<{ id: string }>>(
      `${baseUrl}?search=${encodeURIComponent(code)}&page=1&limit=10`,
    );
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.data.some((item) => item.id === terminalId), true);

    const detail = await requestJson<{ id: string }>(`${baseUrl}/${terminalId}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.data.id, terminalId);

    const updated = await requestJson<{ name: string }>(
      `${baseUrl}/${terminalId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Terminal Integration Updated" }),
      },
    );
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.name, "Terminal Integration Updated");

    const deactivated = await requestJson<{ isActive: boolean }>(
      `${baseUrl}/${terminalId}`,
      { method: "DELETE" },
    );
    assert.equal(deactivated.response.status, 200);
    assert.equal(deactivated.body.data.isActive, false);

    const invalidId = await requestJson<unknown>(`${baseUrl}/bukan-uuid`);
    assert.equal(invalidId.response.status, 400);
  } finally {
    if (terminalId) {
      await prisma.terminal.delete({ where: { id: terminalId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: identity.user.id } }).catch(() => {});

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await prisma.$disconnect();
  }
});
