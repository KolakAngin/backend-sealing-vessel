# Kompatibilitas Dokumen Legacy dan Phase-Aware

## Keputusan canonical

Untuk shipment baru yang mempunyai `BeritaAcaraDocument`, BA UNLOADING berstatus `FINALIZED` adalah satu-satunya dokumen final canonical. `BeritaAcaraPdfArtifact` phase `UNLOADING` adalah satu-satunya artefak PDF yang dilayani oleh endpoint final, termasuk endpoint lama `/{resource}/:id/pdf`.

`SealingReport.finalSnapshot` tetap dipertahankan sebagai field compatibility. Pada transition `FINISH` shipment phase-aware, nilainya disalin persis dari snapshot immutable BA UNLOADING; backend tidak mengambil ulang master, record, verification, attachment, atau signature live. `SealingReport.finalSnapshot` historis tidak dimigrasikan, ditulis ulang, atau dihapus.

## Matriks routing

| Kondisi report | `POST/GET .../:id/pdf` | Penyimpanan |
|---|---|---|
| Tidak mempunyai `BeritaAcaraDocument` | Generator/reader legacy | `finalSnapshot` + `PdfArtifact` |
| Mempunyai BA UNLOADING `FINALIZED` | Delegasi ke endpoint/service BA UNLOADING | `BeritaAcaraDocument` + `BeritaAcaraPdfArtifact` |
| Mempunyai dokumen phase-aware tetapi BA UNLOADING belum final | HTTP 409 | Tidak membuat artefak final |

Alias `reports`, `voyages`, dan `shipments` memakai controller dan compatibility service yang sama. Untuk cabang phase-aware, assigned Unloading Master, Supervisor, atau Admin mengikuti otorisasi BA UNLOADING; Loading Master biasa ditolak. Untuk cabang historis, kebijakan akses legacy dipertahankan.

Artefak lama yang sudah telanjur ada tidak dihapus. Jika sebuah shipment phase-aware juga mempunyai `PdfArtifact` historis, compatibility service mengabaikannya dan tidak menulis ulang file/database tersebut. Storage key baru tetap phase-aware (`BA-LOADING-...` dan `BA-UNLOADING-...`) sehingga tidak berbenturan dengan key legacy.

## XLSX

Audit route, renderer, template, dokumentasi, dan test menunjukkan XLSX adalah export operasional form segel TKO tiga tanda tangan, bukan BA resmi. XLSX tetap tersedia untuk integrasi lama melalui `/{resource}/:id/xlsx`, dengan response `documentClassification=OPERATIONAL_LEGACY_EXPORT`. Tidak dibuat model atau artefak XLSX per phase.

Untuk shipment phase-aware yang sudah `FINISH`, sumbernya tetap immutable karena `finalSnapshot` merupakan salinan snapshot BA UNLOADING. Export memilih `loadingSignatures` untuk tiga slot form segel dan mendukung storage key signature phase-aware. Untuk data historis, struktur snapshot/signature lama tetap dibaca seperti sebelumnya.

## Strategi migrasi

Tidak ada data migration tambahan untuk compatibility ini. Aturan routing diterapkan pada runtime agar data historis tetap utuh. Deployment tidak perlu menghapus `PdfArtifact`, `finalSnapshot`, atau file export lama. Consumer disarankan beralih ke endpoint `/ba/unloading/pdf`; endpoint `/pdf` tetap tersedia sebagai facade kompatibilitas.
