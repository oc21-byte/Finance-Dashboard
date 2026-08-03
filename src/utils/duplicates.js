import dayjs from 'dayjs'

// Two rows are treated as possible duplicates when the amount matches to the cent, the dates are
// close (statements often post the same purchase a day or two apart), and the descriptions agree.
// Deliberately a flag, never an automatic delete: a genuine repeat charge — same coffee, same
// price, next morning — is indistinguishable from a re-import, so the call stays with the user.
const DATE_WINDOW_DAYS = 3
const SIMILARITY_THRESHOLD = 0.7

// Strips punctuation and long reference/store numbers, which are the usual reason the same
// merchant reads differently across two exports of the same month.
export function normalizeDescription(desc) {
  return String(desc ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cents(amount) {
  return Math.round(Number(amount ?? 0) * 100)
}

function dayKey(date) {
  const d = dayjs(date)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(date ?? '')
}

function withinDateWindow(a, b) {
  const da = dayjs(a)
  const db = dayjs(b)
  if (!da.isValid() || !db.isValid()) return dayKey(a) === dayKey(b)
  return Math.abs(da.diff(db, 'day')) <= DATE_WINDOW_DAYS
}

function sameSource(a, b) {
  return String(a.source ?? '').trim().toLowerCase() === String(b.source ?? '').trim().toLowerCase()
}

function descriptionsAgree(normA, normB) {
  if (!normA || !normB) return normA === normB
  if (normA === normB) return true
  // One export truncating the merchant name shouldn't hide a duplicate.
  if (normA.length >= 6 && normB.length >= 6 && (normA.startsWith(normB) || normB.startsWith(normA))) {
    return true
  }
  const tokensA = new Set(normA.split(' ').filter(Boolean))
  const tokensB = new Set(normB.split(' ').filter(Boolean))
  if (!tokensA.size || !tokensB.size) return false
  let shared = 0
  for (const token of tokensA) if (tokensB.has(token)) shared++
  return shared / Math.max(tokensA.size, tokensB.size) >= SIMILARITY_THRESHOLD
}

export function isDuplicatePair(a, b) {
  if (cents(a.amount) !== cents(b.amount)) return false
  if (!descriptionsAgree(normalizeDescription(a.description), normalizeDescription(b.description))) return false
  // A statement never lists the same charge on two different days, so within one source only an
  // exact date match is suspicious — a few days apart is a habitual repeat purchase (the same
  // corner-store run, the same monthly subscription). The window only earns its keep across
  // sources, where a PDF keyed on transaction date and a CSV keyed on posting date disagree.
  return sameSource(a, b)
    ? dayKey(a.date) === dayKey(b.date)
    : withinDateWindow(a.date, b.date)
}

// Amount is the cheapest discriminator, so candidates are bucketed by it rather than comparing
// every incoming row against every stored one.
function bucketByAmount(txs) {
  const buckets = new Map()
  for (const tx of txs) {
    const key = cents(tx.amount)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(tx)
  }
  return buckets
}

// Tags incoming rows that look like something already stored, or like an earlier row in the same
// upload — re-uploading overlapping months is the main way duplicates get in.
export function annotateDuplicates(groups, existing = []) {
  const storedBuckets = bucketByAmount(existing.filter(tx => !tx.dupDismissed))
  const batchBuckets = new Map()
  let duplicateCount = 0

  const annotated = groups.map(group => ({
    ...group,
    transactions: group.transactions.map(tx => {
      const key = cents(tx.amount)
      // The source is assigned at confirm time, so borrow the group's pending name to get the
      // same-source date rule applied to a straight re-upload.
      const probe = tx.source ? tx : { ...tx, source: group.sourceName }
      const stored = (storedBuckets.get(key) ?? []).find(candidate => isDuplicatePair(probe, candidate))
      const inBatch = stored
        ? null
        : (batchBuckets.get(key) ?? []).find(candidate => isDuplicatePair(probe, candidate.tx))

      if (!batchBuckets.has(key)) batchBuckets.set(key, [])
      batchBuckets.get(key).push({ tx: probe, fileName: group.fileName })

      if (!stored && !inBatch) return tx
      duplicateCount++
      const match = stored ?? inBatch.tx
      return {
        ...tx,
        duplicateOf: {
          date: match.date,
          description: match.description,
          origin: stored ? 'already imported' : `also in ${inBatch.fileName}`,
        },
      }
    }),
  }))

  return { groups: annotated, duplicateCount }
}

// Sets of stored transactions that look like each other. A set counts as resolved once any member
// has been marked "not a duplicate", so one click clears a pair.
export function findDuplicateGroups(transactions) {
  const groups = []
  for (const bucket of bucketByAmount(transactions).values()) {
    if (bucket.length < 2) continue
    const claimed = new Set()
    for (let i = 0; i < bucket.length; i++) {
      if (claimed.has(i)) continue
      const members = [bucket[i]]
      for (let j = i + 1; j < bucket.length; j++) {
        if (claimed.has(j)) continue
        if (isDuplicatePair(bucket[i], bucket[j])) {
          members.push(bucket[j])
          claimed.add(j)
        }
      }
      if (members.length > 1) {
        claimed.add(i)
        groups.push(members)
      }
    }
  }
  return groups.filter(members => !members.some(tx => tx.dupDismissed))
}

// Both the per-row badge and the "duplicates only" filter read from this.
export function duplicateFlags(transactions) {
  const groups = findDuplicateGroups(transactions)
  const byId = new Map()
  for (const members of groups) {
    for (const tx of members) {
      const other = members.find(m => m.id !== tx.id)
      byId.set(tx.id, { otherDate: other?.date ?? null, setSize: members.length })
    }
  }
  return { groupCount: groups.length, byId }
}
