# Spesifikasi Sumber Kebenaran Segel Kapal

Status: baseline dokumentasi dan audit, 7 September 2026. Dokumen ini tidak menyatakan bahwa implementasi saat ini sudah sesuai.

## 1. Tujuan dan batas

Dokumen ini menetapkan sumber kebenaran untuk pengembangan form, data voyage/shipment, konfigurasi vessel, serta keluaran laporan Segel Kapal. Pekerjaan audit ini tidak mengubah production code, Prisma schema, migration, seed, API, maupun frontend.

Semua ejaan sumber dicatat apa adanya. Normalisasi istilah atau koreksi typo hanya boleh dilakukan setelah ada keputusan pemilik produk; typo tidak diam-diam diubah menjadi aturan baru.

## 2. Hierarki sumber dan aturan konflik

Urutan otoritas berikut berlaku menurut ruang lingkupnya:

1. `Form Segel Baru sesuai TKO (edit1).xlsx` adalah acuan utama struktur form A–H dan layout laporan.
2. `acuan seed dan list.xlsx` adalah acuan utama khusus untuk field wajib pembuatan shipment/voyage pada sheet pertama dan seluruh nilai master seed pada sheet kedua.
3. `contoh loading dari segel kapal.pdf` adalah contoh pengisian OB. Queen Sofia yang paling dekat dengan sumber lapangan. Contoh ini membuktikan cara pemakaian dan bentuk lampiran foto, tetapi tidak menambah kewajiban global bila tidak ada di sumber berprioritas lebih tinggi.
4. `Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf` adalah referensi tambahan untuk istilah dan struktur. Bila berbeda dengan Excel utama, Excel utama menang.
5. Production code, schema, seed saat ini, frontend, test, dan dokumentasi lama adalah objek audit, bukan sumber persyaratan.

Aturan resolusi:

- Sumber yang lebih rendah tidak boleh mengganti struktur sumber yang lebih tinggi.
- Nilai contoh Queen Sofia tidak boleh dijadikan default semua vessel.
- Sel kosong tidak boleh ditafsirkan sebagai nol, `false`, atau “tidak tersedia”.
- Istilah mirip tidak boleh dianggap identik tanpa keputusan eksplisit, misalnya `Shipment Number` dengan `reportNo`, atau `Status Sealing` dengan status perjalanan.
- Formula dan nilai hard-coded pada Excel utama menggambarkan layout/contoh binding. Nilai `STS TABONEO`, `MT. GLOBAL TOP`, `B40`, dan `LOADING` tidak boleh menjadi default universal tanpa konfirmasi.

Checksum dan metadata sumber tersedia di [INVENTARIS_SUMBER.md](./INVENTARIS_SUMBER.md).

## 3. Data wajib pembuatan shipment/voyage

Sheet `liast kebutuhan acuan shipment` menetapkan sebelas field berikut sebagai kebutuhan wajib. Label sumber dipertahankan verbatim.

| No. | Label sumber | Makna target yang dapat dipastikan |
|---:|---|---|
| 1 | Nama Kapal | Vessel yang menjalankan voyage. |
| 2 | Activity | Aktivitas yang dipilih dari master aktivitas. |
| 3 | Tanggal | Tanggal shipment/voyage. Sumber tidak memastikan apakah mencakup waktu. |
| 4 | Voyage Number | Nomor voyage. |
| 5 | Shipoment Number | Nomor shipment; `Shipoment` adalah ejaan asli sumber. |
| 6 | Produk | Produk yang dipilih dari master produk. |
| 7 | Loading Port | Port asal/loading. |
| 8 | Jetty Name Loading Port | Jetty di port loading. |
| 9 | Discharge Port | Port tujuan/discharge. |
| 10 | Jetty Name Discharge Port | Jetty di port discharge. |
| 11 | Status Sealing | Status sealing. Domain nilainya tidak tersedia pada sumber. |

Kewajiban ini berlaku pada pembuatan shipment/voyage target. API saat ini belum memenuhi keseluruhan daftar; detailnya ada di [MAPPING_XLSX_API_DB.md](./MAPPING_XLSX_API_DB.md).

## 4. Seluruh master seed dari sumber

Bagian ini menyalin seluruh sel data pada sheet `acuan seed`. Sel kosong ditulis `—` dan harus tetap dianggap “belum ada data”, bukan nilai default.

### 4.1 Plant/lokasi

| Kode Plant | Nama Plant Lokasi |
|---|---|
| `1401` | IT Balikpapan |
| `1402` | FT Samarinda |
| `1403` | FT Tarakan |
| `1404` | IT Banjarmasin |
| `2503` | DM LPG Banjarmasin |
| `1S45` | STS Taboneo |

Kode `1S45` mengandung huruf `S` menurut nilai cell dan tidak boleh diubah menjadi `1545` tanpa konfirmasi.

### 4.2 Vessel

Header `Pemilik Kapan` disalin verbatim; kemungkinan koreksi menjadi `Pemilik Kapal` belum disahkan.

| Nama Kapal | Tipe Kapal | Produk | Pemilik Kapan | DWT Kapal | Kapasitas | Jumlah Tangki | Drawing Kapal | Link Drawing Kapal |
|---|---|---|---|---|---|---:|---|---|
| MT IHSAN 2 | MT | LPG | PT Agrabudi Gas Utama | — | — | 2 | YES | — |
| MT IHSAN 3 | MT | LPG | PT Agrabudi Gas Utama | — | — | 2 | NO | — |
| MT IHSAN 5 | MT | LPG | PT Agrabudi Gas Utama | — | — | 2 | YES | — |
| OB Ratu Maryam | OB | BBM | PT Barokah Gemilang Perkasa | — | — | 7 | YES | — |
| OB XXXXX | OB | AVTUR | PT Barokah Gemilang Perkasa | — | — | 7 | YES | — |

### 4.3 Aktivitas

| Urutan sumber | AKTIVITAS |
|---:|---|
| 1 | LOADING |
| 2 | DISCHARGE |
| 3 | ROB |

### 4.4 Produk dan UoM

| Urutan sumber | PRODUK | UoM |
|---:|---|---|
| 1 | PERTALITE | KL |
| 2 | PERTAMAX | MT |
| 3 | PERTAMAX TURBO | BBRL |
| 4 | BIOSOLAR B40 | — |
| 5 | PERTADEX | — |
| 6 | DEXLITE | — |
| 7 | LPG | — |
| 8 | MFO | — |

UoM pada tiga baris pertama tidak cukup untuk membuktikan bahwa UoM merupakan atribut tetap produk atau daftar master independen. Keputusan model data ini masih terbuka.

### 4.5 Jetty

| Urutan sumber | JETTY NAME |
|---:|---|
| 1 | JETTY 1 |
| 2 | JETTY 2 |
| 3 | JETTY 3 |
| 4 | MT GLOBAL |
| 5 | MT XXXX |

Sumber tidak menyediakan relasi jetty-ke-plant/port. Relasi tersebut tidak boleh direka.

## 5. Header dan narasi laporan

Excel utama memakai judul `SEALING REPORT`, logo Pertamina Patra Niaga, lalu header:

1. `Vessel Name`
2. `Terminal`
3. `Cargo`
4. `Date/Time`

Narasi berikutnya mempunyai placeholder/data untuk:

- `We Loading Master/Surveyor ...`
- `on board the vessel of ...`
- `at the port of ...`
- `for and on behalf of PT. Pertamina Patra Niaga`
- `to conduct LOADING inspection and supervision of ...`
- kalimat penutup pembuka tabel: `Upon the completion of loading/discharging we have conduct some sealing on board the vessel as follows:`

Pada workbook, nama vessel di cell input dipakai kembali melalui formula pada narasi. `Terminal`, `Cargo`, bagian terminal pada narasi, dan `LOADING` berisi contoh hard-coded. Implementasi target harus melakukan binding dari data voyage/master, bukan menganggap nilai contoh sebagai konstanta global. Sumber belum memastikan siapa yang mengisi frasa `Loading Master/Surveyor` dan objek setelah `supervision of`; keduanya tetap keputusan terbuka.

## 6. Struktur form A–H yang normatif

### A. Closed Cade/Hatch Coaming/Tank Dom, Tank Cleaning Access and Sounding Hole/Flange Vapor Lock of Sounding Hole

Kolom, dalam urutan Excel utama:

1. `No.`
2. `Compartement` (ejaan sumber)
3. `Sounding Hole/ Flange Vapor Lock`
4. `Tank Cleaning Access DOT/ Deck Seal`
5. `Hatch Coaming/ Tank Dom/ Closed Cade/ Manhole`
6. `Sampling Hole/ Sighting Hole/ Small Manhole`
7. `Emergency Connection (Framo pump)`

Layout contoh utama menyediakan kelompok `PORT SIDE` dengan baris bernama `1`–`7` dan `Slop`, serta kelompok `STBD SIDE` dengan baris bernama sama. Pada masing-masing kelompok terdapat satu baris grid tanpa label sebelum `Slop`; baris tanpa label ini tidak boleh otomatis dianggap compartment. Konfigurasi target harus membangkitkan baris dari compartment vessel aktif dan urutannya, bukan mengunci jumlah `1`–`7` atau keberadaan `Slop` untuk semua vessel.

Catatan konflik: kolom ke-4 Excel menggabungkan `Tank Cleaning Access DOT/Deck Seal`. Seed implementasi saat ini memecahnya menjadi dua template. Struktur keluaran harus mengikuti Excel utama sampai ada keputusan perubahan sumber.

### B. Manifold Cargo/Bunker/MARPOL

Kolom:

1. `No.`
2. `Cargo/ Bunker/ Marpol Manifold (Port)`
3. `Cargo/ Bunker/ Marpol Manifold (Stbd)`

Excel utama menyediakan lima baris input. Isi pada kolom Port dan Stbd adalah nomor segel/lokasi sesuai konfigurasi vessel; jangan menambahkan kolom terpisah hanya karena PDF tambahan memilikinya.

### C. Permanent Means Access (FPT, APT, WBT)

Struktur Excel utama melintasi halaman 1 dan 2:

- Halaman 1: `No.`, `Fore Peak Tank`, dan `After Peak Tank`. Masing-masing FPT dan APT mempunyai tiga slot sejajar.
- Awal halaman 2: dua blok tabel berdampingan. Tiap blok memiliki `No.`, `Water Ballast Tank (P)`, dan `Water Ballast Tank (S)` dengan empat baris; total tersedia delapan pasangan WBT P/S.

Nomor/identitas WBT tidak diisi di template. Identitas dan banyaknya baris target harus berasal dari konfigurasi vessel. PDF tambahan menyederhanakan C menjadi dua tabel generik `PERMANEN MEAS ACCESS (WBT)`; penyederhanaan ini tidak menggantikan layout Excel utama.

### D. Cargo Valve on Deck (Suction, Stripping, Drop, Cross Over, Gate & Drain Manifold)

Kolom:

1. `No.`
2. `Suction`
3. `Stripping`
4. `Dropline`
5. `Cross Over`
6. `Gate & Drain Manifold`

Excel utama menyediakan delapan baris. PDF tambahan mengelompokkan jenis tersebut menjadi dua kelompok besar; target tetap menggunakan lima kolom Excel utama.

### E. Tank Cleaning/COW Valve

Kolom:

1. `No.`
2. `Tank Cleaning Valve`
3. `Cow Valve`

Excel utama menyediakan tiga baris input.

### F. Bunker Sounding Hole (bila terdapat Flange) and Deck Seal

Kolom:

1. `No.`
2. `Compartement Bunker` (ejaan sumber)
3. `Sounding Hole/ Flange Vapor Lock`
4. `Deck Seal`

Excel utama menyediakan tiga baris input. Keberlakuan bagian ini bergantung pada konfigurasi vessel dan keberadaan flange; tidak semua vessel harus dipaksa mempunyai data F.

### G. Sealing Access at Pump Room dan Pumps

Kolom: `No.`, `Equipment`, dan `Seal No.`. Daftar equipment harus tampil dalam urutan berikut:

| No. | Equipment | Slot nomor segel pada Excel utama |
|---:|---|---:|
| 1 | Cargo Sea Chest Valve | 3 |
| 2 | Spool Piece Cargo Line Vs Ballast Line | 3 |
| 3 | Overboard Valve | 3 |
| 4 | Cover of Strainer | 3 |
| 5 | Cargo Oil Pump Valve | 3 |
| 6 | Stripping pump Valve | 3 |
| 7 | Bilge pump valve | 3 |
| 8 | Cross Over/By Pass Valve | 3 |
| 9 | Tank Cleaning Valve | 3 |
| 10 | Drain Valve Cargo Oil Pump Strainer | 3 |
| 11 | Drain Valve stripping Pump Strainer | 3 |
| 12 | Air pipe Cargo Oil Pump Strainer (Tongkang/spob) | 3 |
| 13 | Air pipe stripping Pump Strainer (Tongkang/spob) | 3 |
| 14 | Pipa pancingan pompa cargo (Tongkang/spob) | 3 |

Nomor 12–14 secara eksplisit ditandai untuk Tongkang/SPOB. Setiap equipment dapat diaktifkan, dinonaktifkan, atau mempunyai instance sesuai vessel; daftar globalnya tetap bagian dari bentuk TKO.

### H. Other

| No. | Equipment menurut Excel utama | Slot nomor segel |
|---:|---|---:|
| 1 | Sampling Bottle | 2 |
| 2 | Measurement Tool Box | 1 |
| 3 | Pintu Pumproom | 1 |
| 4 | Portable Emergency Submersible Cargo Pump | 1 |

Konflik yang disengaja dicatat, bukan diselesaikan: PDF tambahan menulis item 3 sebagai `Wilden Pump` dan memberi empat slot `a`–`d` untuk Sampling Bottle. Excel utama dan contoh Queen Sofia sama-sama memakai `Pintu Pumproom`; karena itu target baseline memakai `Pintu Pumproom` dan dua slot Sampling Bottle. Apakah `Wilden Pump` perlu menjadi item tambahan/alias masih harus dikonfirmasi.

## 7. Konfigurasi vessel dinamis

Struktur A–H adalah template global; baris aktual adalah konfigurasi per vessel. Target minimal harus mampu merepresentasikan:

- identitas vessel dan atribut master sumber: nama, tipe, produk, pemilik, DWT, kapasitas, jumlah tangki, indikator drawing, dan link drawing;
- compartment/tangki dengan kode, nama, sisi (`PORT`, `STBD`, atau posisi lain bila disahkan), urutan, dan status aktif;
- titik A–H per vessel yang mengikat kategori, jenis kolom/equipment, compartment bila relevan, sisi, nama/lokasi, nomor instance, urutan, ketersediaan, dan status aktif;
- nol, satu, atau beberapa nomor segel pada satu titik sesuai jumlah fisik/slot;
- snapshot konfigurasi pada voyage sehingga perubahan master vessel di masa depan tidak mengubah laporan historis secara diam-diam.

`Jumlah Tangki` dari seed tidak cukup untuk menghasilkan kode atau sisi compartment. Contoh Queen Sofia `1P`–`7P`, `1S`–`7S`, dan `Slop` tidak boleh digeneralisasi ke vessel lain. Aturan pembuatan compartment dari jumlah tangki masih memerlukan data/konfirmasi.

## 8. Struktur keluaran XLSX

Workbook utama mempunyai satu sheet `Segel`. Konten laporan disusun menjadi tiga panel cetak vertikal yang ditempatkan berdampingan pada sheet:

| Halaman logis | Rentang kolom | Isi utama |
|---:|---|---|
| 1 | `C:CV` | Judul/logo, header, narasi, A, B, dan awal C (FPT/APT). |
| 2 | `DA:GT` | Lanjutan C (WBT), D, E, F, dan G nomor 1–5. |
| 3 | `GY:KR` | G nomor 6–14, H, acknowledgement, dan tanda tangan. |

Di antara panel terdapat empat kolom kosong. Workbook mempunyai manual column break setelah kolom `CV`; tidak ada defined print area yang tersimpan. Konfigurasi cetak yang terdeteksi:

- paper size OOXML `9` (A4);
- portrait;
- horizontal dan vertical centered;
- margin kiri, kanan, atas, bawah, header, footer masing-masing `0.1181102362` inci (sekitar 0,3 cm);
- logo PNG tertanam berukuran 349 × 117 piksel pada kanan atas panel pertama.

Generator XLSX target harus menghasilkan tiga halaman logis tersebut secara deterministik. Karena file sumber tidak menyimpan defined print area, detail scaling/fit-to-page tidak boleh ditebak; harus diuji dan disahkan dengan hasil render.

Bagian akhir panel ketiga memuat:

- `Kindly acknowledge the above report by signing below`
- `Thanks you.` (ejaan Excel utama)
- tiga kotak tanda tangan: `Chief Officer`, `Terminal Representative`, dan `Surveyor`.

Apakah typo `Thanks you.` boleh dikoreksi menjadi `Thank you.` perlu konfirmasi.

## 9. Struktur keluaran PDF

Baseline isi PDF adalah render tiga halaman laporan XLSX dengan urutan yang sama. PDF tambahan juga terdiri dari tiga halaman, tetapi pembagian bagian berbeda; pembagian Excel utama tetap menang.

Contoh Queen Sofia menunjukkan pola keluaran sembilan halaman:

1. Halaman 1–3: sealing report terisi dan tanda tangan.
2. Halaman 4–9: 53 foto dalam contact sheet tiga kolom × tiga baris per halaman, kecuali slot terakhir kosong.

Label foto disimpan di atas setiap foto. Distribusi label verbatim pada contoh adalah 28 foto compartment (`1P` sampai `7S`, masing-masing dua), 9 `Pump Room`, 2 `Sample`, 2 `Slop`, dan 12 `Trank`. `Trank` adalah ejaan pada PDF dan belum boleh dinormalisasi diam-diam menjadi `Tank`.

Lampiran foto membuktikan kebutuhan urutan dan caption, tetapi belum ada keputusan apakah PDF target wajib selalu menggabungkan lampiran, berapa foto maksimal, bagaimana pagination untuk rasio gambar berbeda, atau apakah dokumen non-foto ikut digabung.

## 10. Contoh Queen Sofia yang dapat dibaca

Data header yang cukup jelas:

| Field | Nilai terbaca |
|---|---|
| Vessel Name | `OB. QUEEN SOFIA` |
| Terminal | `STS TABONEO (MT. GLOBAL TOP)` |
| Cargo | Teks cetak `B40` diikuti tulisan tangan yang tampak seperti `B-SO`; bagian tulisan tangan belum pasti. |
| Date/Time | `28 JULI 2026`; waktu tidak tampak. |
| Activity pada narasi | `LOADING` |

Pola pengisian yang terbukti:

- A mengisi nomor segel terutama pada `Sounding Hole/Flange Vapor Lock` dan `Hatch Coaming/Tank Dom/Closed Cade/Manhole` untuk compartment Port dan Stbd 1–7 serta Slop.
- B mengisi dua nomor pada sisi Port dan dua pada Stbd; beberapa digit tulisan tangan tidak cukup jelas untuk dijadikan seed.
- D, E, F, dan sebagian besar G kosong; G nomor 5 `Cargo Oil Pump Valve` berisi empat nomor pada satu area equipment.
- H `Sampling Bottle` berisi dua nomor, `Measurement Tool Box` satu nomor, `Pintu Pumproom` dua nomor pada satu slot visual, dan `Portable Emergency Submersible Cargo Pump` kosong.

Nomor H yang cukup jelas untuk contoh uji manual, bukan seed master:

| Equipment | Nomor terbaca |
|---|---|
| Sampling Bottle | `W. 21113200`, `W. 21113245` |
| Measurement Tool Box | `W. 21114045` |
| Pintu Pumproom | `W. 21114042`, `W. 21114043` |

Digit yang meragukan tidak ditranskripsikan sebagai fakta. Scan tetap menjadi rujukan visual primer untuk validasi contoh ini.

## 11. Keputusan yang tidak boleh ditebak

Keputusan berikut belum mempunyai data pasti:

1. Apakah label typo/varian sumber akan dipertahankan pada UI/output atau dikoreksi: `liast`, `Shipoment`, `Compartement`, `Pemilik Kapan`, `PERMANEN MEAS`, `Thanks you.`, `Trank`, serta `DOT` pada Excel utama versus `COT` pada PDF tambahan.
2. Apakah `reportNo` identik dengan Voyage Number, Shipment Number, atau nomor laporan yang berbeda.
3. Domain dan transisi `Status Sealing`, serta hubungannya dengan status perjalanan `DRAFT/BERLAYAR/SANDAR/FINISH`.
4. Apakah `Tanggal` wajib menyimpan waktu, timezone, tanggal loading, atau tanggal laporan.
5. Model terpisah untuk plant, port, terminal, dan jetty serta relasi di antaranya.
6. Apakah UoM adalah atribut produk, master mandiri, atau pilihan per shipment.
7. Normalisasi `Activity`: sumber memakai `DISCHARGE`, form memakai `Loading/Discharging`, sedangkan enum saat ini memakai `DISCHARGING`; sumber juga mempunyai `ROB`.
8. Makna dan sumber data `Loading Master/Surveyor` pada narasi.
9. Aturan menghasilkan compartment dari `Jumlah Tangki`, termasuk Slop, center tank, FPT/APT/WBT, dan vessel non-Queen Sofia.
10. Apakah `Wilden Pump` perlu ditambahkan sebagai equipment terpisah/alias selain `Pintu Pumproom`.
11. Apakah jumlah slot statis Excel adalah batas maksimum, minimum, atau hanya layout contoh ketika konfigurasi vessel mempunyai lebih banyak titik/seal.
12. Aturan snapshot master vessel/titik sealing pada voyage historis.
13. Format nomor segel, apakah prefix `W.` merupakan bagian nilai, dan apakah nomor harus unik secara global.
14. Aturan ekspor: penamaan file, locale/tanggal, pembulatan ukuran, scaling, QR/barcode, metadata dokumen, tanda tangan digital/gambar, dan penggabungan lampiran.
15. Apakah label/caption foto harus memilih vocabulary baku atau mempertahankan input lapangan.

Tidak ada implementasi untuk keputusan di atas yang boleh dianggap final sebelum pemilik produk memberi jawaban atau sumber baru dengan prioritas yang disepakati.
