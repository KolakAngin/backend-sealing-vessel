import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/utils/password.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL belum tersedia pada file .env");
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function seedAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const email = process.env.SEED_ADMIN_EMAIL || null;

  if (!username || !password) {
    console.log("Admin tidak dibuat: SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD belum diisi.");
    return null;
  }

  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD minimal 8 karakter");
  }

  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { username: username.toLowerCase() },
    update: {
      passwordHash,
      fullName: "Administrator",
      email: email?.toLowerCase() ?? null,
      role: "ADMIN",
      isActive: true,
    },
    create: {
      username: username.toLowerCase(),
      passwordHash,
      fullName: "Administrator",
      email: email?.toLowerCase() ?? null,
      role: "ADMIN",
      isActive: true,
    },
  });
}

// ======================================================
// MASTER KATEGORI TKO A-H
// ======================================================

const sealingCategories = [
  {
    code: "A",
    name: "Closed Cade/Hatch Coaming/Tank Dom, Tank Cleaning Access and Sounding Hole/Flange Vapor Lock",
    description:
      "Titik sealing pada compartment, sounding hole, tank cleaning access, deck seal, manhole, sampling hole, dan emergency connection.",
    sequence: 1,
  },
  {
    code: "B",
    name: "Manifold Cargo/Bunker/MARPOL",
    description:
      "Titik sealing manifold cargo, bunker, atau MARPOL pada sisi Port dan Starboard.",
    sequence: 2,
  },
  {
    code: "C",
    name: "Permanent Means Access (FPT, APT, WBT)",
    description:
      "Titik sealing permanent means access pada FPT, APT, atau WBT.",
    sequence: 3,
  },
  {
    code: "D",
    name: "Cargo Valve on Deck",
    description:
      "Suction, stripping, drop, cross-over, by-pass, gate, dan drain manifold.",
    sequence: 4,
  },
  {
    code: "E",
    name: "Tank Cleaning/COW Valve",
    description:
      "Titik sealing pada tank cleaning valve dan crude oil washing valve.",
    sequence: 5,
  },
  {
    code: "F",
    name: "Bunker Sounding Hole and Deck Seal",
    description:
      "Titik sealing bunker sounding hole atau flange vapor lock serta deck seal.",
    sequence: 6,
  },
  {
    code: "G",
    name: "Sealing Access at Pump Room and Pumps",
    description:
      "Titik sealing pada pump room, pompa, valve, strainer, dan perpipaan.",
    sequence: 7,
  },
  {
    code: "H",
    name: "Other Equipment",
    description:
      "Peralatan lainnya seperti sampling bottle, measurement toolbox, dan portable pump.",
    sequence: 8,
  },
] as const;

// ======================================================
// MASTER TEMPLATE TITIK SEALING
// ======================================================

const sealingPointTemplates = [
  // KATEGORI A
  {
    categoryCode: "A",
    code: "A-01",
    name: "Sounding Hole/Flange Vapor Lock",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "A",
    code: "A-02",
    name: "Tank Cleaning Access",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "A",
    code: "A-03",
    name: "COT/Deck Seal",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 3,
  },
  {
    categoryCode: "A",
    code: "A-04",
    name: "Hatch Coaming/Tank Dom/Closed Cade/Manhole",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 4,
  },
  {
    categoryCode: "A",
    code: "A-05",
    name: "Sampling Hole/Sighting Hole/Small Manhole",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 5,
  },
  {
    categoryCode: "A",
    code: "A-06",
    name: "Emergency Connection (Framo Pump)",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 6,
  },

  // KATEGORI B
  {
    categoryCode: "B",
    code: "B-01",
    name: "Cargo/Bunker/MARPOL Manifold",
    requiresCompartment: false,
    supportsSide: true,
    sequence: 1,
  },

  // KATEGORI C
  {
    categoryCode: "C",
    code: "C-01",
    name: "Permanent Means Access (FPT/APT/WBT)",
    requiresCompartment: false,
    supportsSide: true,
    sequence: 1,
  },

  // KATEGORI D
  {
    categoryCode: "D",
    code: "D-01",
    name: "Suction/Stripping/Drop/Gate and Drain Manifold",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "D",
    code: "D-02",
    name: "Cross Over/By Pass Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },

  // KATEGORI E
  {
    categoryCode: "E",
    code: "E-01",
    name: "Tank Cleaning Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "E",
    code: "E-02",
    name: "COW Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },

  // KATEGORI F
  {
    categoryCode: "F",
    code: "F-01",
    name: "Bunker Sounding Hole/Flange Vapor Lock",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "F",
    code: "F-02",
    name: "Deck Seal",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 2,
  },

  // KATEGORI G
  {
    categoryCode: "G",
    code: "G-01",
    name: "Cargo Sea Chest Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "G",
    code: "G-02",
    name: "Spool Piece Cargo Line vs Ballast Line",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "G",
    code: "G-03",
    name: "Overboard Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 3,
  },
  {
    categoryCode: "G",
    code: "G-04",
    name: "Cover of Strainer",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 4,
  },
  {
    categoryCode: "G",
    code: "G-05",
    name: "Cargo Oil Pump Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 5,
  },
  {
    categoryCode: "G",
    code: "G-06",
    name: "Stripping Pump Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 6,
  },
  {
    categoryCode: "G",
    code: "G-07",
    name: "Bilge Pump Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 7,
  },
  {
    categoryCode: "G",
    code: "G-08",
    name: "Cross Over/By Pass Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 8,
  },
  {
    categoryCode: "G",
    code: "G-09",
    name: "Tank Cleaning Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 9,
  },
  {
    categoryCode: "G",
    code: "G-10",
    name: "Drain Valve Cargo Oil Pump Strainer",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 10,
  },
  {
    categoryCode: "G",
    code: "G-11",
    name: "Drain Valve Stripping Pump Strainer",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 11,
  },
  {
    categoryCode: "G",
    code: "G-12",
    name: "Air Pipe Cargo Oil Pump Strainer",
    description: "Digunakan untuk Tongkang/SPOB.",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 12,
  },
  {
    categoryCode: "G",
    code: "G-13",
    name: "Air Pipe Stripping Pump Strainer",
    description: "Digunakan untuk Tongkang/SPOB.",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 13,
  },
  {
    categoryCode: "G",
    code: "G-14",
    name: "Pipa Pancingan Pompa Cargo",
    description: "Digunakan untuk Tongkang/SPOB.",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 14,
  },

  // KATEGORI H
  {
    categoryCode: "H",
    code: "H-01",
    name: "Sampling Bottle",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "H",
    code: "H-02",
    name: "Measurement Tool Box",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "H",
    code: "H-03",
    name: "Wilden Pump",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 3,
  },
  {
    categoryCode: "H",
    code: "H-04",
    name: "Portable Emergency Submersible Cargo Pump",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 4,
  },
] as const;

// ======================================================
// FUNGSI SEED
// ======================================================

async function seedCategories() {
  const categoryIds = new Map<string, string>();

  for (const category of sealingCategories) {
    const savedCategory = await prisma.sealingCategory.upsert({
      where: {
        code: category.code,
      },
      update: {
        name: category.name,
        description: category.description,
        sequence: category.sequence,
        isActive: true,
      },
      create: {
        code: category.code,
        name: category.name,
        description: category.description,
        sequence: category.sequence,
        isActive: true,
      },
    });

    categoryIds.set(savedCategory.code, savedCategory.id);
  }

  return categoryIds;
}

async function seedTemplates(categoryIds: Map<string, string>) {
  for (const template of sealingPointTemplates) {
    const categoryId = categoryIds.get(template.categoryCode);

    if (!categoryId) {
      throw new Error(
        `Kategori ${template.categoryCode} tidak ditemukan`,
      );
    }

    const description =
      "description" in template ? template.description : null;

    await prisma.sealingPointTemplate.upsert({
      where: {
        code: template.code,
      },
      update: {
        categoryId,
        name: template.name,
        description,
        requiresCompartment: template.requiresCompartment,
        supportsSide: template.supportsSide,
        sequence: template.sequence,
        isActive: true,
      },
      create: {
        categoryId,
        code: template.code,
        name: template.name,
        description,
        requiresCompartment: template.requiresCompartment,
        supportsSide: template.supportsSide,
        sequence: template.sequence,
        isActive: true,
      },
    });
  }
}

async function seedTerminal() {
  return prisma.terminal.upsert({
    where: {
      code: "STS-TABONEO",
    },
    update: {
      name: "STS TABONEO (MT. GLOBAL TOP)",
      city: "Taboneo",
      isActive: true,
    },
    create: {
      code: "STS-TABONEO",
      name: "STS TABONEO (MT. GLOBAL TOP)",
      city: "Taboneo",
      isActive: true,
    },
  });
}

async function seedVessel() {
  const vesselName = "OB. QUEEN SOFIA";

  // Nama vessel tidak memiliki constraint @unique,
  // sehingga tidak dapat langsung digunakan dalam upsert.
  const existingVessel = await prisma.vessel.findFirst({
    where: {
      name: {
        equals: vesselName,
        mode: "insensitive",
      },
    },
  });

  if (existingVessel) {
    return prisma.vessel.update({
      where: {
        id: existingVessel.id,
      },
      data: {
        name: vesselName,
        vesselType: "BARGE",
        isActive: true,
      },
    });
  }

  return prisma.vessel.create({
    data: {
      name: vesselName,
      vesselType: "BARGE",
      isActive: true,
    },
  });
}

async function seedCompartments(vesselId: string) {
  const compartments = Array.from({ length: 7 }, (_, index) => {
    const tankNumber = index + 1;

    return [
      {
        code: `${tankNumber}P`,
        name: `Compartment ${tankNumber}P`,
        side: "PORT" as const,
        sequence: tankNumber * 2 - 1,
      },
      {
        code: `${tankNumber}S`,
        name: `Compartment ${tankNumber}S`,
        side: "STBD" as const,
        sequence: tankNumber * 2,
      },
    ];
  }).flat();

  for (const compartment of compartments) {
    await prisma.compartment.upsert({
      where: {
        vesselId_code: {
          vesselId,
          code: compartment.code,
        },
      },
      update: {
        name: compartment.name,
        side: compartment.side,
        sequence: compartment.sequence,
        isActive: true,
      },
      create: {
        vesselId,
        code: compartment.code,
        name: compartment.name,
        side: compartment.side,
        sequence: compartment.sequence,
        isActive: true,
      },
    });
  }
}

async function main() {
  console.log("Memulai proses seed...");

  const admin = await seedAdmin();
  if (admin) console.log(`Admin berhasil dibuat/diperbarui: ${admin.username}`);

  const categoryIds = await seedCategories();

  console.log("Kategori sealing A-H berhasil dibuat.");

  await seedTemplates(categoryIds);

  console.log("Template titik sealing berhasil dibuat.");

  const terminal = await seedTerminal();

  console.log(`Terminal berhasil dibuat: ${terminal.name}`);

  const vessel = await seedVessel();

  console.log(`Vessel berhasil dibuat: ${vessel.name}`);

  await seedCompartments(vessel.id);

  console.log("Compartment vessel berhasil dibuat.");
  console.log("Seluruh seed master berhasil dijalankan.");
}

main()
  .catch((error) => {
    console.error("Seed gagal dijalankan:");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
