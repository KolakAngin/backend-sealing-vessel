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
- kolom shipment baru nullable pada database hanya agar laporan historis tetap dapat dibaca. Request create canonical mewajibkan seluruh field sumber selain `sealingStatus` yang memiliki default server.

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
| `POST` | `/shipments` | Membuat shipment lengkap. |
| `GET` | `/shipments/:id` | Detail shipment dan report sealing. |
| `PATCH` | `/shipments/:id` | Memperbarui shipment ketika `DRAFT`. |
| `DELETE` | `/shipments/:id` | Menghapus shipment ketika `DRAFT`. |
| `POST` | `/shipments/:id/depart` | `DRAFT` → `BERLAYAR`. |
| `POST` | `/shipments/:id/arrive` | `BERLAYAR` → `SANDAR`. |
| `POST` | `/shipments/:id/finish` | `SANDAR` → `FINISH`. |
| `POST` | `/shipments/:id/finalize` | Finalisasi canonical, membentuk final snapshot; alias bisnis untuk `finish`. |
| `GET` | `/shipments/:id/validation` | Validasi kesiapan seluruh transisi tanpa mengubah data. |
| `POST` | `/shipments/:id/prepare-seals` | Membekukan konfigurasi aktual dan menginisialisasi record A–H; lihat [API_FORM_SNAPSHOT.md](./API_FORM_SNAPSHOT.md). |
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
  "productId": "UUID",
  "loadingPlantId": "UUID",
  "loadingJettyId": "UUID",
  "dischargePlantId": "UUID",
  "dischargeJettyId": "UUID"
}
```

Semua field pada contoh di atas wajib. `sealingStatus` boleh tidak dikirim; server mengisinya dengan `READY` dan mengembalikannya dalam respons. Field assignment `loadingMasterId` dapat dikirim eksplisit; bila caller adalah Loading Master/Supervisor, nilainya default ke caller. `unloadingMasterId` boleh kosong saat draft tetapi wajib sebelum depart. Field opsional lain: `loadingMasterSurveyorName` dan `remarks`.

Aturan bisnis:

- `shipmentNumber` dinormalisasi uppercase dan unik;
- `voyageNumber` dinormalisasi uppercase, tetapi sumber tidak menetapkannya unik;
- Vessel, Activity, Product, kedua Plant, dan kedua Jetty harus aktif;
- kode Activity hanya `LOADING`, `DISCHARGE`, atau `ROB`;
- loading Jetty harus memiliki assignment ke loading Plant;
- discharge Jetty harus memiliki assignment ke discharge Plant;
- bila dikirim, `sealingStatus` harus berupa teks non-kosong maksimal 50 karakter dan dinormalisasi uppercase. Nilai lama selain `READY` tetap diterima karena domain resminya belum ditentukan; frontend dapat menghapus konstanta `READY` dari request. Status proses tetap dibaca dari `status` dan `sealingProcessStatus`;
- record baru selalu memulai lifecycle perjalanan dengan `status = DRAFT`;
- create menghasilkan audit `CREATE` entity `SHIPMENT_VOYAGE`.

### Update

`PATCH` menerima subset field create, tetapi hasil gabungan dengan data tersimpan harus tetap mempunyai semua field shipment wajib selain `sealingStatus`. Bila data historis belum mempunyai `sealingStatus`, update mengisinya dengan `READY`. Master yang dirujuk divalidasi ulang dan harus aktif. Vessel tidak dapat diubah setelah sealing record disiapkan. Update menghasilkan audit `UPDATE`.

### Delete

Hanya record `DRAFT` yang dapat dihapus. Delete menghasilkan audit `DELETE` sebelum data transaksi dianggap selesai dihapus.

### List/filter

Selain `page`, `limit`, `search`, `status`, dan `sortOrder`, filter tersedia untuk:

- `vesselId`, `activityId`, dan `productId`;
- `loadingPlantId`, `loadingJettyId`, `dischargePlantId`, dan `dischargeJettyId`;
- `voyageNumber`, `shipmentNumber`, serta `sealingStatus`.

## 4. Kompatibilitas laporan lama

Endpoint `/api/v1/reports` dipertahankan sebagai endpoint legacy dengan payload lama. Data lama tidak dihapus, nomor `reportNo` tidak dipetakan otomatis menjadi shipment number, dan Terminal lama tidak ditebak sebagai Plant. Laporan historis dapat memiliki field shipment baru bernilai `null`; create melalui `/shipments` atau `/voyages` tidak dapat menghasilkan record seperti itu.

STEP 4 tidak mengubah konfigurasi record A–H. Implementasi pengisian transaksinya ditambahkan secara terpisah pada STEP 6; attachment, signature, export XLSX/PDF, dan frontend tetap tidak diubah oleh STEP 6.
