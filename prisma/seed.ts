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
    name: "Tank Cleaning Access DOT/Deck Seal",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "A",
    code: "A-03",
    name: "COT/Deck Seal",
    description: "Template legacy sebelum kolom gabungan A-02 diselaraskan dengan XLSX utama.",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 99,
  },
  {
    categoryCode: "A",
    code: "A-04",
    name: "Hatch Coaming/Tank Dom/Closed Cade/Manhole",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 3,
  },
  {
    categoryCode: "A",
    code: "A-05",
    name: "Sampling Hole/Sighting Hole/Small Manhole",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 4,
  },
  {
    categoryCode: "A",
    code: "A-06",
    name: "Emergency Connection (Framo Pump)",
    requiresCompartment: true,
    supportsSide: false,
    sequence: 5,
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
    description: "Template legacy generik; dipertahankan untuk konfigurasi dan laporan lama.",
    requiresCompartment: false,
    supportsSide: true,
    sequence: 99,
  },
  {
    categoryCode: "C",
    code: "C-02",
    name: "Fore Peak Tank",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "C",
    code: "C-03",
    name: "After Peak Tank",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "C",
    code: "C-04",
    name: "Water Ballast Tank (P)",
    requiresCompartment: false,
    supportsSide: true,
    sequence: 3,
  },
  {
    categoryCode: "C",
    code: "C-05",
    name: "Water Ballast Tank (S)",
    requiresCompartment: false,
    supportsSide: true,
    sequence: 4,
  },

  // KATEGORI D
  {
    categoryCode: "D",
    code: "D-01",
    name: "Suction/Stripping/Drop/Gate and Drain Manifold",
    description: "Template legacy berkelompok; dipertahankan untuk konfigurasi dan laporan lama.",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 99,
  },
  {
    categoryCode: "D",
    code: "D-02",
    name: "Cross Over/By Pass Valve",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 4,
  },
  {
    categoryCode: "D",
    code: "D-03",
    name: "Suction",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 1,
  },
  {
    categoryCode: "D",
    code: "D-04",
    name: "Stripping",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 2,
  },
  {
    categoryCode: "D",
    code: "D-05",
    name: "Dropline",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 3,
  },
  {
    categoryCode: "D",
    code: "D-06",
    name: "Gate & Drain Manifold",
    requiresCompartment: false,
    supportsSide: false,
    sequence: 5,
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
    name: "Pintu Pumproom",
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

const currentFormVersion = {
  code: "FORM-SEGEL-TKO-EDIT1",
  name: "Form Segel Baru sesuai TKO (edit1)",
  revision: "edit1",
  description:
    "Versi snapshot konfigurasi berdasarkan sumber utama Form Segel Baru sesuai TKO (edit1).xlsx.",
} as const;

// ======================================================
// MASTER SHEET `acuan seed`
// ======================================================

const plants = [
  { code: "1401", name: "IT Balikpapan", sequence: 1 },
  { code: "1402", name: "FT Samarinda", sequence: 2 },
  { code: "1403", name: "FT Tarakan", sequence: 3 },
  { code: "1404", name: "IT Banjarmasin", sequence: 4 },
  { code: "2503", name: "DM LPG Banjarmasin", sequence: 5 },
  { code: "1S45", name: "STS Taboneo", sequence: 6 },
] as const;

const activities = ["LOADING", "DISCHARGE", "ROB"].map((code, index) => ({
  code,
  name: code,
  sequence: index + 1,
}));

const products = [
  "PERTALITE",
  "PERTAMAX",
  "PERTAMAX TURBO",
  "BIOSOLAR B40",
  "PERTADEX",
  "DEXLITE",
  "LPG",
  "MFO",
].map((name, index) => ({ name, sequence: index + 1 }));

// UoM disimpan sebagai master mandiri. Workbook tidak menyatakan relasi tetap
// Product-UoM, sehingga seed tidak membuat relasi yang bersifat spekulatif.
const unitsOfMeasure = ["KL", "MT", "BBRL"].map((code, index) => ({
  code,
  sequence: index + 1,
}));

const jetties = ["JETTY 1", "JETTY 2", "JETTY 3", "MT GLOBAL", "MT XXXX"]
  .map((name, index) => ({ name, sequence: index + 1 }));

const sourceVessels = [
  { name: "MT IHSAN 2", vesselType: "MT", productGroup: "LPG", owner: "PT Agrabudi Gas Utama", tankCount: 2, drawingStatus: "YES" },
  { name: "MT IHSAN 3", vesselType: "MT", productGroup: "LPG", owner: "PT Agrabudi Gas Utama", tankCount: 2, drawingStatus: "NO" },
  { name: "MT IHSAN 5", vesselType: "MT", productGroup: "LPG", owner: "PT Agrabudi Gas Utama", tankCount: 2, drawingStatus: "YES" },
  { name: "OB Ratu Maryam", vesselType: "OB", productGroup: "BBM", owner: "PT Barokah Gemilang Perkasa", tankCount: 7, drawingStatus: "YES" },
  { name: "OB XXXXX", vesselType: "OB", productGroup: "AVTUR", owner: "PT Barokah Gemilang Perkasa", tankCount: 7, drawingStatus: "YES" },
] as const;

// ======================================================
// FUNGSI SEED
// ======================================================

async function seedWorkbookMasters() {
  for (const plant of plants) {
    await prisma.plant.upsert({
      where: { code: plant.code },
      update: { name: plant.name, sequence: plant.sequence, isActive: true },
      create: { ...plant, isActive: true },
    });
  }

  for (const activity of activities) {
    await prisma.activity.upsert({
      where: { code: activity.code },
      update: { name: activity.name, sequence: activity.sequence, isActive: true },
      create: { ...activity, isActive: true },
    });
  }

  for (const product of products) {
    await prisma.product.upsert({
      where: { name: product.name },
      update: { sequence: product.sequence, isActive: true },
      create: { ...product, isActive: true },
    });
  }

  for (const unit of unitsOfMeasure) {
    await prisma.unitOfMeasure.upsert({
      where: { code: unit.code },
      update: { sequence: unit.sequence, isActive: true },
      create: { ...unit, isActive: true },
    });
  }

  for (const jetty of jetties) {
    await prisma.jetty.upsert({
      where: { name: jetty.name },
      update: { sequence: jetty.sequence, isActive: true },
      create: { ...jetty, isActive: true },
    });
  }

  for (const vessel of sourceVessels) {
    const existingVessel = await prisma.vessel.findFirst({
      where: { name: { equals: vessel.name, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
    const knownSourceValues = {
      name: vessel.name,
      vesselType: vessel.vesselType,
      productGroup: vessel.productGroup,
      owner: vessel.owner,
      tankCount: vessel.tankCount,
      drawingStatus: vessel.drawingStatus,
      isActive: true,
    };

    if (existingVessel) {
      await prisma.vessel.update({ where: { id: existingVessel.id }, data: knownSourceValues });
    } else {
      await prisma.vessel.create({ data: knownSourceValues });
    }
  }
}

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

async function seedVesselFormProfiles() {
  const formVersion = await prisma.formTkoVersion.upsert({
    where: { code: currentFormVersion.code },
    update: { ...currentFormVersion, isActive: true },
    create: { ...currentFormVersion, isActive: true },
  });
  const categories = await prisma.sealingCategory.findMany({
    where: { code: { in: ["A", "B", "C", "D", "E", "F", "G", "H"] } },
    orderBy: { sequence: "asc" },
  });
  const vessels = await prisma.vessel.findMany({ select: { id: true, name: true } });

  for (const vessel of vessels) {
    const profile = await prisma.vesselFormProfile.upsert({
      where: {
        vesselId_formVersionId: {
          vesselId: vessel.id,
          formVersionId: formVersion.id,
        },
      },
      update: { isActive: true },
      create: {
        vesselId: vessel.id,
        formVersionId: formVersion.id,
        name: `Profil aktual ${vessel.name}`,
        isActive: true,
        activatedAt: new Date(),
      },
    });

    for (const category of categories) {
      const availablePointCount = await prisma.vesselSealingPoint.count({
        where: {
          vesselId: vessel.id,
          isActive: true,
          availability: "AVAILABLE",
          sealingPointTemplate: { categoryId: category.id, isActive: true },
        },
      });
      await prisma.vesselFormSection.upsert({
        where: {
          vesselFormProfileId_categoryId: {
            vesselFormProfileId: profile.id,
            categoryId: category.id,
          },
        },
        update: {
          isAvailable: category.isActive && availablePointCount > 0,
          sequence: category.sequence,
        },
        create: {
          vesselFormProfileId: profile.id,
          categoryId: category.id,
          isAvailable: category.isActive && availablePointCount > 0,
          sequence: category.sequence,
        },
      });
    }
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

  compartments.push(
    {
      code: "SLOP-P",
      name: "Slop Port",
      side: "PORT" as const,
      sequence: 15,
    },
    {
      code: "SLOP-S",
      name: "Slop Starboard",
      side: "STBD" as const,
      sequence: 16,
    },
  );

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

  await seedWorkbookMasters();

  console.log("Master sheet acuan seed berhasil dibuat/diperbarui.");

  const terminal = await seedTerminal();

  console.log(`Terminal berhasil dibuat: ${terminal.name}`);

  const vessel = await seedVessel();

  console.log(`Vessel berhasil dibuat: ${vessel.name}`);

  await seedCompartments(vessel.id);

  console.log("Compartment vessel berhasil dibuat.");

  await seedVesselFormProfiles();

  console.log("Versi form TKO dan profile vessel berhasil dibuat/diperbarui.");
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
