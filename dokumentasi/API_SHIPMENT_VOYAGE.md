# API Shipment/Voyage Sealing — STEP 4

Snapshot implementasi: 7 September 2026.

## 1. Keputusan model

`Shipment`, `Voyage`, dan header `SealingReport` memakai satu aggregate/model database, yaitu `SealingReport`. Pemisahan menjadi tabel shipment baru tidak dilakukan karena report lama beserta `SealingRecord`, attachment, signature, pembuat, penanggung jawab unloading, lifecycle perjalanan, dan audit sudah berelasi ke model tersebut. Menambahkan field shipment secara additive mempertahankan seluruh ID dan relasi laporan lama.

Konsekuensinya:

- `/shipments` dan `/voyages` adalah dua nama resource canonical untuk record yang sama;
- `status` adalah lifecycle perjalanan: `DRAFT`, `BERLAYAR`, `SANDAR`, atau `FINISH`;
- `sealingStatus` adalah label sealing tersendiri, opsional pada request dan diisi `READY` oleh server bila tidak dikirim; nilainya tidak mengubah `status` perjalanan;
- `sealingProcessStatus` adalah status proses internal yang dikelola server; detailnya ada pada [API_SHIPMENT_LIFECYCLE.md](./API_SHIPMENT_LIFECYCLE.md);
- `reportNo` tetap tersedia sebagai identitas teknis/legacy dan dibuat otomatis untuk shipment baru. Nilainya tidak dianggap sama dengan `voyageNumber` atau `shipmentNumber`;
- kolom shipment baru nullable pada database agar laporan historis tetap dapat dibaca dan destination dapat ditetapkan setelah penyegelan loading selesai. Field inti canonical tetap wajib saat create.

## 2. Relasi Plant–Jetty

Workbook tidak menyatakan pasangan Plant–Jetty. Karena itu migration tidak melakukan backfill atau mengarang relasi. Relasi eksplisit disimpan dalam `PlantJettyAssignment` dan bersifat many-to-many: satu nama jetty dapat ditetapkan ke lebih dari satu plant jika data aktual memang menyatakannya.

Sebelum shipment dibuat, admin harus membuat assignment yang benar:

### `GET /api/v1/plant-jetty-assignments`

Query opsional: `page`, `limit`, `plantId`, dan `jettyId`. Dapat dibaca semua user terautentikasi.

### `POST /api/v1/plant-jetty-assignments`

Khusus `ADMIN`.

```json
{
  "plantId": "UUID",
  "jettyId": "UUID"
}
```

Plant dan Jetty harus aktif. Pasangan harus unik. Operasi menghasilkan audit `CREATE` untuk entity `PLANT_JETTY_ASSIGNMENT`.

### `DELETE /api/v1/plant-jetty-assignments/:id`

Khusus `ADMIN`. Assignment yang masih dipakai shipment/voyage tidak dapat dihapus. Operasi yang berhasil menghasilkan audit `DELETE`. Tidak ada assignment yang dibuat otomatis dari seed.

## 3. Endpoint canonical shipment/voyage

Endpoint berikut tersedia identik pada prefix `/api/v1/shipments` dan `/api/v1/voyages`:

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/shipments` | List dan filter shipment. |
| `POST` | `/shipments` | Membuat shipment; destination boleh ditunda. |
| `GET` | `/shipments/:id` | Detail shipment dan report sealing. |
| `PATCH` | `/shipments/:id` | Memperbarui shipment ketika `DRAFT`. |
| `DELETE` | `/shipments/:id` | Menghapus shipment ketika `DRAFT` dan proses BA phase-aware belum dimulai. |
| `POST` | `/shipments/:id/depart` | `DRAFT` → `BERLAYAR`. |
| `POST` | `/shipments/:id/arrive` | `BERLAYAR` → `SANDAR`. |
| `POST` | `/shipments/:id/finish` | `SANDAR` → `FINISH`. |
| `POST` | `/shipments/:id/finalize` | Finalisasi canonical, membentuk final snapshot; alias bisnis untuk `finish`. |
| `GET` | `/shipments/:id/validation` | Validasi kesiapan seluruh transisi tanpa mengubah data. |
| `POST` | `/shipments/:id/prepare-seals` | Membekukan konfigurasi aktual dan menginisialisasi record A–H; lihat [API_FORM_SNAPSHOT.md](./API_FORM_SNAPSHOT.md). |
| `PUT` | `/shipments/:id/destination-assignment` | Memilih pasangan discharge Plant–Jetty setelah sealing `READY`. |
| `GET/PUT/PATCH/DELETE` | `/shipments/:id/form/...` | Membaca dan mengisi nomor segel A–H; lihat [API_FORM_A_H_ENTRY.md](./API_FORM_A_H_ENTRY.md). |

Hak akses create/update/delete mengikuti alur existing: `ADMIN`, `SUPERVISOR`, atau `LOADING_MASTER`, dengan pemeriksaan pemilik. Lifecycle unloading tetap mengikuti role `UNLOADING_MASTER`.

### Create

```json
{
  "vesselId": "UUID",
  "activityId": "UUID",
  "reportDateTime": "2026-09-07T08:00:00.000Z",
  "voyageNumber": "VOY-001",
  "shipmentNumber": "SHP-001",
  "productIds": ["UUID-PRODUK-1", "UUID-PRODUK-2"],
  "loadingPlantId": "UUID",
  "loadingJettyId": "UUID",
  "dischargePlantId": "UUID",
  "dischargeJettyId": "UUID"
}
```

`productIds` wajib berisi minimal satu UUID unik dan urutannya dipertahankan pada response maupun snapshot BA. Alias lama `productId` masih diterima sebagai satu produk; jika keduanya dikirim, `productId` harus sama dengan elemen pertama `productIds`. Response menyediakan `productIds` dan `products`, sedangkan `productId`/`product` menunjuk produk pertama untuk kompatibilitas. `dischargePlantId` dan `dischargeJettyId` opsional saat create, tetapi harus dikirim sebagai pasangan. Bila dikirim, pasangan langsung divalidasi. `sealingStatus` boleh tidak dikirim; server mengisinya dengan `READY` dan mengembalikannya dalam respons. Field assignment `loadingMasterId` dapat dikirim eksplisit; bila caller adalah Loading Master/Supervisor, nilainya default ke caller. `unloadingMasterId` boleh kosong saat draft tetapi wajib sebelum depart. Field opsional lain: `loadingMasterSurveyorName` dan `remarks`.

Aturan bisnis:

- `shipmentNumber` dinormalisasi uppercase dan unik;
- `voyageNumber` dinormalisasi uppercase, tetapi sumber tidak menetapkannya unik;
- Vessel, Activity, seluruh Product, Loading Plant, dan Loading Jetty harus aktif; destination yang dikirim juga harus aktif;
- kode Activity hanya `LOADING`, `DISCHARGE`, atau `ROB`;
- loading Jetty harus memiliki assignment ke loading Plant;
- discharge Jetty yang dikirim harus memiliki assignment ke discharge Plant;
- bila dikirim, `sealingStatus` harus berupa teks non-kosong maksimal 50 karakter dan dinormalisasi uppercase. Nilai lama selain `READY` tetap diterima karena domain resminya belum ditentukan; frontend dapat menghapus konstanta `READY` dari request. Status proses tetap dibaca dari `status` dan `sealingProcessStatus`;
- record baru selalu memulai lifecycle perjalanan dengan `status = DRAFT`;
- create menghasilkan audit `CREATE` entity `SHIPMENT_VOYAGE`.

### Update

`PATCH` menerima subset field create untuk field selain destination, termasuk penggantian seluruh daftar melalui `productIds`. Daftar baru menggantikan relasi produk sebelumnya secara atomik dan tidak boleh kosong/duplikat. Hasil gabungan dengan data tersimpan harus tetap mempunyai field inti shipment. Perubahan `dischargePlantId`/`dischargeJettyId` melalui `PATCH` ditolak agar gate bisnis tidak dapat dilewati. Bila data historis belum mempunyai `sealingStatus`, update mengisinya dengan `READY`. Master yang dirujuk divalidasi ulang dan harus aktif. Vessel tidak dapat diubah setelah sealing record disiapkan. Update menghasilkan audit `UPDATE`.

### Destination assignment

`PUT /api/v1/shipments/:id/destination-assignment` tersedia juga melalui alias `/voyages` dan `/reports`, tetapi hanya menerima record canonical (`shipmentNumber` terisi). Payload:

```json
{
  "dischargePlantId": "UUID",
  "dischargeJettyId": "UUID",
  "unloadingMasterId": "UUID opsional"
}
```

Assignment hanya dapat dilakukan ketika shipment masih `DRAFT` dan `sealingProcessStatus = READY`. Actor harus Loading Master yang ditugaskan, `SUPERVISOR`, atau `ADMIN`; `UNLOADING_MASTER` tidak mendapat akses. Pasangan master harus aktif dan terdaftar pada `PlantJettyAssignment`. Service memakai row lock yang sama dengan transisi perjalanan, sehingga assignment tidak dapat berlomba melewati departure. Audit `SHIPMENT_DESTINATION_ASSIGNMENT` menyimpan actor, nilai lama, nilai baru, dan `assignedAt`. Setelah depart, assignment terkunci.

### Delete

Hanya record `DRAFT` yang belum mempunyai `BeritaAcaraDocument` yang dapat dihapus. Delete mengambil row lock shipment agar tidak race dengan finalisasi BA dan menghasilkan audit `DELETE` dalam transaksi yang sama.

### List/filter

Selain `page`, `limit`, `search`, `status`, dan `sortOrder`, filter tersedia untuk:

- `vesselId`, `activityId`, dan `productId` (filter cocok bila produk terdapat di mana pun dalam `productIds` shipment);
- `loadingPlantId`, `loadingJettyId`, `dischargePlantId`, dan `dischargeJettyId`;
- `voyageNumber`, `shipmentNumber`, serta `sealingStatus`.

## 4. Kompatibilitas laporan lama

Endpoint `/api/v1/reports` dipertahankan sebagai endpoint legacy dengan payload lama. Data lama tidak dihapus, nomor `reportNo` tidak dipetakan otomatis menjadi shipment number, dan Terminal lama tidak ditebak sebagai Plant. Alias destination assignment pada `/reports/:id` hanya bekerja untuk record canonical; laporan legacy ditolak agar field Plant–Jetty tidak bercampur dengan Terminal.

Migration multi-produk membackfill setiap `SealingReport.productId` lama menjadi baris urutan pertama pada `SealingReportProduct`. Kolom dan relasi tunggal lama tidak dihapus; shipment canonical baru menggunakan relasi tersebut sebagai sumber utama dan mengisinya hanya sebagai alias produk pertama.

STEP 4 tidak mengubah konfigurasi record A–H. Implementasi pengisian transaksinya ditambahkan secara terpisah pada STEP 6; attachment, signature, export XLSX/PDF, dan frontend tetap tidak diubah oleh STEP 6.
