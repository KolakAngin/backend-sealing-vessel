import type { Request, Response } from "express";

import { getValidatedInput } from "../middleware/validate-request.js";
import type {
  CreateActivityInput, CreateCategoryInput, CreateCompartmentInput,
  CreateJettyInput, CreatePlantInput, CreateProductInput, CreateTemplateInput,
  CreateUnitOfMeasureInput, CreateVesselInput, CreateVesselPointInput, IdParams,
  ListActivitiesInput, ListCategoriesInput, ListCompartmentsInput,
  ListJettiesInput, ListPlantsInput, ListProductsInput, ListTemplatesInput,
  ListUnitsOfMeasureInput, ListVesselPointsInput, ListVesselsInput,
  UpdateActivityInput, UpdateCategoryInput, UpdateCompartmentInput,
  UpdateJettyInput, UpdatePlantInput, UpdateProductInput, UpdateTemplateInput,
  UpdateUnitOfMeasureInput, UpdateVesselInput, UpdateVesselPointInput,
} from "../schemas/master-data.schema.js";
import * as service from "../services/master-data.service.js";
import { sendSuccess } from "../utils/api-response.js";
import { AppError } from "../utils/app-error.js";

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

function actorId(request: Request): string {
  if (!request.authUser) throw new AppError(401, "Autentikasi diperlukan");
  return request.authUser.id;
}

function createController<I>(operation: (input: I, actorId: string) => Promise<unknown>, message: string) {
  return async (request: Request, response: Response): Promise<void> => {
    const { body } = getValidatedInput<{ body: I }>(response);
    sendSuccess(response, 201, message, await operation(body, actorId(request)));
  };
}

function updateController<I>(operation: (id: string, input: I, actorId: string) => Promise<unknown>, message: string) {
  return async (request: Request, response: Response): Promise<void> => {
    const { params, body } = getValidatedInput<{ params: IdParams; body: I }>(response);
    sendSuccess(response, 200, message, await operation(params.id, body, actorId(request)));
  };
}

function deleteController(operation: (id: string, actorId: string) => Promise<unknown>, message: string) {
  return async (request: Request, response: Response): Promise<void> => {
    const { params } = getValidatedInput<{ params: IdParams }>(response);
    sendSuccess(response, 200, message, await operation(params.id, actorId(request)));
  };
}

export const listPlantsController = listController<ListPlantsInput>(service.listPlants, "Daftar plant berhasil diambil");
export const getPlantController = detailController(service.getPlant, "Plant berhasil diambil");
export const createPlantController = createController<CreatePlantInput>(service.createPlant, "Plant berhasil dibuat");
export const updatePlantController = updateController<UpdatePlantInput>(service.updatePlant, "Plant berhasil diperbarui");
export const deletePlantController = deleteController(service.deactivatePlant, "Plant berhasil dinonaktifkan");

export const listJettiesController = listController<ListJettiesInput>(service.listJetties, "Daftar jetty berhasil diambil");
export const getJettyController = detailController(service.getJetty, "Jetty berhasil diambil");
export const createJettyController = createController<CreateJettyInput>(service.createJetty, "Jetty berhasil dibuat");
export const updateJettyController = updateController<UpdateJettyInput>(service.updateJetty, "Jetty berhasil diperbarui");
export const deleteJettyController = deleteController(service.deactivateJetty, "Jetty berhasil dinonaktifkan");

export const listActivitiesController = listController<ListActivitiesInput>(service.listActivities, "Daftar activity berhasil diambil");
export const getActivityController = detailController(service.getActivity, "Activity berhasil diambil");
export const createActivityController = createController<CreateActivityInput>(service.createActivity, "Activity berhasil dibuat");
export const updateActivityController = updateController<UpdateActivityInput>(service.updateActivity, "Activity berhasil diperbarui");
export const deleteActivityController = deleteController(service.deactivateActivity, "Activity berhasil dinonaktifkan");

export const listProductsController = listController<ListProductsInput>(service.listProducts, "Daftar product berhasil diambil");
export const getProductController = detailController(service.getProduct, "Product berhasil diambil");
export const createProductController = createController<CreateProductInput>(service.createProduct, "Product berhasil dibuat");
export const updateProductController = updateController<UpdateProductInput>(service.updateProduct, "Product berhasil diperbarui");
export const deleteProductController = deleteController(service.deactivateProduct, "Product berhasil dinonaktifkan");

export const listUnitsOfMeasureController = listController<ListUnitsOfMeasureInput>(service.listUnitsOfMeasure, "Daftar unit of measure berhasil diambil");
export const getUnitOfMeasureController = detailController(service.getUnitOfMeasure, "Unit of measure berhasil diambil");
export const createUnitOfMeasureController = createController<CreateUnitOfMeasureInput>(service.createUnitOfMeasure, "Unit of measure berhasil dibuat");
export const updateUnitOfMeasureController = updateController<UpdateUnitOfMeasureInput>(service.updateUnitOfMeasure, "Unit of measure berhasil diperbarui");
export const deleteUnitOfMeasureController = deleteController(service.deactivateUnitOfMeasure, "Unit of measure berhasil dinonaktifkan");

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
