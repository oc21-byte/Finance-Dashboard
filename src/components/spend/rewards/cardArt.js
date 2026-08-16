// Card art: a gradient per issuer, and nothing else.
//
// No logos, no wordmarks, no trade dress — the app has no licence to reproduce any of it, and a
// plausible-looking fake card face is worse than an honest coloured rectangle. The gradient is
// decoration that makes a wallet of eight cards scannable; it is never the thing you identify a
// card by. The card's own name is always printed on top of it.
//
// Deliberately separate from `spend/palette.js`: those colours encode DATA (a card's share of a
// chart, consistent across every chart on the page), and these encode nothing. Mixing them would
// let a wallet tile's decoration read as a chart series.

const ISSUER_ART = {
  'Amex': 'linear-gradient(135deg,#2b83e0,#0f4179)',
  'Bank of America': 'linear-gradient(135deg,#d64f57,#8f1116)',
  'Bilt': 'linear-gradient(135deg,#4b5563,#111827)',
  'BMO': 'linear-gradient(135deg,#2f6fd0,#0b2f6b)',
  'Capital One': 'linear-gradient(135deg,#e04b3c,#8f1d18)',
  'Chase': 'linear-gradient(135deg,#2a90d9,#0a4a7d)',
  'CIBC': 'linear-gradient(135deg,#c22a32,#6f0d13)',
  'Citi': 'linear-gradient(135deg,#2a6cb0,#0b2f5c)',
  'Discover': 'linear-gradient(135deg,#f5842e,#a8480a)',
  'PC Financial': 'linear-gradient(135deg,#e8434a,#8f1116)',
  'Rogers Bank': 'linear-gradient(135deg,#e8434a,#7d1319)',
  'Scotiabank': 'linear-gradient(135deg,#e8434a,#8f1116)',
  'Tangerine': 'linear-gradient(135deg,#f79239,#b4530d)',
  'TD': 'linear-gradient(135deg,#12a86a,#04543a)',
  'TJX': 'linear-gradient(135deg,#8b5cf6,#4c1d95)',
  'Wells Fargo': 'linear-gradient(135deg,#d93a44,#7d1319)',
}

// For an issuer the catalog gains before this table does. Neutral rather than random, so a new
// card never arrives wearing another issuer's colours.
const FALLBACK_ART = 'linear-gradient(135deg,#94a3b8,#475569)'

/** A card that earns nothing, or one we cannot score. Flat and grey, so it reads as inert. */
export const INERT_ART = 'linear-gradient(135deg,#e5e7eb,#cbd5e1)'

export function issuerArt(issuer) {
  return ISSUER_ART[issuer] ?? FALLBACK_ART
}
