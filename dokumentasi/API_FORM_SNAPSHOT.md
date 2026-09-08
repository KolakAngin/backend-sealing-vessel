# API Snapshot dan Inisialisasi Form A–H — STEP 5

Snapshot implementasi: 7 September 2026.

## Endpoint

Endpoint yang setara:

- `POST /api/v1/shipments/:id/prepare-seals`
- `POST /api/v1/voyages/:id/prepare-seals`
- `POST /api/v1/reports/:id/prepare-seals` untuk kompatibilitas ID report lama.

Body harus berupa object kosong:

```json
{}
```

Endpoint hanya dapat dijalankan oleh `ADMIN`, `SUPERVISOR`, atau `LOADING_MASTER` pemilik ketika lifecycle shipment masih `DRAFT`.

## Urutan pembacaan

Service membaca dan mengunci Shipment/`SealingReport`, lalu membaca:

1. Vessel shipment;
2. `FormTkoVersion` aktif milik profile;
3. `VesselFormProfile` aktif untuk vessel;
4. state availability section A–H pada `VesselFormSection`;
5. seluruh compartment aktif vessel;
6. seluruh `VesselSealingPoint` aktif dan `AVAILABLE` yang templatenya aktif serta berada dalam section tersedia.

Section yang `isAvailable=false`, kategori di luar A–H, titik `NOT_AVAILABLE`/`INACTIVE`, dan titik dengan compartment nonaktif tidak dimasukkan. Service tidak membuat kategori, template, vessel sealing point, atau titik `SYS-COMPARTMENT` baru.

## Snapshot

Inisialisasi pertama mengisi field berikut pada `SealingReport`:

- `formVersionId`;
- `vesselFormProfileId`;
- `formInitializedAt`;
- `formConfigurationSnapshot` JSON.

Snapshot JSON menyimpan identitas versi form, profile, vessel, semua state section A–H, daftar compartment aktif, serta daftar titik aktual berikut label template, section, side, instance, urutan, lokasi, `isRequired`, dan label compartment pada saat inisialisasi.

Setiap `SealingRecord` hasil inisialisasi juga menyimpan `pointSnapshot`. Dengan demikian perubahan nama, urutan, availability, compartment, template, atau point pada master vessel setelah inisialisasi tidak mengubah representasi konfigurasi laporan lama.

Kolom snapshot nullable untuk menjaga seluruh laporan dan record legacy. Record lama berbasis `SYS-COMPARTMENT` tidak diubah atau dihapus dan dapat tetap mempunyai `pointSnapshot=null`.

## Pembuatan record

Satu record dibuat untuk setiap point dalam snapshot, termasuk beberapa point yang berada pada compartment yang sama. Constraint yang dipertahankan adalah:

```text
unique(sealingReportId, vesselSealingPointId)
```

Tidak ada lagi pembatasan satu record per compartment. Semua record yang dibuat otomatis mempunyai `status=NOT_SEALED`; proses ini tidak memasang nomor seal dan tidak mengubah status menjadi `SEALED`.

## Idempotensi

Pemanggilan pertama membekukan snapshot. Pemanggilan berikutnya:

- memakai snapshot pertama, bukan membaca ulang konfigurasi master;
- tidak menambahkan point baru yang kemudian dibuat pada vessel;
- tidak menghapus point yang kemudian dinonaktifkan pada vessel;
- memakai upsert berdasarkan report + vessel sealing point sehingga tidak membuat duplikasi;
- dapat memulihkan record snapshot yang terhapus selama report masih `DRAFT`.

Row report dikunci selama transaksi inisialisasi untuk mencegah dua request paralel membuat snapshot yang berbeda.

## Response

```json
{
  "reportId": "UUID",
  "formVersion": {
    "id": "UUID",
    "code": "FORM-SEGEL-TKO-EDIT1",
    "name": "Form Segel Baru sesuai TKO (edit1)",
    "revision": "edit1"
  },
  "vesselFormProfileId": "UUID",
  "sectionCount": 2,
  "compartmentCount": 3,
  "pointCount": 8,
  "readyCount": 8,
  "createdCount": 8,
  "initializedAt": "2026-09-07T00:00:00.000Z",
  "reusedSnapshot": false
}
```

`sectionCount` menghitung section tersedia. `pointCount` adalah jumlah point dalam snapshot. `readyCount` menghitung seluruh record report, termasuk record legacy yang sudah ada. Pada pemanggilan idempoten normal, `createdCount=0` dan `reusedSnapshot=true`.

## Versi dan profile form

Versi awal memakai kode `FORM-SEGEL-TKO-EDIT1`, berasal dari nama workbook sumber utama. Seed membuat versi tersebut secara idempoten dan membuat/memperbarui `VesselFormProfile` setiap vessel.

Untuk kompatibilitas dengan wizard vessel yang sudah tersedia, availability section pada profile disinkronkan dari keberadaan point aktif berstatus `AVAILABLE` pada section itu. Sinkronisasi hanya mengubah profile/section; tidak pernah membuat point. Bagian G tanpa point tersedia akan tersimpan `isAvailable=false`.

Seed Queen Sofia mencakup `1P–7P`, `1S–7S`, `SLOP-P` (`Slop Port`), dan `SLOP-S` (`Slop Starboard`).

STEP 5 tidak mengerjakan input nomor seal, attachment, signature, ekspor XLSX/PDF, maupun frontend.

Pengisian status, catatan, dan satu atau beberapa nomor segel setelah snapshot dibuat didokumentasikan pada [API_FORM_A_H_ENTRY.md](./API_FORM_A_H_ENTRY.md).
