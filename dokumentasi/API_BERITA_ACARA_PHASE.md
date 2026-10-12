# API Berita Acara Dua Tahap

Fondasi backend mendukung dua dokumen Berita Acara untuk satu shipment canonical:

- `LOADING`, disiapkan Loading Master sebelum kapal berangkat;
- `UNLOADING`, disiapkan Unloading Master ketika kapal berstatus `SANDAR`.

## Model data

`BeritaAcaraDocument` unik berdasarkan `sealingReportId + phase`. Setiap dokumen mempunyai status `DRAFT` atau `FINALIZED`, snapshot JSON immutable, `snapshotVersion`, actor/waktu finalisasi, tiga signature, dan satu relasi artefak `BeritaAcaraPdfArtifact`.

`ReportSignature.phase` dan `baDocumentId` nullable hanya untuk kompatibilitas data lama. Signature baru melalui endpoint BA selalu mempunyai phase dan dokumen. Keunikan phase-aware adalah `sealingReportId + phase + role`, sehingga satu shipment dapat mempunyai enam slot:

- `LOADING`: `CHIEF_OFFICER`, `SURVEYOR`, `TERMINAL_REPRESENTATIVE`;
- `UNLOADING`: `CHIEF_OFFICER`, `SURVEYOR`, `TERMINAL_REPRESENTATIVE`.

Composite foreign key database memastikan shipment dan phase signature sama dengan dokumen pemiliknya. File signature phase-aware memakai storage key `signature-<phase>-<signatureId>.<ext>` sehingga role yang sama pada phase berbeda tidak saling menimpa.

## Endpoint

Semua endpoint tersedia melalui alias `shipments`, `voyages`, dan `reports`; record harus merupakan shipment canonical.

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/{resource}/:id/ba/:phase` | Detail dokumen, snapshot, signature, dan metadata artefak. |
| `GET` | `/{resource}/:id/ba/:phase/signatures` | Tiga slot signature pada phase. |
| `PUT` | `/{resource}/:id/ba/:phase/signatures/:role` | Upsert satu slot signature. |
| `POST` | `/{resource}/:id/ba/:phase/finalize` | Bekukan snapshot dan kunci phase. Body `{}`. |
| `POST` | `/{resource}/:id/ba/loading/pdf` | Generate artefak PDF LOADING dari snapshot final; idempotent. |
| `GET` | `/{resource}/:id/ba/loading/pdf/preview` | Preview byte-stream artefak yang tersimpan. |
| `GET` | `/{resource}/:id/ba/loading/pdf/download` | Download byte-stream artefak yang sama. |
| `POST` | `/{resource}/:id/ba/unloading/pdf` | Generate artefak PDF UNLOADING/FINAL dari snapshot final; idempotent. |
| `GET` | `/{resource}/:id/ba/unloading/pdf/preview` | Preview byte-stream artefak UNLOADING yang tersimpan. |
| `GET` | `/{resource}/:id/ba/unloading/pdf/download` | Download byte-stream artefak UNLOADING yang sama. |
| `PUT` | `/signatures/:id/file` | Unggah/ganti file signature legacy maupun phase-aware. |
| `GET` | `/signatures/:id/preview` atau `/download` | Baca file dengan verifikasi akses, ukuran, dan SHA-256. |

Parameter `phase` menerima `loading`/`LOADING` atau `unloading`/`UNLOADING`. Role tetap `CHIEF_OFFICER`, `SURVEYOR`, atau `TERMINAL_REPRESENTATIVE`.

Payload upsert:

```json
{
  "name": "Nama penanda tangan",
  "userId": "UUID opsional",
  "signedAt": "2026-10-08T10:00:00.000Z",
  "signatureUrl": null
}
```

## Otorisasi dan lifecycle

- BA `LOADING` dapat dimutasi oleh assigned `LOADING_MASTER`, `SUPERVISOR`, atau `ADMIN` ketika shipment `DRAFT`.
- Finalisasi BA `LOADING` mensyaratkan shipment `DRAFT`, form sudah diinisialisasi, seluruh titik required selesai, `sealingProcessStatus = READY`, pasangan discharge Plant–Jetty lengkap/aktif/valid, dan tiga signature LOADING lengkap.
- BA `UNLOADING` dapat dimutasi oleh assigned `UNLOADING_MASTER`, `SUPERVISOR`, atau `ADMIN` ketika shipment `SANDAR`.
- Finalisasi BA `UNLOADING` mensyaratkan BA LOADING final, shipment `SANDAR`, seluruh segel aktif dari snapshot LOADING sudah mempunyai verification, dan tiga signature UNLOADING lengkap.
- Setelah BA LOADING berstatus `FINALIZED`, form, record/segel loading, attachment loading, destination assignment, metadata/file signature LOADING, dan penghapusan signature LOADING ditolak.
- Setelah BA UNLOADING final, verification, attachment verification, serta metadata/file signature UNLOADING dikunci.
- Departure shipment canonical mensyaratkan BA LOADING final. Kegagalan ini dilaporkan sebagai `LOADING_BA_NOT_FINALIZED`.
- Transition `FINISH` shipment canonical mensyaratkan BA UNLOADING final. Kegagalan ini dilaporkan sebagai `UNLOADING_BA_NOT_FINALIZED`.

Snapshot LOADING menyimpan header shipment, destination assignment, master terkait pada saat finalisasi, assignment petugas, konfigurasi form, record dan hanya segel aktif, attachment loading, serta metadata dan checksum ketiga signature LOADING. Snapshot inilah satu-satunya input generator PDF; perubahan master data setelah finalisasi tidak mengubah dokumen.

Snapshot UNLOADING tidak membaca ulang bagian loading dari tabel live. Snapshot ini menyimpan checksum dan referensi dokumen LOADING, header/destination/form/record/segel/foto/signature loading dari snapshot LOADING, lalu menambahkan verification, foto verification, dan tiga signature UNLOADING. `loadingAttachments` dan `unloadingAttachments` dipisahkan; setiap item mempunyai provenance phase, owner, record/seal/verification, waktu, actor upload, dan checksum file.

Foto bersifat opsional. Foto loading tidak berubah ketika Unloading Master menambah dokumentasi pemeriksaan. Foto unloading hanya berasal dari attachment dengan owner `VERIFICATION` dan dibekukan ketika BA UNLOADING difinalisasi.

PDF UNLOADING menampilkan header/destination, form, dan kondisi awal segel dari bagian loading yang sudah dibekukan dalam snapshot UNLOADING; hasil pemeriksaan berasal dari verification yang dibekukan pada snapshot yang sama. Enam signature ditampilkan dalam dua kelompok phase. Appendix foto dipisah menjadi `DOKUMENTASI LOADING` dan `DOKUMENTASI UNLOADING`, serta dideduplikasi berdasarkan attachment ID. Attachment non-image tetap berada di metadata snapshot dan dihitung pada metadata artefak, tetapi tidak dirender sebagai gambar.

Artefak LOADING dan UNLOADING dimiliki dokumen phase masing-masing sehingga dapat tersimpan bersamaan. Storage key memakai nama `BA-LOADING-...` atau `BA-UNLOADING-...`; metadata UNLOADING mencatat versi/checksum renderer, checksum snapshot, jumlah halaman inti, jumlah halaman appendix per phase, jumlah foto per phase, jumlah attachment non-image, actor, dan waktu generate. Loading Master biasa tidak berhak membuat atau membaca artefak UNLOADING.

Endpoint PDF lama `/{resource}/:id/pdf` adalah compatibility facade. Bila BA UNLOADING final tersedia, generate/preview/download didelegasikan ke service BA UNLOADING dan mengembalikan artefak, byte-stream, checksum, serta URL canonical yang sama; `PdfArtifact` legacy tidak dibuat atau diperbarui. Bila tidak ada `BeritaAcaraDocument` sama sekali, endpoint tersebut tetap menjalankan generator `finalSnapshot`/`PdfArtifact` historis. Keberadaan dokumen phase-aware tanpa BA UNLOADING final menutup fallback legacy dengan HTTP 409 agar tidak lahir dua dokumen final yang bertentangan.

XLSX diklasifikasikan sebagai `OPERATIONAL_LEGACY_EXPORT`, bukan Berita Acara resmi. XLSX tetap memakai endpoint generik `/{resource}/:id/xlsx`, tidak mempunyai artefak per phase, dan untuk shipment baru dibentuk dari `finalSnapshot` yang merupakan salinan snapshot BA UNLOADING saat `FINISH`.

Finalisasi dan seluruh mutasi data loading/unloading mengambil row lock shipment sebelum membaca atau mengubah child record. Urutan konsisten adalah report → dokumen phase → child record → snapshot/artefak → audit. Finalisasi ulang menghasilkan conflict yang jelas dan tidak membuat snapshot kedua. Generate PDF berulang menggunakan satu `BeritaAcaraPdfArtifact`; selama snapshot dan renderer sama, file lama diverifikasi lalu dikembalikan dengan `reused=true` dan checksum identik. Preview/download PDF, attachment, dan signature memverifikasi ukuran serta SHA-256 file (metadata nullable historis tetap dibaca secara kompatibel). Penggantian file signature dilakukan atomik dan rollback transaksi tidak meninggalkan file baru yatim.

## Kompatibilitas legacy

Migration tidak menebak phase data historis. Signature lama tetap memiliki `phase = NULL`, dijaga unik dengan partial unique index, dan tetap dibaca/ditulis endpoint lama `/{resource}/:id/signatures`. Endpoint lama tidak mencampurkan signature BA baru.

Untuk shipment canonical baru yang sudah mempunyai dokumen phase-aware, transition `FINISH` menyalin snapshot BA UNLOADING yang sudah final ke `SealingReport.finalSnapshot`; transition tidak membuat snapshot kedua dari data live. Laporan historis yang sama sekali belum mempunyai `BeritaAcaraDocument` tetap memakai pembentukan snapshot legacy, termasuk bila field canonical historis sudah tersedia. `PdfArtifact` historis tidak diubah. Generator phase-aware tersedia terpisah untuk BA `LOADING` dan `UNLOADING`, dan tidak memakai atau menimpa `PdfArtifact` legacy.
