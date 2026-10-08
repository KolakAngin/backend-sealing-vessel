# Panduan Akses API Berdasarkan Role

Dokumen ini menjelaskan API Backend Aplikasi Segel Kapal dari sudut pandang pengguna. Tujuannya agar pembaca yang belum memahami backend tetap dapat mengetahui:

- apa yang dapat dilakukan setiap role;
- endpoint yang harus dipanggil;
- method HTTP yang harus digunakan;
- urutan kerja dari awal sampai selesai;
- data yang harus dikirim;
- contoh request dan hasil yang diharapkan;
- penyebab umum request ditolak.

Urutan role dalam dokumen ini adalah:

1. `ADMIN`
2. `SUPERVISOR`
3. `LOADING_MASTER`
4. `UNLOADING_MASTER`
5. `VIEWER`

Dokumen ini mengikuti implementasi backend pada 10 September 2026. Jika dokumentasi lama berbeda dengan dokumen ini, route dan aturan service backend terbaru menjadi acuan.

---

## 1. Istilah dasar yang perlu diketahui

### 1.1 Apa itu API?

API adalah pintu yang digunakan frontend, aplikasi mobile, Postman, atau sistem lain untuk meminta backend melakukan sesuatu.

Contoh:

- untuk melihat daftar vessel, aplikasi memanggil `GET /api/v1/vessels`;
- untuk membuat vessel, aplikasi memanggil `POST /api/v1/vessels`;
- untuk mengubah vessel, aplikasi memanggil `PATCH /api/v1/vessels/:id`.

### 1.2 Arti method HTTP

| Method | Arti sederhana | Contoh penggunaan |
|---|---|---|
| `GET` | Mengambil atau melihat data | Melihat daftar vessel |
| `POST` | Membuat data atau menjalankan suatu proses | Membuat shipment atau memberangkatkan kapal |
| `PATCH` | Mengubah sebagian data yang sudah ada | Mengganti nama vessel |
| `PUT` | Menyimpan atau mengganti satu data secara lengkap | Mengisi satu titik Form A–H |
| `DELETE` | Menghapus atau menonaktifkan data | Menonaktifkan vessel |

`DELETE` pada sebagian besar master data adalah soft delete: record tidak benar-benar hilang, tetapi `isActive` diubah menjadi `false`. Penghapusan shipment `DRAFT`, assignment Plant–Jetty, attachment, dan beberapa data transaksi dapat benar-benar menghapus record.

### 1.3 Base URL

Contoh alamat backend lokal:

```text
http://localhost:5001
```

Base URL API:

```text
http://localhost:5001/api/v1
```

Contoh endpoint relatif:

```text
GET /vessels
```

berarti alamat lengkapnya:

```text
GET http://localhost:5001/api/v1/vessels
```

Alamat server produksi dapat berbeda. Ganti `http://localhost:5001` dengan alamat backend pada environment yang digunakan.

### 1.4 Header yang wajib

Untuk request JSON:

```http
Content-Type: application/json
Authorization: Bearer <ACCESS_TOKEN>
```

Untuk upload file, gunakan `multipart/form-data`. Jangan menetapkan boundary multipart secara manual; Postman, browser, atau perintah `curl -F` akan membuatnya.

Semua endpoint memerlukan token kecuali:

- `GET /`;
- `GET /api/v1/health`;
- `POST /api/v1/auth/login`.

### 1.5 Arti placeholder

Contoh path:

```text
/api/v1/vessels/<VESSEL_ID>
```

`<VESSEL_ID>` harus diganti dengan ID sebenarnya dari response API, misalnya:

```text
/api/v1/vessels/8c5ebae7-f36a-4671-a253-58a0a324697b
```

Placeholder yang sering digunakan:

| Placeholder | Artinya |
|---|---|
| `<ACCESS_TOKEN>` | Token hasil login |
| `<USER_ID>` | ID user |
| `<VESSEL_ID>` | ID vessel |
| `<SHIPMENT_ID>` | ID shipment; pada backend juga disebut report ID |
| `<POINT_ID>` | `vesselSealingPointId` dari Form A–H |
| `<RECORD_ID>` | ID sealing record |
| `<SEAL_ID>` | ID segel |
| `<VERIFICATION_ID>` | ID hasil verifikasi segel |
| `<ATTACHMENT_ID>` | ID attachment |
| `<SIGNATURE_ID>` | ID metadata tanda tangan |

### 1.6 Format response

Response JSON berhasil mempunyai bentuk umum:

```json
{
  "success": true,
  "message": "Operasi berhasil",
  "data": {},
  "timestamp": "2026-09-10T08:00:00.000Z"
}
```

Response daftar biasanya mempunyai informasi pagination:

```json
{
  "success": true,
  "message": "Daftar berhasil diambil",
  "data": [],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  },
  "timestamp": "2026-09-10T08:00:00.000Z"
}
```

Response gagal mempunyai bentuk umum:

```json
{
  "success": false,
  "message": "Pesan kesalahan",
  "details": [],
  "timestamp": "2026-09-10T08:00:00.000Z"
}
```

Kode HTTP penting:

| Kode | Makna | Tindakan pengguna/developer |
|---|---|---|
| `200` | Request berhasil | Gunakan data response |
| `201` | Data berhasil dibuat | Simpan `data.id` jika diperlukan untuk langkah berikutnya |
| `400` | Isi request atau urutan proses salah | Baca `message` dan `details`, lalu perbaiki input |
| `401` | Token tidak ada, salah, atau kedaluwarsa | Login kembali dan gunakan token baru |
| `403` | Role atau assignment tidak mengizinkan | Jangan mengulang request tanpa memperbaiki role/assignment |
| `404` | Data tidak ditemukan | Periksa ID atau pastikan data sudah dibuat |
| `409` | Konflik data | Periksa nilai unik, relasi yang masih digunakan, checksum, atau status final |
| `413` | File terlalu besar | Kecilkan file; batas default 10 MiB |
| `415` | Format file tidak didukung | Gunakan JPEG, PNG, WebP, atau PDF |
| `500` | Kesalahan internal server | Catat request dan periksa log backend |

> Catatan: contoh response pada dokumen ini dipersingkat. Field aktual dapat lebih banyak.

---

## 2. Langkah awal untuk semua role

### 2.1 Periksa apakah backend hidup

```bash
curl http://localhost:5001/api/v1/health
```

Hasil yang diharapkan:

```json
{
  "success": true,
  "message": "Service sehat",
  "data": {
    "status": "ok",
    "uptime": 120
  },
  "timestamp": "2026-09-10T08:00:00.000Z"
}
```

### 2.2 Login

Endpoint:

```text
POST /api/v1/auth/login
```

Body JSON:

```json
{
  "username": "nama.user",
  "password": "password-user"
}
```

Contoh `curl`:

```bash
curl -X POST http://localhost:5001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nama.user","password":"password-user"}'
```

Contoh hasil:

```json
{
  "success": true,
  "message": "Login berhasil",
  "data": {
    "accessToken": "eyJ...",
    "tokenType": "Bearer",
    "expiresIn": 28800,
    "user": {
      "id": "uuid-user",
      "username": "nama.user",
      "fullName": "Nama User",
      "role": "LOADING_MASTER",
      "isActive": true
    }
  }
}
```

Salin nilai `data.accessToken`. Token tersebut harus dikirim pada setiap request selanjutnya:

```http
Authorization: Bearer eyJ...
```

### 2.3 Memeriksa identitas dan role sendiri

```bash
curl http://localhost:5001/api/v1/auth/me \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Frontend disarankan memanggil endpoint ini setelah aplikasi dibuka kembali untuk memastikan token masih valid, user masih aktif, dan role user belum berubah.

### 2.4 Cara memasukkan request di Postman

Untuk request JSON:

1. Pilih method, misalnya `POST`.
2. Masukkan URL lengkap.
3. Buka tab **Authorization**.
4. Pilih **Bearer Token**.
5. Tempel access token tanpa menulis kata `Bearer` lagi.
6. Buka **Body → raw → JSON**.
7. Masukkan body sesuai contoh.
8. Tekan **Send**.

Untuk upload file:

1. Pilih method dan URL.
2. Isi Bearer Token.
3. Buka **Body → form-data**.
4. Buat key `file`, ubah jenisnya menjadi **File**, lalu pilih file.
5. Tambahkan key teks lain seperti `caption` jika diperlukan.
6. Tekan **Send**.

---

# 3. ADMIN

## 3.1 Tanggung jawab Admin

Admin mengelola akun pengguna, seluruh master data, konfigurasi vessel, assignment Plant–Jetty, dan dapat membantu seluruh proses transaksi. Admin dapat mengakses semua shipment tanpa dibatasi assignment.

## 3.2 Ringkasan endpoint Admin

| Fungsi | Method dan endpoint |
|---|---|
| Melihat profil sendiri | `GET /auth/me` |
| CRUD user | `GET/POST /users`, `GET/PATCH/DELETE /users/:id` |
| CRUD Terminal | `GET/POST /terminals`, `GET/PATCH/DELETE /terminals/:id` |
| CRUD Plant | `GET/POST /plants`, `GET/PATCH/DELETE /plants/:id` |
| CRUD Jetty | `GET/POST /jetties`, `GET/PATCH/DELETE /jetties/:id` |
| CRUD Activity | `GET/POST /activities`, `GET/PATCH/DELETE /activities/:id` |
| CRUD Product | `GET/POST /products`, `GET/PATCH/DELETE /products/:id` |
| CRUD Unit of Measure | `GET/POST /units-of-measure`, `GET/PATCH/DELETE /units-of-measure/:id` |
| Assignment Plant–Jetty | `GET/POST /plant-jetty-assignments`, `DELETE /plant-jetty-assignments/:id` |
| CRUD vessel | `GET/POST /vessels`, `GET/PATCH/DELETE /vessels/:id` |
| CRUD compartment | `GET/POST /compartments`, `GET/PATCH/DELETE /compartments/:id` |
| CRUD section A–H | `GET/POST /sealing-categories`, `GET/PATCH/DELETE /sealing-categories/:id` |
| CRUD template titik | `GET/POST /sealing-point-templates`, `GET/PATCH/DELETE /sealing-point-templates/:id` |
| CRUD titik vessel | `GET/POST /vessel-sealing-points`, `GET/PATCH/DELETE /vessel-sealing-points/:id` |
| Seluruh transaksi shipment | Endpoint shipment loading dan unloading |
| Audit log | `GET /audit-logs` |

Semua path pada tabel memakai prefix `/api/v1`.

## 3.3 A–Z membuat dan mengelola user

### Langkah 1 — Lihat user yang sudah ada

```bash
curl "http://localhost:5001/api/v1/users?page=1&limit=10&role=LOADING_MASTER&isActive=true" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Filter yang tersedia: `page`, `limit`, `search`, `role`, `isActive`, `sortBy`, dan `sortOrder`.

### Langkah 2 — Buat user

```bash
curl -X POST http://localhost:5001/api/v1/users \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "username":"loading.master.01",
    "password":"PasswordKuat123!",
    "fullName":"Loading Master 01",
    "email":"lm01@example.com",
    "role":"LOADING_MASTER",
    "isActive":true
  }'
```

Simpan nilai `data.id` sebagai `<USER_ID>`.

Aturan penting:

- username minimal 3 karakter dan disimpan lowercase;
- password 8–72 karakter;
- username dan email harus unik;
- `email` boleh `null`;
- role harus salah satu dari lima role aplikasi.

### Langkah 3 — Lihat detail user

```bash
curl http://localhost:5001/api/v1/users/<USER_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### Langkah 4 — Ubah user

`PATCH` cukup mengirim field yang ingin diubah:

```bash
curl -X PATCH http://localhost:5001/api/v1/users/<USER_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName":"Loading Master Area 01",
    "role":"LOADING_MASTER"
  }'
```

Untuk reset password melalui API yang sama:

```json
{
  "password": "PasswordBaru123!"
}
```

### Langkah 5 — Nonaktifkan user

```bash
curl -X DELETE http://localhost:5001/api/v1/users/<USER_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

User menjadi `isActive=false` dan tidak dapat login. Admin tidak dapat menonaktifkan akun dirinya sendiri.

Untuk mengaktifkan kembali:

```bash
curl -X PATCH http://localhost:5001/api/v1/users/<USER_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"isActive":true}'
```

## 3.4 Pola A–Z mengelola master data

Semua master berikut memakai pola yang sama:

1. `GET /resource` untuk melihat daftar.
2. `POST /resource` untuk membuat.
3. Ambil `data.id` dari response.
4. `GET /resource/:id` untuk melihat detail.
5. `PATCH /resource/:id` untuk mengubah sebagian field.
6. `DELETE /resource/:id` untuk menonaktifkan.

### Daftar resource dan contoh body create

| Master | Endpoint | Contoh body `POST` |
|---|---|---|
| Terminal | `/terminals` | `{"code":"TML-01","name":"Terminal Utama","address":"Alamat","city":"Balikpapan","isActive":true}` |
| Plant | `/plants` | `{"code":"PLT-01","name":"Plant Utama","sequence":1,"isActive":true}` |
| Jetty | `/jetties` | `{"name":"Jetty 1","sequence":1,"isActive":true}` |
| Activity | `/activities` | `{"code":"LOADING","name":"Loading","sequence":1,"isActive":true}` |
| Product | `/products` | `{"name":"Fuel Oil","sequence":1,"isActive":true}` |
| Unit of Measure | `/units-of-measure` | `{"code":"KL","sequence":1,"isActive":true}` |

Contoh lengkap membuat Plant:

```bash
curl -X POST http://localhost:5001/api/v1/plants \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "code":"PLT-01",
    "name":"Plant Utama",
    "sequence":1,
    "isActive":true
  }'
```

Contoh melihat dan mencari Plant:

```bash
curl "http://localhost:5001/api/v1/plants?page=1&limit=10&search=utama&isActive=true&sortOrder=asc" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Contoh mengubah Plant:

```bash
curl -X PATCH http://localhost:5001/api/v1/plants/<PLANT_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Plant Utama Baru","sequence":2}'
```

Contoh menonaktifkan Plant:

```bash
curl -X DELETE http://localhost:5001/api/v1/plants/<PLANT_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Gunakan pola yang sama untuk endpoint master lainnya dengan body sesuai tabel.

Activity yang dipakai shipment harus memiliki kode `LOADING`, `DISCHARGE`, atau `ROB`.

## 3.5 A–Z membuat relasi Plant–Jetty

Shipment hanya dapat dibuat jika Jetty sudah dihubungkan dengan Plant.

### Langkah 1 — Ambil ID Plant

```text
GET /api/v1/plants?isActive=true
```

### Langkah 2 — Ambil ID Jetty

```text
GET /api/v1/jetties?isActive=true
```

### Langkah 3 — Buat assignment

```bash
curl -X POST http://localhost:5001/api/v1/plant-jetty-assignments \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "plantId":"<PLANT_ID>",
    "jettyId":"<JETTY_ID>"
  }'
```

Plant dan Jetty harus aktif. Kombinasi yang sama tidak boleh dibuat dua kali.

### Langkah 4 — Periksa assignment

```bash
curl "http://localhost:5001/api/v1/plant-jetty-assignments?plantId=<PLANT_ID>" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

### Langkah 5 — Hapus jika salah

```bash
curl -X DELETE http://localhost:5001/api/v1/plant-jetty-assignments/<ASSIGNMENT_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Assignment tidak dapat dihapus jika sudah digunakan oleh shipment.

## 3.6 A–Z membuat vessel dan konfigurasi Form A–H

Urutan yang benar adalah:

```text
Vessel + compartment
        ↓
Section/kategori A–H
        ↓
Template jenis titik
        ↓
Titik aktual pada vessel
        ↓
Konfigurasi siap dipakai oleh shipment
```

### Langkah 1 — Buat vessel beserta minimal satu compartment

```bash
curl -X POST http://localhost:5001/api/v1/vessels \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"MT CONTOH",
    "imoNumber":"IMO1234567",
    "vesselType":"TANKER",
    "productGroup":"BBM",
    "owner":"PT Contoh",
    "flag":"Indonesia",
    "deadweightTonnage":12000,
    "capacity":15000,
    "tankCount":2,
    "drawingStatus":"YES",
    "drawingFileUrl":null,
    "drawingLink":null,
    "isActive":true,
    "compartments":[
      {
        "code":"COT-1P",
        "name":"Cargo Oil Tank 1 Port",
        "side":"PORT",
        "sequence":1,
        "description":null,
        "isActive":true
      },
      {
        "code":"COT-1S",
        "name":"Cargo Oil Tank 1 Starboard",
        "side":"STBD",
        "sequence":2,
        "description":null,
        "isActive":true
      }
    ]
  }'
```

Nilai `vesselType`: `TANKER`, `BARGE`, `SPOB`, `OTHER`, `MT`, atau `OB`.

Nilai `side`: `PORT`, `STBD`, `CENTER`, atau `null`.

Simpan `data.id` sebagai `<VESSEL_ID>` dan ID setiap compartment sebagai `<COMPARTMENT_ID>`.

### Langkah 2 — Periksa compartment vessel

```bash
curl http://localhost:5001/api/v1/vessels/<VESSEL_ID>/compartments \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Jika perlu menambah compartment setelah vessel dibuat:

```bash
curl -X POST http://localhost:5001/api/v1/compartments \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "vesselId":"<VESSEL_ID>",
    "code":"COT-2P",
    "name":"Cargo Oil Tank 2 Port",
    "side":"PORT",
    "sequence":3,
    "description":null,
    "isActive":true
  }'
```

### Langkah 3 — Buat section A–H jika belum tersedia

Contoh membuat Section A:

```bash
curl -X POST http://localhost:5001/api/v1/sealing-categories \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "code":"A",
    "name":"Cargo Oil Tank",
    "description":"Titik segel pada cargo tank",
    "sequence":1,
    "isActive":true
  }'
```

Simpan `data.id` sebagai `<CATEGORY_ID>`.

### Langkah 4 — Buat template titik

```bash
curl -X POST http://localhost:5001/api/v1/sealing-point-templates \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "categoryId":"<CATEGORY_ID>",
    "code":"SOUNDING",
    "name":"Sounding Pipe",
    "description":"Lubang sounding cargo tank",
    "requiresCompartment":true,
    "supportsSide":true,
    "sequence":1,
    "isActive":true
  }'
```

Simpan `data.id` sebagai `<TEMPLATE_ID>`.

`requiresCompartment=true` berarti setiap titik aktual dari template ini wajib menunjuk compartment.

### Langkah 5 — Pasang template sebagai titik aktual vessel

```bash
curl -X POST http://localhost:5001/api/v1/vessel-sealing-points \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "vesselId":"<VESSEL_ID>",
    "sealingPointTemplateId":"<TEMPLATE_ID>",
    "compartmentId":"<COMPARTMENT_ID>",
    "code":"COT-1P-SOUNDING-1",
    "displayName":"Sounding Pipe COT 1P",
    "side":"PORT",
    "locationName":"Main Deck",
    "instanceNo":1,
    "isRequired":true,
    "sequence":1,
    "availability":"AVAILABLE",
    "description":null,
    "isActive":true
  }'
```

Nilai `availability`: `AVAILABLE`, `NOT_AVAILABLE`, atau `INACTIVE`.

`isRequired=true` berarti titik wajib diselesaikan sebelum kapal dapat berangkat.

### Langkah 6 — Verifikasi konfigurasi vessel

```bash
curl http://localhost:5001/api/v1/vessels/<VESSEL_ID>/sealing-points \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Ulangi pembuatan titik untuk seluruh posisi yang diperlukan pada Section A–H.

### Mengubah vessel

Gunakan `PATCH`; jangan sertakan `compartments`:

```bash
curl -X PATCH http://localhost:5001/api/v1/vessels/<VESSEL_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"owner":"PT Pemilik Baru","drawingStatus":"YES"}'
```

Mengubah konfigurasi master tidak mengubah Form A–H shipment lama karena shipment menyimpan snapshot konfigurasi.

### Menonaktifkan vessel

```bash
curl -X DELETE http://localhost:5001/api/v1/vessels/<VESSEL_ID> \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Vessel nonaktif tidak dapat digunakan untuk membuat shipment baru.

## 3.7 Admin menjalankan transaksi shipment

Admin dapat menjalankan endpoint transaksi yang dijelaskan pada bagian Loading Master dan Unloading Master. Perbedaannya:

- Admin dapat mengakses semua shipment;
- Admin wajib mengirim `loadingMasterId` ketika membuat shipment canonical;
- Admin dapat menetapkan atau mengganti Loading Master lain;
- Admin dapat menjalankan proses loading dan unloading tanpa menjadi assignee;
- aturan status dan validasi bisnis tetap berlaku bagi Admin.

Contoh membuat shipment sebagai Admin:

```bash
curl -X POST http://localhost:5001/api/v1/shipments \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "vesselId":"<VESSEL_ID>",
    "activityId":"<ACTIVITY_ID>",
    "reportDateTime":"2026-09-10T08:00:00.000Z",
    "voyageNumber":"VOY-001",
    "shipmentNumber":"SHP-001",
    "productId":"<PRODUCT_ID>",
    "loadingPlantId":"<LOADING_PLANT_ID>",
    "loadingJettyId":"<LOADING_JETTY_ID>",
    "dischargePlantId":"<DISCHARGE_PLANT_ID>",
    "dischargeJettyId":"<DISCHARGE_JETTY_ID>",
    "sealingStatus":"READY",
    "loadingMasterId":"<LOADING_MASTER_USER_ID>",
    "unloadingMasterId":"<UNLOADING_MASTER_USER_ID>",
    "loadingMasterSurveyorName":"Nama Surveyor",
    "remarks":"Shipment dibuat oleh Admin"
  }'
```

Selanjutnya ikuti alur operasional pada:

- Bagian 5 untuk persiapan dan keberangkatan;
- Bagian 6 untuk kedatangan dan finalisasi;
- Bagian 4 untuk fungsi pengawasan lintas assignment.

Urutan lengkap bila Admin menjalankan transaksi dari awal sampai akhir adalah:

1. `POST /shipments` — buat shipment dan tetapkan LM/UM.
2. `POST /shipments/:id/prepare-seals` — ambil snapshot konfigurasi vessel.
3. `GET /shipments/:id/form` — ambil seluruh ID titik.
4. `PUT /shipments/:id/form/points/:pointId` — isi titik dan nomor segel.
5. `POST /shipments/:id/attachments` atau endpoint attachment section/record — tambah bukti loading.
6. `POST /shipments/:id/signatures` dan `PUT /signatures/:id/file` — tambah tanda tangan jika tersedia.
7. `GET /shipments/:id/validation` — pastikan validasi depart lolos.
8. `POST /shipments/:id/depart` — ubah `DRAFT` menjadi `BERLAYAR`.
9. `POST /shipments/:id/arrive` — ubah `BERLAYAR` menjadi `SANDAR`.
10. `POST /seals/:id/verify` — verifikasi semua segel aktif.
11. `POST /verifications/:id/attachments` — tambah bukti verifikasi jika tersedia.
12. `GET /shipments/:id/validation` — pastikan validasi finalisasi lolos.
13. `POST /shipments/:id/finalize` — kunci transaksi menjadi `FINISH`.
14. `POST /shipments/:id/pdf` dan `POST /shipments/:id/xlsx` — buat dokumen resmi.
15. `GET /shipments/:id/pdf/download` atau `/xlsx/download` — unduh hasil.

## 3.8 Melihat audit log

```bash
curl "http://localhost:5001/api/v1/audit-logs?page=1&limit=20&action=CREATE" \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Filter tersedia:

- `entityType`, misalnya `SHIPMENT_VOYAGE`, `SEAL`, atau `USER`;
- `entityId`;
- `action`: `CREATE`, `UPDATE`, `DELETE`, `SUBMIT`, `VERIFY`, `APPROVE`, `REJECT`, `INSTALL_SEAL`, `REMOVE_SEAL`, `REPLACE_SEAL`, `DEPART`, `ARRIVE`, `FINISH`, atau `FINALIZE`;
- `page` dan `limit`.

---

# 4. SUPERVISOR

## 4.1 Tanggung jawab Supervisor

Supervisor mengawasi seluruh operasi shipment. Supervisor dapat bekerja lintas assignment, membantu proses Loading Master dan Unloading Master, mengatur penanggung jawab shipment, serta membaca audit log. Supervisor tidak dapat mengubah user, master data, konfigurasi vessel, Terminal, atau assignment Plant–Jetty.

## 4.2 Ringkasan endpoint Supervisor

| Fungsi | Endpoint |
|---|---|
| Membaca seluruh master | Semua endpoint `GET` master |
| Melihat semua shipment | `GET /shipments` dan `GET /shipments/:id` |
| Membuat shipment | `POST /shipments` |
| Mengubah/menghapus draft | `PATCH/DELETE /shipments/:id` |
| Menentukan LM/UM | Field assignment pada create/update shipment |
| Menyiapkan Form A–H | `POST /shipments/:id/prepare-seals` |
| Mengelola Form A–H | Endpoint `/shipments/:reportId/form/...` |
| Mengelola segel loading | Endpoint record/seal pada status `DRAFT` |
| Depart | `POST /shipments/:id/depart` |
| Arrive | `POST /shipments/:id/arrive` |
| Verifikasi | `POST /seals/:id/verify` |
| Finish/finalize | `POST /shipments/:id/finalize` |
| Dokumentasi dan signature | Endpoint attachment/signature |
| PDF/XLSX | Endpoint generate, preview, dan download |
| Audit | `GET /audit-logs` |

## 4.3 A–Z membuat dan membagikan shipment

### Langkah 1 — Ambil referensi master

Supervisor hanya membaca master yang sudah disiapkan Admin:

```text
GET /api/v1/vessels?isActive=true
GET /api/v1/activities?isActive=true
GET /api/v1/products?isActive=true
GET /api/v1/plants?isActive=true
GET /api/v1/jetties?isActive=true
GET /api/v1/plant-jetty-assignments
```

Setiap request menggunakan header `Authorization: Bearer <SUPERVISOR_TOKEN>`.

Untuk mendapatkan ID Loading/Unloading Master, Supervisor tidak dapat memakai `GET /users` karena endpoint user khusus Admin. Frontend perlu memperoleh pilihan user assignment melalui mekanisme yang disediakan Admin atau data yang sudah tersedia dalam aplikasi. Backend saat ini belum mempunyai endpoint lookup assignee khusus Supervisor.

### Langkah 2 — Buat shipment

```bash
curl -X POST http://localhost:5001/api/v1/shipments \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "vesselId":"<VESSEL_ID>",
    "activityId":"<ACTIVITY_ID>",
    "reportDateTime":"2026-09-10T08:00:00.000Z",
    "voyageNumber":"VOY-002",
    "shipmentNumber":"SHP-002",
    "productId":"<PRODUCT_ID>",
    "loadingPlantId":"<LOADING_PLANT_ID>",
    "loadingJettyId":"<LOADING_JETTY_ID>",
    "dischargePlantId":"<DISCHARGE_PLANT_ID>",
    "dischargeJettyId":"<DISCHARGE_JETTY_ID>",
    "sealingStatus":"READY",
    "loadingMasterId":"<LOADING_MASTER_USER_ID>",
    "unloadingMasterId":"<UNLOADING_MASTER_USER_ID>",
    "remarks":"Dipantau Supervisor"
  }'
```

Jika `loadingMasterId` tidak dikirim, backend saat ini dapat menjadikan Supervisor tersebut sebagai Loading Master assignment. Untuk pembagian tugas operasional yang jelas, kirim ID Loading Master yang sebenarnya.

### Langkah 3 — Koreksi atau ganti assignment saat masih DRAFT

```bash
curl -X PATCH http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "loadingMasterId":"<LOADING_MASTER_USER_ID>",
    "unloadingMasterId":"<UNLOADING_MASTER_USER_ID>",
    "remarks":"Assignment operasional telah ditetapkan"
  }'
```

Shipment hanya dapat diubah atau dihapus ketika `DRAFT`. Vessel tidak dapat diganti setelah Form/sealing record disiapkan.

## 4.4 A–Z memonitor shipment

### Langkah 1 — Lihat seluruh shipment

```bash
curl "http://localhost:5001/api/v1/shipments?page=1&limit=20&status=DRAFT&sortOrder=desc" \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>"
```

Filter tersedia: `search`, `status`, `vesselId`, `activityId`, `productId`, ID Plant/Jetty, `voyageNumber`, `shipmentNumber`, dan `sealingStatus`.

### Langkah 2 — Lihat detail

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>"
```

### Langkah 3 — Lihat Form A–H

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>"
```

### Langkah 4 — Validasi kesiapan

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/validation \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>"
```

Baca:

- `data.transitions.depart.allowed` untuk kesiapan berangkat;
- `data.transitions.arrive.allowed` untuk kesiapan tiba;
- `data.transitions.finalize.allowed` untuk kesiapan selesai;
- array `errors` untuk daftar kekurangan.

### Langkah 5 — Lihat dokumentasi dan signature

```text
GET /api/v1/shipments/<SHIPMENT_ID>/attachments
GET /api/v1/shipments/<SHIPMENT_ID>/signatures
```

### Langkah 6 — Lihat audit shipment

```bash
curl "http://localhost:5001/api/v1/audit-logs?entityType=SHIPMENT_VOYAGE&entityId=<SHIPMENT_ID>" \
  -H "Authorization: Bearer <SUPERVISOR_TOKEN>"
```

## 4.5 Supervisor membantu operasi

Supervisor dapat menjalankan seluruh langkah operasional pada Bagian 5 dan 6 tanpa harus menjadi assignee, selama status lifecycle benar. Contohnya:

```text
POST /shipments/:id/prepare-seals
PUT  /shipments/:reportId/form/points/:pointId
POST /shipments/:id/depart
POST /shipments/:id/arrive
POST /seals/:id/verify
POST /shipments/:id/finalize
```

Penggunaan kewenangan ini sebaiknya untuk supervisi atau koreksi yang tercatat dalam audit log, bukan untuk menggantikan pembagian tanggung jawab normal.

---

# 5. LOADING MASTER

## 5.1 Tanggung jawab Loading Master

Loading Master mengerjakan fase sebelum keberangkatan: membuat shipment, melengkapi header, menyiapkan Form A–H, memasang segel, menambahkan dokumentasi loading, menambahkan tanda tangan, memvalidasi kesiapan, dan memberangkatkan kapal.

Loading Master hanya dapat membaca dan mengubah shipment yang ditugaskan kepadanya. Untuk laporan legacy tanpa `loadingMasterId`, pembuat laporan dianggap sebagai assignment implisit.

## 5.2 Alur Loading Master dari A–Z

```text
Login
  ↓
Ambil master referensi
  ↓
Buat shipment DRAFT
  ↓
Tentukan Unloading Master
  ↓
Inisialisasi snapshot Form A–H
  ↓
Isi titik dan nomor segel
  ↓
Unggah dokumentasi loading
  ↓
Isi tanda tangan bila tersedia
  ↓
Validasi kesiapan depart
  ↓
Perbaiki semua error
  ↓
Depart: DRAFT → BERLAYAR
```

## 5.3 Langkah 1 — Melihat shipment assignment

```bash
curl "http://localhost:5001/api/v1/shipments?page=1&limit=20&status=DRAFT" \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

Backend otomatis memfilter hasil agar hanya shipment assignment Loading Master tersebut yang dikembalikan.

## 5.4 Langkah 2 — Mengambil semua ID referensi

Sebelum membuat shipment, ambil ID dari endpoint berikut:

```text
GET /api/v1/vessels?isActive=true
GET /api/v1/activities?isActive=true
GET /api/v1/products?isActive=true
GET /api/v1/plants?isActive=true
GET /api/v1/jetties?isActive=true
GET /api/v1/plant-jetty-assignments
```

Loading Master hanya membaca data tersebut dan tidak dapat membuat atau mengubahnya.

Pastikan kombinasi loading Plant–Jetty dan discharge Plant–Jetty tersedia pada endpoint assignment.

## 5.5 Langkah 3 — Membuat shipment/dokumen baru

Endpoint canonical:

```text
POST /api/v1/shipments
```

Contoh:

```bash
curl -X POST http://localhost:5001/api/v1/shipments \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "vesselId":"<VESSEL_ID>",
    "activityId":"<ACTIVITY_ID>",
    "reportDateTime":"2026-09-10T08:00:00.000Z",
    "voyageNumber":"VOY-003",
    "shipmentNumber":"SHP-003",
    "productId":"<PRODUCT_ID>",
    "loadingPlantId":"<LOADING_PLANT_ID>",
    "loadingJettyId":"<LOADING_JETTY_ID>",
    "dischargePlantId":"<DISCHARGE_PLANT_ID>",
    "dischargeJettyId":"<DISCHARGE_JETTY_ID>",
    "sealingStatus":"READY",
    "unloadingMasterId":"<UNLOADING_MASTER_USER_ID>",
    "loadingMasterSurveyorName":"Nama Surveyor",
    "remarks":"Persiapan loading"
  }'
```

Loading Master tidak perlu mengirim `loadingMasterId`; backend otomatis menetapkan user yang sedang login. Loading Master tidak boleh menunjuk Loading Master lain.

Semua field berikut wajib:

- `vesselId`;
- `activityId`;
- `reportDateTime` dalam format tanggal ISO 8601;
- `voyageNumber`;
- `shipmentNumber` yang harus unik;
- `productId`;
- loading dan discharge Plant–Jetty;
- `sealingStatus`.

`unloadingMasterId` boleh belum diisi saat membuat draft, tetapi wajib sebelum depart.

Backend saat ini belum menyediakan endpoint daftar user untuk Loading Master. ID Unloading Master harus diperoleh dari pilihan yang sebelumnya disediakan Admin/frontend. Jika frontend perlu memuat pilihan tersebut langsung dari backend untuk role LM, diperlukan endpoint lookup assignee baru.

Simpan `data.id` dari response sebagai `<SHIPMENT_ID>`.

> Dalam backend, `<SHIPMENT_ID>` juga dipakai sebagai `reportId`. Keduanya menunjuk record yang sama.

## 5.6 Langkah 4 — Memeriksa dan memperbarui draft

Lihat detail:

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

Ubah hanya field yang diperlukan:

```bash
curl -X PATCH http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "unloadingMasterId":"<UNLOADING_MASTER_USER_ID>",
    "remarks":"Data assignment sudah lengkap"
  }'
```

Loading Master hanya dapat mengubah shipment assignment yang masih `DRAFT`. Jika vessel salah, ganti sebelum menyiapkan Form A–H.

Menghapus draft yang tidak jadi digunakan:

```bash
curl -X DELETE http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

## 5.7 Langkah 5 — Inisialisasi Form A–H

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/prepare-seals \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Backend akan:

- membaca konfigurasi vessel aktif;
- membuat snapshot yang tidak berubah walaupun master diubah kemudian;
- menyiapkan sealing record untuk titik A–H;
- menentukan titik required dan optional.

Operasi ini hanya dapat dilakukan ketika status `DRAFT`.

## 5.8 Langkah 6 — Mengambil struktur Form A–H

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

Cari setiap nilai:

```json
{
  "vesselSealingPointId": "uuid-point",
  "recordId": "uuid-record",
  "required": true,
  "status": "NOT_SEALED",
  "seals": []
}
```

Gunakan `vesselSealingPointId` sebagai `<POINT_ID>` pada endpoint pengisian form. Jangan memakai `recordId` pada path form.

## 5.9 Langkah 7 — Mengisi satu titik dan nomor segel

`PUT` mengganti seluruh isi titik:

```bash
curl -X PUT http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form/points/<POINT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "status":"SEALED",
    "notes":"Penyegelan selesai dan diperiksa",
    "seals":[
      {
        "sealNumber":"W.10001",
        "installedAt":"2026-09-10T09:00:00.000Z",
        "notes":"Slot 1"
      },
      {
        "sealNumber":"W.10002",
        "notes":"Slot 2"
      }
    ]
  }'
```

Aturan status titik:

| Status | Aturan |
|---|---|
| `SEALED` | Wajib mempunyai minimal satu nomor segel |
| `NOT_SEALED` | Tidak boleh mempunyai nomor segel |
| `NOT_APPLICABLE` | Tidak boleh mempunyai nomor segel dan tidak menghalangi depart |

Nomor segel disimpan uppercase dan harus unik secara global.

## 5.10 Langkah 8 — Mengubah sebagian atau mengosongkan titik

Mengubah catatan saja:

```bash
curl -X PATCH http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form/points/<POINT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"notes":"Catatan sudah diperbarui"}'
```

Jika status diubah dari `SEALED`, kirim juga `"seals":[]`.

Mengosongkan titik:

```bash
curl -X DELETE http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form/points/<POINT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

Titik kembali menjadi `NOT_SEALED`; posisi konfigurasi tidak dihapus.

## 5.11 Langkah 9 — Mengisi satu section sekaligus

```bash
curl -X PUT http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form/sections/A \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "points":[
      {
        "vesselSealingPointId":"<POINT_ID_1>",
        "status":"SEALED",
        "notes":"Titik pertama",
        "seals":[{"sealNumber":"W.20001"}]
      },
      {
        "vesselSealingPointId":"<POINT_ID_2>",
        "status":"NOT_APPLICABLE",
        "notes":"Tidak tersedia pada voyage ini",
        "seals":[]
      }
    ]
  }'
```

Semua point harus berasal dari section yang ada pada path. Jika satu point gagal, seluruh batch dibatalkan.

## 5.12 Endpoint record/seal alternatif

Untuk frontend baru, endpoint Form A–H lebih disarankan. Endpoint record/seal berikut tetap tersedia:

| Kebutuhan | Endpoint |
|---|---|
| Melihat record | `GET /shipments/:reportId/records` |
| Membuat record | `POST /shipments/:reportId/records` |
| Mengubah record | `PATCH /records/:id` |
| Menghapus record | `DELETE /records/:id` |
| Memasang segel | `POST /records/:recordId/seals` |
| Mengubah segel | `PATCH /seals/:id` |
| Melepas segel | `POST /seals/:id/remove` |
| Mengganti segel | `POST /seals/:id/replace` |

Contoh mengganti segel:

```bash
curl -X POST http://localhost:5001/api/v1/seals/<SEAL_ID>/replace \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "sealNumber":"W.30002",
    "installedAt":"2026-09-10T10:00:00.000Z",
    "notes":"Penggantian karena segel awal rusak"
  }'
```

Seluruh mutasi record dan segel hanya dapat dilakukan saat `DRAFT`.

## 5.13 Langkah 10 — Mengunggah dokumentasi loading

Dokumentasi bersifat opsional menurut aturan backend saat ini.

Format file: JPEG, PNG, WebP, atau PDF. Batas default: 10 MiB.

### Attachment tingkat shipment

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/attachments \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -F "file=@/lokasi/foto-loading.jpg" \
  -F "type=PHOTO" \
  -F "caption=Kondisi umum sebelum keberangkatan" \
  -F "sequence=1"
```

### Attachment untuk Section A

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/sections/A/attachments \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -F "file=@/lokasi/foto-titik.jpg" \
  -F "type=PHOTO" \
  -F "caption=Foto sounding pipe" \
  -F "sequence=1" \
  -F "vesselSealingPointId=<POINT_ID>"
```

### Attachment untuk sealing record

```bash
curl -X POST http://localhost:5001/api/v1/records/<RECORD_ID>/attachments \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -F "file=@/lokasi/bukti-segel.jpg" \
  -F "caption=Bukti nomor segel W.10001"
```

Melihat daftar attachment:

```text
GET /api/v1/shipments/<SHIPMENT_ID>/attachments
GET /api/v1/shipments/<SHIPMENT_ID>/sections/A/attachments
GET /api/v1/records/<RECORD_ID>/attachments
```

Mengubah metadata attachment milik sendiri:

```bash
curl -X PATCH http://localhost:5001/api/v1/attachments/<ATTACHMENT_ID> \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"caption":"Caption yang diperbaiki","sequence":2}'
```

Preview dan download:

```text
GET /api/v1/attachments/<ATTACHMENT_ID>/preview
GET /api/v1/attachments/<ATTACHMENT_ID>/download
```

Hapus attachment milik sendiri:

```text
DELETE /api/v1/attachments/<ATTACHMENT_ID>
```

Loading Master hanya dapat mengubah dokumentasi loading pada shipment assignment berstatus `DRAFT`. Update/delete attachment oleh LM juga dibatasi kepada file yang diunggahnya sendiri.

## 5.14 Langkah 11 — Menambahkan tanda tangan

Jenis tanda tangan bukan role login. Nilainya adalah:

- `CHIEF_OFFICER`;
- `TERMINAL_REPRESENTATIVE`;
- `SURVEYOR`.

### Buat metadata tanda tangan

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/signatures \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "role":"CHIEF_OFFICER",
    "name":"Nama Chief Officer",
    "signedAt":"2026-09-10T10:30:00.000Z"
  }'
```

Simpan `data.id` sebagai `<SIGNATURE_ID>`.

### Upload file tanda tangan

```bash
curl -X PUT http://localhost:5001/api/v1/signatures/<SIGNATURE_ID>/file \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -F "file=@/lokasi/tanda-tangan.png"
```

### Operasi lainnya

```text
GET    /api/v1/shipments/<SHIPMENT_ID>/signatures
GET    /api/v1/signatures/<SIGNATURE_ID>
PATCH  /api/v1/signatures/<SIGNATURE_ID>
GET    /api/v1/signatures/<SIGNATURE_ID>/preview
GET    /api/v1/signatures/<SIGNATURE_ID>/download
DELETE /api/v1/signatures/<SIGNATURE_ID>
```

Maksimal satu tanda tangan per jenis dalam satu shipment. Tanda tangan dapat diubah oleh LM/UM assignee, Supervisor, atau Admin sebelum `FINISH`.

## 5.15 Langkah 12 — Validasi kesiapan depart

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/validation \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>"
```

Pastikan:

```json
{
  "transitions": {
    "depart": {
      "allowed": true,
      "errors": []
    }
  }
}
```

Jika `allowed=false`, selesaikan semua masalah pada `errors`. Pemeriksaan depart meliputi:

- shipment masih `DRAFT`;
- master referensi masih aktif;
- kombinasi Plant–Jetty valid;
- LM dan UM aktif dengan role yang benar;
- snapshot Form A–H tersedia;
- seluruh titik required sudah `SEALED` dengan segel aktif atau `NOT_APPLICABLE`.

Attachment dan signature belum menjadi syarat wajib lifecycle.

## 5.16 Langkah 13 — Memberangkatkan kapal

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/depart \
  -H "Authorization: Bearer <LOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "occurredAt":"2026-09-10T11:00:00.000Z",
    "remarks":"Kapal diberangkatkan setelah pemeriksaan selesai"
  }'
```

`occurredAt` dan `remarks` opsional. Jika waktu tidak dikirim, server memakai waktu saat request diproses.

Jika berhasil:

- `status` berubah dari `DRAFT` menjadi `BERLAYAR`;
- `sealingProcessStatus` menjadi `IN_TRANSIT`;
- data loading dikunci;
- shipment mulai tersedia untuk proses Unloading Master yang ditugaskan.

## 5.17 Setelah depart

Loading Master masih dapat membaca shipment assignment, Form A–H, file, signature, dan hasil akhir. Loading Master tidak dapat menjalankan `arrive`, memverifikasi segel, atau menjalankan `finish`.

Setelah shipment `FINISH`, Loading Master dapat generate PDF/XLSX untuk shipment assignment:

```text
POST /api/v1/shipments/<SHIPMENT_ID>/pdf
POST /api/v1/shipments/<SHIPMENT_ID>/xlsx
```

Detail ekspor dijelaskan pada Bagian 8.

---

# 6. UNLOADING MASTER

## 6.1 Tanggung jawab Unloading Master

Unloading Master menangani shipment setelah perjalanan dimulai: menerima kapal, melihat data loading, memverifikasi setiap segel, mengunggah bukti verifikasi, melengkapi tanda tangan bila perlu, memvalidasi kesiapan finalisasi, dan menyelesaikan shipment.

Unloading Master hanya dapat mengakses shipment dengan `unloadingMasterId` yang sama dengan ID user tersebut.

## 6.2 Alur Unloading Master dari A–Z

```text
Login
  ↓
Lihat shipment assignment BERLAYAR
  ↓
Periksa detail, Form A–H, dan dokumentasi loading
  ↓
Arrive: BERLAYAR → SANDAR
  ↓
Verifikasi setiap segel aktif
  ↓
Unggah bukti verifikasi
  ↓
Lengkapi tanda tangan bila diperlukan
  ↓
Validasi kesiapan finalize
  ↓
Perbaiki semua error
  ↓
Finalize: SANDAR → FINISH
  ↓
Generate/unduh dokumen final
```

## 6.3 Langkah 1 — Melihat shipment yang ditugaskan

```bash
curl "http://localhost:5001/api/v1/shipments?page=1&limit=20&status=BERLAYAR" \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>"
```

Backend otomatis mengembalikan shipment dengan `unloadingMasterId` yang sesuai.

Jika daftar kosong, periksa bersama Supervisor/Admin apakah user sudah ditetapkan sebagai Unloading Master shipment.

## 6.4 Langkah 2 — Melihat data sebelum menerima kapal

```text
GET /api/v1/shipments/<SHIPMENT_ID>
GET /api/v1/shipments/<SHIPMENT_ID>/form
GET /api/v1/shipments/<SHIPMENT_ID>/attachments
GET /api/v1/shipments/<SHIPMENT_ID>/signatures
GET /api/v1/shipments/<SHIPMENT_ID>/validation
```

Untuk melihat file bukti loading:

```text
GET /api/v1/attachments/<ATTACHMENT_ID>/preview
GET /api/v1/attachments/<ATTACHMENT_ID>/download
```

Unloading Master dapat membaca hasil Form A–H, tetapi tidak dapat mengubah input loading atau nomor segel.

## 6.5 Langkah 3 — Mencatat kedatangan kapal

Pastikan shipment berstatus `BERLAYAR`, kemudian:

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/arrive \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "occurredAt":"2026-09-11T07:30:00.000Z",
    "remarks":"Kapal tiba di jetty tujuan"
  }'
```

Jika berhasil:

- `status` berubah menjadi `SANDAR`;
- `sealingProcessStatus` menjadi `VERIFICATION`;
- endpoint verifikasi segel mulai dapat digunakan.

## 6.6 Langkah 4 — Mendapatkan ID segel

Ambil struktur form:

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/form \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>"
```

Pada setiap titik, cari array `seals`:

```json
{
  "seals": [
    {
      "id": "uuid-seal",
      "sealNumber": "W.10001",
      "status": "INSTALLED"
    }
  ]
}
```

Gunakan `seals[].id` sebagai `<SEAL_ID>`.

Alternatif:

```text
GET /api/v1/shipments/<SHIPMENT_ID>/records?page=1&limit=100
```

## 6.7 Langkah 5 — Memverifikasi segel

```bash
curl -X POST http://localhost:5001/api/v1/seals/<SEAL_ID>/verify \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "condition":"GOOD",
    "verifiedAt":"2026-09-11T08:00:00.000Z",
    "remarks":"Nomor sesuai dan kondisi segel baik"
  }'
```

Nilai `condition`:

- `GOOD` — segel baik;
- `DAMAGED` — segel rusak;
- `BROKEN` — segel pecah;
- `MISSING` — segel hilang;
- `OTHER` — kondisi lain, jelaskan pada `remarks`.

Simpan `data.id` dari response verifikasi sebagai `<VERIFICATION_ID>` untuk mengunggah bukti.

Verifikasi hanya dapat dilakukan ketika shipment berstatus `SANDAR`.

## 6.8 Langkah 6 — Mengunggah bukti verifikasi

```bash
curl -X POST http://localhost:5001/api/v1/verifications/<VERIFICATION_ID>/attachments \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>" \
  -F "file=@/lokasi/foto-verifikasi.jpg" \
  -F "type=PHOTO" \
  -F "caption=Kondisi segel W.10001 saat tiba" \
  -F "sequence=1"
```

Melihat buktinya:

```text
GET /api/v1/verifications/<VERIFICATION_ID>/attachments
```

Mengubah atau menghapus metadata menggunakan endpoint attachment umum:

```text
PATCH  /api/v1/attachments/<ATTACHMENT_ID>
DELETE /api/v1/attachments/<ATTACHMENT_ID>
```

UM hanya dapat mengelola attachment verification pada shipment assignment berstatus `SANDAR`; update/delete juga dibatasi kepada attachment yang diunggahnya sendiri.

## 6.9 Langkah 7 — Tanda tangan

Unloading Master dapat menggunakan endpoint tanda tangan yang sama dengan Loading Master sebelum shipment `FINISH`:

```text
GET  /api/v1/shipments/<SHIPMENT_ID>/signatures
POST /api/v1/shipments/<SHIPMENT_ID>/signatures
PATCH /api/v1/signatures/<SIGNATURE_ID>
PUT  /api/v1/signatures/<SIGNATURE_ID>/file
```

Contoh membuat tanda tangan Surveyor:

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/signatures \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "role":"SURVEYOR",
    "name":"Nama Surveyor",
    "signedAt":"2026-09-11T09:00:00.000Z"
  }'
```

## 6.10 Langkah 8 — Validasi kesiapan finalisasi

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/validation \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>"
```

Pastikan:

```json
{
  "transitions": {
    "finalize": {
      "allowed": true,
      "errors": []
    }
  }
}
```

Finalisasi memerlukan:

- shipment berstatus `SANDAR`;
- Unloading Master masih aktif dan assignment sesuai;
- snapshot Form A–H valid;
- seluruh titik required selesai atau `NOT_APPLICABLE`;
- seluruh segel aktif mempunyai verification.

Attachment dan tanda tangan belum menjadi syarat wajib finalisasi.

## 6.11 Langkah 9 — Finalisasi shipment

Endpoint yang disarankan:

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/finalize \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "occurredAt":"2026-09-11T10:00:00.000Z",
    "remarks":"Verifikasi selesai; shipment difinalisasi"
  }'
```

`POST /shipments/:id/finish` tersedia sebagai alias dan menghasilkan proses yang sama.

Jika berhasil:

- `status` menjadi `FINISH`;
- `sealingProcessStatus` menjadi `FINALIZED`;
- backend membuat `finalSnapshot`;
- data shipment, form, segel, verification, attachment, dan signature terkunci;
- tidak ada endpoint reopen/revision.

Pastikan semua koreksi selesai sebelum finalisasi.

## 6.12 Langkah 10 — Membuat dokumen akhir

Setelah `FINISH`, UM dapat membuat PDF dan XLSX:

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/pdf \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>"
```

```bash
curl -X POST http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/xlsx \
  -H "Authorization: Bearer <UNLOADING_MASTER_TOKEN>"
```

Unduh hasil:

```text
GET /api/v1/shipments/<SHIPMENT_ID>/pdf/download
GET /api/v1/shipments/<SHIPMENT_ID>/xlsx/download
```

---

# 7. VIEWER

## 7.1 Tanggung jawab Viewer

Viewer hanya membaca. Dalam implementasi saat ini, Viewer dapat membaca seluruh shipment dan tidak dibatasi assignment, Plant, Jetty, atau Terminal.

Viewer tidak dapat membuat, mengubah, menghapus, memproses lifecycle, mengunggah file, mengelola signature, generate ekspor, atau melihat audit log.

## 7.2 Endpoint yang dapat digunakan Viewer

### Profil

```text
GET /api/v1/auth/me
```

### Master data

```text
GET /api/v1/terminals
GET /api/v1/terminals/:id
GET /api/v1/plants
GET /api/v1/plants/:id
GET /api/v1/jetties
GET /api/v1/jetties/:id
GET /api/v1/activities
GET /api/v1/activities/:id
GET /api/v1/products
GET /api/v1/products/:id
GET /api/v1/units-of-measure
GET /api/v1/units-of-measure/:id
GET /api/v1/plant-jetty-assignments
```

### Vessel dan konfigurasi

```text
GET /api/v1/vessels
GET /api/v1/vessels/:id
GET /api/v1/compartments
GET /api/v1/compartments/:id
GET /api/v1/sealing-categories
GET /api/v1/sealing-categories/:id
GET /api/v1/sealing-point-templates
GET /api/v1/sealing-point-templates/:id
GET /api/v1/vessel-sealing-points
GET /api/v1/vessel-sealing-points/:id
GET /api/v1/vessels/:vesselId/compartments
GET /api/v1/vessels/:vesselId/sealing-points
GET /api/v1/sealing-categories/:categoryId/templates
```

### Shipment dan hasil operasi

```text
GET /api/v1/shipments
GET /api/v1/shipments/:id
GET /api/v1/shipments/:id/validation
GET /api/v1/shipments/:reportId/form
GET /api/v1/shipments/:reportId/records
```

### Attachment dan signature

```text
GET /api/v1/shipments/:reportId/attachments
GET /api/v1/shipments/:reportId/sections/:sectionCode/attachments
GET /api/v1/records/:recordId/attachments
GET /api/v1/verifications/:verificationId/attachments
GET /api/v1/attachments/:id
GET /api/v1/attachments/:id/preview
GET /api/v1/attachments/:id/download
GET /api/v1/shipments/:reportId/signatures
GET /api/v1/signatures/:id
GET /api/v1/signatures/:id/preview
GET /api/v1/signatures/:id/download
```

### Dokumen final

```text
GET /api/v1/shipments/:reportId/pdf/preview
GET /api/v1/shipments/:reportId/pdf/download
GET /api/v1/shipments/:reportId/xlsx/preview
GET /api/v1/shipments/:reportId/xlsx/download
```

Viewer hanya dapat membuka hasil ekspor setelah role lain menjalankan endpoint generate.

## 7.3 A–Z Viewer melihat laporan

### Langkah 1 — Login

Gunakan `POST /api/v1/auth/login`, lalu simpan token.

### Langkah 2 — Cari shipment

```bash
curl "http://localhost:5001/api/v1/shipments?page=1&limit=20&search=SHP-003" \
  -H "Authorization: Bearer <VIEWER_TOKEN>"
```

### Langkah 3 — Buka detail

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID> \
  -H "Authorization: Bearer <VIEWER_TOKEN>"
```

### Langkah 4 — Buka Form A–H dan dokumentasi

```text
GET /api/v1/shipments/<SHIPMENT_ID>/form
GET /api/v1/shipments/<SHIPMENT_ID>/attachments
GET /api/v1/shipments/<SHIPMENT_ID>/signatures
```

### Langkah 5 — Preview atau download hasil final

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/pdf/download \
  -H "Authorization: Bearer <VIEWER_TOKEN>" \
  --output laporan.pdf
```

```bash
curl http://localhost:5001/api/v1/shipments/<SHIPMENT_ID>/xlsx/download \
  -H "Authorization: Bearer <VIEWER_TOKEN>" \
  --output laporan.xlsx
```

Jika mendapat `404`, kemungkinan dokumen belum di-generate oleh Admin, Supervisor, LM, atau UM.

---

## 8. Panduan umum attachment, signature, PDF, dan XLSX

Bagian ini berlaku bagi role yang mempunyai izin pada shipment tersebut.

### 8.1 Attachment

| Operasi | Method | Endpoint |
|---|---|---|
| List attachment shipment | `GET` | `/shipments/:reportId/attachments` |
| Upload attachment shipment | `POST` | `/shipments/:reportId/attachments` |
| List attachment section | `GET` | `/shipments/:reportId/sections/:sectionCode/attachments` |
| Upload attachment section | `POST` | `/shipments/:reportId/sections/:sectionCode/attachments` |
| List/upload attachment record | `GET/POST` | `/records/:recordId/attachments` |
| List/upload attachment verification | `GET/POST` | `/verifications/:verificationId/attachments` |
| Metadata attachment | `GET` | `/attachments/:id` |
| Ubah metadata | `PATCH` | `/attachments/:id` |
| Preview | `GET` | `/attachments/:id/preview` |
| Download | `GET` | `/attachments/:id/download` |
| Preview alias legacy | `GET` | `/attachments/:id/file` |
| Hapus | `DELETE` | `/attachments/:id` |

Field upload:

| Field | Wajib? | Keterangan |
|---|---:|---|
| `file` | Ya | JPEG, PNG, WebP, atau PDF |
| `type` | Tidak | `PHOTO`, `DOCUMENT`, `OTHER`; otomatis jika kosong |
| `caption` | Tidak | Maksimal 2.000 karakter |
| `description` | Tidak | Field deskripsi legacy, maksimal 2.000 karakter; request baru disarankan memakai `caption` |
| `sequence` | Tidak | Urutan tampilan, mulai dari 0 |
| `sectionCode` | Kontekstual | A–H |
| `compartmentId` | Tidak | Harus sesuai snapshot |
| `vesselSealingPointId` | Tidak | Harus sesuai snapshot |

### 8.2 Signature

| Operasi | Method | Endpoint |
|---|---|---|
| List per shipment | `GET` | `/shipments/:reportId/signatures` |
| Buat metadata | `POST` | `/shipments/:reportId/signatures` |
| Detail | `GET` | `/signatures/:id` |
| Ubah metadata | `PATCH` | `/signatures/:id` |
| Upload/ganti file | `PUT` | `/signatures/:id/file` |
| Preview/download | `GET` | `/signatures/:id/preview` atau `/download` |
| Hapus | `DELETE` | `/signatures/:id` |

### 8.3 PDF final

Generate hanya setelah `FINISH`:

```text
POST /api/v1/shipments/<SHIPMENT_ID>/pdf
```

Generate pertama menghasilkan HTTP `201`. Jika PDF yang sama sudah tersedia, backend mengembalikan HTTP `200` dan `reused=true`.

```text
GET /api/v1/shipments/<SHIPMENT_ID>/pdf/preview
GET /api/v1/shipments/<SHIPMENT_ID>/pdf/download
```

### 8.4 XLSX final

Generate hanya setelah `FINISH`:

```text
POST /api/v1/shipments/<SHIPMENT_ID>/xlsx
GET  /api/v1/shipments/<SHIPMENT_ID>/xlsx/preview
GET  /api/v1/shipments/<SHIPMENT_ID>/xlsx/download
```

Role yang dapat generate: Admin, Supervisor, LM assignee, dan UM assignee. Viewer hanya preview/download artefak yang sudah ada.

---

## 9. Matriks izin final

Keterangan:

- `✓` = diizinkan;
- `A` = hanya shipment assignment;
- `—` = tidak diizinkan;
- izin mutasi tetap tunduk pada status lifecycle.

| Fungsi | Admin | Supervisor | Loading Master | Unloading Master | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Login dan profil sendiri | ✓ | ✓ | ✓ | ✓ | ✓ |
| Membaca master data | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mengubah master dan konfigurasi vessel | ✓ | — | — | — | — |
| Mengelola user | ✓ | — | — | — | — |
| Melihat shipment | ✓ | ✓ | A | A | ✓ |
| Membuat shipment | ✓ | ✓ | ✓ | — | — |
| Mengubah/menghapus draft | ✓ | ✓ | A | — | — |
| Menentukan/mengganti LM lain | ✓ | ✓ | — | — | — |
| Menyiapkan dan mengisi Form A–H | ✓ | ✓ | A | — | — |
| Mengelola segel loading | ✓ | ✓ | A | — | — |
| Depart | ✓ | ✓ | A | — | — |
| Arrive | ✓ | ✓ | — | A | — |
| Verifikasi segel | ✓ | ✓ | — | A | — |
| Finalize | ✓ | ✓ | — | A | — |
| Dokumentasi loading | ✓ | ✓ | A | — | Baca |
| Dokumentasi verification | ✓ | ✓ | — | A | Baca |
| Mengelola signature | ✓ | ✓ | A | A | — |
| Generate PDF/XLSX | ✓ | ✓ | A | A | — |
| Preview/download PDF/XLSX | ✓ | ✓ | A | A | ✓ |
| Audit log | ✓ | ✓ | — | — | — |

---

## 10. Lifecycle dan aturan penguncian

```text
DRAFT --depart--> BERLAYAR --arrive--> SANDAR --finalize--> FINISH
```

| Status | Yang dapat dilakukan |
|---|---|
| `DRAFT` | Mengubah header shipment, Form A–H, segel loading, dan dokumentasi loading |
| `BERLAYAR` | Membaca data dan menunggu proses arrive |
| `SANDAR` | Memverifikasi segel dan menambah dokumentasi verification |
| `FINISH` | Membaca data serta membuat/mengunduh dokumen final; data transaksi terkunci |

Tidak tersedia endpoint untuk:

- mundur dari `BERLAYAR` ke `DRAFT`;
- mundur dari `SANDAR` ke `BERLAYAR`;
- membuka kembali shipment `FINISH`;
- membuat revisi final snapshot.

---

## 11. Endpoint canonical dan alias

Dokumen ini menggunakan `/shipments` sebagai endpoint utama. Backend menyediakan alias:

- `/voyages` untuk payload canonical yang sama;
- `/reports` untuk kompatibilitas laporan lama.

Contoh endpoint yang ekuivalen untuk pembacaan:

```text
GET /api/v1/shipments/<ID>
GET /api/v1/voyages/<ID>
GET /api/v1/reports/<ID>
```

Untuk pengembangan baru, gunakan `/shipments`. Jangan mencampurkan `/shipments` dan `/reports` ketika membuat data karena `POST /reports` memakai payload legacy yang berbeda.

---

## 12. Checklist implementasi frontend

Untuk setiap tombol atau menu frontend:

1. Panggil `GET /auth/me` untuk mengetahui role user.
2. Sembunyikan tombol yang tidak sesuai role.
3. Untuk LM/UM, pastikan shipment termasuk assignment user.
4. Periksa `status` sebelum menampilkan tombol aksi.
5. Panggil endpoint `/validation` sebelum `depart` atau `finalize`.
6. Tampilkan semua `details/errors` dari backend kepada pengguna.
7. Setelah `POST`, `PATCH`, `PUT`, atau `DELETE` berhasil, ambil ulang detail shipment.
8. Simpan ID dari response; jangan memakai nama atau nomor sebagai pengganti UUID.
9. Untuk file, gunakan response sebagai Blob, bukan mencoba membaca sebagai JSON.
10. Jangan menganggap kontrol UI sebagai keamanan; backend tetap menjadi pemeriksa izin utama.

Contoh pemetaan tombol:

| Tombol UI | Syarat tampil | API |
|---|---|---|
| Tambah Vessel | Role Admin | `POST /vessels` |
| Ubah Vessel | Role Admin | `PATCH /vessels/:id` |
| Buat Shipment | Admin/Supervisor/LM | `POST /shipments` |
| Siapkan Form | Admin/Supervisor/LM assignee + `DRAFT` | `POST /shipments/:id/prepare-seals` |
| Simpan Titik | Admin/Supervisor/LM assignee + `DRAFT` | `PUT /shipments/:id/form/points/:pointId` |
| Berangkat | Admin/Supervisor/LM assignee + validasi depart lolos | `POST /shipments/:id/depart` |
| Kapal Tiba | Admin/Supervisor/UM assignee + `BERLAYAR` | `POST /shipments/:id/arrive` |
| Verifikasi Segel | Admin/Supervisor/UM assignee + `SANDAR` | `POST /seals/:id/verify` |
| Finalisasi | Admin/Supervisor/UM assignee + validasi final lolos | `POST /shipments/:id/finalize` |
| Generate PDF | Admin/Supervisor/LM/UM sesuai akses + `FINISH` | `POST /shipments/:id/pdf` |
| Download PDF | Semua role yang dapat membaca shipment | `GET /shipments/:id/pdf/download` |

---

## 13. Catatan kebutuhan API lanjutan

Implementasi saat ini belum menyediakan:

- endpoint logout server-side atau refresh token;
- endpoint ganti password mandiri;
- endpoint lookup user untuk Supervisor memilih LM/UM;
- pembatasan Viewer berdasarkan Plant/Terminal;
- endpoint reopen/revision setelah `FINISH`;
- kewajiban attachment atau signature sebagai lifecycle gate.

Jika fungsi tersebut dibutuhkan, backend perlu ditambah terlebih dahulu. Frontend tidak boleh menyimulasikan izin atau workflow yang belum tersedia di backend.
