import { Router, type RequestHandler } from "express";

import * as controller from "../controllers/master-data.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/master-data.schema.js";

export const masterDataRouter = Router();

masterDataRouter.use(authenticate);

function crud(path: string, schemas: { list: Parameters<typeof validateRequest>[0]; create: Parameters<typeof validateRequest>[0]; detail: Parameters<typeof validateRequest>[0]; update: Parameters<typeof validateRequest>[0] }, handlers: { list: RequestHandler; create: RequestHandler; detail: RequestHandler; update: RequestHandler; remove: RequestHandler }) {
  masterDataRouter.get(path, validateRequest(schemas.list), handlers.list);
  masterDataRouter.post(path, authorize("ADMIN", "SUPERVISOR"), validateRequest(schemas.create), handlers.create);
  masterDataRouter.get(`${path}/:id`, validateRequest(schemas.detail), handlers.detail);
  masterDataRouter.patch(`${path}/:id`, authorize("ADMIN", "SUPERVISOR"), validateRequest(schemas.update), handlers.update);
  masterDataRouter.delete(`${path}/:id`, authorize("ADMIN"), validateRequest(schemas.detail), handlers.remove);
}

crud("/vessels", { list: schema.listVesselsRequest, create: schema.createVesselRequest, detail: schema.vesselDetailRequest, update: schema.updateVesselRequest }, { list: controller.listVesselsController, create: controller.createVesselController, detail: controller.getVesselController, update: controller.updateVesselController, remove: controller.deleteVesselController });
crud("/compartments", { list: schema.listCompartmentsRequest, create: schema.createCompartmentRequest, detail: schema.compartmentDetailRequest, update: schema.updateCompartmentRequest }, { list: controller.listCompartmentsController, create: controller.createCompartmentController, detail: controller.getCompartmentController, update: controller.updateCompartmentController, remove: controller.deleteCompartmentController });
crud("/sealing-categories", { list: schema.listCategoriesRequest, create: schema.createCategoryRequest, detail: schema.categoryDetailRequest, update: schema.updateCategoryRequest }, { list: controller.listCategoriesController, create: controller.createCategoryController, detail: controller.getCategoryController, update: controller.updateCategoryController, remove: controller.deleteCategoryController });
crud("/sealing-point-templates", { list: schema.listTemplatesRequest, create: schema.createTemplateRequest, detail: schema.templateDetailRequest, update: schema.updateTemplateRequest }, { list: controller.listTemplatesController, create: controller.createTemplateController, detail: controller.getTemplateController, update: controller.updateTemplateController, remove: controller.deleteTemplateController });
crud("/vessel-sealing-points", { list: schema.listVesselPointsRequest, create: schema.createVesselPointRequest, detail: schema.vesselPointDetailRequest, update: schema.updateVesselPointRequest }, { list: controller.listVesselPointsController, create: controller.createVesselPointController, detail: controller.getVesselPointController, update: controller.updateVesselPointController, remove: controller.deleteVesselPointController });

masterDataRouter.get("/vessels/:vesselId/compartments", validateRequest(schema.listVesselCompartmentsRequest), controller.listVesselCompartmentsController);
masterDataRouter.get("/vessels/:vesselId/sealing-points", validateRequest(schema.listVesselSealingPointsRequest), controller.listVesselSealingPointsController);
masterDataRouter.get("/sealing-categories/:categoryId/templates", validateRequest(schema.listCategoryTemplatesRequest), controller.listCategoryTemplatesController);
