# Mapping XLSX — API — Database

Snapshot implementasi: 8 September 2026. Kolom API dan database di bawah menggambarkan backend setelah release gate STEP 11.

## 1. Legenda

| Status | Arti |
|---|---|
| Sesuai | Konsep target tersedia dan semantiknya cukup sepadan. |
| Parsial | Ada tempat penyimpanan/API, tetapi domain, kewajiban, atau granularitas berbeda. |
| Tidak ada | Konsep target belum direpresentasikan. |
| Konflik | Implementasi menyatakan perilaku yang bertentangan dengan sumber utama. |
| Menunggu keputusan | Mapping tidak dapat dipastikan dari sumber dan tidak boleh ditebak. |

Alur API yang diaudit menggunakan prefix `/api/v1`; tabel menuliskan path setelah prefix.

## 2. Mapping field wajib shipment/voyage

| Label sumber | Kandidat konsep target | API saat ini | Database saat ini | Status dan gap |
|---|---|---|---|---|
| Nama Kapal | Referensi vessel | `POST /shipments` dan `/voyages`: `vesselId` wajib dan harus aktif | `SealingReport.vesselId` → `Vessel.id/name` | Sesuai untuk transaksi; snapshot spesifikasi ke laporan historis belum ditentukan. |
| Activity | Referensi master aktivitas | `activityId` wajib, aktif, dan berkode `LOADING`, `DISCHARGE`, atau `ROB` | `SealingReport.activityId` → `Activity.id` | Sesuai. `operationType` lama dipertahankan nullable hanya untuk laporan legacy. |
| Tanggal | Tanggal voyage/shipment | `reportDateTime` wajib, ISO date-time | `SealingReport.reportDateTime` `Timestamptz(3)` | Parsial: implementasi mewajibkan waktu; sumber hanya menulis Tanggal. |
| Voyage Number | Nomor voyage | `voyageNumber` wajib | `SealingReport.voyageNumber` varchar nullable hanya untuk histori | Sesuai; tidak dibuat unik karena sumber tidak memerintahkannya. |
| Shipoment Number | Nomor shipment | `shipmentNumber` wajib | `SealingReport.shipmentNumber` unique; nullable hanya untuk histori | Sesuai; dinormalisasi uppercase dan tidak dipetakan ke `reportNo`. |
| Produk | Referensi master produk | `productId` wajib dan aktif | `SealingReport.productId` → `Product.id` | Sesuai. UoM tetap di luar shipment karena sumber belum menetapkan relasinya. |
| Loading Port | Referensi plant loading | `loadingPlantId` wajib dan aktif | `SealingReport.loadingPlantId` → `Plant.id` | Sesuai dengan istilah implementasi Plant; Terminal lama tetap terpisah. |
| Jetty Name Loading Port | Referensi jetty loading | `loadingJettyId` wajib, aktif, dan harus di-assign ke loading Plant | `SealingReport.loadingJettyId` → `Jetty.id`; validasi melalui `PlantJettyAssignment` | Sesuai setelah assignment aktual dikonfigurasi. |
| Discharge Port | Referensi plant discharge | `dischargePlantId` wajib dan aktif | `SealingReport.dischargePlantId` → `Plant.id` | Sesuai dengan istilah implementasi Plant; Terminal lama tetap terpisah. |
| Jetty Name Discharge Port | Referensi jetty discharge | `dischargeJettyId` wajib, aktif, dan harus di-assign ke discharge Plant | `SealingReport.dischargeJettyId` → `Jetty.id`; validasi melalui `PlantJettyAssignment` | Sesuai setelah assignment aktual dikonfigurasi. |
| Status Sealing | Status sealing | `sealingStatus` wajib, non-kosong, maksimal 50 karakter | `SealingReport.sealingStatus` varchar; terpisah dari `status` | Struktur sesuai; domain nilai tetap menunggu sumber dan tidak dijadikan enum tebakan. |

Field implementasi tambahan yang tidak muncul pada daftar wajib sumber:

| API | Database | Catatan |
|---|---|---|
| `reportNo` dibuat otomatis | `SealingReport.reportNo`, unik | Nomor teknis/legacy terpisah; tidak disamakan dengan Voyage/Shipment Number. |
| `unloadingMasterId` opsional | FK nullable ke `User` | Kebutuhan workflow implementasi, tidak disebut dalam sheet shipment. |
| `loadingMasterSurveyorName` opsional | varchar nullable | Kandidat narasi form, tetapi sumber belum menjelaskan pihak/aturan pengisian. |
| `portName` opsional | varchar nullable | Berpotensi menduplikasi port/terminal; semantic belum pasti. |
| `remarks` opsional | text nullable | Catatan internal, tidak konflik dengan sumber. |

## 3. Mapping header sealing report

| Elemen Excel utama | API saat ini | Database | Status |
|---|---|---|---|
| `Vessel Name` | `vesselId` | relasi `SealingReport.vessel` | Sesuai. |
| `Terminal` | `originTerminalId`; ada `destinationTerminalId` | dua relasi `Terminal` | Parsial: header tunggal tidak menentukan terminal asal/tujuan mana yang dicetak. |
| `Cargo` | `productId` pada shipment canonical; `cargo` hanya legacy | `SealingReport.product` dan kolom `cargo` legacy | Sesuai untuk transaksi baru; aturan snapshot nama produk pada output belum diputuskan. |
| `Date/Time` | `reportDateTime` | `Timestamptz(3)` | Sesuai secara teknis; format/timezone output belum diputuskan. |
| `We Loading Master/Surveyor ...` | `loadingMasterSurveyorName` | field dengan nama sama | Parsial; sumber/role pengisi belum pasti. |
| `at the port of ...` | `portName` | `SealingReport.portName` | Parsial; tumpang tindih dengan terminal/port master. |
| Jenis kegiatan pada narasi | `activityId` pada shipment canonical; `operationType` hanya legacy | FK `Activity`; enum lama nullable | Sesuai untuk transaksi baru; renderer narasi belum tersedia. |
| Chief Officer | endpoint signature, role `CHIEF_OFFICER` | `ReportSignature` | Sesuai untuk satu signature per role. |
| Terminal Representative | endpoint signature, role `TERMINAL_REPRESENTATIVE` | `ReportSignature` | Sesuai untuk satu signature per role. |
| Surveyor | endpoint signature, role `SURVEYOR` | `ReportSignature` | Sesuai untuk satu signature per role. |

## 4. Mapping form A–H

Model generik yang tersedia saat ini:

`SealingCategory` → `SealingPointTemplate` → `VesselSealingPoint` → `SealingRecord` → satu atau lebih `Seal`.

STEP 5 memakai rantai ini untuk membaca seluruh point aktual pada section A–H yang tersedia di `VesselFormProfile`. `prepare-seals` tidak lagi membuat kategori/template/point `SYSC` dan tidak lagi memilih hanya satu point per compartment. Konfigurasi dibekukan pada `SealingReport.formConfigurationSnapshot` serta `SealingRecord.pointSnapshot`. STEP 6 membaca snapshot tersebut sebagai struktur row/column dan menyediakan transaksi status, catatan, serta beberapa nomor segel per titik melalui API form.

| Bagian | Bentuk target Excel utama | Seed/template saat ini | Perilaku voyage/frontend saat ini | Status |
|---|---|---|---|---|
| A | Per compartment, 5 kolom nomor segel setelah kolom compartment | 5 template canonical; `A-02` memakai kolom gabungan `Tank Cleaning Access DOT/Deck Seal`; `A-03` lama dipertahankan sebagai legacy urutan 99 | Seluruh point aktual A per compartment disiapkan; beberapa point dalam satu compartment didukung | Sesuai secara taxonomy canonical; jumlah instance aktual tetap konfigurasi vessel. |
| B | 5 baris × Port/Stbd | 1 template `B-01`, `supportsSide=true` | Seluruh instance/side aktual disiapkan bila section tersedia | Parsial pada granularitas template. |
| C | 3 slot FPT, 3 APT, 8 pasangan WBT P/S | Template canonical `C-02` FPT, `C-03` APT, `C-04` WBT P, `C-05` WBT S; `C-01` generik tetap legacy urutan 99 | Point aktual disiapkan dan di-snapshot | Sesuai secara taxonomy; jumlah instance aktual berasal dari konfigurasi vessel. |
| D | 8 baris × Suction, Stripping, Dropline, Cross Over, Gate & Drain | Lima template canonical berurutan: `D-03`, `D-04`, `D-05`, `D-02`, `D-06`; `D-01` berkelompok tetap legacy urutan 99 | Point aktual disiapkan dan di-snapshot | Sesuai secara taxonomy; jumlah row aktual berasal dari konfigurasi vessel. |
| E | 3 baris × Tank Cleaning Valve/COW Valve | 2 template | Point aktual disiapkan bila section tersedia | Parsial pada metadata slot. |
| F | 3 baris: compartment bunker + sounding/flange + deck seal | 2 template, keduanya `requiresCompartment=true` | Seluruh point aktual per compartment disiapkan | Parsial pada layout/slot. |
| G | 14 equipment, masing-masing 3 slot nomor segel | 14 template dengan urutan yang sepadan | Disiapkan hanya bila section G tersedia; vessel tanpa G menghasilkan nol record G | Snapshot sesuai; metadata jumlah slot belum ada. |
| H | Sampling Bottle 2 slot; Measurement Tool Box 1; Pintu Pumproom 1; Portable Pump 1 | 4 template; `H-03` = `Pintu Pumproom` mengikuti XLSX utama dan contoh Queen Sofia | Point aktual disiapkan bila section tersedia | Sesuai secara taxonomy; banyak nomor per equipment ditampung relasi one-to-many `Seal`. |

### 4.1 Mapping cell logis ke record database

Mapping yang dapat digunakan sebagai arah target, tetapi belum diimplementasikan lengkap:

| Dimensi cell laporan | Tempat saat ini | Catatan audit |
|---|---|---|
| Kategori A–H | `SealingCategory.code` + `VesselFormSection` | Seed A–H ada; `SYSC` tidak lagi dibuat runtime dan hanya dipertahankan sebagai legacy. |
| Jenis kolom/equipment | `SealingPointTemplate` | Template canonical satu-ke-satu dengan taxonomy Excel utama; template lama A-03/C-01/D-01 tetap tersedia sebagai legacy dan tidak dipakai sebagai default canonical. |
| Konfigurasi aktual vessel | `VesselSealingPoint` | Mendukung compartment, side, location, instance, sequence, availability; fondasi dinamis tersedia. |
| Satu titik pada satu voyage | `SealingRecord` | Unique per report + vessel sealing point; `pointSnapshot` menyimpan label/config saat inisialisasi dan status awal `NOT_SEALED`. |
| Nomor segel | `Seal.sealNumber` | Backend form STEP 6 mendukung banyak nomor per record, batch per section, dan unik global; frontend voyage belum memakai API tersebut. |
| Kondisi saat unloading | `SealVerification` | Tersedia; bukan bagian layout form sumber tetapi mendukung workflow pemeriksaan. |
| Foto/dokumen | `Attachment` | STEP 8 mendukung owner report, section A–H, record, atau verification; caption, sequence, konteks compartment/titik, metadata MIME/ukuran/SHA-256, preview, dan download. `description` dipertahankan sebagai alias legacy. |

`formConfigurationSnapshot` adalah sumber historis konfigurasi form. Relasi master tetap tersedia untuk operasi, tetapi renderer laporan mendatang harus memprioritaskan snapshot agar perubahan master tidak mengubah laporan lama.

## 5. Mapping master seed

| Grup sumber | API/model saat ini | Cakupan seed saat ini | Status |
|---|---|---|---|
| Kode Plant + Nama Plant Lokasi | CRUD `/plants`, model `Plant` | Seluruh 6 baris, termasuk kode literal `1S45` | Sesuai untuk master. Pair Jetty dikelola terpisah melalui assignment tanpa backfill seed. |
| Vessel | CRUD `/vessels`, model `Vessel` | Seluruh 5 vessel sheet; seed legacy Queen Sofia tetap dipertahankan | Sesuai untuk baris sumber, dengan data legacy tidak dihapus. |
| Tipe Kapal (`MT`, `OB`) | enum menerima literal `MT` dan `OB` di samping nilai legacy | Kelima vessel memakai literal sumber | Sesuai tanpa mengarang ekuivalensi ke `TANKER`/`BARGE`. |
| Produk per vessel | `Vessel.productGroup` nullable | `LPG`, `BBM`, `AVTUR` sesuai setiap baris vessel | Sesuai untuk nilai sumber; nomenklatur “kelompok produk” belum dinyatakan sebagai FK. |
| Pemilik Kapan | `Vessel.owner` nullable | Kedua nama pemilik disemai sesuai workbook | Sesuai; typo header sumber tidak dikoreksi pada data. |
| DWT Kapal | `Vessel.deadweightTonnage` decimal nullable | Tetap null karena seluruh cell sumber kosong | Sesuai; presisi/satuan belum ditetapkan sumber. |
| Kapasitas | `Vessel.capacity` decimal nullable | Tetap null karena seluruh cell sumber kosong | Sesuai; satuan belum ditetapkan sumber. |
| Jumlah Tangki | `Vessel.tankCount` integer nullable, terpisah dari `Compartment` | Nilai 2/7 disemai sesuai baris | Sesuai sebagai atribut sumber; tidak dipakai untuk mengarang compartment. |
| Drawing Kapal | `Vessel.drawingStatus`, enum `YES/NO` | Kelima nilai YES/NO disemai | Sesuai. |
| File/link Drawing Kapal | `Vessel.drawingFileUrl` dan `drawingLink`, keduanya nullable | Tetap null karena seluruh cell link sumber kosong | Sesuai tanpa nilai default buatan. |
| Aktivitas | CRUD `/activities`, model `Activity` | `LOADING`, `DISCHARGE`, `ROB` | Sesuai untuk master; enum transaksi belum diselaraskan. |
| Produk | CRUD `/products`, model `Product` | Seluruh 8 produk | Sesuai untuk master. |
| Unit of Measure | CRUD `/units-of-measure`, model `UnitOfMeasure` | `KL`, `MT`, `BBRL` | Sesuai sebagai master mandiri; relasi ke produk tidak dibuat. |
| Jetty Name | CRUD `/jetties`, model `Jetty` | Seluruh 5 jetty | Sesuai untuk master; tidak ada FK Plant-Jetty. |
| Terminal legacy | Model/API `Terminal` lama tetap tersedia | Seed `STS-TABONEO` lama tetap idempoten | Dipertahankan untuk kompatibilitas; tidak dikonversi menjadi Plant/Jetty tanpa sumber mapping. |

Seed tetap menyemai kategori A–H, terminal legacy, serta contoh Queen Sofia dari implementasi terdahulu untuk kompatibilitas. Penambahan master sheet tidak menghapus atau menimpa data tersebut. Seed workbook menggunakan unique key untuk master dan pencarian nama vessel case-insensitive sehingga dapat dijalankan berulang; field sumber yang kosong tidak ditulis ke vessel lama.

## 6. Mapping konfigurasi vessel dinamis

| Kebutuhan target | API saat ini | Database saat ini | Audit |
|---|---|---|---|
| Membuat vessel dengan compartment | `POST /vessels`, minimal 1 `compartments[]` | nested create `Vessel` + `Compartment` | Tersedia. |
| Menyimpan spesifikasi vessel | Create/update `/vessels` menerima tipe, kelompok produk, pemilik, DWT, kapasitas, jumlah tangki, status/file/link drawing | Kolom nullable additive pada `Vessel` | Tersedia; nullable menjaga kompatibilitas data lama. |
| Mengubah daftar compartment setelah create | CRUD `/compartments` terpisah | `Compartment` | Tersedia per item; bukan payload konfigurasi atomik. |
| Menentukan titik A–H per vessel | CRUD `/vessel-sealing-points` | `VesselSealingPoint` | Tersedia. API mewajibkan compartment untuk template yang memerlukannya dan menolak side pada template yang tidak mendukung side; template non-compartment masih dapat diberi compartment. |
| Filter compartment berdasarkan vessel di UI point | Frontend memuat `/compartments?limit=100&isActive=true` tanpa ketergantungan vessel | Relasi DB benar | Parsial: UI memungkinkan memilih compartment vessel lain, lalu API menolak. |
| Membuat voyage dari snapshot konfigurasi | `prepare-seals` pada `/shipments`, `/voyages`, dan `/reports` | Membaca versi/profile/section/compartment/point aktual, membekukan JSON, lalu membuat record `NOT_SEALED` | Tersedia dan idempotent. |
| Menampilkan seluruh A–H | Workspace hanya memfilter record dengan `compartment.id` | Model mendukung non-compartment point | Konflik: B–H yang tidak memakai compartment tidak terlihat. |
| Beberapa nomor per titik | Endpoint `POST /records/:recordId/seals` mendukung tambah berulang | relasi one-to-many | Parsial: UI `activeSeal()` dan tabel hanya satu input aktif. |

## 7. Mapping output XLSX/PDF

| Kebutuhan | Endpoint/layanan saat ini | Status |
|---|---|---|
| Ekspor XLSX tiga panel sesuai Excel utama | `POST /reports|voyages|shipments/:reportId/xlsx` memakai template immutable dan `finalSnapshot` | Tersedia pada STEP 9. |
| Ekspor PDF tiga halaman | `POST /reports|voyages|shipments/:reportId/pdf` memakai background PDF TKO immutable dan `finalSnapshot` | Tersedia pada STEP 10; overflow memakai set 3 halaman continuation. |
| Menyertakan tanda tangan pada posisi layout | Nama/waktu dan citra JPEG/PNG/WebP dirender ke tiga kotak resmi; PDF/URL ditulis sebagai referensi | Tersedia pada XLSX. |
| Contact sheet foto 3 × 3 dengan caption dan sequence | Appendix PDF mengumpulkan foto report/section/record/verification dari snapshot, lalu mengurutkan sequence/createdAt/ID | Tersedia; JPEG/PNG/WebP dirender, dokumen PDF tidak diperlakukan sebagai foto. |
| Preview/download lampiran asli | `GET /attachments/:id/preview` dan `/download`; `/file` tetap alias preview | Tersedia, tetapi bukan ekspor laporan. |
| Preview/download XLSX | `GET /reports|voyages|shipments/:reportId/xlsx/preview|download` | Tersedia setelah generate. |
| Preview/download PDF final | `GET /reports|voyages|shipments/:reportId/pdf/preview|download` | Membaca `PdfArtifact` immutable dan memverifikasi checksum sebelum mengirim. |
| Print structure A4 | Margin, portrait, page break, printer settings, ukuran kolom/baris dipertahankan; template sumber tidak memiliki defined print area | Sesuai sumber, tanpa menebak scaling. |
| Overflow | Worksheet `Segel Lanjutan N`, setiap sheet klon template resmi dengan chunk row/kolom | Tersedia dan diuji. |

PDF memakai PDF referensi tambahan sebagai sumber geometry tiga halaman. Hal ini tidak mengubah hierarki data: nilai dan struktur dinamis tetap berasal dari `finalSnapshot`, sedangkan PDF referensi hanya menjadi latar layout A4. `PdfArtifact` menyimpan checksum snapshot/template/hasil dan unique per laporan agar unduhan ulang identik.

## 8. Endpoint transaksi yang tersedia pada working tree

`/shipments` dan `/voyages` adalah endpoint canonical untuk field shipment wajib. `/reports` tetap tersedia sebagai endpoint legacy agar integrasi dan laporan lama tidak terputus. Lifecycle saat ini:

`DRAFT` → `BERLAYAR` → `SANDAR` → `FINISH`.

`SealingReport.status` menyimpan lifecycle tersebut, sedangkan `SealingReport.sealingStatus` menyimpan nilai sumber yang terpisah. STEP 7 menambahkan `sealingProcessStatus` server-managed (`NOT_STARTED`, `IN_PROGRESS`, `READY`, `IN_TRANSIT`, `VERIFICATION`, `FINALIZED`) dan `finalSnapshot`. Domain nilai `sealingStatus` sumber tetap berupa string karena sumber tidak menyediakan enum.

Validasi depart hanya mewajibkan nomor segel untuk point snapshot yang tersedia dan `isRequired=true`; point required berstatus `NOT_APPLICABLE`, point opsional, dan section tidak tersedia tidak memblokir. Finalisasi memerlukan verification untuk nomor aktif, tetapi tidak mewajibkan dokumentasi/attachment.

## 9. Mapping yang ditahan sampai konfirmasi

Mapping berikut sengaja tidak dibuat:

- domain nilai `sealingStatus`;
- `reportNo` ↔ Voyage Number atau Shipment Number; implementasi mempertahankannya terpisah;
- `Terminal` ↔ Plant, Port, atau Jetty;
- snapshot nama/atribut master pada laporan historis;
- pasangan aktual Plant–Jetty dari workbook; assignment wajib dikonfigurasi eksplisit dan tidak di-seed dengan tebakan;
- ekuivalensi literal vessel `MT`/`OB` ↔ tipe legacy `TANKER`/`BARGE`;
- apakah `Wilden Pump` perlu menjadi equipment tambahan/alias; baseline `H-03` sudah memakai `Pintu Pumproom` sesuai dua sumber yang lebih kuat;
- `Jumlah Tangki` ↔ jumlah compartment;
- UoM sebagai atribut produk atau transaksi;
- nilai kosong master ↔ nilai default.

Setiap mapping tersebut memerlukan keputusan pemilik produk atau sumber baru yang otoritasnya ditetapkan.
