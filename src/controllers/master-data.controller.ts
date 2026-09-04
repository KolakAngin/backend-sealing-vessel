import type { Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type {
  CreateCategoryInput, CreateCompartmentInput, CreateTemplateInput,
  CreateVesselInput, CreateVesselPointInput, IdParams,
  ListCategoriesInput, ListCompartmentsInput, ListTemplatesInput,
  ListVesselPointsInput, ListVesselsInput, UpdateCategoryInput,
  UpdateCompartmentInput, UpdateTemplateInput, UpdateVesselInput,
  UpdateVesselPointInput,
} from "../schemas/master-data.schema.js";
import * as service from "../services/master-data.service.js";
import { sendSuccess } from "../utils/api-response.js";

type ListResult = { items: unknown[]; pagination: Record<string, number> };

function listController<Q>(operation: (query: Q) => Promise<ListResult>, message: string) {
  return async (_request: Request, response: Response): Promise<void> => {
    const { query } = getValidatedInput<{ query: Q }>(response);
    const result = await operation(query);
    sendSuccess(response, 200, message, result.items, result.pagination);
  };
}

function detailController(operation: (id: string) => Promise<unknown>, message: string) {
  return async (_request: Request, response: Response): Promise<void> => {
    const { params } = getValidatedInput<{ params: IdParams }>(response);
    sendSuccess(response, 200, message, await operation(params.id));
  };
}

function createController<I>(operation: (input: I) => Promise<unknown>, message: string) {
  return async (_request: Request, response: Response): Promise<void> => {
    const { body } = getValidatedInput<{ body: I }>(response);
    sendSuccess(response, 201, message, await operation(body));
  };
}

function updateController<I>(operation: (id: string, input: I) => Promise<unknown>, message: string) {
  return async (_request: Request, response: Response): Promise<void> => {
    const { params, body } = getValidatedInput<{ params: IdParams; body: I }>(response);
    sendSuccess(response, 200, message, await operation(params.id, body));
  };
}

function deleteController(operation: (id: string) => Promise<unknown>, message: string) {
  return async (_request: Request, response: Response): Promise<void> => {
    const { params } = getValidatedInput<{ params: IdParams }>(response);
    sendSuccess(response, 200, message, await operation(params.id));
  };
}

export const listVesselsController = listController<ListVesselsInput>(service.listVessels, "Daftar vessel berhasil diambil");
export const getVesselController = detailController(service.getVessel, "Vessel berhasil diambil");
export const createVesselController = createController<CreateVesselInput>(service.createVessel, "Vessel berhasil dibuat");
export const updateVesselController = updateController<UpdateVesselInput>(service.updateVessel, "Vessel berhasil diperbarui");
export const deleteVesselController = deleteController(service.deactivateVessel, "Vessel berhasil dinonaktifkan");

export const listCompartmentsController = listController<ListCompartmentsInput>(service.listCompartments, "Daftar compartment berhasil diambil");
export const getCompartmentController = detailController(service.getCompartment, "Compartment berhasil diambil");
export const createCompartmentController = createController<CreateCompartmentInput>(service.createCompartment, "Compartment berhasil dibuat");
export const updateCompartmentController = updateController<UpdateCompartmentInput>(service.updateCompartment, "Compartment berhasil diperbarui");
export const deleteCompartmentController = deleteController(service.deactivateCompartment, "Compartment berhasil dinonaktifkan");

export const listCategoriesController = listController<ListCategoriesInput>(service.listCategories, "Daftar kategori sealing berhasil diambil");
export const getCategoryController = detailController(service.getCategory, "Kategori sealing berhasil diambil");
export const createCategoryController = createController<CreateCategoryInput>(service.createCategory, "Kategori sealing berhasil dibuat");
export const updateCategoryController = updateController<UpdateCategoryInput>(service.updateCategory, "Kategori sealing berhasil diperbarui");
export const deleteCategoryController = deleteController(service.deactivateCategory, "Kategori sealing berhasil dinonaktifkan");

export const listTemplatesController = listController<ListTemplatesInput>(service.listTemplates, "Daftar template titik sealing berhasil diambil");
export const getTemplateController = detailController(service.getTemplate, "Template titik sealing berhasil diambil");
export const createTemplateController = createController<CreateTemplateInput>(service.createTemplate, "Template titik sealing berhasil dibuat");
export const updateTemplateController = updateController<UpdateTemplateInput>(service.updateTemplate, "Template titik sealing berhasil diperbarui");
export const deleteTemplateController = deleteController(service.deactivateTemplate, "Template titik sealing berhasil dinonaktifkan");

export const listVesselPointsController = listController<ListVesselPointsInput>(service.listVesselPoints, "Daftar titik sealing vessel berhasil diambil");
export const getVesselPointController = detailController(service.getVesselPoint, "Titik sealing vessel berhasil diambil");
export const createVesselPointController = createController<CreateVesselPointInput>(service.createVesselPoint, "Titik sealing vessel berhasil dibuat");
export const updateVesselPointController = updateController<UpdateVesselPointInput>(service.updateVesselPoint, "Titik sealing vessel berhasil diperbarui");
export const deleteVesselPointController = deleteController(service.deactivateVesselPoint, "Titik sealing vessel berhasil dinonaktifkan");

export async function listVesselCompartmentsController(_request: Request, response: Response): Promise<void> {
  const { params, query } = getValidatedInput<{ params: { vesselId: string }; query: Omit<ListCompartmentsInput, "vesselId"> }>(response);
  const result = await service.listCompartments({ ...query, vesselId: params.vesselId });
  sendSuccess(response, 200, "Daftar compartment vessel berhasil diambil", result.items, result.pagination);
}

export async function listVesselSealingPointsController(_request: Request, response: Response): Promise<void> {
  const { params, query } = getValidatedInput<{ params: { vesselId: string }; query: Omit<ListVesselPointsInput, "vesselId"> }>(response);
  const result = await service.listVesselPoints({ ...query, vesselId: params.vesselId });
  sendSuccess(response, 200, "Daftar titik sealing vessel berhasil diambil", result.items, result.pagination);
}

export async function listCategoryTemplatesController(_request: Request, response: Response): Promise<void> {
  const { params, query } = getValidatedInput<{ params: { categoryId: string }; query: Omit<ListTemplatesInput, "categoryId"> }>(response);
  const result = await service.listTemplates({ ...query, categoryId: params.categoryId });
  sendSuccess(response, 200, "Daftar template kategori berhasil diambil", result.items, result.pagination);
}
