export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * Menormalisasi page terhadap jumlah data terbaru. Ini membuat list tetap
 * usable ketika item terakhir pada halaman akhir dihapus atau consumer masih
 * membawa nomor halaman dari filter/resource sebelumnya.
 */
export function resolvePagination(requestedPage: number, limit: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  return {
    skip: (page - 1) * limit,
    take: limit,
    meta: { page, limit, total, totalPages } satisfies PaginationMeta,
  };
}
