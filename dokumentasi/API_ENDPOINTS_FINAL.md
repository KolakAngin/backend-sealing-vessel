# Endpoint Backend Final

Release gate: 8 September 2026. Semua path transaksi di bawah memakai prefix `/api/v1`. Selain health dan login, endpoint memerlukan Bearer token.

Untuk Flutter Web, set `CORS_ORIGINS` sebagai daftar origin yang dipisahkan koma (contoh:
`http://localhost:8080,https://sboard.example.com`). Hanya origin pada daftar yang menerima
header CORS. Nilai `*` dan URL dengan path tidak diterima. Bila variabel belum diatur, tidak ada
origin browser yang diizinkan. Preflight `OPTIONS` dijawab sebelum autentikasi.

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

## Kontrak pagination

Seluruh endpoint list paginated menerima `page` mulai dari 1 dan `limit` 1–100. Response mengembalikan `meta.page`, `meta.limit`, `meta.total`, dan `meta.totalPages`. Urutan selalu mempunyai tie-breaker `id` agar item dengan nilai sort yang sama tidak berpindah atau muncul ganda antarhalaman.

Jika `page` yang diminta melampaui halaman terakhir—misalnya setelah item terakhir pada halaman akhir dihapus atau consumer membawa state halaman dari resource lain—backend mengembalikan halaman terakhir yang masih valid dan `meta.page` berisi nomor halaman aktual tersebut. Untuk hasil kosong, kontraknya adalah `page=1`, `total=0`, dan `totalPages=1`.

## User dan master

| Method | Path | Akses |
|---|---|---|
| GET, POST | `/users` | A |
| GET | `/users?role=UNLOADING_MASTER&isActive=true&sortBy=fullName&sortOrder=asc` | LM, S (lookup terbatas) |
| GET | `/users/assignable?role=UNLOADING_MASTER&search=...` | A, S, LM |
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

Lookup `/users/assignable` hanya mengembalikan user aktif ber-role `UNLOADING_MASTER` dengan field
`id`, `username`, `fullName`, dan `role`. `role=UNLOADING_MASTER` wajib; `search` opsional
(mencari pada username/nama, tanpa membedakan huruf besar dan kecil). Paginasi memakai `page`
dan `limit` (maksimum 100) serta `meta` seperti daftar lain. Daftar user lengkap tetap khusus ADMIN.

Kompatibilitas Flutter: `GET /users?role=UNLOADING_MASTER&isActive=true&sortBy=fullName&sortOrder=asc`
dapat dipakai `LOADING_MASTER` dan `SUPERVISOR`. Response hanya berisi empat field lookup di atas,
termasuk bila dipaginasi dengan `page`/`limit`. Pola `/users` lainnya tetap khusus ADMIN.

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

Endpoint nested compartment dan titik vessel memakai `limit=100` bila query `limit` tidak dikirim, tetapi tetap mengembalikan metadata pagination dan menerima `page`/`limit` eksplisit. Hal ini mencegah konfigurasi ke-11 dan seterusnya tersembunyi pada consumer yang membaca konfigurasi satu vessel. Daftar `/vessels` menampilkan `_count.compartments` untuk compartment aktif dan `_count.sealingPoints` untuk titik A–H yang benar-benar eligible bagi snapshot mobile: point, template, kategori, dan compartment terkait aktif serta availability `AVAILABLE`.

## Shipment/voyage dan lifecycle

`/shipments` adalah nama canonical. `/voyages` adalah alias canonical kompatibel dan `/reports` adalah alias legacy pada aggregate `SealingReport` yang sama.

| Method | Path untuk setiap `{resource}` = `shipments`, `voyages`, `reports` | Akses |
|---|---|---|
| GET | `/{resource}` | AUTH; LM/UM difilter assignment |
| GET | `/{resource}/:id` | AUTH; LM/UM diverifikasi assignment |
| POST | `/{resource}` | A, S, LM; `/reports` memakai payload legacy |
| PATCH, DELETE | `/{resource}/:id` | A, S, LM; LM wajib assigned |
| POST | `/{resource}/:id/prepare-seals` | A, S, LM; LM wajib assigned |
| PUT | `/{resource}/:id/destination-assignment` | A, S, LM; canonical, DRAFT, READY; LM wajib assigned |
| GET | `/{resource}/:id/validation` | AUTH; LM/UM wajib assigned |
| POST | `/{resource}/:id/depart` | A, S, LM; LM wajib assigned |
| POST | `/{resource}/:id/arrive` | A, S, UM; UM wajib assigned |
| POST | `/{resource}/:id/finish` | A, S, UM; UM wajib assigned |
| POST | `/{resource}/:id/finalize` | A, S, UM; alias finalisasi ke transisi `FINISH` |

Departure shipment canonical memerlukan BA LOADING final. Endpoint BA LOADING: `POST /{resource}/:id/ba/loading/finalize`, `POST /{resource}/:id/ba/loading/pdf`, serta `GET /{resource}/:id/ba/loading/pdf/preview|download`. Seluruh endpoint mutasi/generate hanya untuk A, S, atau LM assignee.

Setelah kapal `SANDAR`, A, S, atau UM assignee melengkapi verification/foto dan tiga signature UNLOADING, lalu memanggil `POST /{resource}/:id/ba/unloading/finalize`. Endpoint `finish/finalize` lifecycle baru terbuka setelah dokumen tersebut final.

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
| PUT | `/{resource}/:reportId/signatures/:role` | A/S/LM/UM sesuai assignment; buat atau perbarui satu slot role, respons 200 |
| GET, PATCH, DELETE | `/signatures/:id` | GET AUTH; mutasi A/S/LM/UM sesuai assignment |
| PUT | `/signatures/:id/file` | A/S/LM/UM sesuai assignment |
| GET | `/signatures/:id/preview`, `/signatures/:id/download` | AUTH; assignment berlaku |

Endpoint di atas adalah kontrak signature legacy (`phase = NULL`). Fondasi BA dua tahap menambahkan endpoint berikut untuk setiap `{resource}` = `shipments`, `voyages`, `reports`:

| Method | Path | Akses |
|---|---|---|
| GET | `/{resource}/:reportId/ba/:phase` | AUTH; assignment baca berlaku |
| GET | `/{resource}/:reportId/ba/:phase/signatures` | AUTH; assignment baca berlaku |
| PUT | `/{resource}/:reportId/ba/:phase/signatures/:role` | LOADING: A/S/assigned LM saat DRAFT; UNLOADING: A/S/assigned UM saat SANDAR |
| POST | `/{resource}/:reportId/ba/:phase/finalize` | Otorisasi per phase; tiga role wajib lengkap; phase dikunci |

Detail model, snapshot, migration legacy, dan fondasi artefak ada di [API_BERITA_ACARA_PHASE.md](./API_BERITA_ACARA_PHASE.md).

`PUT /shipments/:id/signatures/CHIEF_OFFICER` menerima JSON seperti
`{"name":"Budi","signedAt":"2026-09-20T03:10:00.000Z"}`. Role yang tersedia:
`CHIEF_OFFICER`, `TERMINAL_REPRESENTATIVE`, dan `SURVEYOR`. `name` wajib;
`userId`, `signedAt`, dan `signatureUrl` opsional. Jika slot role sudah ada,
`id` dan metadata file tetap dipertahankan, sedangkan field yang dikirim diperbarui.
Unggah file tetap melalui `PUT /signatures/:id/file` menggunakan `id` dari respons.
Laporan `FINISH` tetap terkunci.

## XLSX, PDF, dan audit

Untuk setiap `{resource}` = `shipments`, `voyages`, `reports`:

| Method | Path | Akses |
|---|---|---|
| POST | `/{resource}/:reportId/xlsx` | Export operasional/legacy, bukan BA; A/S/LM/UM sesuai assignment; laporan wajib final |
| GET | `/{resource}/:reportId/xlsx/preview`, `/{resource}/:reportId/xlsx/download` | AUTH; assignment berlaku |
| POST | `/{resource}/:reportId/pdf` | Compatibility facade: BA UNLOADING untuk phase-aware, `PdfArtifact` untuk historis tanpa dokumen BA |
| GET | `/{resource}/:reportId/pdf/preview`, `/{resource}/:reportId/pdf/download` | Byte artefak BA UNLOADING yang sama untuk phase-aware; artefak legacy untuk historis |
| GET | `/audit-logs` | A, S |

Payload, response, validasi detail, MIME, dan contoh penggunaan tersedia pada dokumen API per STEP di folder ini. Daftar ini adalah inventaris route final dan matriks akses release gate; route yang tidak tercantum dianggap bukan kontrak API backend.
