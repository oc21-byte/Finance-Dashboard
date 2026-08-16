import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES } from '../src/constants/categories.js'
import {
  CARD_CATALOG, CATALOG_REGIONS, RATE_CATEGORIES, catalogCard, catalogVerifiedAt,
} from '../src/constants/cardCatalog.js'

// The catalog is hand-authored static data and the app's only source of earn rates. Nothing
// validates it at runtime, so this file is the guard rail: a bad hand-edit, or a future authoring
// pass that keys rates by the mockup's names instead of the app's categories, fails here rather
// than quietly rendering a 0% row that looks like a real answer.

test('every card carries the fields the model reads', () => {
  for (const card of CARD_CATALOG) {
    assert.ok(card.id, 'card is missing an id')
    for (const field of ['name', 'short', 'issuer', 'summary', 'verified']) {
      assert.equal(typeof card[field], 'string', `${card.id}.${field} must be a string`)
      assert.ok(card[field].length, `${card.id}.${field} must not be empty`)
    }
    assert.ok(CATALOG_REGIONS.includes(card.region), `${card.id} has region ${card.region}`)
    assert.equal(typeof card.base, 'number', `${card.id}.base must be a number`)
    assert.ok(card.base >= 0, `${card.id}.base must not be negative`)
    assert.equal(typeof card.fee, 'number', `${card.id}.fee must be a number`)
    assert.ok(card.fee >= 0, `${card.id}.fee must not be negative`)
    assert.equal(typeof card.rates, 'object', `${card.id}.rates must be an object`)
  }
})

test('ids are unique — they are persisted in settings and are a permanent contract', () => {
  const ids = CARD_CATALOG.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate catalog id')
})

test('every rate key is a real app category', () => {
  for (const card of CARD_CATALOG) {
    for (const category of Object.keys(card.rates)) {
      assert.ok(
        RATE_CATEGORIES.includes(category),
        `${card.id} pays on "${category}", which is not an app category. Rates key on ` +
        `CATEGORIES ('Food & Dining', 'Transport'), never the mockup's names ('dining', 'gas').`,
      )
    }
  }
})

test('Income and Transfer are not rateable — they are not purchases', () => {
  assert.ok(!RATE_CATEGORIES.includes('Income'))
  assert.ok(!RATE_CATEGORIES.includes('Transfer'))
  // Everything else a card can be swiped for stays available, including Other.
  assert.ok(RATE_CATEGORIES.includes('Other'))
  assert.equal(RATE_CATEGORIES.length, CATEGORIES.length - 2)
})

test('rates are positive percentages with at most one cap, and caps are positive', () => {
  for (const card of CARD_CATALOG) {
    for (const [category, rate] of Object.entries(card.rates)) {
      const where = `${card.id}.rates['${category}']`
      assert.equal(typeof rate.pct, 'number', `${where}.pct must be a number`)
      assert.ok(rate.pct > 0, `${where}.pct must be positive`)
      const caps = ['capMo', 'capQtr', 'capYr'].filter(k => rate[k] != null)
      assert.ok(caps.length <= 1, `${where} declares ${caps.length} caps; use exactly one`)
      for (const cap of caps) assert.ok(rate[cap] > 0, `${where}.${cap} must be positive`)
    }
  }
})

test('a bonus that covers only part of a category is flagged, with a note saying which part', () => {
  for (const card of CARD_CATALOG) {
    for (const [category, rate] of Object.entries(card.rates)) {
      if (rate.coverage == null) continue
      assert.equal(
        rate.coverage, 'partial',
        `${card.id}.rates['${category}'].coverage must be 'partial' or absent`,
      )
      assert.ok(
        typeof rate.note === 'string' && rate.note.length,
        `${card.id}.rates['${category}'] is partial but says nothing about which part it covers`,
      )
    }
  }
})

test('Transport bonuses are always partial — the category bundles gas, transit and flights', () => {
  for (const card of CARD_CATALOG) {
    const rate = card.rates.Transport
    if (!rate) continue
    assert.equal(
      rate.coverage, 'partial',
      `${card.id} pays ${rate.pct}% on all of Transport. No issuer does: the category bundles ` +
      `gas, transit, rideshare and flights. Mark it partial or drop it.`,
    )
  }
})

test('the special-rate shapes the model branches on are well formed', () => {
  for (const card of CARD_CATALOG) {
    if (card.topCat) {
      assert.ok(card.topCat.pct > 0, `${card.id}.topCat.pct must be positive`)
    }
    if (card.rotating) {
      assert.ok(card.rotating.pct > 0, `${card.id}.rotating.pct must be positive`)
    }
    if (card.chooser) {
      assert.ok(Array.isArray(card.chooser.pcts), `${card.id}.chooser.pcts must be an array`)
      assert.ok(card.chooser.pcts.length > 0, `${card.id}.chooser.pcts must not be empty`)
      for (const pct of card.chooser.pcts) {
        assert.ok(pct > 0, `${card.id}.chooser.pcts holds a non-positive rate`)
      }
    }
  }
})

test('verified stamps are YYYY-MM, and the newest is reported', () => {
  for (const card of CARD_CATALOG) {
    assert.match(card.verified, /^\d{4}-(0[1-9]|1[0-2])$/, `${card.id}.verified must be YYYY-MM`)
  }
  assert.equal(catalogVerifiedAt(), CARD_CATALOG.map(c => c.verified).sort().at(-1))
})

test('both regions are represented, so the region chips are never empty', () => {
  for (const region of CATALOG_REGIONS) {
    assert.ok(CARD_CATALOG.some(c => c.region === region), `no cards for region ${region}`)
  }
})

test('catalogCard returns null for an id the catalog no longer has', () => {
  assert.equal(catalogCard('amexBcp')?.short, 'Blue Cash Preferred')
  // A stored id is allowed to outlive its catalog row; the view re-links it rather than throwing.
  assert.equal(catalogCard('retiredCardFromTwoVersionsAgo'), null)
  assert.equal(catalogCard(undefined), null)
})

test('the authored catalog is 23 US and 16 Canada cards', () => {
  const us = CARD_CATALOG.filter(c => c.region === 'us')
  const ca = CARD_CATALOG.filter(c => c.region === 'ca')
  assert.equal(us.length, 23)
  assert.equal(ca.length, 16)
})
