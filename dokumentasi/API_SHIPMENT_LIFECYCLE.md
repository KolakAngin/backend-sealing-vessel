# API Validasi dan Lifecycle Shipment/Voyage Sealing — STEP 7

Snapshot implementasi: 8 September 2026.

## Pemisahan status

Tiga jenis status tidak dicampur:

- `status`: perjalanan `DRAFT → BERLAYAR → SANDAR → FINISH`;
- `sealingProcessStatus`: status proses internal yang dikelola server, yaitu `NOT_STARTED`, `IN_PROGRESS`, `READY`, `IN_TRANSIT`, `VERIFICATION`, dan `FINALIZED`;
- `sealingStatus`: nilai Status Sealing dari sumber/workbook. Kolom string lama tetap dipertahankan karena domain sumber belum ditentukan dan tidak boleh ditebak.

Urutan bisnis canonical lengkap adalah `DRAFT → BA LOADING FINALIZED → BERLAYAR → SANDAR → BA UNLOADING FINALIZED → FINISH`. Finalisasi BA tidak mengubah `status` perjalanan: BA LOADING final tetap `DRAFT`, sedangkan BA UNLOADING final tetap `SANDAR` sampai endpoint lifecycle berikutnya dipanggil.

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
| `PUT` | `/api/v1/shipments/:id/destination-assignment` | Memilih discharge Plant–Jetty setelah sealing `READY`, sebelum depart. |
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
- Hanya Loading Master yang ditugaskan, Admin, atau Supervisor yang dapat memilih destination; Unloading Master tidak dapat memilih atau mengubahnya.
- Hanya Unloading Master yang ditugaskan, Admin, atau Supervisor yang dapat melakukan arrive, verification, dan finalize.

`createdById` tetap menyimpan pembuat/audit owner dan tidak diganti oleh assignment.

## Validasi sebelum berangkat

Untuk shipment canonical:

1. status perjalanan harus `DRAFT`;
2. seluruh field inti shipment dan pasangan destination harus lengkap;
3. Vessel, Activity, seluruh Product pada `productIds`, Plant, dan Jetty harus aktif;
4. Activity hanya `LOADING`, `DISCHARGE`, atau `ROB`;
5. pasangan Loading Plant–Jetty dan Discharge Plant–Jetty harus masih valid;
6. Loading Master dan Unloading Master harus valid dan aktif;
7. snapshot A–H harus tersedia, valid, dan berasal dari vessel shipment;
8. hanya point snapshot dengan `isRequired=true` yang wajib selesai;
9. point required boleh `NOT_APPLICABLE`; selain itu harus `SEALED` dan mempunyai minimal satu nomor segel aktif.
10. BA `LOADING` harus sudah berstatus `FINALIZED`.

Point `isRequired=false`, section tidak tersedia, dan point `NOT_APPLICABLE` tidak menghalangi keberangkatan. Tiga signature LOADING diperiksa ketika BA LOADING difinalisasi; departure hanya memeriksa hasil finalisasi immutable tersebut.

Destination boleh kosong saat create. Assignment yang ditunda baru dibuka ketika `sealingProcessStatus = READY`, hanya selama status perjalanan masih `DRAFT`. Departure ditolak dengan `DESTINATION_ASSIGNMENT_REQUIRED` bila pasangan belum lengkap, ditolak bila pasangan tidak aktif/tidak terdaftar, dan ditolak dengan `LOADING_BA_NOT_FINALIZED` bila BA LOADING belum final. Destination langsung terkunci ketika BA LOADING final, sebelum depart.

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
- BA `UNLOADING` telah difinalisasi; bila belum, validasi mengembalikan `UNLOADING_BA_NOT_FINALIZED`.

Nomor berstatus `REMOVED` atau `REPLACED` tidak dianggap seal aktif. Point/section `NOT_APPLICABLE` tidak menghalangi finalisasi. Foto verification bersifat opsional, tetapi seluruh foto yang tersedia dibekukan ke snapshot BA UNLOADING.

## Response validasi

Response mengembalikan:

- activity, status perjalanan, `sealingStatus`, status proses tersimpan dan hasil kalkulasi;
- assignment Loading/Unloading Master;
- jumlah point snapshot, point required, required `NOT_APPLICABLE`, dan record;
- `transitions.depart`, `transitions.arrive`, serta `transitions.finalize`, masing-masing berisi `allowed` dan daftar error berkode;
- kebijakan aktif, termasuk `documentationRequired=false`, `notApplicableBlocksFinalization=false`, dan `revisionSupported=false`.

Endpoint validasi bersifat read-only dan tidak menjalankan transisi.

## Final snapshot dan penguncian

Untuk shipment canonical, finalisasi lifecycle menggunakan snapshot BA UNLOADING yang sudah immutable sebagai `SealingReport.finalSnapshot`; data live tidak dipotret ulang. Snapshot tersebut berisi:

- header shipment, activity, vessel, seluruh daftar produk, Plant/Jetty, assignment, dan waktu lifecycle;
- snapshot konfigurasi A–H;
- seluruh sealing record, point snapshot, status, catatan;
- seluruh nomor segel dan verification;
- `loadingAttachments` dari snapshot BA LOADING dan `unloadingAttachments` dari verification, lengkap dengan provenance dan checksum;
- tiga signature LOADING dan tiga signature UNLOADING;
- waktu dan user finalisasi.

Verification, attachment verification, dan signature UNLOADING sudah terkunci sejak BA UNLOADING final, sebelum status `FINISH`. Setelah `FINISH`, seluruh mutasi lifecycle tetap ditolak. Data historis non-canonical tetap memakai pembentukan finalSnapshot legacy.

## Revisi

Spesifikasi sumber belum menentukan siapa yang boleh membuka revisi, nomor/versi revisi, alasan, approval, ataupun apakah revisi menyalin final snapshot. Karena itu STEP 7 tidak membuat endpoint reopen/revision dan tidak menebak workflow. Client dapat membaca `revisionSupported=false` dari endpoint validasi.

Frontend berada di luar ruang lingkup lifecycle backend ini. Attachment dan PDF resmi mengikuti phase BA serta snapshot immutable; XLSX tetap export operasional/legacy sebagaimana dijelaskan pada dokumentasi export.
