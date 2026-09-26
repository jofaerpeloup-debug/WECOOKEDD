import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ManagementPagination({ pagination, onPageChange, noun = 'result' }) {
  if (
    !pagination
    || !Number.isSafeInteger(pagination.page)
    || pagination.page < 1
    || !Number.isSafeInteger(pagination.limit)
    || pagination.limit < 1
    || !Number.isSafeInteger(pagination.total)
    || pagination.total < 0
    || !Number.isSafeInteger(pagination.totalPages)
    || pagination.totalPages < 0
  ) return null;

  const { page, limit, total, totalPages } = pagination;
  const first = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const last = total === 0 ? 0 : Math.min(page * limit, total);
  const pages = Math.max(totalPages, 1);

  return (
    <nav className="wc-management-pagination" aria-label={`${noun} pagination`}>
      <p>
        <strong>{first}–{last}</strong> of {total} total {noun}{total === 1 ? '' : 's'}
      </p>
      <div>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={15} aria-hidden="true" /> Previous
        </button>
        <span>Page {page} of {pages}</span>
        <button type="button" disabled={totalPages === 0 || page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
