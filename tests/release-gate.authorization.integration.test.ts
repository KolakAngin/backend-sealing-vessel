import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/config/prisma.js";
import { authorizationHeaders, createTestIdentity } from "./helpers/auth.js";

const mutationResources = [
  "terminals",
  "plants",
  "jetties",
  "activities",
  "products",
  "units-of-measure",
  "vessels",
  "compartments",
  "sealing-categories",
  "sealing-point-templates",
  "vessel-sealing-points",
  "plant-jetty-assignments",
  "users",
] as const;

test("release gate RBAC: seluruh mutasi master dan konfigurasi vessel hanya ADMIN", async () => {
  await prisma.$connect();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const identities = await Promise.all([
    createTestIdentity("SUPERVISOR"),
    createTestIdentity("LOADING_MASTER"),
    createTestIdentity("UNLOADING_MASTER"),
    createTestIdentity("VIEWER"),
  ]);
  const arbitraryId = randomUUID();

  try {
    for (const identity of identities) {
      for (const resource of mutationResources) {
        const operations = resource === "plant-jetty-assignments"
          ? [["POST", ""], ["DELETE", `/${arbitraryId}`]] as const
          : [["POST", ""], ["PATCH", `/${arbitraryId}`], ["DELETE", `/${arbitraryId}`]] as const;
        for (const [method, suffix] of operations) {
          const response = await fetch(`${api}/${resource}${suffix}`, {
            method,
            headers: {
              ...authorizationHeaders(identity.accessToken),
              ...(method === "DELETE" ? {} : { "content-type": "application/json" }),
            },
            ...(method === "DELETE" ? {} : { body: "{}" }),
          });
          assert.equal(
            response.status,
            403,
            `${identity.user.role} tidak boleh ${method} /${resource}${suffix}`,
          );
        }
      }
    }
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: identities.map((identity) => identity.user.id) } } });
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
