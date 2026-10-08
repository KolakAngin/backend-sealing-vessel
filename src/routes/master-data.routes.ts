import { Router, type RequestHandler } from "express";

import * as controller from "../controllers/master-data.controller.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validate-request.js";
import * as schema from "../schemas/master-data.schema.js";

export const masterDataRouter = Router();

masterDataRouter.use(authenticate);

function adminCrud(path: string, schemas: { list: Parameters<typeof validateRequest>[0]; create: Parameters<typeof validateRequest>[0]; detail: Parameters<typeof validateRequest>[0]; update: Parameters<typeof validateRequest>[0] }, handlers: { list: RequestHandler; create: RequestHandler; detail: RequestHandler; update: RequestHandler; remove: RequestHandler }) {
  masterDataRouter.get(path, validateRequest(schemas.list), handlers.list);
  masterDataRouter.post(path, authorize("ADMIN"), validateRequest(schemas.create), handlers.create);
  masterDataRouter.get(`${path}/:id`, validateRequest(schemas.detail), handlers.detail);
  masterDataRouter.patch(`${path}/:id`, authorize("ADMIN"), validateRequest(schemas.update), handlers.update);
  masterDataRouter.delete(`${path}/:id`, authorize("ADMIN"), validateRequest(schemas.detail), handlers.remove);
}

adminCrud("/plants", { list: schema.listPlantsRequest, create: schema.createPlantRequest, detail: schema.plantDetailRequest, update: schema.updatePlantRequest }, { list: controller.listPlantsController, create: controller.createPlantController, detail: controller.getPlantController, update: controller.updatePlantController, remove: controller.deletePlantController });
adminCrud("/jetties", { list: schema.listJettiesRequest, create: schema.createJettyRequest, detail: schema.jettyDetailRequest, update: schema.updateJettyRequest }, { list: controller.listJettiesController, create: controller.createJettyController, detail: controller.getJettyController, update: controller.updateJettyController, remove: controller.deleteJettyController });
adminCrud("/activities", { list: schema.listActivitiesRequest, create: schema.createActivityRequest, detail: schema.activityDetailRequest, update: schema.updateActivityRequest }, { list: controller.listActivitiesController, create: controller.createActivityController, detail: controller.getActivityController, update: controller.updateActivityController, remove: controller.deleteActivityController });
adminCrud("/products", { list: schema.listProductsRequest, create: schema.createProductRequest, detail: schema.productDetailRequest, update: schema.updateProductRequest }, { list: controller.listProductsController, create: controller.createProductController, detail: controller.getProductController, update: controller.updateProductController, remove: controller.deleteProductController });
adminCrud("/units-of-measure", { list: schema.listUnitsOfMeasureRequest, create: schema.createUnitOfMeasureRequest, detail: schema.unitOfMeasureDetailRequest, update: schema.updateUnitOfMeasureRequest }, { list: controller.listUnitsOfMeasureController, create: controller.createUnitOfMeasureController, detail: controller.getUnitOfMeasureController, update: controller.updateUnitOfMeasureController, remove: controller.deleteUnitOfMeasureController });
adminCrud("/vessels", { list: schema.listVesselsRequest, create: schema.createVesselRequest, detail: schema.vesselDetailRequest, update: schema.updateVesselRequest }, { list: controller.listVesselsController, create: controller.createVesselController, detail: controller.getVesselController, update: controller.updateVesselController, remove: controller.deleteVesselController });
adminCrud("/compartments", { list: schema.listCompartmentsRequest, create: schema.createCompartmentRequest, detail: schema.compartmentDetailRequest, update: schema.updateCompartmentRequest }, { list: controller.listCompartmentsController, create: controller.createCompartmentController, detail: controller.getCompartmentController, update: controller.updateCompartmentController, remove: controller.deleteCompartmentController });
adminCrud("/sealing-categories", { list: schema.listCategoriesRequest, create: schema.createCategoryRequest, detail: schema.categoryDetailRequest, update: schema.updateCategoryRequest }, { list: controller.listCategoriesController, create: controller.createCategoryController, detail: controller.getCategoryController, update: controller.updateCategoryController, remove: controller.deleteCategoryController });
adminCrud("/sealing-point-templates", { list: schema.listTemplatesRequest, create: schema.createTemplateRequest, detail: schema.templateDetailRequest, update: schema.updateTemplateRequest }, { list: controller.listTemplatesController, create: controller.createTemplateController, detail: controller.getTemplateController, update: controller.updateTemplateController, remove: controller.deleteTemplateController });
adminCrud("/vessel-sealing-points", { list: schema.listVesselPointsRequest, create: schema.createVesselPointRequest, detail: schema.vesselPointDetailRequest, update: schema.updateVesselPointRequest }, { list: controller.listVesselPointsController, create: controller.createVesselPointController, detail: controller.getVesselPointController, update: controller.updateVesselPointController, remove: controller.deleteVesselPointController });

masterDataRouter.get("/vessels/:vesselId/compartments", validateRequest(schema.listVesselCompartmentsRequest), controller.listVesselCompartmentsController);
masterDataRouter.get("/vessels/:vesselId/sealing-points", validateRequest(schema.listVesselSealingPointsRequest), controller.listVesselSealingPointsController);
masterDataRouter.get("/sealing-categories/:categoryId/templates", validateRequest(schema.listCategoryTemplatesRequest), controller.listCategoryTemplatesController);
