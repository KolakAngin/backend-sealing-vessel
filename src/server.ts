import type { Server } from "node:http";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";

let server: Server | undefined;
let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Menerima ${signal}, menghentikan server...`);
  server?.close();
  await prisma.$disconnect();
  process.exit(0);
}

async function startServer(): Promise<void> {
  await prisma.$connect();

  server = app.listen(env.PORT, () => {
    console.log(`Server berjalan di http://localhost:${env.PORT}`);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

startServer().catch(async (error: unknown) => {
  console.error("Server gagal dijalankan:", error);
  await prisma.$disconnect();
  process.exit(1);
});
