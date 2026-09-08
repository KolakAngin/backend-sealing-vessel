# API Validasi dan Lifecycle Shipment/Voyage Sealing — STEP 7

Snapshot implementasi: 8 September 2026.

## Pemisahan status

Tiga jenis status tidak dicampur:

- `status`: perjalanan `DRAFT → BERLAYAR → SANDAR → FINISH`;
- `sealingProcessStatus`: status proses internal yang dikelola server, yaitu `NOT_STARTED`, `IN_PROGRESS`, `READY`, `IN_TRANSIT`, `VERIFICATION`, dan `FINALIZED`;
- `sealingStatus`: nilai Status Sealing dari sumber/workbook. Kolom string lama tetap dipertahankan karena domain sumber belum ditentukan dan tidak boleh ditebak.

`sealingProcessStatus` bergerak sebagai berikut:

```text
create shipment       NOT_STARTED
snapshot dibuat       IN_PROGRESS atau READY
required selesai      READY
depart                IN_TRANSIT
arrive                VERIFICATION
finalize/finish        FINALIZED
```

## Endpoint

Semua endpoint tersedia pada prefix `shipments`, `voyages`, dan `reports`:

| Method | Path canonical | Keterangan |
|---|---|---|
| `GET` | `/api/v1/shipments/:id/validation` | Menghitung kesiapan depart, arrive, dan finalize beserta seluruh error. |
| `POST` | `/api/v1/shipments/:id/depart` | `DRAFT → BERLAYAR`. |
| `POST` | `/api/v1/shipments/:id/arrive` | `BERLAYAR → SANDAR`. |
| `POST` | `/api/v1/shipments/:id/finalize` | `SANDAR → FINISH` dan membentuk final snapshot. |
| `POST` | `/api/v1/shipments/:id/finish` | Alias kompatibilitas untuk `finalize`. |

Body transisi:

```json
{
  "occurredAt": "2026-09-08T10:00:00.000Z",
  "remarks": "Opsional"
}
```

Keduanya opsional. Bila `occurredAt` tidak dikirim, server memakai waktu transaksi.

## Assignment

- Shipment canonical selalu mempunyai `loadingMasterId` pada saat dibuat.
- Bila creator adalah `LOADING_MASTER` atau `SUPERVISOR`, assignment loading default ke creator.
- Creator `ADMIN` wajib mengirim `loadingMasterId` eksplisit.
- Loading Master hanya dapat menetapkan dirinya sendiri; assignment ke Loading Master lain hanya dapat dilakukan oleh `ADMIN` atau `SUPERVISOR`.
- Loading Master harus aktif dan mempunyai role `LOADING_MASTER` atau `SUPERVISOR`.
- `unloadingMasterId` dapat belum ditentukan selama penyusunan draft, tetapi wajib aktif dan ber-role `UNLOADING_MASTER` atau `SUPERVISOR` sebelum depart.
- Hanya Loading Master yang ditugaskan, Admin, atau Supervisor yang dapat menyiapkan form dan melakukan depart.
- Hanya Unloading Master yang ditugaskan, Admin, atau Supervisor yang dapat melakukan arrive, verification, dan finalize.

`createdById` tetap menyimpan pembuat/audit owner dan tidak diganti oleh assignment.

## Validasi sebelum berangkat

Untuk shipment canonical:

1. status perjalanan harus `DRAFT`;
2. seluruh field wajib shipment harus lengkap;
3. Vessel, Activity, Product, Plant, dan Jetty harus aktif;
4. Activity hanya `LOADING`, `DISCHARGE`, atau `ROB`;
5. pasangan Loading Plant–Jetty dan Discharge Plant–Jetty harus masih valid;
6. Loading Master dan Unloading Master harus valid dan aktif;
7. snapshot A–H harus tersedia, valid, dan berasal dari vessel shipment;
8. hanya point snapshot dengan `isRequired=true` yang wajib selesai;
9. point required boleh `NOT_APPLICABLE`; selain itu harus `SEALED` dan mempunyai minimal satu nomor segel aktif.

Point `isRequired=false`, section tidak tersedia, dan point `NOT_APPLICABLE` tidak menghalangi keberangkatan. Dokumentasi, attachment, dan signature tidak diperiksa karena sumber belum menyatakannya wajib.

Nilai `isRequired` disimpan pada `VesselSealingPoint` dan ikut dibekukan pada snapshot. Snapshot lama yang belum mempunyai atribut tersebut diperlakukan required untuk mempertahankan aturan historis yang lebih ketat.

## Aturan Activity

Master hanya menerima `LOADING`, `DISCHARGE`, dan `ROB`. Ketiganya mengikuti safety gate yang sama: sealing required diselesaikan di origin, perjalanan berstatus BERLAYAR, lalu pemeriksaan dilakukan setelah SANDAR. Tidak ada pengecualian khusus ROB atau pembalikan assignment untuk DISCHARGE karena perbedaan tersebut tidak ditentukan sumber.

## Validasi sebelum finalisasi

Finalisasi memerlukan:

- status perjalanan `SANDAR`;
- Unloading Master aktif dan sesuai assignment;
- snapshot canonical tetap valid;
- point required telah selesai atau `NOT_APPLICABLE`;
- setiap nomor segel aktif pada point yang bukan `NOT_APPLICABLE` telah mempunyai verification.

Nomor berstatus `REMOVED` atau `REPLACED` tidak dianggap seal aktif. Point/section `NOT_APPLICABLE` tidak menghalangi finalisasi. Tidak ada kewajiban attachment atau dokumen.

## Response validasi

Response mengembalikan:

- activity, status perjalanan, `sealingStatus`, status proses tersimpan dan hasil kalkulasi;
- assignment Loading/Unloading Master;
- jumlah point snapshot, point required, required `NOT_APPLICABLE`, dan record;
- `transitions.depart`, `transitions.arrive`, serta `transitions.finalize`, masing-masing berisi `allowed` dan daftar error berkode;
- kebijakan aktif, termasuk `documentationRequired=false`, `notApplicableBlocksFinalization=false`, dan `revisionSupported=false`.

Endpoint validasi bersifat read-only dan tidak menjalankan transisi.

## Final snapshot dan penguncian

Finalisasi menyimpan `SealingReport.finalSnapshot` JSON yang berisi:

- header shipment, activity, vessel, product, Plant/Jetty, assignment, dan waktu lifecycle;
- snapshot konfigurasi A–H;
- seluruh sealing record, point snapshot, status, catatan;
- seluruh nomor segel dan verification;
- metadata attachment report/section/record/verification serta tiga slot signature, termasuk checksum dan ukuran file;
- waktu dan user finalisasi.

Setelah `FINISH`, update shipment/report, input form, perubahan nomor segel, verification, dan finalisasi ulang ditolak oleh aturan status service. Final snapshot tidak ditulis ulang.

## Revisi

Spesifikasi sumber belum menentukan siapa yang boleh membuka revisi, nomor/versi revisi, alasan, approval, ataupun apakah revisi menyalin final snapshot. Karena itu STEP 7 tidak membuat endpoint reopen/revision dan tidak menebak workflow. Client dapat membaca `revisionSupported=false` dari endpoint validasi.

STEP 7 tidak mengerjakan attachment, generator XLSX/PDF, ataupun frontend.
