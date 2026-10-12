import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";
import type { BaPdfActor } from "./ba-pdf-export.service.js";
import { generateUnloadingBaPdf, getUnloadingBaPdfFile } from "./ba-pdf-export.service.js";
import { generateOfficialPdf, getOfficialPdfFile } from "./pdf-export.service.js";

type FinalPdfMode = "LEGACY" | "PHASE_AWARE_UNLOADING";

async function resolveFinalPdfMode(reportId: string): Promise<FinalPdfMode> {
  const report = await prisma.sealingReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      baDocuments: {
        select: { phase: true, status: true },
      },
    },
  });
  if (!report) throw new AppError(404, "Shipment/voyage tidak ditemukan");
  if (report.baDocuments.length === 0) return "LEGACY";
  if (report.baDocuments.some((document: { phase: string; status: string }) => document.phase === "UNLOADING" && document.status === "FINALIZED")) {
    return "PHASE_AWARE_UNLOADING";
  }
  throw new AppError(409, "Endpoint PDF final legacy dinonaktifkan untuk shipment phase-aware sampai BA UNLOADING difinalisasi");
}

export async function generateCompatibleFinalPdf(reportId: string, actor: BaPdfActor) {
  const mode = await resolveFinalPdfMode(reportId);
  if (mode === "PHASE_AWARE_UNLOADING") return generateUnloadingBaPdf(reportId, actor);
  return generateOfficialPdf(reportId, actor);
}

export async function getCompatibleFinalPdfFile(reportId: string, actor: BaPdfActor) {
  const mode = await resolveFinalPdfMode(reportId);
  if (mode === "PHASE_AWARE_UNLOADING") return getUnloadingBaPdfFile(reportId, actor);
  return getOfficialPdfFile(reportId, actor);
}
