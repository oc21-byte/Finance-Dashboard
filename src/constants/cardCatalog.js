// The credit-card catalog: published ongoing earn rates for cards the Rewards view can score.
//
// This is hand-authored static data and the app's only source of rates — nothing fetches them.
// `test/cardCatalog.test.js` validates every entry, so a bad edit fails `npm test` rather than
// quietly rendering a 0% row.
//
// THREE RULES, enforced by that test:
//
// 1. `rates` keys are app category names from `CATEGORIES` — 'Food & Dining', never 'dining';
//    'Transport', never 'gas'. The grid joins these keys against `t.category` on real rows, so a
//    key that isn't a real category scores nothing at all.
//
// 2. `coverage: 'partial'` whenever the published bonus covers only PART of an app category, with
//    a `note` saying which part. 'Transport' bundles gas, transit, rideshare and flights, so a
//    4%-gas card scored against all of Transport overstates its return. The flag is how that
//    over-estimate stays visible instead of being laundered into a confident number.
//
// 3. Caps are dollars of SPEND, not of reward: `capMo`, `capQtr`, `capYr`. `rewardsModel.js`
//    normalizes all three to a monthly figure.
//
// A card's `id` is persisted in `settings.cardRewards.wallet` and `.overrides`. It is a permanent
// contract — rename a card's display name freely, never its id.
//
// Adding a card: copy a neighbor in CARD_CATALOG, give it a new camelCase id, fill fee / base /
// rates / summary / verified. Do not put rates in components. User corrections belong in
// settings.cardRewards.overrides so a catalog update cannot clobber them.
//
// `pct` is what rewardsModel multiplies by spend. Cash-back cards use the published percent.
// Points cards use equivalent cash at these valuations (household cheat sheet, Aug 2026):
//   Chase Ultimate Rewards  2.0¢/pt   → 3x dining = 6, 1x = base 2
//   Capital One miles       1.85¢/mi  → 2x = base 3.7
//   everything else         1.0¢      → 5x = 5  (Amex MR, Bilt, BMO Rewards, Blue Points, Scene+)
// Portal-only bonuses (Chase Travel, Cap One Travel, Bilt Travel) stay in `summary` — putting
// them on Transport would score every gas fill at the portal rate. Welcome bonuses, intro APRs
// and annual travel credits are not scored; mention a credit in summary if the fee needs context.

import { CATEGORIES } from './categories.js'

/** Card ids are stored in settings; this list is what a stored id may point at. */
export const CATALOG_REGIONS = ['us', 'ca']

export const REGION_LABELS = { us: 'United States', ca: 'Canada' }

/**
 * The reward-rate axis: app categories a card can plausibly pay a bonus on.
 *
 * `Income` and `Transfer` are excluded — they are not purchases, and a rate on either would be
 * scoring money that never earns anything. `Other` stays in: it is where uncategorized spend
 * lands, and a flat-rate card genuinely does pay on it.
 */
export const RATE_CATEGORIES = CATEGORIES.filter(c => c !== 'Income' && c !== 'Transfer')

/**
 * Published ongoing earn rates, verified Aug 2026. This is the app's claim, not the issuer's —
 * `settings.cardRewards.overrides` is how a user corrects one, and a correction survives
 * replacing everything below.
 *
 * Seed ids (amexBcp, customCash, freedomUnlimited, discoverIt, activeCash, cobalt,
 * scotiaMomentum, cibcDividend, tangerine) are a persistence contract. Never rename them.
 */
export const CARD_CATALOG = [
  // --- United States --------------------------------------------------------
  {
    id: 'amexBcp',
    name: 'Amex Blue Cash Preferred',
    short: 'Blue Cash Preferred',
    issuer: 'Amex',
    region: 'us',
    fee: 95,
    summary: '6% US supermarkets (to $6k/yr) · 6% streaming · 3% gas & transit · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 6, capYr: 6000 },
      'Subscription': { pct: 6, coverage: 'partial', note: 'streaming services only' },
      'Transport': { pct: 3, coverage: 'partial', note: 'gas and transit only' },
    },
    verified: '2026-08',
  },
  {
    id: 'customCash',
    name: 'Citi Custom Cash',
    short: 'Custom Cash',
    issuer: 'Citi',
    region: 'us',
    fee: 0,
    summary: '5% on your top eligible category each cycle, to $500 · 1% else',
    base: 1,
    rates: {},
    topCat: { pct: 5, capMo: 500 },
    verified: '2026-08',
  },
  {
    id: 'freedomUnlimited',
    name: 'Chase Freedom Unlimited',
    short: 'Freedom Unlimited',
    issuer: 'Chase',
    region: 'us',
    fee: 0,
    summary: '3% dining · 3% drugstores · 1.5% everything else · 5% Chase Travel not scored as a category',
    base: 1.5,
    rates: {
      'Food & Dining': { pct: 3 },
      'Health': { pct: 3, coverage: 'partial', note: 'drugstores only' },
    },
    verified: '2026-08',
  },
  {
    id: 'discoverIt',
    name: 'Discover it Cash Back',
    short: 'Discover it',
    issuer: 'Discover',
    region: 'us',
    fee: 0,
    summary: "5% on this quarter's rotating category, to $1,500 · 1% everything else",
    base: 1,
    rates: {},
    // The category changes every quarter and the user activates it manually, so there is nothing
    // to publish here — `settings.cardRewards.wallet[source].quarters` is the only record of what
    // a given quarter actually was, and an unrecorded quarter is scored at the base rate.
    rotating: { pct: 5, capQtr: 1500 },
    verified: '2026-08',
  },
  {
    id: 'activeCash',
    name: 'Wells Fargo Active Cash',
    short: 'Active Cash',
    issuer: 'Wells Fargo',
    region: 'us',
    fee: 0,
    summary: 'Flat 2% on every purchase, no categories to track',
    base: 2,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'savor',
    name: 'Capital One Savor',
    short: 'Savor',
    issuer: 'Capital One',
    region: 'us',
    fee: 0,
    summary: '3% grocery, dining, entertainment and streaming · 1% else · 8% Cap One Entertainment not scored as a category',
    base: 1,
    rates: {
      'Food & Dining': { pct: 3 },
      'Grocery': { pct: 3, coverage: 'partial', note: 'excludes Walmart, Target and warehouse clubs' },
      'Entertainment': { pct: 3 },
      'Subscription': { pct: 3, coverage: 'partial', note: 'popular streaming services only' },
    },
    verified: '2026-08',
  },
  {
    id: 'tdCash',
    name: 'TD Cash',
    short: 'TD Cash',
    issuer: 'TD',
    region: 'us',
    fee: 0,
    summary: '3% and 2% on two categories you choose each quarter · 1% else · superstores and warehouse clubs always 1%',
    base: 1,
    rates: {},
    chooser: { pcts: [3, 2] },
    verified: '2026-08',
  },
  {
    id: 'sapphireReserve',
    name: 'Chase Sapphire Reserve',
    short: 'Sapphire Reserve',
    issuer: 'Chase',
    region: 'us',
    fee: 795,
    summary: '3x dining (~6% at 2¢/pt) · 1x else (~2%) · 8x Chase Travel and 4x direct flights/hotels in summary only · $300 travel credit not scored',
    base: 2,
    rates: {
      'Food & Dining': { pct: 6 },
    },
    verified: '2026-08',
  },
  {
    id: 'ventureX',
    name: 'Capital One Venture X',
    short: 'Venture X',
    issuer: 'Capital One',
    region: 'us',
    fee: 395,
    summary: '2x miles on everything (~3.7% at 1.85¢/mi) · 10x Cap One Travel hotels/cars in summary only · $300 travel credit not scored',
    base: 3.7,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'tjxRewards',
    name: 'TJX Rewards+',
    short: 'TJX Rewards+',
    issuer: 'TJX',
    region: 'us',
    fee: 0,
    summary: '5% at T.J. Maxx, Marshalls, HomeGoods, Sierra and Homesense, paid in store certificates · 1% else',
    base: 1,
    rates: {
      'Shopping': { pct: 5, coverage: 'partial', note: 'T.J. Maxx, Marshalls, HomeGoods, Sierra and Homesense; paid in certificates' },
    },
    verified: '2026-08',
  },
  {
    id: 'sapphirePreferred',
    name: 'Chase Sapphire Preferred',
    short: 'Sapphire Preferred',
    issuer: 'Chase',
    region: 'us',
    fee: 95,
    summary: '3x dining, streaming, online groceries, gas & EV (~6% at 2¢/pt) · 2x other travel · 1x else (~2%) · 5x Chase Travel and $100 hotel credit not scored as categories',
    base: 2,
    rates: {
      'Food & Dining': { pct: 6 },
      'Grocery': { pct: 6, coverage: 'partial', note: 'online groceries excluding Target, Walmart and wholesale clubs' },
      'Subscription': { pct: 6, coverage: 'partial', note: 'top streaming services only' },
      'Transport': { pct: 6, coverage: 'partial', note: 'gas and EV charging; other travel is 2x (~4%)' },
    },
    verified: '2026-08',
  },
  {
    id: 'freedomFlex',
    name: 'Chase Freedom Flex',
    short: 'Freedom Flex',
    issuer: 'Chase',
    region: 'us',
    fee: 0,
    summary: '5% rotating categories to $1,500/quarter · 3% dining and drugstores · 1% else · 5% Chase Travel not scored as a category',
    base: 1,
    rates: {
      'Food & Dining': { pct: 3 },
      'Health': { pct: 3, coverage: 'partial', note: 'drugstores only' },
    },
    rotating: { pct: 5, capQtr: 1500 },
    verified: '2026-08',
  },
  {
    id: 'amexGold',
    name: 'American Express Gold Card',
    short: 'Amex Gold',
    issuer: 'Amex',
    region: 'us',
    fee: 325,
    summary: '4x restaurants (to $50k/yr) · 4x US supermarkets (to $25k/yr) · 3x flights · 1x else · dining credits not scored',
    base: 1,
    rates: {
      'Food & Dining': { pct: 4, capYr: 50000 },
      'Grocery': { pct: 4, capYr: 25000 },
      'Transport': { pct: 3, coverage: 'partial', note: 'flights booked direct or via Amex Travel' },
    },
    verified: '2026-08',
  },
  {
    id: 'amexPlat',
    name: 'American Express Platinum Card',
    short: 'Amex Platinum',
    issuer: 'Amex',
    region: 'us',
    fee: 895,
    summary: '5x flights and prepaid hotels via Amex Travel · 1x else · credits and lounge access not scored',
    base: 1,
    rates: {
      'Transport': { pct: 5, coverage: 'partial', note: 'flights booked direct or via Amex Travel, and prepaid hotels via Amex Travel' },
    },
    verified: '2026-08',
  },
  {
    id: 'citiDoubleCash',
    name: 'Citi Double Cash',
    short: 'Double Cash',
    issuer: 'Citi',
    region: 'us',
    fee: 0,
    summary: '2% on every purchase (1% when you buy, 1% when you pay)',
    base: 2,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'venture',
    name: 'Capital One Venture',
    short: 'Venture',
    issuer: 'Capital One',
    region: 'us',
    fee: 95,
    summary: '2x miles on everything (~3.7% at 1.85¢/mi) · 5x Cap One Travel in summary only',
    base: 3.7,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'autograph',
    name: 'Wells Fargo Autograph',
    short: 'Autograph',
    issuer: 'Wells Fargo',
    region: 'us',
    fee: 0,
    summary: '3x dining, travel, transit, gas, streaming and phone plans · 1x else',
    base: 1,
    rates: {
      'Food & Dining': { pct: 3 },
      'Transport': { pct: 3, coverage: 'partial', note: 'gas, transit and travel' },
      'Subscription': { pct: 3, coverage: 'partial', note: 'popular streaming services and phone plans' },
    },
    verified: '2026-08',
  },
  {
    id: 'boaCustomCash',
    name: 'Bank of America Customized Cash Rewards',
    short: 'Customized Cash',
    issuer: 'Bank of America',
    region: 'us',
    fee: 0,
    summary: '3% on a category you choose · 2% grocery and wholesale · 1% else · combined bonus spend to $2,500/quarter then 1% · Preferred Rewards boost not scored',
    base: 1,
    rates: {
      'Grocery': { pct: 2 },
      'Shopping': { pct: 2, coverage: 'partial', note: 'wholesale clubs' },
    },
    chooser: { pcts: [3] },
    verified: '2026-08',
  },
  {
    id: 'amexBce',
    name: 'Amex Blue Cash Everyday',
    short: 'Blue Cash Everyday',
    issuer: 'Amex',
    region: 'us',
    fee: 0,
    summary: '3% US supermarkets, US gas and US online retail, each to $6k/yr then 1% · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 3, capYr: 6000 },
      'Transport': { pct: 3, coverage: 'partial', note: 'US gas stations only', capYr: 6000 },
      'Shopping': { pct: 3, coverage: 'partial', note: 'US online retail only', capYr: 6000 },
    },
    verified: '2026-08',
  },
  {
    id: 'costcoAnywhere',
    name: 'Costco Anywhere Visa',
    short: 'Costco Anywhere',
    issuer: 'Citi',
    region: 'us',
    fee: 0,
    summary: '4% gas & EV (to $7k/yr) · 3% dining and travel · 2% Costco · 1% else · Costco membership required, no card fee',
    base: 1,
    rates: {
      'Transport': { pct: 4, capYr: 7000, coverage: 'partial', note: 'gas and EV charging; dining/travel is 3%' },
      'Food & Dining': { pct: 3 },
      'Shopping': { pct: 2, coverage: 'partial', note: 'Costco warehouses and Costco.com' },
    },
    verified: '2026-08',
  },
  {
    id: 'biltBlue',
    name: 'Bilt Blue',
    short: 'Bilt Blue',
    issuer: 'Bilt',
    region: 'us',
    fee: 0,
    summary: '1x everyday · up to 1.25x rent/mortgage/HOA paid through Bilt · neighborhood dining, Lyft and Bilt Travel bonuses in summary only',
    base: 1,
    rates: {
      'Housing': { pct: 1.25, coverage: 'partial', note: 'rent, mortgage and HOA paid through Bilt' },
    },
    verified: '2026-08',
  },
  {
    id: 'biltObsidian',
    name: 'Bilt Obsidian',
    short: 'Bilt Obsidian',
    issuer: 'Bilt',
    region: 'us',
    fee: 95,
    summary: '3x dining or grocery (grocery to $25k/yr — cap not attached to the chooser slot) · 2x travel · 1x else · 1.25x housing through Bilt · $100 Bilt Travel hotel credit not scored',
    base: 1,
    rates: {
      'Transport': { pct: 2, coverage: 'partial', note: 'travel; Bilt Travel hotels/flights stack higher, in summary only' },
      'Housing': { pct: 1.25, coverage: 'partial', note: 'rent, mortgage and HOA paid through Bilt' },
    },
    chooser: { pcts: [3] },
    verified: '2026-08',
  },
  {
    id: 'biltPalladium',
    name: 'Bilt Palladium',
    short: 'Bilt Palladium',
    issuer: 'Bilt',
    region: 'us',
    fee: 495,
    summary: '2x everyday · 1.25x housing through Bilt so rent does not inherit the 2% base · $400 Bilt Travel hotel credit and $200 Bilt Cash not scored',
    base: 2,
    rates: {
      'Housing': { pct: 1.25, coverage: 'partial', note: 'rent, mortgage and HOA paid through Bilt — not the 2x everyday rate' },
    },
    verified: '2026-08',
  },

  // --- Canada ---------------------------------------------------------------
  {
    id: 'cobalt',
    name: 'Amex Cobalt',
    short: 'Cobalt',
    issuer: 'Amex',
    region: 'ca',
    fee: 156,
    summary: '5x eats & groceries · 3x streaming · 2x transit & gas · 1x else',
    base: 1,
    rates: {
      'Food & Dining': { pct: 5 },
      'Grocery': { pct: 5, capYr: 30000 },
      'Subscription': { pct: 3, coverage: 'partial', note: 'streaming services only' },
      'Transport': { pct: 2, coverage: 'partial', note: 'transit and gas only' },
    },
    verified: '2026-08',
  },
  {
    id: 'scotiaMomentum',
    name: 'Scotiabank Momentum Visa Infinite',
    short: 'Momentum',
    issuer: 'Scotiabank',
    region: 'ca',
    fee: 120,
    summary: '4% groceries & recurring bills · 2% gas & transit · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 4, capYr: 25000 },
      'Subscription': { pct: 4, coverage: 'partial', note: 'recurring bill payments only' },
      'Transport': { pct: 2, coverage: 'partial', note: 'gas and transit only' },
    },
    verified: '2026-08',
  },
  {
    id: 'cibcDividend',
    name: 'CIBC Dividend Visa Infinite',
    short: 'Dividend',
    issuer: 'CIBC',
    region: 'ca',
    fee: 120,
    summary: '4% gas & EV charging · 4% groceries · 2% dining & transit · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 4, capYr: 20000 },
      'Transport': { pct: 4, coverage: 'partial', note: 'gas and EV charging only' },
      'Food & Dining': { pct: 2 },
    },
    verified: '2026-08',
  },
  {
    id: 'tangerine',
    name: 'Tangerine Money-Back',
    short: 'Money-Back',
    issuer: 'Tangerine',
    region: 'ca',
    fee: 0,
    summary: '2% on two or three categories you choose · 0.5% else',
    base: 0.5,
    rates: {},
    chooser: { pcts: [2, 2] },
    verified: '2026-08',
  },
  {
    id: 'simplyCashPref',
    name: 'SimplyCash Preferred',
    short: 'SimplyCash Preferred',
    issuer: 'Amex',
    region: 'ca',
    fee: 120,
    summary: '4% groceries and gas (to $1,200 cash back/yr, ~$30k spend) · 2% everything else',
    base: 2,
    rates: {
      'Grocery': { pct: 4, capYr: 30000 },
      'Transport': { pct: 4, coverage: 'partial', note: 'gas only' },
    },
    verified: '2026-08',
  },
  {
    id: 'rogersRed',
    name: 'Rogers Red World Elite',
    short: 'Rogers Red',
    issuer: 'Rogers Bank',
    region: 'ca',
    fee: 0,
    summary: '2% on everything for Rogers/Fido/Shaw customers · 1.5% without that bill · Aug 2026 annual spend cap then a lower rate · 3% on the Rogers bill in summary only',
    base: 2,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'tdCashBackInfinite',
    name: 'TD Cash Back Visa Infinite',
    short: 'TD Cash Back Infinite',
    issuer: 'TD',
    region: 'ca',
    fee: 139,
    summary: '3% grocery, gas/EV, transit, recurring bills and streaming, each to $15k/yr then 1% · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 3, capYr: 15000 },
      'Transport': { pct: 3, capYr: 15000, coverage: 'partial', note: 'gas, EV charging and public transit' },
      'Subscription': { pct: 3, capYr: 15000, coverage: 'partial', note: 'recurring bills, streaming, digital gaming and media' },
    },
    verified: '2026-08',
  },
  {
    id: 'scotiaPassport',
    name: 'Scotiabank Passport Visa Infinite+',
    short: 'Passport',
    issuer: 'Scotiabank',
    region: 'ca',
    fee: 150,
    summary: '3x Scene+ at Sobeys family grocers · 2x other grocery, dining, entertainment and daily transit · 1x else · no foreign-transaction fee · Scene+ Travel hotels in summary only',
    base: 1,
    rates: {
      'Grocery': { pct: 3, coverage: 'partial', note: 'Sobeys, Safeway, IGA, Foodland and participating Co-ops; other grocery is 2x' },
      'Food & Dining': { pct: 2 },
      'Entertainment': { pct: 2 },
      'Transport': { pct: 2, coverage: 'partial', note: 'daily transit, rideshare, taxis; Scene+ Travel hotels/cars stack higher, in summary only' },
    },
    verified: '2026-08',
  },
  {
    id: 'pcWorldElite',
    name: 'PC Financial World Elite Mastercard',
    short: 'PC World Elite',
    issuer: 'PC Financial',
    region: 'ca',
    fee: 0,
    summary: '4.5% Shoppers Drug Mart · 3% Loblaws-banner groceries · 3% Esso/Mobil · 1% else · redeemable as PC Optimum',
    base: 1,
    rates: {
      'Health': { pct: 4.5, coverage: 'partial', note: 'Shoppers Drug Mart and Pharmaprix' },
      'Grocery': { pct: 3, coverage: 'partial', note: 'Loblaws-banner grocery stores' },
      'Transport': { pct: 3, coverage: 'partial', note: 'Esso and Mobil stations' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoCashBackWE',
    name: 'BMO CashBack World Elite Mastercard',
    short: 'BMO CashBack WE',
    issuer: 'BMO',
    region: 'ca',
    fee: 139,
    summary: '5% groceries to $500/statement · 4% transit to $300 · 3% gas/EV to $300 · 2% recurring to $500 · 1% else',
    base: 1,
    rates: {
      'Grocery': { pct: 5, capMo: 500 },
      'Transport': { pct: 4, capMo: 300, coverage: 'partial', note: 'transit, rideshare and taxis; gas and EV is 3% to $300/statement' },
      'Subscription': { pct: 2, capMo: 500, coverage: 'partial', note: 'recurring bill payments' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoCashBack',
    name: 'BMO CashBack Mastercard',
    short: 'BMO CashBack',
    issuer: 'BMO',
    region: 'ca',
    fee: 0,
    summary: '3% groceries to $500/statement · 1% recurring bills · 0.5% else',
    base: 0.5,
    rates: {
      'Grocery': { pct: 3, capMo: 500 },
      'Subscription': { pct: 1, coverage: 'partial', note: 'recurring bill payments' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoEclipseVI',
    name: 'BMO eclipse Visa Infinite',
    short: 'eclipse Visa Infinite',
    issuer: 'BMO',
    region: 'ca',
    fee: 120,
    summary: '5x BMO Rewards on dining, groceries, gas and transit in Canada (combined ~$50k/yr then 1x) · 1x else · $50 lifestyle credit not scored',
    base: 1,
    rates: {
      'Food & Dining': { pct: 5 },
      'Grocery': { pct: 5 },
      'Transport': { pct: 5, coverage: 'partial', note: 'gas, public transit and rideshare in Canada' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoAscendWE',
    name: 'BMO Ascend World Elite Mastercard',
    short: 'BMO Ascend',
    issuer: 'BMO',
    region: 'ca',
    fee: 150,
    summary: '5x eligible travel · 3x dining, entertainment and recurring bills · 1x else',
    base: 1,
    rates: {
      'Transport': { pct: 5, coverage: 'partial', note: 'eligible travel purchases' },
      'Food & Dining': { pct: 3 },
      'Entertainment': { pct: 3 },
      'Subscription': { pct: 3, coverage: 'partial', note: 'recurring bill payments' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoStudentCashBack',
    name: 'BMO Student CashBack Mastercard',
    short: 'BMO Student CashBack',
    issuer: 'BMO',
    region: 'ca',
    fee: 0,
    summary: '3% groceries to $500/statement · 1% recurring bills · 0.5% else',
    base: 0.5,
    rates: {
      'Grocery': { pct: 3, capMo: 500 },
      'Subscription': { pct: 1, coverage: 'partial', note: 'recurring bill payments' },
    },
    verified: '2026-08',
  },
  {
    id: 'bmoBlue',
    name: 'BMO Blue Rewards Mastercard',
    short: 'Blue Rewards',
    issuer: 'BMO',
    region: 'ca',
    fee: 0,
    summary: '1x Blue Points on groceries, gas, EV, wholesale and everything else · 5x at Blue Rewards partners (to $500/statement) in summary only · ex-AIR MILES',
    base: 1,
    rates: {},
    verified: '2026-08',
  },
  {
    id: 'bmoBlueWE',
    name: 'BMO Blue Rewards World Elite Mastercard',
    short: 'Blue Rewards WE',
    issuer: 'BMO',
    region: 'ca',
    fee: 120,
    summary: '2x Blue Points on groceries, gas, EV, wholesale and alcohol · 1x else · 10x at Blue Rewards partners (to $1,000/statement) in summary only · ex-AIR MILES',
    base: 1,
    rates: {
      'Grocery': { pct: 2 },
      'Transport': { pct: 2, coverage: 'partial', note: 'gas and EV charging' },
      'Shopping': { pct: 2, coverage: 'partial', note: 'wholesale clubs and alcohol' },
    },
    verified: '2026-08',
  },
]

const BY_ID = new Map(CARD_CATALOG.map(c => [c.id, c]))

/** A catalog card by id, or null. Never throws — a stored id can outlive a catalog entry. */
export function catalogCard(id) {
  return BY_ID.get(id) ?? null
}

/**
 * Newest `verified` stamp in the catalog, `YYYY-MM`. The view uses this to say how current the
 * rates are, and to go quiet about its own accuracy once they are old.
 */
export function catalogVerifiedAt(catalog = CARD_CATALOG) {
  return catalog.reduce((newest, c) => (c.verified > newest ? c.verified : newest), '')
}
