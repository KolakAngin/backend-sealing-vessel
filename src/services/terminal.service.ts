import { prisma } from "../config/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";
import type {
  CreateTerminalInput,
  ListTerminalsQuery,
  UpdateTerminalInput,
} from "../schemas/terminal.schema.js";
import { AppError } from "../utils/app-error.js";

function terminalOrderBy(
  sortBy: ListTerminalsQuery["sortBy"],
  sortOrder: ListTerminalsQuery["sortOrder"],
): Prisma.TerminalOrderByWithRelationInput {
  return { [sortBy]: sortOrder };
}

export async function listTerminals(query: ListTerminalsQuery) {
  const where: Prisma.TerminalWhereInput = {
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" as const } },
            { name: { contains: query.search, mode: "insensitive" as const } },
            { city: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const skip = (query.page - 1) * query.limit;
  const items = await prisma.terminal.findMany({
    where,
    orderBy: terminalOrderBy(query.sortBy, query.sortOrder),
    skip,
    take: query.limit,
  });
  const total = await prisma.terminal.count({ where });

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

export async function getTerminalById(id: string) {
  const terminal = await prisma.terminal.findUnique({ where: { id } });

  if (!terminal) {
    throw new AppError(404, "Terminal tidak ditemukan");
  }

  return terminal;
}

export async function createTerminal(input: CreateTerminalInput) {
  return prisma.terminal.create({
    data: {
      code: input.code.toUpperCase(),
      name: input.name,
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      isActive: input.isActive,
    },
  });
}

export async function updateTerminal(id: string, input: UpdateTerminalInput) {
  return prisma.terminal.update({
    where: { id },
    data: {
      ...(input.code === undefined
        ? {}
        : { code: input.code.toUpperCase() }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.address === undefined ? {} : { address: input.address }),
      ...(input.city === undefined ? {} : { city: input.city }),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
    },
  });
}

export async function deactivateTerminal(id: string) {
  return prisma.terminal.update({
    where: { id },
    data: { isActive: false },
  });
}
