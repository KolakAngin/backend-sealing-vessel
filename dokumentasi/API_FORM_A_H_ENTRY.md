# API Transaksi Pengisian Nomor Segel A–H — STEP 6

Snapshot implementasi: 8 September 2026.

## Prinsip

Seluruh pembacaan posisi dan validasi memakai `SealingReport.formConfigurationSnapshot`, bukan konfigurasi master vessel yang mungkin sudah berubah. Form harus lebih dahulu diinisialisasi melalui `POST /api/v1/shipments/:id/prepare-seals`.

Mutation hanya tersedia bagi `ADMIN`, `SUPERVISOR`, atau `LOADING_MASTER` pemilik selama lifecycle laporan masih `DRAFT`. Endpoint GET mengikuti hak baca shipment/voyage yang sudah ada.

## Endpoint

Endpoint berikut tersedia dengan prefix `shipments`, `voyages`, dan `reports`:

| Method | Path canonical | Keterangan |
|---|---|---|
| `GET` | `/api/v1/shipments/:reportId/form` | Mengambil struktur A–H yang sudah dikelompokkan. |
| `PUT` | `/api/v1/shipments/:reportId/form/points/:pointId` | Menyimpan/mengganti seluruh input satu titik. |
| `PATCH` | `/api/v1/shipments/:reportId/form/points/:pointId` | Memperbarui sebagian input satu titik. |
| `DELETE` | `/api/v1/shipments/:reportId/form/points/:pointId` | Mengosongkan input titik dan mengembalikannya ke `NOT_SEALED`. |
| `PUT` | `/api/v1/shipments/:reportId/form/sections/:sectionCode` | Batch upsert atomik satu section A–H. |

`pointId` adalah `vesselSealingPointId` yang dikembalikan struktur form, bukan ID `SealingRecord`.

## Struktur hasil GET

Response berisi metadata report dan array `sections` berurutan. Semua section A–H tetap dikembalikan; section yang tidak tersedia mempunyai `isAvailable=false` dan `rows=[]`.

Setiap section mempunyai `sequence` dan `rows`. Untuk point yang mempunyai compartment, satu row mewakili compartment dan kolomnya mewakili titik/template aktual pada compartment tersebut. Untuk point tanpa compartment, satu row mewakili equipment/template dan kolomnya mewakili side/instance aktual.

Setiap column mengembalikan:

- `sectionSequence`, `rowSequence`, dan `columnSequence`;
- `compartment` lengkap atau `null`;
- `side` efektif dari point atau compartment;
- `instance`;
- `required`, yang berasal dari konfigurasi vessel dan dibekukan pada snapshot;
- identitas template, point, `positionKey`, dan `vesselSealingPointId`;
- `recordId`, `status`, `notes`, dan seluruh nomor segel.

Dengan struktur tersebut, Bagian A dapat mempunyai lima atau lebih kolom titik pada satu row compartment tanpa dibatasi oleh service transaksi.

## Menyimpan satu titik

`PUT` memakai replacement semantics untuk status, catatan, dan daftar nomor segel:

```json
{
  "status": "SEALED",
  "notes": "Tiga slot pada satu equipment",
  "seals": [
    { "sealNumber": "W.10001", "notes": "Slot 1" },
    { "sealNumber": "W.10002", "notes": "Slot 2" },
    { "sealNumber": "W.10003", "notes": "Slot 3" }
  ]
}
```

`PATCH` menerima subset `status`, `notes`, atau `seals`. Field yang tidak dikirim dipertahankan. Bila status diubah dari `SEALED`, client harus sekaligus mengirim `seals: []` atau membersihkan titik melalui DELETE.

`DELETE` tidak menghapus posisi snapshot maupun record konfigurasi. Operasi tersebut menghapus nomor segel input, menghapus catatan, dan mengatur status record menjadi `NOT_SEALED`.

## Batch satu section

```json
{
  "points": [
    {
      "vesselSealingPointId": "UUID-POINT-1",
      "status": "SEALED",
      "notes": "Sounding",
      "seals": [{ "sealNumber": "W.20001" }]
    },
    {
      "vesselSealingPointId": "UUID-POINT-2",
      "status": "NOT_APPLICABLE",
      "notes": "Tidak tersedia pada voyage ini",
      "seals": []
    }
  ]
}
```

Seluruh point harus berasal dari section pada path. Maksimal 500 point dan 100 nomor segel per point. Batch dijalankan dalam satu transaksi dengan row lock pada report; satu kegagalan membatalkan seluruh batch.

## Validasi

- snapshot harus tersedia, valid, dan mempunyai vessel yang sama dengan shipment;
- point harus terdapat tepat sekali dalam snapshot;
- section point harus tersedia;
- compartment point wajib terdapat pada daftar compartment snapshot;
- template `requiresCompartment=true` tidak boleh mempunyai compartment null;
- posisi unik ditentukan oleh section + template + compartment + side efektif + instance;
- point tidak boleh dikirim dua kali dalam satu batch;
- `SEALED` wajib mempunyai minimal satu nomor segel;
- `NOT_SEALED` dan `NOT_APPLICABLE` tidak boleh mempunyai nomor segel;
- nomor segel dinormalisasi menjadi uppercase;
- nomor segel tidak boleh berulang dalam satu titik, antar-point pada batch, atau pada record lain.

Keunikan nomor segel mengikuti constraint existing `Seal.sealNumber @unique`, yaitu global termasuk data historis. Format dan arti prefix seperti `W.` tidak divalidasi karena belum dipastikan sumber dan tidak boleh ditebak.

## Audit

Setiap perubahan titik menghasilkan audit dengan entity type `A_H_POINT_INPUT` dan old/new data yang mencakup status, catatan, section, serta nomor segel. Batch juga menghasilkan audit ringkasan `A_H_SECTION_INPUT`. Penghapusan input memakai action `DELETE`; create/upsert/update memakai `UPDATE` karena posisi record sudah dibentuk pada STEP 5.

STEP 6 tidak mengubah lifecycle/finalisasi, attachment, signature, ekspor XLSX/PDF, maupun frontend.
