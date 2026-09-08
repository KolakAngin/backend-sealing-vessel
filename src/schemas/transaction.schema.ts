import { z } from "zod";

const uuid = z.uuid("ID harus berupa UUID yang valid");
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v === "" ? null : v);
const paging = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(10) });
const detail = z.object({ body: z.unknown(), params: z.object({ id: uuid }), query: z.object({}) });

export const createReportBody = z.object({
  reportNo: z.string().trim().min(1).max(50), vesselId: uuid,
  originTerminalId: uuid, destinationTerminalId: uuid, unloadingMasterId: uuid.nullable().optional(),
  cargo: nullableText(150), operationType: z.literal("LOADING").default("LOADING"),
  reportDateTime: z.coerce.date(), loadingMasterSurveyorName: nullableText(150),
  portName: nullableText(150), remarks: nullableText(2_000),
}).strict();
export const updateReportBody = createReportBody.partial().refine((v) => Object.keys(v).length > 0, "Minimal satu field harus dikirim");
export const shipmentBody = z.object({
  vesselId: uuid,
  activityId: uuid,
  reportDateTime: z.coerce.date(),
  voyageNumber: z.string().trim().min(1).max(50),
  shipmentNumber: z.string().trim().min(1).max(50),
  productId: uuid,
  loadingPlantId: uuid,
  loadingJettyId: uuid,
  dischargePlantId: uuid,
  dischargeJettyId: uuid,
  sealingStatus: z.string().trim().min(1).max(50),
  loadingMasterId: uuid.optional(),
  unloadingMasterId: uuid.nullable().optional(),
  loadingMasterSurveyorName: nullableText(150),
  remarks: nullableText(2_000),
}).strict();
export const updateShipmentBody = shipmentBody.partial()
  .refine((v) => Object.keys(v).length > 0, "Minimal satu field harus dikirim");
export const listReportsQuery = paging.extend({
  search: z.string().trim().min(1).max(150).optional(),
  vesselId: uuid.optional(),
  activityId: uuid.optional(),
  productId: uuid.optional(),
  loadingPlantId: uuid.optional(),
  loadingJettyId: uuid.optional(),
  dischargePlantId: uuid.optional(),
  dischargeJettyId: uuid.optional(),
  originTerminalId: uuid.optional(),
  destinationTerminalId: uuid.optional(),
  voyageNumber: z.string().trim().min(1).max(50).optional(),
  shipmentNumber: z.string().trim().min(1).max(50).optional(),
  sealingStatus: z.string().trim().min(1).max(50).optional(),
  status: z.enum(["DRAFT", "BERLAYAR", "SANDAR", "FINISH"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
export const createReportRequest = z.object({ body: createReportBody, params: z.object({}), query: z.object({}) });
export const updateReportRequest = z.object({ body: updateReportBody, params: z.object({ id: uuid }), query: z.object({}) });
export const createShipmentRequest = z.object({ body: shipmentBody, params: z.object({}), query: z.object({}) });
export const updateShipmentRequest = z.object({ body: updateShipmentBody, params: z.object({ id: uuid }), query: z.object({}) });
export const listReportsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listReportsQuery });
export const reportDetailRequest = detail;
export const transitionReportRequest = z.object({ body: z.object({ remarks: nullableText(2_000) }).strict(), params: z.object({ id: uuid }), query: z.object({}) });
export const journeyTransitionRequest = z.object({ body: z.object({ occurredAt: z.coerce.date().optional(), remarks: nullableText(2_000) }).strict(), params: z.object({ id: uuid }), query: z.object({}) });
export const prepareReportSealsRequest = z.object({ body: z.object({}).strict(), params: z.object({ id: uuid }), query: z.object({}) });
export const lifecycleValidationRequest = z.object({ body: z.unknown(), params: z.object({ id: uuid }), query: z.object({}) });
export const reportXlsxRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid }), query: z.object({}) });
export const reportPdfRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid }), query: z.object({}) });

const formSectionCode = z.string().trim().toUpperCase().pipe(z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]));
const formRecordStatus = z.enum(["SEALED", "NOT_SEALED", "NOT_APPLICABLE"]);
const formSealValue = z.object({
  sealNumber: z.string().trim().min(1).max(100),
  installedAt: z.coerce.date().optional(),
  notes: nullableText(2_000),
}).strict();
const formPointFields = {
  status: formRecordStatus,
  notes: nullableText(2_000),
  seals: z.array(formSealValue).max(100),
};

function validateFormSealState(
  value: { status: z.infer<typeof formRecordStatus>; seals: Array<{ sealNumber: string }> },
  context: z.RefinementCtx,
) {
  const normalized = value.seals.map((seal) => seal.sealNumber.trim().toUpperCase());
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: "custom", path: ["seals"], message: "Nomor segel tidak boleh duplikat dalam satu titik" });
  }
  if (value.status === "SEALED" && value.seals.length === 0) {
    context.addIssue({ code: "custom", path: ["seals"], message: "Status SEALED wajib mempunyai minimal satu nomor segel" });
  }
  if (value.status !== "SEALED" && value.seals.length > 0) {
    context.addIssue({ code: "custom", path: ["seals"], message: "Status NOT_SEALED/NOT_APPLICABLE tidak boleh mempunyai nomor segel" });
  }
}

export const formPointWriteBody = z.object(formPointFields).strict().superRefine(validateFormSealState);
export const formPointPatchBody = z.object({
  status: formRecordStatus.optional(),
  notes: nullableText(2_000),
  seals: z.array(formSealValue).max(100).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Minimal satu field harus dikirim");
export const formSectionBatchBody = z.object({
  points: z.array(
    z.object({ vesselSealingPointId: uuid, ...formPointFields }).strict().superRefine(validateFormSealState),
  ).min(1).max(500),
}).strict();

export const reportFormRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid }), query: z.object({}) });
export const writeFormPointRequest = z.object({ body: formPointWriteBody, params: z.object({ reportId: uuid, pointId: uuid }), query: z.object({}) });
export const patchFormPointRequest = z.object({ body: formPointPatchBody, params: z.object({ reportId: uuid, pointId: uuid }), query: z.object({}) });
export const deleteFormPointRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid, pointId: uuid }), query: z.object({}) });
export const batchFormSectionRequest = z.object({ body: formSectionBatchBody, params: z.object({ reportId: uuid, sectionCode: formSectionCode }), query: z.object({}) });

export const createPlantJettyAssignmentBody = z.object({ plantId: uuid, jettyId: uuid }).strict();
export const listPlantJettyAssignmentsQuery = paging.extend({ plantId: uuid.optional(), jettyId: uuid.optional() });
export const createPlantJettyAssignmentRequest = z.object({ body: createPlantJettyAssignmentBody, params: z.object({}), query: z.object({}) });
export const listPlantJettyAssignmentsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listPlantJettyAssignmentsQuery });
export const plantJettyAssignmentDetailRequest = detail;

export const createRecordBody = z.object({ vesselSealingPointId: uuid, status: z.enum(["SEALED", "NOT_SEALED", "NOT_APPLICABLE"]).default("NOT_SEALED"), notes: nullableText(2_000) }).strict();
export const updateRecordBody = createRecordBody.omit({ vesselSealingPointId: true }).partial().refine((v) => Object.keys(v).length > 0, "Minimal satu field harus dikirim");
export const createRecordRequest = z.object({ body: createRecordBody, params: z.object({ reportId: uuid }), query: z.object({}) });
export const listRecordsRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid }), query: paging });
export const updateRecordRequest = z.object({ body: updateRecordBody, params: z.object({ id: uuid }), query: z.object({}) });
export const recordDetailRequest = detail;

export const createSealBody = z.object({ sealNumber: z.string().trim().min(1).max(100), installedAt: z.coerce.date().optional(), notes: nullableText(2_000) }).strict();
export const updateSealBody = z.object({ sealNumber: z.string().trim().min(1).max(100).optional(), installedAt: z.coerce.date().optional(), notes: nullableText(2_000) }).strict().refine((v) => Object.keys(v).length > 0, "Minimal satu field harus dikirim");
export const createSealRequest = z.object({ body: createSealBody, params: z.object({ recordId: uuid }), query: z.object({}) });
export const updateSealRequest = z.object({ body: updateSealBody, params: z.object({ id: uuid }), query: z.object({}) });
export const sealDetailRequest = detail;
export const removeSealRequest = z.object({ body: z.object({ notes: nullableText(2_000) }).strict(), params: z.object({ id: uuid }), query: z.object({}) });
export const replaceSealRequest = z.object({ body: createSealBody, params: z.object({ id: uuid }), query: z.object({}) });
export const verifySealRequest = z.object({ body: z.object({ condition: z.enum(["GOOD", "DAMAGED", "BROKEN", "MISSING", "OTHER"]), verifiedAt: z.coerce.date().optional(), remarks: nullableText(2_000) }).strict(), params: z.object({ id: uuid }), query: z.object({}) });

export const signatureBody = z.object({ userId: uuid.nullable().optional(), role: z.enum(["CHIEF_OFFICER", "TERMINAL_REPRESENTATIVE", "SURVEYOR"]), name: z.string().trim().min(1).max(150), signatureUrl: nullableText(2_000), signedAt: z.coerce.date().nullable().optional() }).strict();
export const updateSignatureBody = signatureBody.omit({ role: true }).partial().refine((v) => Object.keys(v).length > 0, "Minimal satu field harus dikirim");
export const createSignatureRequest = z.object({ body: signatureBody, params: z.object({ reportId: uuid }), query: z.object({}) });
export const listSignaturesRequest = z.object({ body: z.unknown(), params: z.object({ reportId: uuid }), query: z.object({}) });
export const updateSignatureRequest = z.object({ body: updateSignatureBody, params: z.object({ id: uuid }), query: z.object({}) });
export const signatureDetailRequest = detail;

export const listAuditsQuery = paging.extend({ entityType: z.string().trim().max(50).optional(), entityId: uuid.optional(), action: z.enum(["CREATE", "UPDATE", "DELETE", "SUBMIT", "VERIFY", "APPROVE", "REJECT", "INSTALL_SEAL", "REMOVE_SEAL", "REPLACE_SEAL", "DEPART", "ARRIVE", "FINISH", "FINALIZE"]).optional() });
export const listAuditsRequest = z.object({ body: z.unknown(), params: z.object({}), query: listAuditsQuery });

export type CreateReportInput = z.infer<typeof createReportBody>; export type UpdateReportInput = z.infer<typeof updateReportBody>; export type ListReportsInput = z.infer<typeof listReportsQuery>;
export type CreateShipmentInput = z.infer<typeof shipmentBody>; export type UpdateShipmentInput = z.infer<typeof updateShipmentBody>;
export type CreatePlantJettyAssignmentInput = z.infer<typeof createPlantJettyAssignmentBody>; export type ListPlantJettyAssignmentsInput = z.infer<typeof listPlantJettyAssignmentsQuery>;
export type CreateRecordInput = z.infer<typeof createRecordBody>; export type UpdateRecordInput = z.infer<typeof updateRecordBody>;
export type CreateSealInput = z.infer<typeof createSealBody>; export type UpdateSealInput = z.infer<typeof updateSealBody>; export type VerifySealInput = z.infer<typeof verifySealRequest>["body"];
export type FormPointWriteInput = z.infer<typeof formPointWriteBody>; export type FormPointPatchInput = z.infer<typeof formPointPatchBody>; export type FormSectionBatchInput = z.infer<typeof formSectionBatchBody>;
export type SignatureInput = z.infer<typeof signatureBody>; export type UpdateSignatureInput = z.infer<typeof updateSignatureBody>; export type ListAuditsInput = z.infer<typeof listAuditsQuery>;
