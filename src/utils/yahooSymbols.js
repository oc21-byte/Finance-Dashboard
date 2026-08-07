/**
 * Yahoo Finance chart symbols to try for a stored ticker, in preference order.
 *
 * Bare Canadian symbols collide with unrelated US listings on Yahoo (HURA → TuHURA
 * Biosciences, TEC → Harbor Transformative Technology). The TSX listing is `TICKER.TO`.
 *
 * `listing` comes from the holding when known (`CA` | `US`). Without it, candidates stay
 * Canadian-first — this app's registered accounts are mostly TFSA / RRSP / FHSA — and a
 * pure US symbol like AAPL still resolves after `AAPL.TO` 404s.
 */

const EXCHANGE_SUFFIX =
  /\.(TO|V|CN|NE|TSXV|L|HK|AX|DE|PA|SW|T|F|OL|CO|ST|HE|MI|AS|BR|LS|MC|SA|MX|KQ|KS|NS|BO|JK|SI|NZ|JO)$/i

export function yahooSymbolCandidates(ticker, { listing = null } = {}) {
  const t = String(ticker || '').trim().toUpperCase()
  if (!t) return []
  if (EXCHANGE_SUFFIX.test(t)) return [t]

  if (listing === 'US') return [t, `${t}.TO`]
  if (listing === 'CA') return [`${t}.TO`, t]
  // Unknown: Canadian-first, then bare.
  return [`${t}.TO`, t]
}
