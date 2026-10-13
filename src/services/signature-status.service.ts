import type { BeritaAcaraPhase, SignatureRole } from "../generated/prisma/client.js";
import { resolveVerifiedFile } from "../storage/local-storage.js";
import { extensionForMimeType } from "../utils/uploaded-file.js";

export const REQUIRED_SIGNATURE_ROLES = ["CHIEF_OFFICER", "SURVEYOR", "TERMINAL_REPRESENTATIVE"] as const;

export type SignatureState = "MISSING" | "UNSIGNED" | "INVALID_FILE" | "SIGNED";

export type SignatureEvidence = {
  id: string;
  phase: BeritaAcaraPhase | null;
  role: SignatureRole;
  signedAt: Date | string | null;
  signatureFileName: string | null;
  signatureMimeType: string | null;
  signatureFileSize: bigint | string | null;
  signatureChecksumSha256: string | null;
};

export type SignatureRoleStatus = {
  role: SignatureRole;
  signatureId: string | null;
  state: SignatureState;
  isSigned: boolean;
  missingRequirements: string[];
};

export function managedSignatureStorageKey(signature: Pick<SignatureEvidence, "id" | "phase" | "signatureMimeType">) {
  if (!signature.phase || !signature.signatureMimeType) return null;
  return `signature-${signature.phase.toLowerCase()}-${signature.id}.${extensionForMimeType(signature.signatureMimeType)}`;
}

function metadataRequirements(signature: SignatureEvidence) {
  const missing: string[] = [];
  if (!signature.signedAt) missing.push("signedAt");
  if (!signature.signatureFileName) missing.push("signatureFileName");
  if (!signature.signatureMimeType) missing.push("signatureMimeType");
  if (signature.signatureFileSize === null || signature.signatureFileSize === undefined || BigInt(signature.signatureFileSize) <= 0n) {
    missing.push("signatureFileSize");
  }
  if (!signature.signatureChecksumSha256 || !/^[a-f0-9]{64}$/i.test(signature.signatureChecksumSha256)) {
    missing.push("signatureChecksumSha256");
  }
  return missing;
}

export async function evaluateSignatureRoles(
  signatures: SignatureEvidence[],
  phase: BeritaAcaraPhase,
): Promise<{ isComplete: boolean; roles: SignatureRoleStatus[]; incompleteRoles: SignatureRole[] }> {
  const roles: SignatureRoleStatus[] = [];
  for (const role of REQUIRED_SIGNATURE_ROLES) {
    const signature = signatures.find((item) => item.phase === phase && item.role === role);
    if (!signature) {
      roles.push({ role, signatureId: null, state: "MISSING", isSigned: false, missingRequirements: ["signature"] });
      continue;
    }
    const missingRequirements = metadataRequirements(signature);
    if (missingRequirements.length > 0) {
      roles.push({ role, signatureId: signature.id, state: "UNSIGNED", isSigned: false, missingRequirements });
      continue;
    }
    const storageKey = managedSignatureStorageKey(signature);
    if (!storageKey) {
      roles.push({ role, signatureId: signature.id, state: "UNSIGNED", isSigned: false, missingRequirements: ["managedSignatureFile"] });
      continue;
    }
    try {
      await resolveVerifiedFile(storageKey, {
        fileSize: BigInt(signature.signatureFileSize!),
        checksumSha256: signature.signatureChecksumSha256,
      });
      roles.push({ role, signatureId: signature.id, state: "SIGNED", isSigned: true, missingRequirements: [] });
    } catch {
      roles.push({ role, signatureId: signature.id, state: "INVALID_FILE", isSigned: false, missingRequirements: ["validSignatureFile"] });
    }
  }
  const incompleteRoles = roles.filter((item) => !item.isSigned).map((item) => item.role);
  return { isComplete: incompleteRoles.length === 0, roles, incompleteRoles };
}
