# Implementation Progress dan Audit Kesenjangan

Snapshot: 8 September 2026 (Asia/Jakarta), branch backend `develop`, HEAD `26f9ed5cf11e9911b27bdaf7069c7df2ccd83251`.

Status release gate backend: **BACKEND_CLEAR**.

Status ini hanya berlaku untuk backend STEP 1–11 terhadap kebutuhan yang dapat dipastikan dari sumber. Semua kebutuhan sumber sudah dipetakan; keputusan yang datanya belum tersedia tetap dicatat eksplisit sebagai `Menunggu keputusan` dan tidak diisi dengan asumsi. Bagian historis di bawah merekam progres per STEP; bagian 17 adalah hasil audit final yang mengatasi temuan lama.

## 1. Ringkasan hasil

Backend master, vessel dinamis, shipment/voyage, snapshot dan input A–H, lifecycle, attachment, signature, XLSX, PDF, RBAC, serta audit log sudah tersedia dan melewati release gate. XLSX memakai template utama immutable; PDF final deterministik tersimpan dengan checksum dan appendix foto opsional. Frontend voyage berada di luar lingkup STEP 11 dan statusnya tidak memengaruhi `BACKEND_CLEAR`.

Dokumen baseline yang menjadi rujukan:

- [SPEC_SUMBER_TKO.md](./SPEC_SUMBER_TKO.md)
- [MAPPING_XLSX_API_DB.md](./MAPPING_XLSX_API_DB.md)
- [INVENTARIS_SUMBER.md](./INVENTARIS_SUMBER.md)

## 2. Status Git sebelum pekerjaan dokumentasi

Root folder `Prisma` bukan repository Git. Repository yang ditemukan adalah `backed-kapal/.git`. Status awal backend:

### Modified, sudah ada sebelum audit ini

| File | Ringkasan perubahan yang diaudit |
|---|---|
| `dokumentasi/Dokumentasi_Backend_Kapal.txt` | Memperbarui tanggal verifikasi, role Loading/Unloading Master, workflow voyage, endpoint lifecycle, aturan attachment, serta klaim hasil test/migration. |
| `src/controllers/transaction.controller.ts` | Menambahkan actor-scoped list/detail/record dan controller `prepareReportSeals`. |
| `src/routes/attachment.routes.ts` | Menambahkan alias upload attachment melalui `/voyages/:reportId/attachments`. |
| `src/routes/transaction.routes.ts` | Menambahkan alias `/voyages`, endpoint prepare-seals, dan record voyage. |
| `src/schemas/transaction.schema.ts` | Menambahkan schema prepare-seals dan filter audit `DEPART/ARRIVE/FINISH`. |
| `src/services/attachment.service.ts` | Membatasi penghapusan attachment berdasarkan status voyage. |
| `src/services/transaction.service.ts` | Menambah pembatasan akses role, validasi destination, prepare satu record per compartment, serta pembatasan satu record ber-compartment per voyage. |

### Untracked, sudah ada sebelum audit ini

| File/direktori | Ringkasan yang diaudit |
|---|---|
| `dokumentasi/Dokumentasi_Backend_Kapal.docx` | Dokumen backend biner; dipertahankan dan tidak ditimpa. |
| `prisma/migrations/20260906090000_align_voyage_business_flow/` | Migration role/workflow `DRAFT → BERLAYAR → SANDAR → FINISH`, destination/unloading master, dan timestamp lifecycle. |
| `tests/voyage-seal-preparation.integration.test.ts` | Test untuk tepat satu record per compartment, idempotensi prepare, dan larangan depart sebelum semua record berstatus SEALED mempunyai seal aktif. |

Seluruh perubahan di atas diperlakukan sebagai milik pengguna. Tidak ada yang dihapus, di-revert, diformat ulang, atau ditimpa oleh pekerjaan dokumentasi ini.

Frontend `front-end-kapal` berada di luar repository Git backend dan tidak memiliki `.git` yang ditemukan dalam audit workspace, sehingga status perubahannya tidak dapat dibandingkan terhadap commit. State file saat ini tetap dibaca untuk audit.

## 3. Progress per kapabilitas

| Area | Sudah tersedia | Belum sesuai target | Status |
|---|---|---|---|
| Sumber kebenaran | Empat sumber sudah diinventaris dan di-checksum | Perlu konfirmasi keputusan ambigu | Dokumentasi selesai |
| Shipment/voyage | Field wajib, assignment, status perjalanan/proses terpisah, validasi, lifecycle, final snapshot, locking, dan audit | Domain nilai `sealingStatus` sumber serta workflow revisi belum disahkan | Backend STEP 4 dan STEP 7 selesai |
| Vessel | CRUD vessel dan compartment; konfigurasi point dinamis; seluruh spesifikasi; versioned form profile dan snapshot laporan | Arti operasional jumlah tangki tetap menunggu sumber | Backend selesai |
| Form A–H master | Kategori A–H dan template canonical sesuai taxonomy XLSX; point vessel mempunyai availability, side, instance, sequence, dan `isRequired`; template lama dipertahankan sebagai legacy | Jumlah slot statis vs dinamis tetap keputusan produk; multiple seal sudah didukung | Backend selesai |
| Form voyage aktif | Backend menginisialisasi snapshot, mengembalikan grouping section/row/column, dan menyediakan write satu titik serta batch section | Frontend voyage belum merender atau mengisi matriks A–H | Backend STEP 5–6 selesai; frontend belum |
| Nomor seal | CRUD legacy dan API form snapshot mendukung beberapa seal per record, status, catatan, reset, batch, validasi, serta audit | Frontend belum memakai API form; aturan format/prefix belum dipastikan sumber | Backend STEP 6 selesai; frontend belum |
| Pemeriksaan tujuan | Verification, validasi finalisasi, final snapshot, serta workflow SANDAR/FINISH | Domain `sealingStatus` sumber belum ditetapkan | Backend STEP 7 selesai |
| Lampiran | Empat format, owner report/section/record/verification, caption, sequence, konteks A–H/compartment/titik, metadata/checksum, preview/download, authorization, cleanup, audit, final lock, dan appendix foto PDF | Dokumen non-foto tidak digabung karena sumber tidak memerintahkannya | Backend selesai |
| Tanda tangan | Tiga role unik per laporan, nama/waktu, file terkelola, preview/download, authorization, audit, final snapshot, final lock, dan render XLSX/PDF | Kewajiban per tahap tetap menunggu keputusan sumber | Backend selesai |
| Master seed | Kategori/template dan data legacy tetap ada; seluruh 6 plant, 5 vessel, 3 activity, 8 product, 3 UoM, dan 5 jetty dari sheet disemai idempoten | Tidak ada gap untuk cakupan master sheet kedua | Selesai untuk lingkup ini |
| XLSX export | Template immutable, mapping A–H/header/signature, continuation page, preview/download, checksum, audit, fixture Queen Sofia | Tidak ada gap backend yang bersumber | Selesai |
| PDF export | A4 deterministik, tiga halaman form, continuation, appendix foto, artefak immutable/checksum, preview/download, fixture visual Queen Sofia | Tidak ada gap backend yang bersumber | Selesai |
| Audit log | Transaksi, lifecycle, seal, attachment, signature, export, seluruh master/user/Terminal/configuration vessel | Read-only request tidak dicatat sebagai mutasi | Selesai |

## 4. Temuan audit prioritas

### Selesai backend STEP 5 — inisialisasi transaksi A–H

`prepareReportSeals` sekarang membaca `FormTkoVersion`, `VesselFormProfile`, section A–H tersedia, compartment aktif, dan seluruh point aktual `AVAILABLE`. Service membekukan konfigurasi pada report/record, membuat status awal `NOT_SEALED`, mendukung beberapa point dalam satu compartment, serta tidak lagi membuat `SYS-COMPARTMENT`. Record legacy tetap dipertahankan.

Backend menyimpan bentuk berikut secara dinamis; rendering/input pada frontend voyage berada di luar release gate ini:

- lima jenis seal per compartment pada A;
- bagian B–H yang banyak tidak berhubungan dengan compartment;
- lima kolom D;
- tiga slot untuk masing-masing dari 14 equipment G;
- slot berbeda pada H.

### Selesai — field wajib shipment STEP 4

Endpoint canonical `/shipments` dan `/voyages` mewajibkan Vessel, Activity, tanggal (`reportDateTime`), Voyage Number, Shipment Number, Product, loading Plant/Jetty, discharge Plant/Jetty, dan Status Sealing. Activity hanya menerima master aktif berkode `LOADING`, `DISCHARGE`, atau `ROB`; seluruh referensi master harus aktif; dan pasangan Jetty harus mempunyai `PlantJettyAssignment`. `shipmentNumber` unik dan status sealing tersimpan terpisah dari `ReportStatus` perjalanan.

### Selesai — master database dan seed sheet kedua

Migration `20260907190000_add_reference_masters` menambahkan model mandiri `Plant`, `Jetty`, `Activity`, `Product`, dan `UnitOfMeasure`, serta kolom spesifikasi nullable pada `Vessel`. Seed memuat seluruh nilai non-kosong sheet `acuan seed` dan dapat dijalankan berulang tanpa duplikasi. Data legacy `Terminal`, nilai enum vessel lama, dan Queen Sofia tetap dipertahankan.

Keputusan konservatif yang diterapkan:

- pada tahap seed awal `Plant` tidak diberi pasangan `Jetty`; STEP 4 kemudian menambahkan assignment eksplisit tanpa backfill tebakan;
- `Product` tidak mempunyai relasi ke `UnitOfMeasure`;
- literal tipe vessel `MT` dan `OB` ditambahkan tanpa mengubah nilai lama menjadi `TANKER`/`BARGE`;
- `tankCount` tidak otomatis membentuk `Compartment`;
- cell DWT, kapasitas, dan link drawing yang kosong tetap null serta tidak menimpa nilai lama saat reseed.

### Selesai STEP 11 — taxonomy canonical A–H

- A memakai lima template canonical dengan `A-02` sebagai kolom gabungan `Tank Cleaning Access DOT/Deck Seal`.
- C menyediakan FPT, APT, WBT P, dan WBT S sebagai template canonical terpisah.
- D menyediakan Suction, Stripping, Dropline, Cross Over, serta Gate & Drain sebagai lima template canonical.
- H-03 memakai `Pintu Pumproom` karena XLSX utama dan contoh Queen Sofia sepakat.
- Template A-03/C-01/D-01 lama dipindahkan ke urutan 99 dan diberi keterangan legacy; tidak dihapus agar konfigurasi/laporan lama tetap valid.
- Jumlah slot/seal direpresentasikan oleh `instanceNo` pada titik vessel dan relasi one-to-many `Seal`, bukan batas global yang ditebak dari ruang kosong template.

### Selesai backend STEP 5 — snapshot konfigurasi historis

`SealingReport.formConfigurationSnapshot` menyimpan versi form, profile, section, compartment, dan point saat inisialisasi. Setiap record baru menyimpan `pointSnapshot`. Pemanggilan ulang memakai snapshot pertama sehingga perubahan master tidak mengubah konfigurasi laporan lama. Renderer XLSX/PDF menggunakan snapshot tersebut.

### Selesai STEP 9–10 — ekspor laporan

XLSX dan PDF tersedia pada tiga alias resource, diuji terhadap fixture Queen Sofia, dan menggunakan snapshot final. Rincian implementasi ada pada bagian 15–16 dan daftar route final pada [API_ENDPOINTS_FINAL.md](./API_ENDPOINTS_FINAL.md).

### Selesai — masalah implementasi prepare-seals generik

Implementasi lama yang hanya memberi alias `tx = prisma`, memilih point pertama per compartment, dan membuat template runtime telah diganti transaksi snapshot dengan row lock serta upsert constraint report + vessel sealing point. Masalah lama berikut sudah dihilangkan dari runtime:

- pembuatan `SYSC` saat request transaksi;
- point code generik berbasis UUID compartment (`CMP-<UUID>`);
- validasi satu record per compartment di `createRecord`;
- status awal otomatis `SEALED` dari `prepare-seals`.

### Selesai — klaim verifikasi dokumentasi diperbarui

Hasil aktual release gate adalah 12 migration up-to-date dan 15 test lulus. Rincian final ada pada bagian 17.

## 5. Pekerjaan lanjutan di luar release gate backend

Urutan implementasi yang disarankan setelah konfirmasi, bukan bagian pekerjaan saat ini:

1. Sahkan domain nilai `sealingStatus` serta keputusan glossary yang masih ambigu.
2. Sahkan makna jumlah slot statis pada layout; backend tetap mendukung instance dan nomor segel dinamis.
3. Bangun frontend voyage yang membaca snapshot A–H tanpa mengubah snapshot historis.

Master database serta backend STEP 4–11 sudah selesai. Frontend berada di luar lingkup release gate ini.

## 6. Keputusan produk yang tetap terbuka dan tidak ditebak

Pemilik produk perlu mengonfirmasi:

1. Relasi bisnis akhir `reportNo`, Voyage Number, dan Shipment Number; STEP 4 mempertahankannya sebagai tiga konsep terpisah tanpa mengarang mapping.
2. Domain nilai `Status Sealing`; STEP 4 menyimpannya sebagai string wajib terpisah dari lifecycle perjalanan.
3. Mapping pasangan Plant–Jetty aktual; STEP 4 menyediakan assignment eksplisit tanpa seed tebakan.
4. Snapshot master pada shipment historis; STEP 4 masih memakai FK langsung.
5. Product/UoM: UoM tetap per produk atau dipilih per shipment; untuk sementara keduanya master mandiri tanpa FK.
6. Apakah literal tipe vessel `MT`/`OB` ekuivalen dengan nilai legacy tertentu; implementasi saat ini mempertahankan keduanya sebagai nilai enum tersendiri.
7. Arti `Jumlah Tangki` dan aturan membentuk compartment per vessel.
8. Apakah `Wilden Pump` perlu ditambahkan sebagai equipment atau alias terpisah; baseline H-03 tetap `Pintu Pumproom`.
9. Apakah slot Excel adalah batas tetap atau layout yang dapat bertambah/paginasi.
10. Kebijakan snapshot konfigurasi dan label pada laporan historis.
11. Aturan format/keunikan nomor segel dan prefix seperti `W.`.
12. Koreksi typo pada UI/output resmi.
13. Apakah PDF wajib menggabungkan semua foto dan aturan caption/pagination.
14. Field/tanda tangan mana yang wajib sebelum depart, finish, atau ekspor.

Rincian lebih lengkap ada pada bagian “Keputusan yang tidak boleh ditebak” di spesifikasi.

## 7. Implementasi master pada 7 September 2026

Perubahan dalam lingkup pekerjaan master:

- schema Prisma dan migration additive untuk lima master serta spesifikasi vessel;
- validasi Zod, service, controller, dan route CRUD `/api/v1/plants`, `/jetties`, `/activities`, `/products`, dan `/units-of-measure`;
- perluasan CRUD vessel untuk `MT`/`OB`, kelompok produk, pemilik, DWT, kapasitas, jumlah tangki, status drawing, file drawing, dan link drawing;
- seed workbook idempoten serta integration test baru `reference-master.integration.test.ts`;
- dokumentasi API dan mapping diperbarui.

Migration bersifat additive: tidak menghapus/mengganti tabel `Terminal`, tidak mengubah row vessel lama, dan semua kolom vessel baru nullable. Endpoint baca master tersedia bagi user terautentikasi; create/update/soft-delete hanya untuk `ADMIN`.

## 8. Verifikasi implementasi

Hasil verifikasi lokal:

- `npx prisma validate`: lulus;
- `npx prisma generate`: lulus;
- `npx prisma migrate deploy`: lulus, migration baru diterapkan;
- `npm run typecheck`: lulus;
- `npm run build`: lulus;
- `npm run prisma:seed` dua kali: lulus dan hasil tetap 6 plant, 3 activity, 8 product, 3 UoM, 5 jetty, serta tepat 5 vessel sumber;
- `npm test`: lulus, 7 test/7 pass/0 fail, termasuk test master baru dan regression suite lama.

Peringatan `pg` tentang pemanggilan `client.query()` ketika query lain masih berjalan tetap muncul pada test transaksi/voyage lama. Peringatan ini tidak berasal dari master baru dan tidak menyebabkan kegagalan test.

## 9. Implementasi frontend admin vessel pada 7 September 2026

Menu admin `Vessel` kini menggunakan wizard berikut:

1. identitas dan spesifikasi vessel;
2. daftar compartment aktual tanpa pola tetap 1P–7S;
3. pemilihan titik Bagian A untuk setiap compartment;
4. status tersedia/tidak tersedia untuk Bagian B–H;
5. konfigurasi template titik, compartment, side, instance, sequence, required, availability, label, dan lokasi;
6. preview serta aktivasi vessel.

Frontend memakai endpoint `/vessels`, `/compartments`, `/sealing-categories`, `/sealing-point-templates`, dan `/vessel-sealing-points` melalui proxy backend yang sudah ada. Seluruh halaman pagination dibaca agar konfigurasi dengan lebih dari 100 titik tidak terpotong. Tidak ada mock pada kode aplikasi; mock hanya digunakan di unit test untuk memeriksa urutan request penyimpanan.

Perlindungan konsistensi yang diterapkan:

- vessel baru dibuat nonaktif, konfigurasi disimpan, lalu status aktif diterapkan terakhir;
- compartment dapat ditambah/dihapus dinamis, dengan batas aktual API 1–100 dan tanpa digenerasi dari `tankCount`;
- penghapusan compartment juga menghapus titik terkait dari draft sebelum sinkronisasi;
- Bagian B–H yang tidak tersedia dipersist sebagai point `NOT_AVAILABLE`, sehingga contoh Bagian G nonaktif tidak hanya menjadi state lokal UI;
- `required` ditampilkan dari `SealingPointTemplate.requiresCompartment`, bukan dibuat sebagai atribut per-vessel yang tidak ada di API;
- kegagalan API menampilkan pesan, mempertahankan data yang sudah diterima server, dan memuat ulang konfigurasi server untuk kelanjutan aman.

Karena backend belum menyediakan endpoint batch/transaction untuk keseluruhan konfigurasi, edit vessel yang sudah ada masih dapat berhasil sebagian bila salah satu request lanjutan gagal. Safeguard nonaktif-sampai-selesai berlaku penuh untuk vessel baru; kebutuhan transaksi atomik untuk edit tetap gap backend.

Verifikasi frontend:

- `npm run lint`: lulus;
- `npm run typecheck`: lulus;
- `npm test`: 2 file, 7 test lulus;
- `npm run build`: lulus;
- route lokal `/`: HTTP 200;
- proxy frontend ke backend aktual: login 200 dan pembacaan vessel, kategori, serta template A–H semuanya 200.

Tidak ada perubahan pada shipment, workspace voyage, input nomor segel, export, backend schema, migration, service, controller, atau route dalam pekerjaan frontend ini.

## 10. Implementasi STEP 4 Shipment/Voyage Sealing pada 7 September 2026

Perubahan backend STEP 4:

- `SealingReport` tetap menjadi aggregate tunggal bagi Shipment, Voyage, dan laporan sealing agar seluruh laporan, record, attachment, signature, lifecycle, serta ID historis tidak dipindahkan atau dihapus;
- field additive `activityId`, `voyageNumber`, `shipmentNumber`, `productId`, loading/discharge Plant dan Jetty, serta `sealingStatus` ditambahkan;
- `shipmentNumber` unik dan dinormalisasi uppercase oleh API;
- create canonical `/shipments` dan `/voyages` mewajibkan seluruh sebelas field sheet pertama;
- Activity wajib aktif dan berkode `LOADING`, `DISCHARGE`, atau `ROB`; Vessel, Product, Plant, dan Jetty juga wajib aktif;
- `PlantJettyAssignment` many-to-many ditambahkan agar pasangan loading/discharge dapat divalidasi tanpa mengarang relasi dari workbook;
- migration tidak membuat assignment apa pun dan membuat kolom baru nullable hanya untuk menjaga laporan historis;
- `sealingStatus` terpisah dari `ReportStatus` perjalanan. Karena domain sumber belum tersedia, nilainya string wajib tervalidasi, bukan enum tebakan;
- create, update, dan delete shipment serta create/delete assignment menghasilkan audit log;
- `/reports` dipertahankan sebagai endpoint legacy, sedangkan kontrak baru didokumentasikan pada [API_SHIPMENT_VOYAGE.md](./API_SHIPMENT_VOYAGE.md).

Di luar lingkup dan tidak diubah: konfigurasi record A–H, attachment, signature, XLSX, PDF, dan frontend.

Verifikasi STEP 4:

- `npx prisma validate`: lulus;
- `npx prisma generate`: lulus;
- migration `20260907230000_add_shipment_voyage_sealing`: berhasil diterapkan pada database lokal;
- `npm run typecheck`: lulus;
- `npm test`: 8 integration test lulus, termasuk test baru `shipment-voyage.integration.test.ts`;
- peringatan deprecation concurrent `pg client.query()` yang sudah tercatat sebelumnya tetap muncul dan tidak menyebabkan test gagal.

## 11. Implementasi STEP 5 snapshot dan inisialisasi form A–H pada 7 September 2026

Perubahan backend STEP 5:

- menambahkan `FormTkoVersion`, `VesselFormProfile`, dan `VesselFormSection`;
- menambahkan versi awal `FORM-SEGEL-TKO-EDIT1` dari nama sumber utama tanpa menaikkan referensi PDF di atas workbook;
- profile section disinkronkan dari konfigurasi point aktif/`AVAILABLE` yang digunakan wizard vessel, tanpa membuat point baru;
- `prepare-seals` membaca Shipment, Vessel, versi form, profile, section A–H, compartment, serta seluruh point aktual;
- report menyimpan `formConfigurationSnapshot`, `formVersionId`, `vesselFormProfileId`, dan `formInitializedAt`;
- record menyimpan `pointSnapshot` dan diinisialisasi sebagai `NOT_SEALED`;
- pembatasan satu record per compartment dihapus; constraint unik report + vessel sealing point dipertahankan;
- section tidak tersedia tidak menghasilkan record;
- snapshot pertama digunakan kembali pada panggilan berikutnya dan dilindungi row lock/transaksi;
- kode runtime pembuat kategori/template/point `SYSC` dihapus, tetapi data dan record `SYS-COMPARTMENT` lama tidak dihapus;
- seed Queen Sofia kini mencakup `1P–7P`, `1S–7S`, `SLOP-P`, dan `SLOP-S`;
- endpoint dan struktur snapshot didokumentasikan pada [API_FORM_SNAPSHOT.md](./API_FORM_SNAPSHOT.md).

Integration test mencakup Queen Sofia 16 compartment dengan beberapa titik per compartment, vessel tiga compartment, vessel tanpa Bagian G, idempotensi, status awal `NOT_SEALED`, preservasi record `SYS-COMPARTMENT`, serta bukti bahwa perubahan master hanya memengaruhi report baru dan tidak mengubah report lama.

Di luar lingkup dan tidak diubah: input nomor seal, attachment, signature, XLSX, PDF, dan folder frontend.

Verifikasi STEP 5:

- `npx prisma validate`: lulus;
- `npx prisma generate`: lulus;
- migration `20260907233000_snapshot_vessel_form_configuration`: berhasil diterapkan dan `npx prisma migrate status` menyatakan database lokal sudah up to date;
- `npm run prisma:seed` dijalankan dua kali dan lulus secara idempotent;
- `npm run typecheck`: lulus;
- `npm run build`: lulus;
- `npm test`: seluruh 8 integration test lulus, termasuk `voyage-seal-preparation.integration.test.ts` untuk skenario snapshot STEP 5;
- `git diff --check`: lulus.

## 12. Implementasi STEP 6 transaksi pengisian nomor segel A–H pada 8 September 2026

Perubahan backend STEP 6:

- menambahkan GET struktur form yang mengelompokkan snapshot menjadi section, row, dan column serta mengembalikan compartment, side, instance, dan seluruh urutannya;
- menambahkan PUT satu titik, PATCH parsial, DELETE/reset input, dan PUT batch atomik satu section pada prefix `/shipments`, `/voyages`, serta `/reports`;
- menyimpan `SEALED`, `NOT_SEALED`, `NOT_APPLICABLE`, catatan, dan nol/satu/beberapa nomor segel per titik;
- menetapkan aturan `SEALED` wajib mempunyai nomor segel dan status lainnya tidak boleh mempunyai nomor;
- mempertahankan keunikan global nomor segel yang sudah ditegakkan schema, dengan normalisasi uppercase;
- memvalidasi membership snapshot, vessel snapshot, availability section, compartment, posisi unik, point batch unik, dan duplikasi nomor segel;
- mendukung lima point Bagian A pada satu compartment serta beberapa nomor segel pada satu equipment;
- section G yang tidak tersedia tetap dikembalikan dengan row kosong dan tidak dapat diisi;
- setiap mutation point menghasilkan audit `A_H_POINT_INPUT`, sedangkan batch juga menghasilkan `A_H_SECTION_INPUT`;
- default database dan schema untuk record baru diubah dari `SEALED` menjadi `NOT_SEALED` tanpa mengubah record lama.

Kontrak endpoint lengkap tersedia pada [API_FORM_A_H_ENTRY.md](./API_FORM_A_H_ENTRY.md).

Di luar lingkup dan tidak diubah: lifecycle/finalisasi, attachment, signature, XLSX, PDF, serta folder frontend.

Verifikasi STEP 6:

- `npx prisma validate`: lulus;
- `npx prisma generate`: lulus;
- migration `20260908003000_form_a_h_entry`: berhasil diterapkan;
- `npm run typecheck`: lulus;
- `npm run build`: lulus;
- `npm test`: seluruh 9 integration test lulus, termasuk `form-a-h-entry.integration.test.ts`;
- `git diff --check`: lulus.

Peringatan deprecation concurrent `pg client.query()` yang sudah ada tetap muncul pada test shipment dan transaksi legacy, tetapi seluruh test lulus dan test STEP 6 tidak memunculkan peringatan tersebut.

## 13. Implementasi STEP 7 validasi, sealing status, dan lifecycle pada 8 September 2026

Perubahan backend STEP 7:

- mempertahankan `sealingStatus` sumber sebagai string kompatibel dan menambahkan `sealingProcessStatus` server-managed;
- menambahkan assignment eksplisit `loadingMasterId`, sementara `createdById` tetap menjadi pembuat/audit owner;
- menambahkan `VesselSealingPoint.isRequired` dan membekukannya pada snapshot point;
- menerapkan validasi depart berdasarkan field/master aktif, Activity `LOADING`/`DISCHARGE`/`ROB`, Plant–Jetty, assignment, snapshot, dan point available+required;
- point `NOT_APPLICABLE`, point opsional, serta section tidak tersedia tidak memblokir depart/finalisasi;
- menambahkan endpoint read-only `/validation` dan endpoint `/finalize` sebagai alias bisnis finalisasi `/finish`;
- menerapkan transisi `DRAFT → BERLAYAR → SANDAR → FINISH` dengan status proses yang dikelola server;
- finalisasi memerlukan verification seluruh nomor segel aktif dan membuat `finalSnapshot` immutable;
- seluruh mutation transaksi terkunci setelah `FINISH` melalui validasi status service;
- dokumentasi/attachment/signature tetap opsional dan tidak menjadi gate;
- mekanisme revisi tidak dibuat karena spesifikasi belum menentukan workflow; response validasi menyatakan `revisionSupported=false`;
- lifecycle menghasilkan audit `DEPART`, `ARRIVE`, dan `FINALIZE`.

Kontrak lengkap tersedia pada [API_SHIPMENT_LIFECYCLE.md](./API_SHIPMENT_LIFECYCLE.md).

Di luar lingkup dan tidak diubah: attachment, generator laporan XLSX/PDF, dan folder frontend.

Verifikasi STEP 7:

- `npx prisma validate`: lulus;
- `npx prisma generate`: lulus;
- migration `20260908013000_shipment_sealing_lifecycle`: berhasil diterapkan;
- `npm run typecheck`: lulus;
- `npm run build`: lulus;
- `npm test`: seluruh 10 integration test lulus, termasuk `shipment-lifecycle.integration.test.ts`;
- `git diff --check`: lulus.

Peringatan deprecation concurrent `pg client.query()` masih muncul pada beberapa test yang menjalankan validasi referensi secara paralel. Peringatan tidak menyebabkan kegagalan dan bukan perubahan perilaku lifecycle.

## 14. Implementasi STEP 8 dokumentasi attachment dan tanda tangan pada 8 September 2026

Perubahan backend STEP 8:

- attachment menerima JPEG, PNG, WebP, dan PDF dengan pemeriksaan MIME serta signature bytes;
- owner eksplisit mendukung report, section A–H, sealing record, dan verification;
- menambahkan `caption`, `sequence`, konteks section/compartment/titik, SHA-256, ukuran, MIME, nama aman, serta tipe file;
- menambahkan endpoint list, update metadata, preview inline, download, dan delete pada prefix report/voyage/shipment;
- konteks record/verification diturunkan dari snapshot titik, sedangkan konteks report/section divalidasi terhadap snapshot laporan;
- ukuran maksimum dikendalikan `MAX_UPLOAD_SIZE_BYTES` dengan default 10 MiB;
- upload membersihkan file jika transaksi database/audit gagal; delete dan penggantian file memakai staging/rollback;
- akses file mengikuti assignment Loading/Unloading Master, dengan akses kelola untuk Admin/Supervisor dan baca untuk Viewer;
- tiga signature role `CHIEF_OFFICER`, `TERMINAL_REPRESENTATIVE`, dan `SURVEYOR` tetap unik per laporan;
- signature mendukung nama, waktu, user opsional, serta file JPEG/PNG/WebP/PDF dengan metadata dan checksum;
- seluruh perubahan attachment/signature ditolak setelah report `FINISH`;
- mutation memakai row lock report dan revalidasi status dalam transaksi agar tidak berlomba dengan finalisasi;
- metadata attachment dan signature dibekukan ke `finalSnapshot`, tetapi tetap opsional dan tidak menjadi lifecycle gate;
- kontrak lengkap tersedia pada [API_DOCUMENTATION_SIGNATURE.md](./API_DOCUMENTATION_SIGNATURE.md).

Migration `20260908120000_attachment_documentation_signatures` bersifat additive. Row attachment lama dipertahankan, `ownerType` dibackfill dari FK owner lama, `description` disalin ke `caption`, dan `signatureUrl` legacy tidak dihapus.

Di luar lingkup dan tidak diubah: generator XLSX/PDF, contact sheet, serta folder frontend.

Verifikasi STEP 8:

- `npx prisma validate` dan `npx prisma generate`: lulus;
- migration STEP 8 berhasil diterapkan; `npx prisma migrate status` menunjukkan 10 migration dan database up to date;
- `npm run typecheck` dan `npm run build`: lulus;
- `npm test`: seluruh 11 integration test lulus, termasuk `documentation-signature.integration.test.ts`;
- test mencakup empat MIME, empat owner, caption/sequence/context, preview/download/delete, authorization, batas ukuran, nama aman, cleanup rollback, tiga signature role, unique role, file signature, final snapshot, dan lock setelah finalisasi;
- `git diff --check`: lulus.

Peringatan deprecation concurrent `pg client.query()` yang sudah tercatat tetap muncul pada beberapa integration test dan tidak menyebabkan kegagalan.

## 15. Implementasi STEP 9 generator XLSX resmi pada 8 September 2026

Perubahan backend STEP 9:

- memakai `Form Segel Baru sesuai TKO (edit1).xlsx` secara langsung dan memverifikasi checksum SHA-256 sebelum generate;
- memakai manipulasi OOXML terarah setelah audit membuktikan round-trip library workbook menghapus printer settings/calc chain dan mengubah struktur part;
- membaca hanya `finalSnapshot` laporan `FINISH`, sehingga perubahan master/vessel setelah finalisasi tidak mengubah hasil lama;
- memetakan header Shipment, vessel, activity, tanggal zona `Asia/Jakarta`, voyage/shipment number, product, loading/discharge Plant dan Jetty, serta sealing status;
- memetakan section A-H, compartment/side/instance dinamis, beberapa nomor segel per titik, `NOT_APPLICABLE`, nama/waktu, dan citra tanda tangan;
- menjaga formula narasi dan calc chain; hanya cached value formula vessel yang diselaraskan;
- mempertahankan logo, styles, merge, lebar kolom, tinggi row, margin, orientasi, page break, dan binary printer settings;
- mempertahankan keadaan sumber yang tidak mempunyai defined print area, tanpa menebak scaling/print area baru;
- membuat continuation sebagai klon penuh template pada worksheet `Segel Lanjutan N`; overflow matriks memakai kombinasi chunk row/kolom;
- menambahkan generate, preview inline, dan download pada alias `/reports`, `/voyages`, dan `/shipments`;
- generate atomic pada filesystem, mempunyai checksum hasil, dan menghasilkan audit `XLSX_EXPORT`;
- menambahkan fixture golden Queen Sofia 1P–7P, 1S–7S, Slop Port/Starboard dan test cell, multiple seal, signature image, struktur workbook, serta continuation.

Kontrak lengkap tersedia pada [API_XLSX_EXPORT.md](./API_XLSX_EXPORT.md).

Tidak ada migration/schema database karena artefak XLSX diturunkan dari snapshot final dan metadata audit yang sudah tersedia. Di luar lingkup dan tidak diubah: PDF, attachment lifecycle, frontend, input sealing, dan konfigurasi vessel.

Verifikasi STEP 9:

- `npx prisma validate` dan `npx prisma generate`: lulus (schema tidak diubah pada STEP 9);
- `npm run typecheck`: lulus;
- `npm run build`: lulus;
- `npm test`: seluruh 12 integration test lulus, termasuk `xlsx-export.integration.test.ts`;
- fixture mengunci checksum template `d9a6e738b7551357099f2443207a11396ed2397baf1aeafb1cd4d0c616dae963`;
- test membandingkan merge, geometry row/column, margin, page setup, col break, logo, printer settings, styles, dan calc chain terhadap template;
- test continuation membuktikan worksheet tambahan memakai struktur, drawing, dan printer settings resmi yang sama;
- folder `front-end-kapal` tidak diubah.

## 16. Implementasi STEP 10 generator PDF dan appendix pada 8 September 2026

Perubahan backend STEP 10:

- memakai PDF referensi TKO tiga halaman sebagai background immutable dengan checksum terkunci;
- overlay deterministik dari `finalSnapshot` memakai Helvetica/Helvetica-Bold bawaan PDF, tanpa ketergantungan Office/browser/font host;
- mempertahankan A4 dan pemisahan halaman A, B-E, serta F-H/tanda tangan;
- memetakan header shipment/voyage, Plant-Jetty, A-H, multiple seal, `NOT_APPLICABLE`, nama, citra, dan waktu tanda tangan;
- memakai set tiga halaman resmi tambahan untuk overflow dan memberi label continuation;
- menambahkan appendix foto 3 × 3 setelah form, terurut sequence/createdAt/ID, dengan caption dan section;
- memverifikasi checksum template, signature, foto, dan artefak tersimpan;
- menambahkan model `PdfArtifact` satu-per-report dengan checksum hasil/snapshot/template, versi renderer, jumlah halaman, pembuat, dan waktu;
- generate bersifat idempotent; preview/download selalu membaca file final yang sama dan tidak merender ulang;
- menambahkan endpoint PDF pada alias report/voyage/shipment dan audit `PDF_EXPORT`;
- menambahkan fixture regresi visual Queen Sofia dan integration test determinisme, A4, jumlah/isi/anchor halaman, appendix, penyimpanan, otorisasi, serta kondisi gagal.

Migration additive `20260908170000_pdf_export_artifact` telah diterapkan tanpa mengubah laporan lama. Detail kontrak tersedia pada [API_PDF_EXPORT.md](./API_PDF_EXPORT.md).

Di luar lingkup dan tidak diubah: frontend, input voyage/segel, lifecycle attachment, dan generator XLSX.

Verifikasi STEP 10:

- `npx prisma validate` dan `npx prisma generate`: lulus;
- migration `20260908170000_pdf_export_artifact`: berhasil diterapkan; 11 migration dan database up to date;
- `npm run typecheck` dan `npm run build`: lulus;
- `npm test`: seluruh 13 integration test lulus, termasuk `pdf-export.integration.test.ts`;
- test PDF memeriksa dua render identik, tiga halaman form + dua appendix, seluruh halaman A4, isi seluruh A-H, section G tidak tersedia, logo, citra tanda tangan, sembilan foto per appendix, caption/sequence foto, anchor visual, metadata/checksum, preview/download byte-identik, idempotensi, audit, authorization, dan penolakan DRAFT;
- `git diff --check`: lulus;
- folder `front-end-kapal` tidak diubah.

Peringatan deprecation concurrent `pg client.query()` yang sudah tercatat tetap muncul pada beberapa test lama dan tidak menyebabkan kegagalan.

## 17. STEP 11 — audit akhir dan release gate backend

### Status

**BACKEND_CLEAR** pada 8 September 2026 (Asia/Jakarta).

Audit mencakup `SPEC_SUMBER_TKO.md`, `MAPPING_XLSX_API_DB.md`, keempat sumber XLSX/PDF beserta checksum, Shipment, vessel dinamis, konfigurasi dan transaksi A–H, lifecycle, attachment, signature, generator XLSX/PDF, RBAC, audit log, seluruh route, serta kondisi working tree. Semua kebutuhan yang dapat dipastikan dari sumber sudah mempunyai mapping backend. Keputusan tanpa data pasti tetap berada pada bagian 6 dan tidak menghalangi release gate karena tidak ada nilai/relasi yang dikarang.

Checksum sumber terverifikasi ulang dan sama dengan inventaris:

| Sumber | SHA-256 |
|---|---|
| `Form Segel Baru sesuai TKO (edit1).xlsx` | `d9a6e738b7551357099f2443207a11396ed2397baf1aeafb1cd4d0c616dae963` |
| `acuan seed dan list.xlsx` | `9126172619e6f6fc19eee38815c3636eb3cee6e277fb4720096aed0a6c1b19eb` |
| `contoh loading dari segel kapal.pdf` | `59b204361c2bd4580224295d08e90f230d3c8ae4992a08bff25280ba92038402` |
| `Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf` | `231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6` |

### Defect backend yang diperbaiki

- Menutup hak mutasi `SUPERVISOR` pada Terminal, sealing category, dan sealing-point template; semua mutasi master/configuration kini hanya `ADMIN`.
- Memperketat akses `UNLOADING_MASTER`: list, detail, form, attachment, signature, verification, export, dan transisi hanya untuk `unloadingMasterId` yang sama; shipment `BERLAYAR` tanpa assignment tidak lagi dapat diambil user operasional secara implisit.
- Menambahkan audit atomic untuk create/update/soft-delete seluruh Plant, Jetty, Activity, Product, UoM, Terminal legacy, User, Vessel, Compartment, category, template, serta titik aktual vessel. Password dan password hash tidak masuk audit payload.
- Menyinkronkan kembali `VesselFormProfile` ketika compartment, category, template, atau vessel sealing point berubah; point pada compartment nonaktif tidak lagi membuat section tampak tersedia.
- Menyelaraskan taxonomy canonical A/C/D/H dengan XLSX utama secara additive melalui migration `20260908210000_release_gate_source_alignment`; template legacy tidak dihapus dan snapshot laporan lama tidak diubah.
- Menambahkan alias record yang sebelumnya hilang: `GET/POST /shipments/:reportId/records`.
- Menambahkan test kontrak sumber, matriks RBAC seluruh master/configuration, audit master/user, serta visibilitas assignment operasional.

### Hasil release gate

| Pemeriksaan | Hasil |
|---|---|
| `npx prisma format` | Lulus |
| `npx prisma validate` | Lulus |
| `npx prisma generate` | Lulus, Prisma Client 7.10.0 |
| `npx prisma migrate status` | Lulus, 12 migration, database up-to-date |
| Seed dua kali | Lulus dan idempoten; kontrak sumber memverifikasi 6 Plant, 5 vessel sumber, 3 activity, 8 product, 3 UoM, 5 Jetty, dan taxonomy A–H canonical |
| `npm run typecheck` | Lulus |
| `npm run build` | Lulus |
| Lint | Tidak tersedia: `package.json` tidak memiliki script/dependency lint; `npm run lint --if-present` selesai tanpa menjalankan linter |
| `npm test` | Lulus: 15 test, 15 pass, 0 fail, 0 skipped/cancelled/todo; durasi final 22,63 detik |
| Security/authorization | Lulus: seluruh POST/PATCH/DELETE master dan konfigurasi menolak S/LM/UM/V; assignment LM/UM diuji pada list, detail, write, verification, lifecycle, attachment/signature, dan export |
| Fixture Queen Sofia XLSX | Lulus: checksum template, cell, merge, row/column geometry, margin, page setup, page break, logo, signature, printer settings, styles, calc chain, multiple seal, dan continuation |
| Fixture Queen Sofia PDF | Lulus: deterministik, A4, jumlah/isi/anchor halaman, A–H, section unavailable, logo, signature, appendix 3×3, caption/sequence, checksum, idempotensi, authorization |
| `git diff --check` | Lulus |

Peringatan deprecation dari adapter `pg` tentang concurrent `client.query()` masih muncul pada beberapa transaction test. Peringatan tidak menghasilkan test failure, tidak mengubah hasil transaksi, dan dicatat sebagai kompatibilitas dependency menuju `pg@9`, bukan defect requirement pada release gate ini.

### Endpoint final

Inventaris rinci dan matriks role tersedia di [API_ENDPOINTS_FINAL.md](./API_ENDPOINTS_FINAL.md). Daftar final yang diaudit:

- system/auth: `/`, `/api/v1/health`, `/api/v1/auth/login`, `/api/v1/auth/me`;
- user/master: `/api/v1/users`, `/terminals`, `/plants`, `/jetties`, `/activities`, `/products`, `/units-of-measure`, `/plant-jetty-assignments`;
- vessel/configuration: `/vessels`, `/compartments`, `/sealing-categories`, `/sealing-point-templates`, `/vessel-sealing-points`, termasuk tiga endpoint nested read;
- shipment aliases: `/reports`, `/voyages`, `/shipments` untuk list/create/detail/update/delete, `prepare-seals`, `validation`, `depart`, `arrive`, `finish`, dan `finalize`;
- A–H: `/{resource}/:reportId/form`, point PUT/PATCH/DELETE, serta batch section PUT;
- record/seal: `/{resource}/:reportId/records`, `/records/:id`, `/records/:recordId/seals`, `/seals/:id`, serta remove/replace/verify;
- dokumentasi: attachment report/section/record/verification, metadata, preview/download/file, dan delete;
- signature: signature report, detail/update/delete, file upload, preview, dan download;
- export: XLSX dan PDF generate/preview/download pada ketiga alias resource;
- audit: `/api/v1/audit-logs`.

Pemeriksaan route tidak menemukan endpoint backend yang belum tercantum pada inventaris final. Folder `front-end-kapal` tidak diubah pada STEP 11. Seluruh perubahan working tree yang sudah ada dipertahankan; tidak ada reset, revert, atau penghapusan data/source file.
