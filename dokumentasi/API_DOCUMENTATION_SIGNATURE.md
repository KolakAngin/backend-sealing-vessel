# API Dokumentasi dan Tanda Tangan — STEP 8

Snapshot implementasi: 8 September 2026.

Dokumentasi dan tanda tangan bersifat opsional. Ketiadaannya tidak menghalangi depart maupun finalisasi. STEP 8 hanya mengelola data dan file asli; tidak membuat generator XLSX, PDF laporan, atau contact sheet.

## Format, batas, dan metadata file

Upload menggunakan `multipart/form-data` dengan field file bernama `file` dan menerima:

- JPEG (`image/jpeg`);
- PNG (`image/png`);
- WebP (`image/webp`);
- PDF (`application/pdf`).

Server memeriksa MIME dari multipart dan signature bytes isi file. Batas ukuran berasal dari `MAX_UPLOAD_SIZE_BYTES`, default 10 MiB. Nama asli dibersihkan dari path traversal, karakter kontrol, dan karakter di luar whitelist sebelum disimpan sebagai metadata. Nama file fisik memakai UUID server, bukan nama dari client.

Metadata response mencakup `fileName`, `fileUrl`, `mimeType`, `fileSize`, `checksumSha256`, `type`, `caption`, `sequence`, `sectionCode`, `compartmentId`, `vesselSealingPointId`, uploader, dan waktu upload. `description` dipertahankan sebagai field legacy; request baru menggunakan `caption`.

## Owner dokumentasi

| Owner | Upload/list endpoint |
|---|---|
| Report | `POST/GET /api/v1/shipments/:reportId/attachments` |
| Section A–H | `POST/GET /api/v1/shipments/:reportId/sections/:sectionCode/attachments` |
| Sealing record | `POST/GET /api/v1/records/:recordId/attachments` |
| Verification | `POST/GET /api/v1/verifications/:verificationId/attachments` |

Prefix `reports` dan `voyages` tersedia sebagai alias untuk endpoint owner report/section.

Contoh upload section:

```text
POST /api/v1/shipments/{reportId}/sections/A/attachments
Content-Type: multipart/form-data

file=<binary>
caption=Foto sounding pipe 1P
sequence=1
vesselSealingPointId=<uuid>
compartmentId=<uuid>
```

Field multipart:

- `type`: `PHOTO`, `DOCUMENT`, atau `OTHER`; default PDF menjadi `DOCUMENT`, format gambar menjadi `PHOTO`;
- `caption`: teks opsional maksimal 2.000 karakter;
- `sequence`: integer opsional 0–2.147.483.647;
- `sectionCode`: A–H, opsional kecuali sudah ditentukan oleh route section;
- `compartmentId` dan `vesselSealingPointId`: konteks opsional.

Untuk owner record/verification, titik, compartment, dan section diturunkan dari `pointSnapshot`. Nilai request yang bertentangan ditolak. Untuk owner report/section, konteks diperiksa terhadap snapshot laporan; section yang tidak tersedia atau point dari vessel/report lain ditolak.

## Metadata, preview, download, dan hapus

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/v1/attachments/:id` | Metadata attachment. |
| `PATCH` | `/api/v1/attachments/:id` | Ubah `type`, `caption`, dan/atau `sequence`. |
| `GET` | `/api/v1/attachments/:id/preview` | Stream inline dengan `Content-Disposition: inline`. |
| `GET` | `/api/v1/attachments/:id/download` | Download dengan `Content-Disposition: attachment`. |
| `GET` | `/api/v1/attachments/:id/file` | Alias kompatibilitas untuk preview. |
| `DELETE` | `/api/v1/attachments/:id` | Hapus metadata dan file fisik. |

Response file memakai MIME tersimpan, `Cache-Control: private, no-store`, dan `X-Content-Type-Options: nosniff`.

## Authorization dan lifecycle dokumentasi

- Metadata/file hanya dapat dibaca user terautentikasi yang mempunyai akses ke report. Viewer dapat membaca; Loading/Unloading Master lain ditolak.
- Dokumentasi report, section, dan sealing record hanya dapat ditulis oleh Loading Master yang ditugaskan, Supervisor, atau Admin ketika `DRAFT`.
- Dokumentasi verification hanya dapat ditulis oleh Unloading Master yang ditugaskan, Supervisor, atau Admin ketika `SANDAR`.
- Update/delete metadata dibatasi lagi kepada uploader, Supervisor, atau Admin.
- Semua upload, update, dan delete ditolak setelah report `FINISH`.
- Mutation mengambil row lock report dan memeriksa ulang status di dalam transaksi, sehingga upload/update/delete yang bersamaan dengan finalisasi tidak dapat masuk setelah final snapshot terbentuk.
- Upload menyimpan file terlebih dahulu lalu menjalankan transaksi metadata+audit. Bila transaksi gagal, file fisik dibersihkan. Delete memindahkan file ke staging dan mengembalikannya bila transaksi database gagal.

## Tanda tangan

Role yang didukung tepat seperti layout sumber:

- `CHIEF_OFFICER`;
- `TERMINAL_REPRESENTATIVE`;
- `SURVEYOR`.

Constraint database `sealingReportId + role` memastikan maksimal satu tanda tangan per role per laporan.

Endpoint metadata:

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/v1/shipments/:reportId/signatures` | Daftar tiga slot tanda tangan. Prefix `reports`/`voyages` juga tersedia. |
| `POST` | `/api/v1/shipments/:reportId/signatures` | Buat metadata tanda tangan. |
| `GET` | `/api/v1/signatures/:id` | Detail metadata. |
| `PATCH` | `/api/v1/signatures/:id` | Ubah nama, user terkait, waktu, atau URL legacy. |
| `DELETE` | `/api/v1/signatures/:id` | Hapus metadata dan file terkelola. |

Body create:

```json
{
  "role": "CHIEF_OFFICER",
  "name": "Nama penanda tangan",
  "signedAt": "2026-09-08T12:00:00.000Z"
}
```

`userId`, `signedAt`, dan `signatureUrl` legacy boleh kosong. `name` wajib. File tanda tangan dikelola melalui:

| Method | Endpoint | Fungsi |
|---|---|---|
| `PUT` | `/api/v1/signatures/:id/file` | Upload/ganti JPEG, PNG, WebP, atau PDF. |
| `GET` | `/api/v1/signatures/:id/preview` | Preview inline. |
| `GET` | `/api/v1/signatures/:id/download` | Download file. |

File signature menyimpan nama aman, MIME, ukuran, dan SHA-256. Penggantian file memakai staging/rollback agar file lama tetap tersedia bila transaksi gagal.

Tanda tangan dapat diubah sebelum `FINISH` oleh Loading Master atau Unloading Master yang ditugaskan, Supervisor, atau Admin. Setelah finalisasi seluruh metadata dan file terkunci. Metadata attachment dan signature ikut dibekukan dalam `finalSnapshot`; isi binary tetap berada di storage dan dirujuk melalui metadata/checksum.

Semua mutation menghasilkan audit log. Tidak ada aturan tanda tangan wajib karena sumber belum menentukan role atau timing yang menjadi gate lifecycle.
