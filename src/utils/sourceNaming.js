// Turning a statement's printed account identity into a source name the user already uses.
//
// Deliberately its own module, with no imports: `importQueue.js` pulls in pdfjs, which needs a DOM
// and cannot be loaded by `node --test`. This is the piece that most needs testing, so it lives
// where it can be.

// Words that identify a card product to a bank but not to a person. A source name made only of
// these carries no signal at all, and matching on them is how "Credit Card ending in 1234" would
// come to mean whichever card happened to be called "Card".
const STOPWORDS = new Set([
  'card', 'cards', 'credit', 'debit', 'account', 'ending', 'in', 'the', 'a', 'an', 'statement',
  'visa', 'mastercard', 'amex', 'world', 'elite', 'signature', 'infinite', 'platinum', 'gold',
  'bank', 'rewards', 'reward', 'cash', 'back', 'cashback', 'no',
])

const significantWords = text => String(text ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter(w => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w))

/**
 * Which of the user's existing source names a statement's printed account identity refers to.
 *
 * The identity read off the page ("DISCOVER IT CARD ENDING IN 6957") is never a usable source name
 * on its own — the app calls that card whatever the user calls it ("Discover It"), and adopting the
 * printed string verbatim would mint a brand-new source on every import. So this maps evidence onto
 * a name that already exists, or returns null and lets the user answer.
 *
 * The rule is the PRODUCT word: the last significant word of an existing name, which is the part
 * that actually names the card. "Capital One Savor" is matched by a page saying "Savor Credit
 * Card", because `savor` is what distinguishes it. Requiring every word instead would fail that
 * real case — issuers print the product, not the name you gave it — while matching on any word
 * would let a Capital One VENTURE statement land on your Capital One SAVOR, sharing `capital` and
 * `one` and differing only where it matters.
 *
 * Two qualifying names means we do not know, and ambiguity is precisely what caused the mislabelled
 * import this replaces. It returns null rather than picking.
 */
export function matchSourceName(account, existingSources = []) {
  const haystack = new Set(significantWords(account))
  if (!haystack.size) return null

  const hits = existingSources.filter((name) => {
    const words = significantWords(name)
    const product = words[words.length - 1]
    return !!product && haystack.has(product)
  })
  return hits.length === 1 ? hits[0] : null
}
