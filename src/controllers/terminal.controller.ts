import type { Request, Response } from "express";

import type {
  CreateTerminalInput,
  ListTerminalsQuery,
  TerminalIdParams,
  UpdateTerminalInput,
} from "../schemas/terminal.schema.js";
import {
  createTerminal,
  deactivateTerminal,
  getTerminalById,
  listTerminals,
  updateTerminal,
} from "../services/terminal.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { getValidatedInput } from "../middleware/validate-request.js";

export async function listTerminalsController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { query } = getValidatedInput<{ query: ListTerminalsQuery }>(response);
  const result = await listTerminals(query);

  sendSuccess(
    response,
    200,
    "Daftar terminal berhasil diambil",
    result.items,
    result.pagination,
  );
}

export async function getTerminalController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { params } = getValidatedInput<{ params: TerminalIdParams }>(response);
  const terminal = await getTerminalById(params.id);

  sendSuccess(response, 200, "Terminal berhasil diambil", terminal);
}

export async function createTerminalController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { body } = getValidatedInput<{ body: CreateTerminalInput }>(response);
  const terminal = await createTerminal(body);

  sendSuccess(response, 201, "Terminal berhasil dibuat", terminal);
}

export async function updateTerminalController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { params, body } = getValidatedInput<{
    params: TerminalIdParams;
    body: UpdateTerminalInput;
  }>(response);
  const terminal = await updateTerminal(params.id, body);

  sendSuccess(response, 200, "Terminal berhasil diperbarui", terminal);
}

export async function deactivateTerminalController(
  _request: Request,
  response: Response,
): Promise<void> {
  const { params } = getValidatedInput<{ params: TerminalIdParams }>(response);
  const terminal = await deactivateTerminal(params.id);

  sendSuccess(response, 200, "Terminal berhasil dinonaktifkan", terminal);
}
