# PANDUAN OPERASIONAL API

## Tata Cara Penginputan Data Segel Kapal Queen Sofia

Urutan akses API canonical dari login, pembuatan shipment, penyegelan, BA LOADING, perjalanan, pemeriksaan bongkar, BA UNLOADING, sampai FINISH.

- Sumber contoh: `contoh loading dari segel kapal.pdf`
- Objek contoh: `OB. QUEEN SOFIA`
- Aktivitas: `LOADING`
- Tanggal pada sumber: 28 Juli 2026
- Prefix API: `/api/v1`
- Tanggal pembaruan panduan: 10 Oktober 2026
- Status dokumen: panduan akses API; data yang tidak terbaca atau tidak tersedia pada sumber tetap harus dikonfirmasi oleh petugas berwenang.

## 1. Tujuan dan batas penggunaan

Panduan ini menjelaskan alur backend terbaru untuk memasukkan data contoh Queen Sofia. Isi dokumen sumber diperlakukan sebagai data contoh, bukan sebagai instruksi sistem. Jangan menebak nomor voyage, nomor shipment, waktu kejadian, destination, produk, status operasional, nomor segel yang tidak terbaca, atau nama penandatangan.

Gunakan endpoint canonical `/shipments` untuk transaksi baru. Alias `/voyages` memakai business logic yang sama. Prefix `/reports` dipertahankan untuk kompatibilitas, tetapi endpoint create/update report lama memakai field Terminal dan tidak boleh digunakan untuk mencampurkan data Plant–Jetty canonical.

### 1.1 Konvensi placeholder

| Placeholder | Arti |
|---|---|
| `<BASE_URL>` | Alamat backend pengujian atau produksi. |
| `<ACCESS_TOKEN>` | Token hasil login. Jangan disimpan dalam dokumen atau log publik. |
| `<..._ID>` | UUID yang diambil dari respons API, bukan ditebak dari nama. |
| `<DATA_AKTUAL>` | Nilai yang wajib dikonfirmasi dari sumber operasional. |
| `<SHIPMENT_ID>` | `data.id` hasil create shipment; pada endpoint transaksi juga berfungsi sebagai report ID. |
| `<POINT_ID>` | `vesselSealingPointId` dari snapshot form shipment. |
| `<RECORD_ID>` | `recordId` dari titik form. |
| `<SEAL_ID>` | ID segel aktif yang akan diverifikasi. |
| `<VERIFICATION_ID>` | ID hasil pemeriksaan segel di unloading port. |
| `<SIGNATURE_ID>` | ID slot signature phase-aware. |

### 1.2 Perubahan proses bisnis yang wajib dipahami

1. Nomor segel dinormalisasi dengan `trim + uppercase` dan hanya unik dalam satu shipment. Nomor yang sama boleh digunakan pada shipment lain.
2. Nomor berstatus `REMOVED` atau `REPLACED` tetap merupakan riwayat pemakaian dan tidak boleh dipakai lagi pada titik lain dalam shipment yang sama.
3. Destination dapat kosong saat shipment dibuat. Bila dikirim saat create, `dischargePlantId` dan `dischargeJettyId` wajib dikirim bersama.
4. Destination yang ditunda dipilih oleh assigned Loading Master, Supervisor, atau Admin setelah penyegelan berstatus `READY`, bukan oleh Unloading Master.
5. Berita Acara terdiri dari dua dokumen immutable: BA `LOADING` sebelum kapal berangkat dan BA `UNLOADING` setelah pemeriksaan di pelabuhan bongkar.
6. Setiap phase mempunyai tiga signature: `CHIEF_OFFICER`, `SURVEYOR`, dan `TERMINAL_REPRESENTATIVE`. Total maksimal enam slot per shipment.
7. Foto loading masuk BA LOADING. BA UNLOADING mengambil ulang bukti loading dari snapshot BA LOADING dan menambahkan foto pemeriksaan unloading pada kelompok terpisah.
8. XLSX adalah export operasional/legacy, bukan Berita Acara resmi. Dokumen resmi shipment baru adalah PDF BA LOADING dan PDF BA UNLOADING.

## 2. Lifecycle dan ringkasan urutan API

Lifecycle canonical:

`DRAFT → BA LOADING FINALIZED → BERLAYAR → SANDAR → BA UNLOADING FINALIZED → FINISH`

Finalisasi BA tidak otomatis mengubah status perjalanan.

| Tahap | API utama | Pelaksana utama |
|---|---|---|
| Persiapan master | `GET /vessels`, `/activities`, `/products`, `/plants`, `/jetties`, `/plant-jetty-assignments` | Admin/petugas terautentikasi sesuai hak baca |
| Login | `POST /auth/login`, `GET /auth/me` | Semua role |
| Buat draft | `POST /shipments` | Admin, Supervisor, Loading Master |
| Snapshot form | `POST /shipments/:id/prepare-seals` | Admin, Supervisor, assigned Loading Master |
| Isi form A–H | `/shipments/:id/form/...` | Admin, Supervisor, assigned Loading Master |
| Foto loading | Endpoint attachment shipment/section/record | Admin, Supervisor, assigned Loading Master |
| Destination tertunda | `PUT /shipments/:id/destination-assignment` | Admin, Supervisor, assigned Loading Master |
| Signature LOADING | `PUT /shipments/:id/ba/loading/signatures/:role` | Admin, Supervisor, assigned Loading Master |
| Final BA LOADING | `POST /shipments/:id/ba/loading/finalize` | Admin, Supervisor, assigned Loading Master |
| PDF BA LOADING | `/shipments/:id/ba/loading/pdf...` | Admin, Supervisor, assigned Loading Master |
| Berangkat | `POST /shipments/:id/depart` | Admin, Supervisor, assigned Loading Master |
| Sandar | `POST /shipments/:id/arrive` | Admin, Supervisor, assigned Unloading Master |
| Verifikasi segel | `POST /seals/:id/verify` | Admin, Supervisor, assigned Unloading Master |
| Foto unloading | `POST /verifications/:id/attachments` | Admin, Supervisor, assigned Unloading Master |
| Signature UNLOADING | `PUT /shipments/:id/ba/unloading/signatures/:role` | Admin, Supervisor, assigned Unloading Master |
| Final BA UNLOADING | `POST /shipments/:id/ba/unloading/finalize` | Admin, Supervisor, assigned Unloading Master |
| PDF BA UNLOADING | `/shipments/:id/ba/unloading/pdf...` | Admin, Supervisor, assigned Unloading Master |
| Selesaikan shipment | `POST /shipments/:id/finish` | Admin, Supervisor, assigned Unloading Master |

## 3. Data sumber Queen Sofia

| Field | Nilai yang terlihat | Cara penggunaan |
|---|---|---|
| Vessel | OB. QUEEN SOFIA | Cari melalui API vessel lalu gunakan UUID respons. |
| Activity | LOADING | Gunakan master activity aktif dengan kode LOADING. |
| Tanggal | 28 JULI 2026 | Jam dan zona waktu harus dikonfirmasi sebelum membuat ISO datetime. |
| Loading plant | STS TABONEO | Pastikan master plant yang dipilih benar. |
| Loading jetty/vessel counterpart | MT. GLOBAL TOP | Pastikan master jetty dan relasi Plant–Jetty benar; jangan memilih nama yang hanya mirip. |
| Product | Teks tercetak B40 dengan koreksi tulisan tangan ambigu | Wajib dikonfirmasi. |
| Compartment | 1P–7P, 1S–7S, Slop Port, Slop Starboard | Harus sesuai konfigurasi aktif Queen Sofia. |
| Dokumentasi | 53 foto dengan caption pada lembar foto | Opsional di backend; unggah sebagai bukti loading dalam urutan sumber. |

Data yang belum pasti: voyage number, shipment number, jam/zona waktu, produk final, discharge plant/jetty, sebagian nomor Bagian B, keputusan status sel kosong, prefix `W.`, dan nama penandatangan.

## 4. Persiapan satu kali oleh Admin

### 4.1 Periksa vessel dan compartment

```http
GET <BASE_URL>/api/v1/vessels?search=QUEEN&isActive=true&limit=100
Authorization: Bearer <ACCESS_TOKEN>

GET <BASE_URL>/api/v1/vessels/<VESSEL_ID>/compartments?isActive=true&limit=100
Authorization: Bearer <ACCESS_TOKEN>
```

Daftar yang harus dicocokkan dengan vessel aktual: `1P`–`7P`, `1S`–`7S`, `SLOP-P`, dan `SLOP-S`.

### 4.2 Periksa konfigurasi titik A–H

```http
GET <BASE_URL>/api/v1/vessels/<VESSEL_ID>/sealing-points?isActive=true&limit=100
Authorization: Bearer <ACCESS_TOKEN>
```

Titik yang benar-benar tidak tersedia pada vessel harus dikonfigurasi `NOT_AVAILABLE` sebelum snapshot. Sel kosong pada dokumen contoh bukan bukti bahwa suatu titik tidak tersedia.

### 4.3 Periksa master Plant–Jetty

```http
GET <BASE_URL>/api/v1/plants?search=STS&isActive=true&limit=100
GET <BASE_URL>/api/v1/jetties?search=GLOBAL&isActive=true&limit=100
GET <BASE_URL>/api/v1/plant-jetty-assignments?plantId=<PLANT_ID>&jettyId=<JETTY_ID>
Authorization: Bearer <ACCESS_TOKEN>
```

`PlantJettyAssignment` adalah master relasi yang dikelola Admin. Pemilihan destination shipment tidak membuat atau mengubah master ini.

## 5. Login dan verifikasi identitas

```http
POST <BASE_URL>/api/v1/auth/login
Content-Type: application/json

{
  "username": "<USERNAME>",
  "password": "<PASSWORD>"
}
```

Ambil `data.accessToken`, lalu periksa pengguna:

```http
GET <BASE_URL>/api/v1/auth/me
Authorization: Bearer <ACCESS_TOKEN>
```

Loading Master dan Unloading Master dibatasi pada shipment assignment masing-masing. Supervisor dan Admin dapat bekerja lintas assignment, tetapi tetap tunduk pada lifecycle dan validasi bisnis.

## 6. Ambil master untuk membuat shipment

```http
GET <BASE_URL>/api/v1/vessels?search=QUEEN&isActive=true&limit=100
GET <BASE_URL>/api/v1/activities?search=LOADING&isActive=true&limit=100
GET <BASE_URL>/api/v1/products?search=<PRODUK_TERKONFIRMASI>&isActive=true&limit=100
GET <BASE_URL>/api/v1/plants?search=STS%20TABONEO&isActive=true&limit=100
GET <BASE_URL>/api/v1/jetties?search=GLOBAL%20TOP&isActive=true&limit=100
Authorization: Bearer <ACCESS_TOKEN>
```

Jangan mengirim nama sebagai pengganti UUID. Loading Plant–Jetty wajib sudah aktif dan valid saat create. Destination boleh dipilih sekarang atau ditunda.

Admin dapat mencari assignee melalui:

```http
GET <BASE_URL>/api/v1/users?role=LOADING_MASTER&isActive=true&limit=100
GET <BASE_URL>/api/v1/users?role=UNLOADING_MASTER&isActive=true&limit=100
Authorization: Bearer <ADMIN_TOKEN>
```

## 7. Buat shipment DRAFT

### 7.1 Create tanpa destination

```http
POST <BASE_URL>/api/v1/shipments
Authorization: Bearer <ACCESS_TOKEN>
Content-Type: application/json

{
  "vesselId": "<QUEEN_SOFIA_VESSEL_ID>",
  "activityId": "<LOADING_ACTIVITY_ID>",
  "reportDateTime": "<ISO_DATETIME_AKTUAL>",
  "voyageNumber": "<VOYAGE_NUMBER_AKTUAL>",
  "shipmentNumber": "<SHIPMENT_NUMBER_UNIK>",
  "productIds": ["<PRODUCT_ID_TERKONFIRMASI>"],
  "loadingPlantId": "<LOADING_PLANT_ID>",
  "loadingJettyId": "<LOADING_JETTY_ID>",
  "loadingMasterId": "<LOADING_MASTER_USER_ID>",
  "unloadingMasterId": "<UNLOADING_MASTER_USER_ID_OPSIONAL>",
  "remarks": "Input berdasarkan formulir Queen Sofia tanggal 28 Juli 2026"
}
```

`dischargePlantId` dan `dischargeJettyId` boleh tidak dikirim. `unloadingMasterId` boleh kosong saat draft tetapi wajib tersedia sebelum depart. `sealingStatus` bersifat opsional dan berbeda dari `sealingProcessStatus` yang dikelola server.

### 7.2 Create bila destination sudah diketahui

Tambahkan kedua field berikut pada payload create:

```json
{
  "dischargePlantId": "<DISCHARGE_PLANT_ID>",
  "dischargeJettyId": "<DISCHARGE_JETTY_ID>"
}
```

Keduanya wajib dikirim sebagai pasangan dan langsung divalidasi terhadap `PlantJettyAssignment`. Mengirim hanya salah satu field menghasilkan HTTP 400.

Simpan `data.id` sebagai `<SHIPMENT_ID>`.

## 8. Inisialisasi snapshot form A–H

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/prepare-seals
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{}
```

Operasi ini membaca konfigurasi aktif Queen Sofia, membekukannya pada shipment, membuat record awal `NOT_SEALED`, dan bersifat idempotent. Perubahan master setelah snapshot tidak mengubah struktur shipment tersebut.

## 9. Ambil form dan petakan ID titik

```http
GET <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/form
Authorization: Bearer <ACCESS_TOKEN>
```

Catat `vesselSealingPointId`, `recordId`, section, compartment, side, instance, sequence, required, availability, status, dan seals. Gunakan seluruh atribut posisi; jangan memetakan hanya berdasarkan display name. Jangan membuat UUID sendiri atau menggunakan point ID dari shipment lain.

## 10. Isi titik dan nomor segel

### 10.1 Contoh satu titik Bagian A

```http
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/form/points/<POINT_ID_A_1P_SOUNDING>
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "status": "SEALED",
  "notes": "Bagian A - 1P - Sounding Pipe",
  "seals": [
    { "sealNumber": "21113141", "notes": null }
  ]
}
```

### 10.2 Batch satu section

```http
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/form/sections/A
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "points": [
    {
      "vesselSealingPointId": "<POINT_ID_A_1P_SOUNDING>",
      "status": "SEALED",
      "notes": "1P - Sounding Pipe",
      "seals": [{ "sealNumber": "21113141" }]
    },
    {
      "vesselSealingPointId": "<POINT_ID_A_1P_HATCH>",
      "status": "SEALED",
      "notes": "1P - Hatch Cover",
      "seals": [{ "sealNumber": "21113146" }]
    }
  ]
}
```

Batch maksimal 500 titik dan 100 nomor segel per titik. Satu kegagalan membatalkan seluruh batch.

### 10.3 Aturan status titik

| Status | Aturan |
|---|---|
| `SEALED` | Wajib mempunyai minimal satu nomor segel aktif. |
| `NOT_SEALED` | Tidak boleh membawa array segel berisi. Titik belum selesai. |
| `NOT_APPLICABLE` | Tidak boleh membawa array segel berisi dan tidak menghalangi readiness bila sah menurut aturan. |

### 10.4 Aturan keunikan nomor segel

- Backend menyimpan nomor dalam bentuk `trim + uppercase`.
- Nomor yang hanya berbeda kapitalisasi dianggap sama.
- Nomor hanya harus unik dalam satu shipment, bukan global.
- Nomor yang sama boleh dipakai pada shipment berbeda.
- Nomor yang pernah `REMOVED` atau `REPLACED` tetap tidak boleh digunakan kembali pada titik lain dalam shipment yang sama.
- Aturan yang sama berlaku pada form point, batch section, create seal, update seal, dan replace seal.
- Konflik termasuk request concurrent dikembalikan sebagai HTTP 409.

Contoh: ` w. 10001 ` dan `W. 10001` adalah nomor yang sama dalam shipment yang sama.

### 10.5 Referensi nomor Queen Sofia yang terbaca

Nilai berikut tetap harus diverifikasi dari sumber asli sebelum produksi.

| Compartment | Sounding Pipe | Hatch Cover |
|---|---:|---:|
| 1P | 21113141 | 21113146 |
| 2P | 21113142 | 21113147 |
| 3P | 21113143 | 21113148 |
| 4P | 21113144 | 21113149 |
| 5P | 21113145 | 21113150 |
| 6P | 21113171 | 21113173 |
| 7P | 21113172 | 21113174 |
| Slop Port | Kosong pada sumber | 21113175 |
| 1S | 21113151 | 21113156 |
| 2S | 21113152 | 21113157 |
| 3S | 21113153 | 21113158 |
| 4S | 21113154 | 21113159 |
| 5S | 21113155 | 21113160 |
| 6S | 21113166 | 21113168 |
| 7S | 21113167 | 21113169 |
| Slop Starboard | Kosong pada sumber | 21113170 |

Bagian G Cargo Oil Pump Valve tampak berisi `W. 21114069`, `21113498`, `21113499`, dan `21113500`. Bagian H tampak memuat Sampling Bottle `W. 21113200` dan `W. 21113245`, Measurement Tool Box `W. 21114045`, serta Pintu Pumproom `W. 21114042` dan `W. 21114043`. Prefix dan digit wajib diperiksa ulang.

## 11. Unggah dokumentasi loading

Foto loading bersifat opsional menurut aturan backend saat ini. Gunakan owner yang paling spesifik.

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/attachments
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/sections/A/attachments
POST <BASE_URL>/api/v1/records/<RECORD_ID>/attachments
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: multipart/form-data
```

Contoh field section attachment:

```text
file = <FILE_JPEG_PNG_WEBP_ATAU_PDF>
type = PHOTO
caption = 1P
sequence = 1
compartmentId = <COMPARTMENT_ID_1P>
vesselSealingPointId = <POINT_ID_OPSIONAL>
```

JPEG, PNG, WebP, dan PDF diterima; batas default implementasi 10 MiB. PDF/non-image dipertahankan sebagai metadata bukti tetapi tidak dipaksakan menjadi gambar pada appendix BA.

```http
GET    <BASE_URL>/api/v1/attachments/<ATTACHMENT_ID>/preview
GET    <BASE_URL>/api/v1/attachments/<ATTACHMENT_ID>/download
PATCH  <BASE_URL>/api/v1/attachments/<ATTACHMENT_ID>
DELETE <BASE_URL>/api/v1/attachments/<ATTACHMENT_ID>
```

Loading Master hanya dapat mengubah attachment loading shipment assignment yang masih `DRAFT`; sesudah BA LOADING final bukti loading terkunci.

Urutan caption pada contoh sumber: halaman 4 `1P, 1P, 1S, 1S, 2P, 2P, 2S, 2S, 3P`; halaman 5 `3P, 3S, 3S, 4P, 4P, 4S, 4S, 5P, 5P`; halaman 6 `5S, 5S, 6P, 6P, 6S, 6S, 7P, 7P, 7S`; halaman 7 `7S, Pump Room × 8`; halaman 8 `Pump Room, Sample × 2, Slop × 2, Trank × 4`; halaman 9 `Trank × 8`. Jangan mengubah `Trank` menjadi `Tank` tanpa konfirmasi.

## 12. Tentukan destination

Jika destination belum dikirim saat create, tunggu sampai seluruh titik required selesai sehingga `sealingProcessStatus = READY`, lalu assigned Loading Master memilih destination:

```http
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/destination-assignment
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "dischargePlantId": "<DISCHARGE_PLANT_ID>",
  "dischargeJettyId": "<DISCHARGE_JETTY_ID>",
  "unloadingMasterId": "<UNLOADING_MASTER_ID_OPSIONAL>"
}
```

Aturan:

- shipment harus `DRAFT` dan sealing process sudah `READY`;
- pasangan Plant–Jetty harus aktif dan terdaftar;
- hanya assigned Loading Master, Supervisor, atau Admin;
- Unloading Master tidak dapat memilih atau mengubah destination;
- actor, nilai lama, nilai baru, dan waktu assignment dicatat dalam audit;
- destination terkunci setelah BA LOADING final.

## 13. Lengkapi tiga signature BA LOADING

Untuk setiap role, lakukan upsert phase-aware:

```http
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/signatures/CHIEF_OFFICER
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/signatures/SURVEYOR
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/signatures/TERMINAL_REPRESENTATIVE
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "name": "<NAMA_TERKONFIRMASI>",
  "signedAt": "<ISO_DATETIME_TANDA_TANGAN>",
  "userId": null,
  "signatureUrl": null
}
```

Simpan ID setiap slot. Bila menggunakan file tanda tangan digital:

```http
PUT <BASE_URL>/api/v1/signatures/<SIGNATURE_ID>/file
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: multipart/form-data

file = <FILE_TANDA_TANGAN>
```

Endpoint preview/download file:

```http
GET <BASE_URL>/api/v1/signatures/<SIGNATURE_ID>/preview
GET <BASE_URL>/api/v1/signatures/<SIGNATURE_ID>/download
```

Gunakan endpoint phase-aware, bukan signature legacy, agar role LOADING tidak bertabrakan dengan role UNLOADING.

## 14. Finalisasi dan cetak BA LOADING

### 14.1 Finalisasi

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/finalize
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{}
```

Syarat: shipment `DRAFT`, form telah diinisialisasi, titik required telah `SEALED` dengan minimal satu segel aktif atau sah `NOT_APPLICABLE`, process `READY`, destination valid/lengkap, dan tiga signature LOADING tersedia.

Finalisasi membuat snapshot immutable yang memuat header, destination, konfigurasi form, segel aktif, foto loading, dan tiga signature LOADING. Setelah itu form, nomor segel, attachment loading, destination, dan signature LOADING terkunci.

### 14.2 Generate, preview, dan download PDF LOADING

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/pdf
GET  <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/pdf/preview
GET  <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/loading/pdf/download
Authorization: Bearer <LOADING_MASTER_TOKEN>
```

PDF BA LOADING hanya mengambil data dari snapshot immutable, menampilkan tiga signature LOADING, dan hanya mempunyai dokumentasi loading. Generate ulang bersifat idempotent; snapshot dan renderer yang sama menggunakan checksum yang sama.

## 15. Validasi dan berangkat

```http
GET <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/validation
Authorization: Bearer <LOADING_MASTER_TOKEN>
```

Departure mensyaratkan destination valid, assignment LM/UM benar, form selesai, dan BA LOADING telah final. Jika BA LOADING belum final, backend mengembalikan blocker `LOADING_BA_NOT_FINALIZED`.

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/depart
Authorization: Bearer <LOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "occurredAt": "<ISO_DATETIME_BERANGKAT_AKTUAL>",
  "remarks": "Berangkat setelah BA LOADING final"
}
```

Status berubah `DRAFT → BERLAYAR`. Snapshot dan PDF BA LOADING tidak berubah selama proses unloading.

## 16. Sandar dan verifikasi oleh Unloading Master

### 16.1 Arrive

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/arrive
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "occurredAt": "<ISO_DATETIME_SANDAR_AKTUAL>",
  "remarks": "Kapal sandar di destination"
}
```

Status berubah `BERLAYAR → SANDAR`.

### 16.2 Verifikasi setiap segel aktif dari BA LOADING

Ambil form/detail untuk memperoleh `<SEAL_ID>`, lalu:

```http
POST <BASE_URL>/api/v1/seals/<SEAL_ID>/verify
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "condition": "GOOD",
  "verifiedAt": "<ISO_DATETIME_VERIFIKASI>",
  "remarks": "Nomor sesuai dan kondisi segel baik"
}
```

Kondisi yang tersedia: `GOOD`, `DAMAGED`, `BROKEN`, `MISSING`, atau `OTHER`. Seluruh segel aktif yang dibekukan pada snapshot BA LOADING wajib mempunyai hasil verification. Segel `REMOVED` atau `REPLACED` adalah riwayat dan tidak diperlakukan sebagai segel baru yang harus diverifikasi.

### 16.3 Foto pemeriksaan unloading

Foto unloading harus dimiliki verification, bukan report/section/record loading:

```http
POST <BASE_URL>/api/v1/verifications/<VERIFICATION_ID>/attachments
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: multipart/form-data

file = <FOTO_VERIFIKASI>
type = PHOTO
caption = Kondisi segel <NOMOR_SEGEL> saat tiba
sequence = 1
```

Foto unloading opsional. Penambahannya tidak mengubah snapshot maupun checksum BA LOADING.

## 17. Lengkapi tiga signature BA UNLOADING

```http
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/signatures/CHIEF_OFFICER
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/signatures/SURVEYOR
PUT <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/signatures/TERMINAL_REPRESENTATIVE
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "name": "<NAMA_TERKONFIRMASI>",
  "signedAt": "<ISO_DATETIME_TANDA_TANGAN>",
  "userId": null,
  "signatureUrl": null
}
```

Upload file masing-masing melalui `PUT /api/v1/signatures/<SIGNATURE_ID>/file`. Storage file phase-aware, sehingga file role yang sama pada LOADING dan UNLOADING tidak saling menimpa.

## 18. Finalisasi dan cetak BA UNLOADING

### 18.1 Finalisasi

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/finalize
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: application/json

{}
```

Syarat: shipment `SANDAR`, BA LOADING final, seluruh segel aktif snapshot BA LOADING telah diverifikasi, dan tiga signature UNLOADING tersedia.

Snapshot BA UNLOADING tidak membaca ulang bagian loading dari data live. Snapshot menyimpan referensi/checksum BA LOADING, header/destination/form/segel/foto/signature loading yang sudah dibekukan, lalu menambahkan verification, foto unloading, dan tiga signature UNLOADING. Setelah final, verification, attachment unloading, dan signature UNLOADING terkunci. Shipment tetap `SANDAR`.

### 18.2 Generate, preview, dan download PDF UNLOADING

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/pdf
GET  <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/pdf/preview
GET  <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/ba/unloading/pdf/download
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
```

PDF BA UNLOADING menampilkan enam signature dalam kelompok LOADING dan UNLOADING. Appendix dipisah menjadi `DOKUMENTASI LOADING` dan `DOKUMENTASI UNLOADING`. Foto loading berasal dari snapshot BA LOADING; foto unloading berasal dari attachment verification yang dibekukan. Foto yang sama dideduplikasi. Attachment non-image tetap tercatat dalam metadata tetapi tidak dirender sebagai gambar.

## 19. Selesaikan shipment

```http
POST <BASE_URL>/api/v1/shipments/<SHIPMENT_ID>/finish
Authorization: Bearer <UNLOADING_MASTER_TOKEN>
Content-Type: application/json

{
  "occurredAt": "<ISO_DATETIME_FINISH_AKTUAL>",
  "remarks": "BA UNLOADING final dan proses selesai"
}
```

`POST /shipments/:id/finalize` adalah alias lifecycle yang sama. Bila BA UNLOADING belum final, backend menolak dengan blocker `UNLOADING_BA_NOT_FINALIZED`. Setelah berhasil, status berubah `SANDAR → FINISH`. `finalSnapshot` kompatibilitas diisi dari snapshot BA UNLOADING, bukan dari data live baru.

## 20. Dokumen legacy dan XLSX

- Untuk shipment phase-aware yang sudah mempunyai BA UNLOADING final, endpoint lama `POST/GET /shipments/:id/pdf...` menjadi facade ke artefak BA UNLOADING yang sama. Backend tidak membuat PDF final kedua.
- Untuk laporan historis tanpa `BeritaAcaraDocument`, endpoint PDF legacy tetap memakai `finalSnapshot` dan `PdfArtifact` lama.
- Gunakan endpoint `/ba/loading/pdf` dan `/ba/unloading/pdf` untuk integrasi baru.
- `POST/GET /shipments/:id/xlsx...` adalah export operasional/legacy, bukan BA resmi dan bukan artefak per phase.
- Alias `/voyages` dan `/reports` tersedia pada endpoint transaksi tertentu melalui service yang sama, tetapi panduan Queen Sofia memakai `/shipments` agar kontrak canonical tidak tercampur dengan payload Terminal legacy.

## 21. Penanganan error umum

| HTTP | Makna umum | Tindakan |
|---:|---|---|
| 400 | Payload atau gate bisnis belum valid | Baca detail; lengkapi pasangan field, readiness, verification, atau signature. |
| 401 | Token tidak ada/kedaluwarsa/tidak sah | Login kembali dan kirim Bearer token baru. |
| 403 | Role atau assignment tidak berwenang | Periksa `/auth/me` dan assignment shipment. |
| 404 | Resource atau file tidak ditemukan | Periksa UUID dan lingkungan API. |
| 409 | Konflik state, immutable lock, uniqueness, race, atau integrity file | Jangan mengulang buta; baca kode/pesan konflik dan periksa state terbaru. |

Contoh konflik 409: nomor segel sudah dipakai dalam shipment, finalisasi ganda, mutasi setelah BA final, atau checksum file tidak sesuai.

## 22. Audit log

```http
GET <BASE_URL>/api/v1/audit-logs?entityId=<SHIPMENT_ID>&limit=100
Authorization: Bearer <ADMIN_OR_SUPERVISOR_TOKEN>
```

Audit yang perlu ditelusuri: create shipment, prepare snapshot, perubahan form/segel, attachment, destination assignment, signature per phase, finalisasi BA, depart/arrive/finish, verification, dan pembuatan artefak.

## 23. Checklist operator

### Sebelum create

- [ ] Vessel benar-benar OB. QUEEN SOFIA.
- [ ] Konfigurasi compartment dan titik A–H sesuai vessel aktual.
- [ ] Activity dan produk aktif serta telah dikonfirmasi.
- [ ] Loading Plant–Jetty aktif dan mempunyai relasi master.
- [ ] Voyage number, shipment number unik, serta waktu laporan tersedia.
- [ ] Loading Master ditugaskan; Unloading Master tersedia sebelum depart.

### Sebelum BA LOADING final

- [ ] Snapshot form sudah dibuat dan semua point ID berasal dari shipment ini.
- [ ] Titik required `SEALED` dengan segel aktif atau sah `NOT_APPLICABLE`.
- [ ] Tidak ada nomor duplikat dalam shipment, termasuk riwayat removed/replaced.
- [ ] Foto loading yang diperlukan sudah diunggah sebelum lock.
- [ ] Destination lengkap dan valid.
- [ ] Tiga signature LOADING lengkap.
- [ ] `sealingProcessStatus = READY`.

### Sebelum depart

- [ ] BA LOADING sudah `FINALIZED`.
- [ ] PDF BA LOADING dapat di-preview/download dan dibawa bersama voyage.
- [ ] Validation depart tidak mempunyai blocker.

### Sebelum BA UNLOADING final

- [ ] Kapal berstatus `SANDAR`.
- [ ] Semua segel aktif dari snapshot BA LOADING telah diverifikasi.
- [ ] Foto unloading, bila digunakan, diunggah pada verification yang benar.
- [ ] Tiga signature UNLOADING lengkap.
- [ ] Operator memahami bahwa verification/foto/signature akan terkunci.

### Sebelum FINISH

- [ ] BA UNLOADING sudah `FINALIZED`.
- [ ] PDF final menampilkan signature dan dokumentasi pada kelompok phase yang benar.
- [ ] Validation finish tidak mempunyai blocker.

## 24. Keamanan dan integritas

- Jangan menyimpan password/access token di dokumen, screenshot, source control, atau log publik.
- Gunakan HTTPS pada produksi.
- Selalu gunakan UUID dari respons API pada lingkungan aktif.
- Jangan memberi role Admin hanya untuk melewati error assignment.
- Periksa respons setiap batch; jangan menganggap sebagian gagal sebagai berhasil penuh.
- Preview/download memverifikasi ukuran dan SHA-256 artefak/file yang tersimpan.
- Jangan mengedit data live dengan harapan dokumen final berubah; seluruh BA resmi dibuat dari snapshot immutable.

Dokumen ini disusun berdasarkan contoh Queen Sofia dan kontrak backend pada tanggal pembaruan. Semua placeholder dan nilai ambigu wajib diverifikasi sebelum digunakan pada lingkungan produksi.
