DOKUMENTASI BACKEND APLIKASI SEGEL KAPAL
Tahap 6 - Pengujian dan Dokumentasi API
Tanggal verifikasi: 3 September 2026

======================================================================
1. RINGKASAN
======================================================================

Backend Aplikasi Segel Kapal dibuat dengan Node.js, TypeScript, Express,
Prisma ORM, dan PostgreSQL. Sistem menyediakan autentikasi JWT, otorisasi
berdasarkan role, CRUD master data, transaksi laporan sealing, pengelolaan
seal, verifikasi, tanda tangan, audit log, serta lampiran gambar/dokumen.

======================================================================
2. TEKNOLOGI DAN STRUKTUR UTAMA
======================================================================

- Runtime        : Node.js
- Bahasa         : TypeScript (ECMAScript module)
- Web framework  : Express 5
- ORM            : Prisma ORM 7.10.0
- Database       : PostgreSQL
- Validasi input : Zod
- Autentikasi    : JWT menggunakan jose
- Password       : bcryptjs
- Upload         : Multer memory storage + penyimpanan lokal
- Test runner    : Node.js test runner melalui tsx

Direktori penting:

- prisma/schema.prisma       Skema database
- prisma/migrations/         Riwayat migrasi
- prisma/seed.ts             Seed admin dan master data
- src/routes/                Definisi endpoint
- src/controllers/           HTTP controller
- src/services/              Aturan bisnis dan query Prisma
- src/schemas/               Validasi request Zod
- src/middleware/            Auth, upload, validasi, error handler
- src/storage/               Penyimpanan lampiran lokal
- tests/                     Integration test
- uploads/                   File lampiran lokal (tidak masuk Git)

======================================================================
3. KONFIGURASI DAN MENJALANKAN APLIKASI
======================================================================

Salin dan isi environment berdasarkan .env.example:

DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/kapal_db"
NODE_ENV="development"
PORT="5001"
JWT_SECRET="rahasia-acak-minimal-32-karakter"
JWT_EXPIRES_IN_SECONDS="28800"
UPLOAD_DIR="uploads"
MAX_UPLOAD_SIZE_BYTES="10485760"
SEED_ADMIN_USERNAME="admin"
SEED_ADMIN_PASSWORD="password-kuat-minimal-8-karakter"
SEED_ADMIN_EMAIL="admin@example.com"

Catatan port:
Pada mesin pengembangan ini port 5000 digunakan macOS ControlCenter/AirPlay.
Gunakan PORT=5001 agar request tidak menerima 403 dari proses macOS.

Instalasi dan persiapan:

1. npm install
2. npx prisma migrate dev
3. npx prisma generate
4. npx prisma db seed
5. npm run dev

Alamat lokal yang direkomendasikan:

http://localhost:5001

Pemeriksaan service:

GET /api/v1/health

Contoh:

curl http://localhost:5001/api/v1/health

======================================================================
4. FORMAT RESPONS
======================================================================

Respons berhasil:

{
  "success": true,
  "message": "Pesan keberhasilan",
  "data": {},
  "timestamp": "2026-09-03T00:00:00.000Z"
}

Respons gagal:

{
  "success": false,
  "message": "Pesan kesalahan",
  "details": [],
  "timestamp": "2026-09-03T00:00:00.000Z"
}

Kode HTTP utama:

- 200 OK
- 201 Created
- 400 request atau aturan bisnis tidak valid
- 401 token tidak tersedia/tidak valid
- 403 role tidak memiliki izin
- 404 data tidak ditemukan
- 409 konflik data/relasi
- 413 file melebihi batas ukuran
- 415 format file tidak didukung
- 500 kesalahan internal server

======================================================================
5. AUTENTIKASI DAN ROLE
======================================================================

Role yang tersedia:

- ADMIN      Akses penuh dan manajemen user
- SUPERVISOR Kelola master/transaksi dan review laporan
- OPERATOR   Membuat dan mengelola transaksi miliknya
- VIEWER     Akses baca pada endpoint yang diizinkan

Login:

POST /api/v1/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "PASSWORD_DARI_ENV"
}

Contoh curl:

curl -X POST http://localhost:5001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PASSWORD_DARI_ENV"}'

Gunakan accessToken pada request terlindungi:

Authorization: Bearer ACCESS_TOKEN

Endpoint autentikasi:

- POST /api/v1/auth/login     Publik
- GET  /api/v1/auth/me        Semua user terautentikasi

======================================================================
6. DAFTAR ENDPOINT API
======================================================================

Base URL: http://localhost:5001/api/v1

6.1 User (khusus ADMIN)

- GET    /users
- POST   /users
- GET    /users/:id
- PATCH  /users/:id
- DELETE /users/:id           Menonaktifkan user

Query daftar user: page, limit, search, role, isActive, sortBy, sortOrder.

6.2 Terminal

- GET    /terminals           Semua user terautentikasi
- GET    /terminals/:id       Semua user terautentikasi
- POST   /terminals           ADMIN/SUPERVISOR
- PATCH  /terminals/:id       ADMIN/SUPERVISOR
- DELETE /terminals/:id       ADMIN; menonaktifkan terminal

6.3 Vessel

- GET    /vessels
- POST   /vessels
- GET    /vessels/:id
- PATCH  /vessels/:id
- DELETE /vessels/:id
- GET    /vessels/:vesselId/compartments
- GET    /vessels/:vesselId/sealing-points

6.4 Compartment

- GET    /compartments
- POST   /compartments
- GET    /compartments/:id
- PATCH  /compartments/:id
- DELETE /compartments/:id

6.5 Kategori dan template titik sealing

- GET    /sealing-categories
- POST   /sealing-categories
- GET    /sealing-categories/:id
- PATCH  /sealing-categories/:id
- DELETE /sealing-categories/:id
- GET    /sealing-categories/:categoryId/templates
- GET    /sealing-point-templates
- POST   /sealing-point-templates
- GET    /sealing-point-templates/:id
- PATCH  /sealing-point-templates/:id
- DELETE /sealing-point-templates/:id

6.6 Titik sealing vessel

- GET    /vessel-sealing-points
- POST   /vessel-sealing-points
- GET    /vessel-sealing-points/:id
- PATCH  /vessel-sealing-points/:id
- DELETE /vessel-sealing-points/:id

Aturan akses master data:
GET memerlukan autentikasi. POST/PATCH memerlukan ADMIN atau SUPERVISOR.
DELETE memerlukan ADMIN.

6.7 Laporan sealing

- GET    /reports
- POST   /reports
- GET    /reports/:id
- PATCH  /reports/:id
- DELETE /reports/:id
- POST   /reports/:id/submit
- POST   /reports/:id/verify
- POST   /reports/:id/approve
- POST   /reports/:id/reject

Contoh membuat laporan:

{
  "reportNo": "RPT-2026-001",
  "vesselId": "UUID_VESSEL",
  "terminalId": "UUID_TERMINAL",
  "cargo": "Crude Oil",
  "operationType": "LOADING",
  "reportDateTime": "2026-09-03T08:00:00.000Z",
  "loadingMasterSurveyorName": "Nama Surveyor",
  "portName": "Balikpapan",
  "remarks": "Catatan"
}

Status laporan dan transisi:

DRAFT -> SUBMITTED -> VERIFIED -> APPROVED
                    \-> REJECTED
         \-----------------------> REJECTED

- Submit dilakukan ADMIN/SUPERVISOR/OPERATOR pemilik laporan.
- Verify/approve/reject hanya ADMIN atau SUPERVISOR.
- Laporan harus memiliki minimal satu record sebelum submit.
- Laporan DRAFT dapat diedit atau dihapus oleh pemilik/manager.

6.8 Record sealing

- GET    /reports/:reportId/records
- POST   /reports/:reportId/records
- PATCH  /records/:id
- DELETE /records/:id

Status record: SEALED, NOT_SEALED, NOT_APPLICABLE.

6.9 Seal dan verifikasi

- POST  /records/:recordId/seals
- PATCH /seals/:id
- POST  /seals/:id/remove
- POST  /seals/:id/replace
- POST  /seals/:id/verify       ADMIN/SUPERVISOR

Kondisi verifikasi: GOOD, DAMAGED, BROKEN, MISSING, OTHER.

6.10 Tanda tangan laporan

- GET    /reports/:reportId/signatures
- POST   /reports/:reportId/signatures
- PATCH  /signatures/:id
- DELETE /signatures/:id

Role tanda tangan: CHIEF_OFFICER, TERMINAL_REPRESENTATIVE, SURVEYOR.

6.11 Audit log

- GET /audit-logs              ADMIN/SUPERVISOR

Query: page, limit, entityType, entityId, action.

6.12 Lampiran gambar dan dokumen

- POST   /reports/:reportId/attachments
- POST   /records/:recordId/attachments
- POST   /verifications/:verificationId/attachments
- GET    /attachments/:id
- GET    /attachments/:id/file
- DELETE /attachments/:id

Upload menggunakan multipart/form-data:

- file        Wajib; tipe File
- type        Opsional; PHOTO, DOCUMENT, atau OTHER
- description Opsional; maksimal 2000 karakter
- sequence    Opsional; bilangan bulat >= 0

Format file yang diterima: JPEG, PNG, WebP, PDF.
Batas default: 10 MB. Sistem memvalidasi signature/magic bytes file.
Lampiran hanya dapat ditambahkan ketika laporan DRAFT atau SUBMITTED.

Contoh upload:

curl -X POST http://localhost:5001/api/v1/reports/REPORT_ID/attachments \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -F "file=@/path/foto.png" \
  -F "type=PHOTO" \
  -F "description=Foto bukti pemasangan seal" \
  -F "sequence=1"

Contoh download:

curl http://localhost:5001/api/v1/attachments/ATTACHMENT_ID/file \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  --output lampiran.png

======================================================================
7. PENGUJIAN TAHAP 6
======================================================================

Perintah yang dijalankan pada 3 September 2026:

1. npx prisma validate
   Hasil: LULUS - schema.prisma valid.

2. npx prisma migrate status
   Hasil: LULUS - 3 migrasi ditemukan dan database schema up to date.

3. npm run typecheck
   Hasil: LULUS - tidak ada error TypeScript.

4. npm run build
   Hasil: LULUS - kompilasi produksi berhasil.

5. npm test
   Hasil: LULUS - 5 test, 5 lulus, 0 gagal.

Cakupan integration test:

- Upload, validasi isi, download, dan hapus lampiran.
- Autentikasi, authorization, dan CRUD user.
- CRUD master data dan relasinya.
- CRUD terminal.
- Transaksi sealing end-to-end dan audit log.

Waktu integration suite terakhir: sekitar 4,8 detik.

Catatan non-blocking:
Driver pg menampilkan DeprecationWarning tentang client.query() yang dipanggil
ketika client masih menjalankan query. Seluruh test tetap lulus. Peringatan ini
perlu dipantau saat upgrade pg ke versi mayor berikutnya.

======================================================================
8. CHECKLIST UJI MANUAL POSTMAN
======================================================================

1. Jalankan npm run dev pada port 5001.
2. GET /health dan pastikan HTTP 200.
3. POST /auth/login dan simpan accessToken.
4. Set Authorization -> Bearer Token pada collection Postman.
5. Buat/ambil vessel, terminal, compartment, dan sealing point.
6. Buat laporan DRAFT.
7. Tambahkan sealing record.
8. Tambahkan nomor seal.
9. Upload foto ke laporan atau record.
10. Ambil metadata dan download foto.
11. Submit laporan.
12. Login sebagai ADMIN/SUPERVISOR dan verifikasi seal/laporan.
13. Approve atau reject laporan.
14. Periksa audit log.

======================================================================
9. PERINTAH OPERASIONAL
======================================================================

npm run dev                 Menjalankan development server
npm run typecheck           Memeriksa tipe TypeScript
npm run build               Membuat build produksi
npm start                   Menjalankan build produksi
npm test                    Menjalankan seluruh integration test
npm run prisma:generate     Generate Prisma Client
npm run prisma:migrate      Membuat/menerapkan migrasi development
npm run prisma:seed         Menjalankan seed
npx prisma migrate status   Memeriksa status migrasi

======================================================================
10. KESIMPULAN
======================================================================

Backend telah lulus Tahap 6 untuk lingkup fitur yang tersedia saat ini.
Autentikasi, master data, transaksi sealing, upload gambar/dokumen, audit,
schema database, typecheck, build, dan integration test telah diverifikasi.

Sebelum deployment produksi, gunakan object storage (misalnya S3/R2), HTTPS,
secret produksi, backup database, rate limiting, observability/log terpusat,
serta CI/CD yang menjalankan migrasi dan test secara otomatis.
