import { useEffect, useRef, useState } from 'react'

/**
 * Height of the pinned bar, in px. A hard constant on purpose — see below.
 * Anything that has to clear the bar imports this rather than measuring.
 */
export const PINNED_BAR_H = 56

/**
 * The condensed bar that pins to the top of the viewport once the scope block above it scrolls out.
 * Both tabs use it: Spend through `spend/ScopeHeader.jsx`, Finances through
 * `finance/FinanceScopeBar.jsx`. Only the row of content differs — the pin mechanism must not.
 *
 * **The bar is `fixed`, not `sticky`, and its height is a constant.** Both of those are
 * load-bearing. A sticky element that changes height changes the document's height with it, which
 * moves the scroll position, which moves the sentinel that decides whether to condense — so the
 * header condenses, the page shortens, the sentinel comes back into view, the header expands, and
 * it thrashes on every frame. Taking the bar out of flow means toggling it cannot move anything,
 * and fixing its height means nothing downstream has to measure it and re-render mid-scroll.
 *
 * So: don't make this bar `sticky`, don't let its content wrap, and don't replace the constant
 * with a measurement.
 *
 * `offsetTop` is for anything else pinned above it — currently Layout's demo-mode banner, which is
 * `sticky top-0 z-40` and would otherwise sit on top of the bar.
 *
 * Render this immediately after the block it condenses: the sentinel is its first child, so its
 * position in the document is what decides when the bar appears.
 */
export default function PinnedScopeBar({ offsetTop = 0, children }) {
  const sentinelRef = useRef(null)
  const [pinned, setPinned] = useState(false)

  // A sentinel below the full block, rather than a scroll listener: the browser reports the
  // crossing itself, so this costs nothing per frame.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinelRef} className="h-px -mt-px" aria-hidden />

      {pinned && (
        <div
          // Opaque, not translucent-with-blur: a backdrop-filter spanning the viewport has to
          // recomposite the charts underneath it on every scroll frame.
          className="fixed inset-x-0 z-30 bg-gray-50 border-b border-gray-200 shadow-[0_4px_10px_-8px_rgba(0,0,0,0.3)]"
          style={{ top: offsetTop, height: PINNED_BAR_H, animation: 'scope-condense 140ms ease-out' }}
        >
          {/* Matches <main>'s max-w-7xl and the page's own padding, so the bar lines up with the
              content underneath it. `overflow-hidden` + `whitespace-nowrap` keep this to exactly
              one line at any width — wrapping would break the constant height. */}
          <div className="max-w-7xl mx-auto h-full px-3 sm:px-6 flex items-center gap-x-4 overflow-hidden whitespace-nowrap">
            {children}
          </div>
        </div>
      )}
    </>
  )
}
