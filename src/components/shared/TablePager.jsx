/** The Previous / Next footer for a table driven by `useTablePaging`. */
export default function TablePager({ page, pageCount, onGoToPage }) {
  if (pageCount <= 1) return null
  return (
    <div className="px-4 sm:px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-4">
      <span className="text-[12.5px] text-gray-400">Page {page + 1} of {pageCount}</span>
      <div className="flex gap-2">
        <button
          onClick={() => onGoToPage(Math.max(page - 1, 0))}
          disabled={page === 0}
          className="px-3 py-1.5 text-[12.5px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
        >
          Previous
        </button>
        <button
          onClick={() => onGoToPage(Math.min(page + 1, pageCount - 1))}
          disabled={page >= pageCount - 1}
          className="px-3 py-1.5 text-[12.5px] font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition-colors"
        >
          Next
        </button>
      </div>
    </div>
  )
}
