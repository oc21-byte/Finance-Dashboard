import { useState } from 'react'

// A year of statements makes the transaction list the longest thing on either page by an order of
// magnitude. Collapsed to five rows by default and paginated at ten once expanded, so the charts
// above it stay reachable.
export const COLLAPSED_ROWS = 5
export const PAGE_SIZE = 10

/**
 * Collapse / expand / paginate a row list.
 *
 * @param rows          the full list; only a slice is returned
 * @param resetKey      any value that means "this is a different list now" (period, filters,
 *                      search). When it changes the page returns to the first.
 * @param forceExpanded a review mode that must show every match regardless of the toggle
 * @param containerRef  the table's outer element, used to scroll back to it when paging
 * @param onPageChange  called on a page change — the caller uses it to drop transient row state
 */
export function useTablePaging(rows, {
  resetKey, forceExpanded = false, containerRef, onPageChange,
} = {}) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)

  // Reset to the first page when the underlying list changes out from under it. Done during render
  // rather than in an effect so the new page never paints at the old offset.
  const [seenKey, setSeenKey] = useState(resetKey)
  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setPage(0)
  }

  const isExpanded = expanded || forceExpanded
  const pageCount = Math.max(Math.ceil(rows.length / PAGE_SIZE), 1)
  // Clamped rather than stored: deleting the last row of the last page should land you on a page
  // that exists, without a round trip through state.
  const safePage = Math.min(page, pageCount - 1)
  const visible = isExpanded
    ? rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : rows.slice(0, COLLAPSED_ROWS)

  function goToPage(next) {
    setPage(next)
    onPageChange?.()
    // Only when the table's header has already scrolled off — paging while the whole table is
    // visible shouldn't yank the viewport.
    const el = containerRef?.current
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function toggleExpanded() {
    setExpanded(v => !v)
    setPage(0)
  }

  return { expanded, isExpanded, toggleExpanded, visible, page: safePage, pageCount, goToPage }
}
