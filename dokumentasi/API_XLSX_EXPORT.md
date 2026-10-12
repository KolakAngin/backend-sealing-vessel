# API Export XLSX Operasional/Legacy

XLSX bukan Berita Acara resmi dan bukan artefak phase-aware. Workbook ini adalah export operasional form segel TKO untuk kebutuhan spreadsheet/integrasi lama. Dokumen resmi shipment baru tetap PDF BA LOADING dan PDF BA UNLOADING. Karena itu backend tidak menambah model XLSX per phase maupun endpoint `/ba/:phase/xlsx`.

## 1. Sumber dan prinsip

Generator memakai `Form Segel Baru sesuai TKO (edit1).xlsx` sebagai template immutable. Path default adalah `../../Form Segel Baru sesuai TKO (edit1).xlsx` relatif terhadap working directory backend dan dapat diubah melalui `SEALING_XLSX_TEMPLATE_PATH`.

Checksum SHA-256 yang diterima:

`d9a6e738b7551357099f2443207a11396ed2397baf1aeafb1cd4d0c616dae963`

Generate dihentikan dengan HTTP 409 jika checksum berbeda. Generator mengubah hanya nilai cell target, cached value dua formula narasi, daftar sheet jika ada continuation, dan drawing tanda tangan. Logo, merged cell, border/font/style, lebar kolom, tinggi baris, page margin, orientasi, page break, printer settings, dan calc chain template dipertahankan. Template sumber tidak pernah ditulis.

Template sumber tidak mempunyai defined print area. Ketidakadaan defined print area tersebut dipertahankan; generator tidak mengarang scaling atau print area baru.

## 2. Endpoint

Semua endpoint memerlukan Bearer token dan tersedia dengan prefix ekuivalen `/reports`, `/voyages`, atau `/shipments`.

### Generate

`POST /api/v1/shipments/:reportId/xlsx`

Role: `ADMIN`, `SUPERVISOR`, `LOADING_MASTER`, atau `UNLOADING_MASTER`, dengan pemeriksaan assignment yang sama seperti pembacaan laporan. Hanya laporan `FINISH` dengan `finalSnapshot` versi 1 yang diterima.

Response HTTP 201 (field klasifikasi bersifat eksplisit):

```json
{
  "success": true,
  "data": {
    "reportId": "uuid",
    "documentClassification": "OPERATIONAL_LEGACY_EXPORT",
    "fileName": "SHP-001-uuid.xlsx",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "fileSize": 123456,
    "checksumSha256": "...",
    "templateChecksumSha256": "d9a6...e963",
    "sheetCount": 1,
    "previewUrl": "/api/v1/reports/uuid/xlsx/preview",
    "downloadUrl": "/api/v1/reports/uuid/xlsx/download"
  }
}
```

Setiap generate membuat audit log `CREATE` dengan `entityType=XLSX_EXPORT` dan `classification=OPERATIONAL_LEGACY_EXPORT`. Nama `XLSX_EXPORT` dipertahankan demi kompatibilitas audit lama. File disimpan atomik pada `XLSX_EXPORT_DIR` (default `exports/xlsx`). Generate ulang laporan final yang sama mengganti file deterministiknya dan membuat audit baru.

Untuk shipment phase-aware, `finalSnapshot` pada saat `FINISH` adalah salinan persis snapshot BA UNLOADING. Export memilih tiga `loadingSignatures` untuk mempertahankan bentuk form segel tiga slot; file signature dibaca dengan storage key phase-aware. Enam signature BA dan appendix foto tetap hanya menjadi bagian dokumen PDF BA UNLOADING. Untuk laporan historis tanpa dokumen phase-aware, struktur `finalSnapshot` dan signature legacy tetap didukung.

### Preview dan download

- `GET /api/v1/shipments/:reportId/xlsx/preview` mengembalikan file dengan `Content-Disposition: inline`.
- `GET /api/v1/shipments/:reportId/xlsx/download` mengembalikan file dengan `Content-Disposition: attachment`.

Preview dan download membandingkan byte tersimpan dengan `fileSize` dan SHA-256 yang dicatat pada audit `XLSX_EXPORT` saat generate, menolak perbedaan dengan HTTP 409, dan mengirim header `X-Checksum-SHA256`.

Keduanya memakai `Cache-Control: private, no-store` dan `X-Content-Type-Options: nosniff`, serta mengembalikan HTTP 404 bila endpoint generate belum dipanggil.

## 3. Mapping header

| Data snapshot final | Cell/template |
|---|---|
| Voyage, Shipment Number, Sealing Status | `C2` pada area header kosong resmi |
| Vessel | `U9`; cached value formula narasi `C20` dan `BN22` diperbarui tanpa menghapus formula |
| Loading Plant/Jetty dan Discharge Plant/Jetty | `U11`, masing-masing diberi label Loading/Discharge |
| Product | `U13` |
| Tanggal/waktu | `U15`, format `id-ID` zona waktu `Asia/Jakarta` |
| Activity | `Y22` |
| Lokasi narasi `at the port of` | `AQ20`: discharge untuk `DISCHARGE`, loading untuk `LOADING` dan `ROB` |

`reportNo`, `shipmentNumber`, dan `voyageNumber` tidak disamakan. Nama master dibaca dari `finalSnapshot`, bukan master live.

## 4. Mapping form A-H

- A: matriks resmi lima kolom. Compartment dibagi berdasarkan side `PORT`/`STBD`; nama berisi `Slop` ditempatkan pada row Slop resmi. Beberapa instance/template sama ditulis multiline.
- B: lima row dan dua kolom Port/Stbd.
- C: slot FPT/APT pada panel pertama, lalu WBT P/S pada awal panel kedua.
- D: delapan row dan lima kolom valve resmi.
- E: tiga row dan dua kolom.
- F: tiga row compartment dan dua kolom seal.
- G: empat belas row equipment.
- H: empat row equipment.

Nomor segel aktif pada satu titik ditulis multiline. Seal `REMOVED`/`REPLACED` tidak dicetak. `NOT_APPLICABLE` dicetak literal; record tanpa hasil final yang dapat dicetak ditulis `NOT_SEALED`. Section `isAvailable=false` ditandai `NOT_APPLICABLE` pada slot pertama dan tidak menghasilkan titik buatan.

Urutan berasal dari sequence section, compartment, template, point, dan instance pada snapshot. Master live tidak digunakan.

## 5. Continuation page

Jika kapasitas section terlampaui, generator menambah worksheet `Segel Lanjutan N`. Setiap worksheet adalah klon lengkap template resmi, mengulang header dan tanda tangan, serta mempertahankan style, merge, ukuran kolom/baris, drawing logo, printer settings, margin, orientasi, dan page break. Header `C2` menunjukkan `Continuation x/y`.

Untuk matriks, overflow row dan kolom memakai kombinasi halaman agar tidak ada pasangan compartment–template yang hilang. Penambahan template ke-6 Bagian A, misalnya, tidak menimpa lima kolom resmi pada halaman pertama.

## 6. Tanda tangan

| Role | Nama/waktu | Area gambar |
|---|---|---|
| `CHIEF_OFFICER` | `GY123` | `GY111:ID122` |
| `TERMINAL_REPRESENTATIVE` | `IE123` | `IE111:JL122` |
| `SURVEYOR` | `JM123` | `JM111:KR122` |

JPEG, PNG, dan WebP terkelola disisipkan sebagai drawing OOXML setelah checksum diverifikasi terhadap snapshot final. PDF tidak dipaksa menjadi gambar: nama file PDF ditulis pada kotak tanda tangan. `signatureUrl` tanpa file terkelola ditulis sebagai referensi teks. Ini menghindari konversi PDF/raster yang tidak ditentukan sumber.

## 7. Error utama

| HTTP | Kondisi |
|---|---|
| 403 | Loading/Unloading Master bukan assignee laporan |
| 404 | Laporan/artefak/file tanda tangan tidak ditemukan |
| 409 | Laporan belum FINISH, final snapshot tidak kompatibel, template berubah, atau checksum tanda tangan berbeda |
| 500 | Template/anchor resmi tidak tersedia pada deployment |
