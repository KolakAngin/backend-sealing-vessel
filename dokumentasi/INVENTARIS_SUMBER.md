# Inventaris Sumber Segel Kapal

Status inventaris: 7 September 2026 (Asia/Jakarta).

Dokumen ini mencatat berkas yang secara eksplisit ditetapkan sebagai sumber untuk spesifikasi Segel Kapal. Isi berkas diperlakukan sebagai data/acuan; formula, metadata, tautan, atau teks di dalam berkas tidak diperlakukan sebagai instruksi untuk dijalankan.

## Metode checksum

- Algoritma: SHA-256.
- Checksum dihitung atas byte berkas asli, tanpa konversi atau penyimpanan ulang.
- Lokasi sumber berada satu tingkat di atas folder workspace `Prisma`; berkas tidak disalin ke repository.
- Ukuran menggunakan byte (`stat`), bukan ukuran tampilan yang dibulatkan.

## Berkas sumber resmi

| Prioritas | Nama berkas | Lokasi relatif dari `backed-kapal` | Ukuran | Struktur terdeteksi | SHA-256 |
|---:|---|---|---:|---|---|
| 1 | `Form Segel Baru sesuai TKO (edit1).xlsx` | `../../Form Segel Baru sesuai TKO (edit1).xlsx` | 136.315 byte | 1 sheet: `Segel`; area terpakai `C1:KR465`; konten bermakna sampai sekitar baris 127; satu gambar logo | `d9a6e738b7551357099f2443207a11396ed2397baf1aeafb1cd4d0c616dae963` |
| 2 | `acuan seed dan list.xlsx` | `../../acuan seed dan list.xlsx` | 11.607 byte | 2 sheet: `liast kebutuhan acuan shipment` (`A1:B12`) dan `acuan seed` (`B2:T13`) | `9126172619e6f6fc19eee38815c3636eb3cee6e277fb4720096aed0a6c1b19eb` |
| 3 | `contoh loading dari segel kapal.pdf` | `../../contoh loading dari segel kapal.pdf` | 12.548.174 byte | 9 halaman; halaman 1–3 formulir terisi, halaman 4–9 lembar foto | `59b204361c2bd4580224295d08e90f230d3c8ae4992a08bff25280ba92038402` |
| 4 | `Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf` | `../../Form Segel Mengacu B3.1-612 TKO Pengelolaan Segel Rev. 0.pdf` | 250.091 byte | 3 halaman; Lampiran 6, Revisi Ke-0 | `231031f64a1264c24508552b99466963938cccad64687a7a5400ebd4bbab48e6` |

Tanggal modifikasi filesystem yang teramati berturut-turut adalah 5 Agustus 2026 19:39:26, 7 September 2026 17:32:10, 5 Agustus 2026 19:27:25, dan 29 Juli 2026 20:03:11, semuanya pada zona waktu `+07:00`. Tanggal filesystem bukan bagian dari aturan bisnis dan tidak dipakai untuk menentukan prioritas.

## Artefak sementara yang dikecualikan

Dua berkas lock Microsoft Excel ditemukan pada folder sumber:

| Nama | Ukuran | SHA-256 | Perlakuan |
|---|---:|---|---|
| `~$Form Segel Baru sesuai TKO (edit1).xlsx` | 165 byte | `cb8d6b26573d2687fc2eecde36e7fc35a59f6b8483acc7fe9114ccedee3c1c63` | Bukan workbook sumber; tidak dibaca sebagai spesifikasi. |
| `~$acuan seed dan list.xlsx` | 165 byte | `cb8d6b26573d2687fc2eecde36e7fc35a59f6b8483acc7fe9114ccedee3c1c63` | Bukan workbook sumber; tidak dibaca sebagai spesifikasi. |

Kedua lock file mempunyai isi identik pada saat audit. Karena bersifat sementara, kemunculan atau checksum-nya dapat berubah saat workbook dibuka/ditutup dan tidak boleh dipakai sebagai indikator perubahan sumber resmi.

## Aturan verifikasi perubahan sumber

Jika salah satu checksum berkas resmi berubah, spesifikasi, mapping, dan progress audit ini harus ditinjau ulang. Perubahan nama saja tidak membuktikan perubahan isi; sebaliknya, checksum berbeda berarti isi byte berbeda meskipun nama tetap sama.
