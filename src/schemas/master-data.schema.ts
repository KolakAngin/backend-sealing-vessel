import { z } from "zod";

const uuid = z.uuid("ID harus berupa UUID yang valid");
const nullableString = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((value) => value === "" ? null : value);
const optionalBooleanQuery = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean().optional());
const pagingQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().trim().min(1).max(255).optional(),
  isActive: optionalBooleanQuery,
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
const idParams = z.object({ id: uuid });
const emptyQuery = z.object({});
const detailRequest = z.object({ body: z.unknown(), params: idParams, query: emptyQuery });

export const vesselTypeSchema = z.enum(["TANKER", "BARGE", "SPOB", "OTHER", "MT", "OB"]);
export const drawingStatusSchema = z.enum(["YES", "NO"]);
export const sideSchema = z.enum(["PORT", "STBD", "CENTER"]);
export const availabilitySchema = z.enum(["AVAILABLE", "NOT_AVAILABLE", "INACTIVE"]);

const nullableNonnegativeNumber = z.number().finite().nonnegative().nullable().optional();
const nullableNonnegativeInteger = z.number().int().nonnegative().nullable().optional();
const optionalSequence = z.number().int().positive().nullable().optional();
const masterListQuery = pagingQuery.extend({
  sortBy: z.enum(["name", "sequence", "createdAt", "updatedAt"]).default("sequence"),
});
const codedMasterListQuery = pagingQuery.extend({
  sortBy: z.enum(["code", "name", "sequence", "createdAt", "updatedAt"]).default("sequence"),
});

export const createPlantBody = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(150),
  sequence: optionalSequence,
  isActive: z.boolean().default(true),
}).strict();
export const updatePlantBody = createPlantBody.partial().extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listPlantsRequest = z.object({ body: z.unknown(), params: z.object({}), query: codedMasterListQuery });
export const createPlantRequest = z.object({ body: createPlantBody, params: z.object({}), query: emptyQuery });
export const updatePlantRequest = z.object({ body: updatePlantBody, params: idParams, query: emptyQuery });
export const plantDetailRequest = detailRequest;

export const createJettyBody = z.object({
  name: z.string().trim().min(1).max(150),
  sequence: optionalSequence,
  isActive: z.boolean().default(true),
}).strict();
export const updateJettyBody = createJettyBody.partial().extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listJettiesRequest = z.object({ body: z.unknown(), params: z.object({}), query: masterListQuery });
export const createJettyRequest = z.object({ body: createJettyBody, params: z.object({}), query: emptyQuery });
export const updateJettyRequest = z.object({ body: updateJettyBody, params: idParams, query: emptyQuery });
export const jettyDetailRequest = detailRequest;

export const createActivityBody = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  sequence: optionalSequence,
  isActive: z.boolean().default(true),
}).strict();
export const updateActivityBody = createActivityBody.partial().extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listActivitiesRequest = z.object({ body: z.unknown(), params: z.object({}), query: codedMasterListQuery });
export const createActivityRequest = z.object({ body: createActivityBody, params: z.object({}), query: emptyQuery });
export const updateActivityRequest = z.object({ body: updateActivityBody, params: idParams, query: emptyQuery });
export const activityDetailRequest = detailRequest;

export const createProductBody = z.object({
  name: z.string().trim().min(1).max(150),
  sequence: optionalSequence,
  isActive: z.boolean().default(true),
}).strict();
export const updateProductBody = createProductBody.partial().extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listProductsRequest = z.object({ body: z.unknown(), params: z.object({}), query: masterListQuery });
export const createProductRequest = z.object({ body: createProductBody, params: z.object({}), query: emptyQuery });
export const updateProductRequest = z.object({ body: updateProductBody, params: idParams, query: emptyQuery });
export const productDetailRequest = detailRequest;

export const createUnitOfMeasureBody = z.object({
  code: z.string().trim().min(1).max(20),
  sequence: optionalSequence,
  isActive: z.boolean().default(true),
}).strict();
export const updateUnitOfMeasureBody = createUnitOfMeasureBody.partial().extend({ isActive: z.boolean().optional() })
  .refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
const listUnitsOfMeasureQuery = pagingQuery.extend({
  sortBy: z.enum(["code", "sequence", "createdAt", "updatedAt"]).default("sequence"),
});
export const listUnitsOfMeasureRequest = z.object({ body: z.unknown(), params: z.object({}), query: listUnitsOfMeasureQuery });
export const createUnitOfMeasureRequest = z.object({ body: createUnitOfMeasureBody, params: z.object({}), query: emptyQuery });
export const updateUnitOfMeasureRequest = z.object({ body: updateUnitOfMeasureBody, params: idParams, query: emptyQuery });
export const unitOfMeasureDetailRequest = detailRequest;

const nestedCompartmentBody = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  side: sideSchema.nullable().optional(),
  sequence: z.number().int().positive().nullable().optional(),
  description: nullableString(2_000),
  isActive: z.boolean().default(true),
}).strict();

export const createVesselBody = z.object({
  name: z.string().trim().min(1).max(150),
  imoNumber: nullableString(20),
  vesselType: vesselTypeSchema.nullable().optional(),
  productGroup: nullableString(100),
  owner: nullableString(150),
  flag: nullableString(100),
  deadweightTonnage: nullableNonnegativeNumber,
  capacity: nullableNonnegativeNumber,
  tankCount: nullableNonnegativeInteger,
  drawingStatus: drawingStatusSchema.nullable().optional(),
  drawingFileUrl: nullableString(2_000),
  drawingLink: nullableString(2_000),
  isActive: z.boolean().default(true),
  compartments: z.array(nestedCompartmentBody).min(1, "Minimal satu compartment wajib diisi").max(100),
}).strict();
export const updateVesselBody = createVesselBody.omit({ compartments: true }).partial().extend({
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listVesselsQuery = pagingQuery.extend({ sortBy: z.enum(["name", "imoNumber", "vesselType", "productGroup", "tankCount", "createdAt", "updatedAt"]).default("name"), vesselType: vesselTypeSchema.optional() });
export const createVesselRequest = z.object({ body: createVesselBody, params: z.object({}), query: emptyQuery });
export const updateVesselRequest = z.object({ body: updateVesselBody, params: idParams, query: emptyQuery });
export const listVesselsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listVesselsQuery });
export const vesselDetailRequest = detailRequest;

export const createCompartmentBody = z.object({
  vesselId: uuid,
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  side: sideSchema.nullable().optional(),
  sequence: z.number().int().positive().nullable().optional(),
  description: nullableString(2_000),
  isActive: z.boolean().default(true),
}).strict();
export const updateCompartmentBody = createCompartmentBody.omit({ vesselId: true }).partial().extend({
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listCompartmentsQuery = pagingQuery.extend({ vesselId: uuid.optional(), side: sideSchema.optional(), sortBy: z.enum(["code", "name", "sequence", "createdAt"]).default("sequence") });
export const createCompartmentRequest = z.object({ body: createCompartmentBody, params: z.object({}), query: emptyQuery });
export const updateCompartmentRequest = z.object({ body: updateCompartmentBody, params: idParams, query: emptyQuery });
export const listCompartmentsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listCompartmentsQuery });
export const compartmentDetailRequest = detailRequest;

export const createCategoryBody = z.object({
  code: z.string().trim().min(1).max(5),
  name: z.string().trim().min(1).max(255),
  description: nullableString(2_000),
  sequence: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
}).strict();
export const updateCategoryBody = createCategoryBody.partial().extend({
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listCategoriesQuery = pagingQuery.extend({ sortBy: z.enum(["code", "name", "sequence", "createdAt"]).default("sequence") });
export const createCategoryRequest = z.object({ body: createCategoryBody, params: z.object({}), query: emptyQuery });
export const updateCategoryRequest = z.object({ body: updateCategoryBody, params: idParams, query: emptyQuery });
export const listCategoriesRequest = z.object({ body: z.unknown(), params: z.object({}), query: listCategoriesQuery });
export const categoryDetailRequest = detailRequest;

export const createTemplateBody = z.object({
  categoryId: uuid,
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(255),
  description: nullableString(2_000),
  requiresCompartment: z.boolean().default(false),
  supportsSide: z.boolean().default(false),
  sequence: z.number().int().nonnegative(),
  isActive: z.boolean().default(true),
}).strict();
export const updateTemplateBody = createTemplateBody.partial().extend({
  requiresCompartment: z.boolean().optional(),
  supportsSide: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listTemplatesQuery = pagingQuery.extend({ categoryId: uuid.optional(), requiresCompartment: optionalBooleanQuery, supportsSide: optionalBooleanQuery, sortBy: z.enum(["code", "name", "sequence", "createdAt"]).default("sequence") });
export const createTemplateRequest = z.object({ body: createTemplateBody, params: z.object({}), query: emptyQuery });
export const updateTemplateRequest = z.object({ body: updateTemplateBody, params: idParams, query: emptyQuery });
export const listTemplatesRequest = z.object({ body: z.unknown(), params: z.object({}), query: listTemplatesQuery });
export const templateDetailRequest = detailRequest;

export const createVesselPointBody = z.object({
  vesselId: uuid,
  sealingPointTemplateId: uuid,
  compartmentId: uuid.nullable().optional(),
  code: z.string().trim().min(1).max(50),
  displayName: nullableString(255),
  side: sideSchema.nullable().optional(),
  locationName: nullableString(150),
  instanceNo: z.number().int().positive().default(1),
  isRequired: z.boolean().default(true),
  sequence: z.number().int().nonnegative().nullable().optional(),
  availability: availabilitySchema.default("AVAILABLE"),
  description: nullableString(2_000),
  isActive: z.boolean().default(true),
}).strict();
export const updateVesselPointBody = createVesselPointBody.partial().extend({
  instanceNo: z.number().int().positive().optional(),
  isRequired: z.boolean().optional(),
  availability: availabilitySchema.optional(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, "Minimal satu field harus dikirim");
export const listVesselPointsQuery = pagingQuery.extend({ vesselId: uuid.optional(), sealingPointTemplateId: uuid.optional(), compartmentId: uuid.optional(), side: sideSchema.optional(), availability: availabilitySchema.optional(), sortBy: z.enum(["code", "displayName", "sequence", "createdAt"]).default("sequence") });
export const createVesselPointRequest = z.object({ body: createVesselPointBody, params: z.object({}), query: emptyQuery });
export const updateVesselPointRequest = z.object({ body: updateVesselPointBody, params: idParams, query: emptyQuery });
export const listVesselPointsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listVesselPointsQuery });
export const vesselPointDetailRequest = detailRequest;

export const listVesselCompartmentsRequest = z.object({
  body: z.unknown(),
  params: z.object({ vesselId: uuid }),
  query: listCompartmentsQuery.omit({ vesselId: true }),
});
export const listVesselSealingPointsRequest = z.object({
  body: z.unknown(),
  params: z.object({ vesselId: uuid }),
  query: listVesselPointsQuery.omit({ vesselId: true }),
});
export const listCategoryTemplatesRequest = z.object({
  body: z.unknown(),
  params: z.object({ categoryId: uuid }),
  query: listTemplatesQuery.omit({ categoryId: true }),
});

export type IdParams = z.infer<typeof idParams>;
export type CreatePlantInput = z.infer<typeof createPlantBody>;
export type UpdatePlantInput = z.infer<typeof updatePlantBody>;
export type ListPlantsInput = z.infer<typeof codedMasterListQuery>;
export type CreateJettyInput = z.infer<typeof createJettyBody>;
export type UpdateJettyInput = z.infer<typeof updateJettyBody>;
export type ListJettiesInput = z.infer<typeof masterListQuery>;
export type CreateActivityInput = z.infer<typeof createActivityBody>;
export type UpdateActivityInput = z.infer<typeof updateActivityBody>;
export type ListActivitiesInput = z.infer<typeof codedMasterListQuery>;
export type CreateProductInput = z.infer<typeof createProductBody>;
export type UpdateProductInput = z.infer<typeof updateProductBody>;
export type ListProductsInput = z.infer<typeof masterListQuery>;
export type CreateUnitOfMeasureInput = z.infer<typeof createUnitOfMeasureBody>;
export type UpdateUnitOfMeasureInput = z.infer<typeof updateUnitOfMeasureBody>;
export type ListUnitsOfMeasureInput = z.infer<typeof listUnitsOfMeasureQuery>;
export type CreateVesselInput = z.infer<typeof createVesselBody>;
export type UpdateVesselInput = z.infer<typeof updateVesselBody>;
export type ListVesselsInput = z.infer<typeof listVesselsQuery>;
export type CreateCompartmentInput = z.infer<typeof createCompartmentBody>;
export type UpdateCompartmentInput = z.infer<typeof updateCompartmentBody>;
export type ListCompartmentsInput = z.infer<typeof listCompartmentsQuery>;
export type CreateCategoryInput = z.infer<typeof createCategoryBody>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryBody>;
export type ListCategoriesInput = z.infer<typeof listCategoriesQuery>;
export type CreateTemplateInput = z.infer<typeof createTemplateBody>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateBody>;
export type ListTemplatesInput = z.infer<typeof listTemplatesQuery>;
export type CreateVesselPointInput = z.infer<typeof createVesselPointBody>;
export type UpdateVesselPointInput = z.infer<typeof updateVesselPointBody>;
export type ListVesselPointsInput = z.infer<typeof listVesselPointsQuery>;
