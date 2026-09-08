# API Generator PDF Final dan Appendix Dokumentasi

## 1. Keputusan pipeline

Generator memakai `Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf` sebagai latar immutable tiga halaman. Checksum SHA-256 yang diterima adalah:

`231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6`

Pendekatan overlay dipilih karena sumber tersebut sudah mempunyai ukuran A4, logo, border, posisi, margin visual, dan pemisahan halaman A-H yang resmi. PDF referensi hanya menjadi sumber geometry; hierarki nilai/label dinamis tetap mengikuti snapshot yang dibentuk dari spesifikasi dan mapping XLSX utama. Label titik A dan equipment B-H ditumpuk dari snapshot sehingga teks statis referensi tambahan tidak mengalahkan sumber utama. Renderer tidak bergantung pada LibreOffice/Excel/headless browser atau font sistem. Teks dinamis memakai font PDF standar Helvetica/Helvetica-Bold agar konsisten pada semua host.

Urutan halaman form adalah:

1. header dan Bagian A;
2. Bagian B-E;
3. Bagian F-H dan tanda tangan.

Setiap halaman berukuran sekitar `595.4 × 842 pt` (A4). Renderer hanya menerima laporan `FINISH` dan membaca `finalSnapshot`, sehingga perubahan master/configuration setelah finalisasi tidak mengubah isi laporan.

## 2. Artefak immutable

`PdfArtifact` menyimpan satu hasil final per `SealingReport` melalui unique constraint `sealingReportId`. Metadata yang disimpan:

- nama dan storage key;
- MIME dan ukuran byte;
- SHA-256 hasil PDF;
- SHA-256 template dan snapshot canonical;
- versi renderer;
- jumlah halaman form, appendix, dan total;
- pembuat dan waktu generate.

Pemanggilan generate berikutnya tidak merender ulang. Generate mengunci row report dan memeriksa ulang artefak di dalam transaksi agar dua request bersamaan tidak membuat dua hasil atau saling menghapus file. Service memverifikasi ukuran dan checksum file yang sudah tersimpan, lalu mengembalikan metadata dengan `reused=true`. Preview dan download juga memverifikasi integritas sebelum mengirim file. File hilang atau berubah menghasilkan HTTP `409`.

## 3. Endpoint

Ketiga prefix berikut menunjuk artefak yang sama:

```text
POST /api/v1/reports/:reportId/pdf
POST /api/v1/voyages/:reportId/pdf
POST /api/v1/shipments/:reportId/pdf

GET  /api/v1/reports/:reportId/pdf/preview
GET  /api/v1/voyages/:reportId/pdf/preview
GET  /api/v1/shipments/:reportId/pdf/preview

GET  /api/v1/reports/:reportId/pdf/download
GET  /api/v1/voyages/:reportId/pdf/download
GET  /api/v1/shipments/:reportId/pdf/download
```

Semua endpoint memerlukan bearer token. Generate diizinkan untuk `ADMIN`, `SUPERVISOR`, `LOADING_MASTER`, dan `UNLOADING_MASTER`; assignment report tetap diperiksa untuk kedua role master. Viewer tidak dapat generate, tetapi dapat membaca artefak sesuai kebijakan baca laporan yang berlaku.

Generate pertama memberi HTTP `201`; panggilan idempotent berikutnya HTTP `200`. Contoh data respons:

```json
{
  "reportId": "uuid",
  "fileName": "SHP-001-uuid.pdf",
  "mimeType": "application/pdf",
  "fileSize": 325000,
  "checksumSha256": "...",
  "templateChecksumSha256": "231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6",
  "snapshotChecksumSha256": "...",
  "rendererVersion": "tko-background-overlay-v1",
  "formPageCount": 3,
  "appendixPageCount": 1,
  "pageCount": 4,
  "generatedAt": "2026-09-08T...Z",
  "reused": false,
  "previewUrl": "/api/v1/reports/uuid/pdf/preview",
  "downloadUrl": "/api/v1/reports/uuid/pdf/download"
}
```

Preview memakai `Content-Disposition: inline`; download memakai `attachment`. Keduanya mengirim `X-Checksum-SHA256`.

## 4. Mapping dan overflow

Header memuat vessel, terminal/Plant-Jetty sesuai aktivitas, product, tanggal, shipment number, voyage number, activity, sealing status, dan report number. Titik dibaca dari snapshot A-H. Nilai titik adalah daftar nomor segel aktif, `NOT_SEALED`, atau `NOT_APPLICABLE`. Tanda tangan ditempatkan pada kotak Chief Officer, Terminal Representative, dan Surveyor; citra JPEG/PNG/WebP ditanam setelah checksum file diverifikasi.

Kapasitas halaman memakai slot visual PDF sumber: A 28 compartment × 5 jenis titik, B 14 titik, C 16, D 16, E 18, F 12, G 14, dan H 4. Bila data melebihi kapasitas, renderer menyalin satu set lengkap tiga halaman resmi sebagai continuation. Header setiap set menyatakan nomor continuation. Tidak ada perubahan skala atau ukuran A4.

## 5. Appendix foto

Appendix bersifat opsional dan berada setelah seluruh halaman form. Hanya attachment `type=PHOTO` dengan MIME JPEG, PNG, atau WebP yang dirender. Dokumen PDF dan attachment nonfoto tetap tersedia melalui API attachment, tetapi tidak diperlakukan sebagai foto.

Foto dikumpulkan dari owner report/section, sealing record, dan verification pada `finalSnapshot`, dideduplikasi berdasarkan ID, lalu diurutkan oleh `sequence`, `createdAt`, dan ID. Satu halaman A4 berisi maksimal sembilan kartu (3 × 3). Setiap kartu menampilkan foto, caption atau nama file, sequence, dan section bila ada. File WebP dikonversi deterministik ke PNG sebelum ditanam. Checksum setiap file sumber diverifikasi.

## 6. Audit dan error

Generate pertama membuat satu audit log `CREATE`, `entityType=PDF_EXPORT`, `entityId=reportId`. Generate idempotent tidak menambah audit baru.

- `403`: role generate tidak diizinkan atau assignment master tidak sesuai;
- `404`: report/artefak belum ada;
- `409`: report belum `FINISH`, final snapshot tidak didukung, template berubah, file sumber snapshot hilang/berubah, atau artefak tersimpan gagal pemeriksaan integritas.

Konfigurasi environment:

```dotenv
SEALING_PDF_TEMPLATE_PATH="../../Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf"
PDF_EXPORT_DIR="exports/pdf"
```

## 7. Fixture regresi

`tests/fixtures/queen-sofia-pdf.visual.json` mengunci checksum template, ukuran A4, jumlah halaman, dan anchor koordinat teks pada kelima halaman fixture. Integration test juga memeriksa determinisme dua render, isi A-H, tanda tangan, caption, preview/download byte-identik, idempotensi, audit, role, serta penolakan laporan DRAFT.

Regresi berbasis anchor digunakan agar test tidak bergantung pada rasterizer OS. Logo dan geometry berasal langsung dari tiga page object template immutable; citra tanda tangan dan foto diuji sebagai resource yang berhasil ditanam.
