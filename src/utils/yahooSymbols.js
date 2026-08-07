/**
 * Yahoo Finance chart symbols to try for a stored ticker, in preference order.
 *
 * Bare Canadian symbols collide with unrelated US listings on Yahoo (HURA → TuHURA
 * Biosciences, TEC → Harbor Transformative Technology). The TSX listing is `TICKER.TO`.
 *
 * `listing` comes from the holding when known (`CA` | `US`), else from home currency via
 * `resolveListing`. Without any hint, prefer the bare US symbol — CAD-hedged CDRs like
 * NVDA.TO / PYPL.TO would otherwise win and price a USD book at ~1/5 the real share price.
 * Canadian tickers must carry `listing: 'CA'`, a registered account type, or home currency CAD.
 */

const EXCHANGE_SUFFIX =
  /\.(TO|V|CN|NE|TSXV|L|HK|AX|DE|PA|SW|T|F|OL|CO|ST|HE|MI|AS|BR|LS|MC|SA|MX|KQ|KS|NS|BO|JK|SI|NZ|JO)$/i

export function yahooSymbolCandidates(ticker, { listing = null } = {}) {
  const t = String(ticker || '').trim().toUpperCase()
  if (!t) return []
  if (EXCHANGE_SUFFIX.test(t)) return [t]

  if (listing === 'CA') return [`${t}.TO`, t]
  // US, or unknown: bare first so CDR aliases cannot steal the quote.
  return [t, `${t}.TO`]
}
