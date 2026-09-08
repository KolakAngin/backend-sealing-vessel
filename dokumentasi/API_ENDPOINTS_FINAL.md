# Endpoint Backend Final

Release gate: 8 September 2026. Semua path transaksi di bawah memakai prefix `/api/v1`. Selain health dan login, endpoint memerlukan Bearer token.

## Matriks role

| Kode | Role |
|---|---|
| `A` | `ADMIN` |
| `S` | `SUPERVISOR` |
| `LM` | `LOADING_MASTER`, hanya shipment yang ditugaskan kepadanya; untuk laporan legacy tanpa assignment, pembuat laporan menjadi assignment implisit |
| `UM` | `UNLOADING_MASTER`, hanya shipment yang `unloadingMasterId`-nya sama |
| `V` | `VIEWER`, baca saja |
| `AUTH` | Semua user aktif yang terautentikasi, dengan filter assignment yang diterapkan service |

Mutasi semua master, user, Terminal legacy, assignment Plant–Jetty, dan konfigurasi vessel hanya `A`. `S` dapat mengelola transaksi lintas assignment, tetapi tidak dapat mengubah master/configuration.

## System dan autentikasi

| Method | Path | Akses |
|---|---|---|
| GET | `/` | Publik |
| GET | `/api/v1/health` | Publik |
| POST | `/auth/login` | Publik |
| GET | `/auth/me` | AUTH |

## User dan master

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/users` | A |
| GET, PATCH, DELETE | `/users/:id` | A |
| GET | `/terminals`, `/terminals/:id` | AUTH |
| POST | `/terminals` | A |
| PATCH, DELETE | `/terminals/:id` | A |
| GET | `/plants`, `/plants/:id` | AUTH |
| POST | `/plants` | A |
| PATCH, DELETE | `/plants/:id` | A |
| GET | `/jetties`, `/jetties/:id` | AUTH |
| POST | `/jetties` | A |
| PATCH, DELETE | `/jetties/:id` | A |
| GET | `/activities`, `/activities/:id` | AUTH |
| POST | `/activities` | A |
| PATCH, DELETE | `/activities/:id` | A |
| GET | `/products`, `/products/:id` | AUTH |
| POST | `/products` | A |
| PATCH, DELETE | `/products/:id` | A |
| GET | `/units-of-measure`, `/units-of-measure/:id` | AUTH |
| POST | `/units-of-measure` | A |
| PATCH, DELETE | `/units-of-measure/:id` | A |
| GET | `/plant-jetty-assignments` | AUTH |
| POST | `/plant-jetty-assignments` | A |
| DELETE | `/plant-jetty-assignments/:id` | A |

## Vessel dan konfigurasi A–H

CRUD berikut mempunyai pola yang sama: `GET` list/detail untuk `AUTH`, sedangkan `POST`, `PATCH`, dan `DELETE` hanya `A`.

| Resource | Path |
|---|---|
| Vessel | `/vessels`, `/vessels/:id` |
| Compartment | `/compartments`, `/compartments/:id` |
| Section A–H | `/sealing-categories`, `/sealing-categories/:id` |
| Template titik | `/sealing-point-templates`, `/sealing-point-templates/:id` |
| Titik aktual vessel | `/vessel-sealing-points`, `/vessel-sealing-points/:id` |

Endpoint baca nested: `GET /vessels/:vesselId/compartments`, `GET /vessels/:vesselId/sealing-points`, dan `GET /sealing-categories/:categoryId/templates` (`AUTH`).

## Shipment/voyage dan lifecycle

`/shipments` adalah nama canonical. `/voyages` adalah alias canonical kompatibel dan `/reports` adalah alias legacy pada aggregate `SealingReport` yang sama.

| Method | Path untuk setiap `{resource}` = `shipments`, `voyages`, `reports` | Akses |
|---|---|---|
| GET | `/{resource}` | AUTH; LM/UM difilter assignment |
| GET | `/{resource}/:id` | AUTH; LM/UM diverifikasi assignment |
| POST | `/{resource}` | A, S, LM; `/reports` memakai payload legacy |
| PATCH, DELETE | `/{resource}/:id` | A, S, LM; LM wajib assigned |
| POST | `/{resource}/:id/prepare-seals` | A, S, LM; LM wajib assigned |
| GET | `/{resource}/:id/validation` | AUTH; LM/UM wajib assigned |
| POST | `/{resource}/:id/depart` | A, S, LM; LM wajib assigned |
| POST | `/{resource}/:id/arrive` | A, S, UM; UM wajib assigned |
| POST | `/{resource}/:id/finish` | A, S, UM; UM wajib assigned |
| POST | `/{resource}/:id/finalize` | A, S, UM; alias finalisasi ke transisi `FINISH` |

## Snapshot dan input form A–H

Untuk setiap `{resource}` = `shipments`, `voyages`, `reports`:

| Method | Path | Akses |
|---|---|---|
| GET | `/{resource}/:reportId/form` | AUTH; assignment berlaku |
| PUT | `/{resource}/:reportId/form/points/:pointId` | A, S, LM; assignment berlaku |
| PATCH | `/{resource}/:reportId/form/points/:pointId` | A, S, LM; assignment berlaku |
| DELETE | `/{resource}/:reportId/form/points/:pointId` | A, S, LM; assignment berlaku |
| PUT | `/{resource}/:reportId/form/sections/:sectionCode` | A, S, LM; assignment berlaku |

Endpoint record/seal kompatibilitas:

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/reports/:reportId/records`, `/voyages/:reportId/records`, `/shipments/:reportId/records` | GET AUTH; POST A/S/LM dan assignment |
| PATCH, DELETE | `/records/:id` | A/S/LM dan assignment |
| POST | `/records/:recordId/seals` | A/S/LM dan assignment |
| PATCH | `/seals/:id` | A/S/LM dan assignment |
| POST | `/seals/:id/remove`, `/seals/:id/replace` | A/S/LM dan assignment |
| POST | `/seals/:id/verify` | A/S/UM dan assignment |

## Attachment dokumentasi

Untuk setiap `{resource}` = `shipments`, `voyages`, `reports`:

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/{resource}/:reportId/attachments` | GET AUTH; POST A/S/LM/UM dan assignment/context |
| GET, POST | `/{resource}/:reportId/sections/:sectionCode/attachments` | GET AUTH; POST A/S/LM/UM dan assignment/context |

Owner lain dan file:

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/records/:recordId/attachments` | GET AUTH; POST A/S/LM/UM sesuai assignment/context |
| GET, POST | `/verifications/:verificationId/attachments` | GET AUTH; POST A/S/LM/UM sesuai assignment/context |
| GET, PATCH, DELETE | `/attachments/:id` | GET AUTH; mutasi A/S/LM/UM sesuai assignment/context |
| GET | `/attachments/:id/preview`, `/attachments/:id/download`, `/attachments/:id/file` | AUTH; assignment berlaku; `/file` alias preview legacy |

## Tanda tangan

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/{resource}/:reportId/signatures` | GET AUTH; POST A/S/LM/UM sesuai assignment, `{resource}` = reports/voyages/shipments |
| GET, PATCH, DELETE | `/signatures/:id` | GET AUTH; mutasi A/S/LM/UM sesuai assignment |
| PUT | `/signatures/:id/file` | A/S/LM/UM sesuai assignment |
| GET | `/signatures/:id/preview`, `/signatures/:id/download` | AUTH; assignment berlaku |

## XLSX, PDF, dan audit

Untuk setiap `{resource}` = `shipments`, `voyages`, `reports`:

| Method | Path | Akses |
|---|---|---|
| POST | `/{resource}/:reportId/xlsx` | A/S/LM/UM sesuai assignment; laporan wajib final |
| GET | `/{resource}/:reportId/xlsx/preview`, `/{resource}/:reportId/xlsx/download` | AUTH; assignment berlaku |
| POST | `/{resource}/:reportId/pdf` | A/S/LM/UM sesuai assignment; laporan wajib final |
| GET | `/{resource}/:reportId/pdf/preview`, `/{resource}/:reportId/pdf/download` | AUTH; assignment berlaku |
| GET | `/audit-logs` | A, S |

Payload, response, validasi detail, MIME, dan contoh penggunaan tersedia pada dokumen API per STEP di folder ini. Daftar ini adalah inventaris route final dan matriks akses release gate; route yang tidak tercantum dianggap bukan kontrak API backend.
