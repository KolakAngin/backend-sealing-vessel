# API Generator PDF Native dan Appendix Dokumentasi

## 1. Keputusan pipeline

Generator membuat seluruh halaman form secara native dengan `pdf-lib`. Tidak ada halaman PDF sumber yang disalin, ditanam, dijadikan background, atau ditutupi dengan kotak putih. Header, identitas dokumen, paragraf, tabel A–H, nomor segel, status, area tanda tangan, footer, dan appendix digambar sebagai teks, garis, bentuk vektor, dan gambar data aktual.

Layout native mempunyai identitas SHA-256:

`248d76c5c7c2018fef914f87330ee5edba2a2c6634b73d83ce8b8c8499409a53`

Versi renderer adalah `tko-native-layout-v5`. Identitas layout disimpan pada kolom legacy `templateChecksumSha256`; nama kolom dipertahankan untuk kompatibilitas database/API, tetapi nilainya sekarang adalah checksum spesifikasi layout native, bukan checksum file PDF.

Susunan dan hierarki mengikuti sumber B3.1-612: warna header tabel, urutan bagian, label kolom, ukuran A4, serta area tanda tangan. Jumlah halaman form bersifat dinamis agar bagian yang kosong tidak memboroskan kertas. Perbedaan tipografi dan jarak dari dokumen sumber adalah konsekuensi yang disengaja dari pembuatan ulang secara native. Renderer tidak bergantung pada LibreOffice, Excel, headless browser, font sistem, atau file template PDF.

Kiri atas setiap halaman memakai aset transparan `assets/pertamina-patra-niaga-logo.png`. Integritas aset diperiksa terhadap SHA-256 `443bd4c8973e23e704212da16312894fb5cbca5cb23747429d50bbb1167c8fe0` sebelum PDF dirender.

Urutan halaman form adalah:

1. header dan Bagian A;
2. Bagian B-H yang dipadatkan sesuai jumlah baris aktual;
3. tanda tangan pada halaman terakhir form B-H.

Setiap halaman berukuran sekitar `595.4 × 842 pt` (A4). Renderer hanya menerima laporan `FINISH` dan membaca `finalSnapshot`, sehingga perubahan master/configuration setelah finalisasi tidak mengubah isi laporan.

## 2. Artefak berversi dan idempotensi

`PdfArtifact` menyimpan satu hasil final aktif per `SealingReport` melalui unique constraint `sealingReportId`. Metadata yang disimpan:

- nama dan storage key;
- MIME dan ukuran byte;
- SHA-256 hasil PDF;
- SHA-256 layout native dan snapshot canonical;
- versi renderer;
- jumlah halaman form, appendix, dan total;
- pembuat dan waktu generate.

Pemanggilan generate berikutnya tidak merender ulang selama versi renderer, checksum layout, dan checksum snapshot masih sama. Generate mengunci row report dan memeriksa ulang artefak di dalam transaksi agar dua request bersamaan tidak membuat dua hasil atau saling menghapus file. Service memverifikasi ukuran dan checksum file yang sudah tersimpan, lalu mengembalikan metadata dengan `reused=true`.

Artefak dari renderer overlay lama otomatis dibuat ulang ketika endpoint `POST .../pdf` dipanggil. File lama dipindahkan sementara, artefak database diperbarui atomik, dan audit `UPDATE PDF_EXPORT` dibuat. Preview/download artefak lama memberi `409` sampai proses generate native dijalankan, sehingga sistem tidak menyajikan hasil overlay sebagai hasil native.

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
  "templateChecksumSha256": "248d76c5c7c2018fef914f87330ee5edba2a2c6634b73d83ce8b8c8499409a53",
  "snapshotChecksumSha256": "...",
  "rendererVersion": "tko-native-layout-v5",
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

Header memuat vessel, terminal/Plant-Jetty sesuai master yang memfinalisasi dokumen, product, tanggal, shipment number, voyage number, activity, sealing status, dan report number. Seluruh nilai dinamis shipment dicetak tebal. Paragraf pembuka mencocokkan `finalizedById` dengan assignment Loading Master atau Unloading Master, lalu menyebut lokasi terkait dengan bentuk `at port ...`; identitas master, vessel, port, activity, dan product dicetak tebal. Snapshot lama tanpa ID assignment memakai activity sebagai fallback.

Titik dibaca dari snapshot A-H. Hanya nomor segel aktif yang ditampilkan. Point tanpa nomor segel aktif dan section yang tidak tersedia tidak membentuk baris data; generator juga tidak menulis `NOT_SEALED`, `NOT_APPLICABLE`, maupun `Bagian ... tidak tersedia` pada PDF. Setiap tabel yang mempunyai data tetapi belum mencapai kapasitas mendapat satu baris buffer kosong. Tabel tanpa nomor segel aktif atau berstatus tidak tersedia hanya mempunyai satu baris kosong. Tanda tangan ditempatkan pada kotak Chief Officer, Terminal Representative, dan Surveyor; citra JPEG/PNG/WebP ditanam setelah checksum file diverifikasi.

Kapasitas per blok mengikuti struktur sumber: A 28 compartment × 5 jenis titik, B 14 titik, C 16, D 16, E 18, F 12, G 14, dan H 4. Bagian B-H dialirkan secara dinamis ke halaman berikutnya hanya bila ruang A4 tidak mencukupi; tanda tangan tetap berada pada halaman form terakhir. Bila data melebihi kapasitas blok, renderer membuat blok continuation. Tidak ada perubahan skala atau ukuran A4.

## 5. Appendix foto

Appendix bersifat opsional dan berada setelah seluruh halaman form. Hanya attachment `type=PHOTO` dengan MIME JPEG, PNG, atau WebP yang dirender. Dokumen PDF dan attachment nonfoto tetap tersedia melalui API attachment, tetapi tidak diperlakukan sebagai foto.

Foto dikumpulkan dari owner report/section, sealing record, dan verification pada `finalSnapshot`, dideduplikasi berdasarkan ID, lalu diurutkan oleh `sequence`, `createdAt`, dan ID. Satu halaman A4 berisi maksimal sembilan kartu (3 × 3). Setiap kartu menampilkan foto, caption atau nama file, sequence, dan section bila ada. File WebP dikonversi deterministik ke PNG sebelum ditanam. Checksum setiap file sumber diverifikasi.

## 6. Audit dan error

Generate pertama membuat audit log `CREATE`, `entityType=PDF_EXPORT`, `entityId=reportId`. Regenerasi artefak renderer lama membuat audit `UPDATE`; generate idempotent pada renderer aktif tidak menambah audit baru.

- `403`: role generate tidak diizinkan atau assignment master tidak sesuai;
- `404`: report/artefak belum ada;
- `409`: report belum `FINISH`, final snapshot tidak didukung, preview masih menunjuk renderer lama, file sumber snapshot hilang/berubah, atau artefak tersimpan gagal pemeriksaan integritas.

Konfigurasi environment:

```dotenv
PDF_EXPORT_DIR="exports/pdf"
```

## 7. Fixture regresi

`tests/fixtures/queen-sofia-pdf.visual.json` mengunci checksum layout native, ukuran A4, jumlah halaman, dan anchor koordinat teks pada kelima halaman fixture. Integration test juga memeriksa determinisme dua render, pemadatan laporan tanpa segel menjadi dua halaman form, isi A-H, tanda tangan, caption, preview/download byte-identik, idempotensi, regenerasi artefak overlay lama, audit, role, serta penolakan laporan DRAFT.

Regresi berbasis anchor digunakan agar test tidak bergantung pada rasterizer OS. Halaman pertama wajib mempunyai tepat satu image XObject kecil untuk logo Pertamina Patra Niaga; tidak ada citra halaman template atau background. Tabel, garis, teks, dan geometry form tetap dibuat secara native; citra lain hanya berasal dari tanda tangan dan foto appendix aktual.
